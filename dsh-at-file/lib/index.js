/**
 * dsh-at-file — host half.
 *
 * Two responsibilities:
 *
 *   1. GET /dsh-at-file/list?cwd=<workspace>&q=<query>
 *      A bounded JSON directory of the session workspace, for the composer
 *      @-picker on the client. Entries are files only, workspace-relative
 *      (forward slashes), sorted by how well they match `q`.
 *
 *   2. agent/pre-step expansion
 *      Scans each user message for `@token` mentions, resolves the token
 *      against the session cwd (only files INSIDE the workspace root), and
 *      inlines the file's text right into the message that enters the model
 *      step. The durable transcript keeps the original `@token`; only the
 *      model-facing step sees the attached content. Tokens that do not
 *      resolve (typos, `@user`, email addresses, directories, binaries,
 *      oversized files) are left untouched, so ordinary prose never breaks.
 *
 * The waterfall chain is preserved: `next()` runs first, and the decision is
 * only replaced when something actually expanded.
 */
export const name = "at-file";
/** Services required before the routes and the pre-step hook can run. */
export const inject = ["webServer", "fs"];

const MAX_INLINE_BYTES = 64 * 1024;
const MAX_LIST_FILES = 2000;
const MAX_DEPTH = 4;
const MAX_RESULTS = 60;
/** Directories never walked by the picker (build noise, caches, VCS). */
const SKIP_DIRS = new Set([
	"node_modules", ".git", ".hg", ".svn", "dist", "build", "out",
	".next", ".nuxt", ".output", ".turbo", ".cache", ".parcel-cache",
	".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache",
	".idea", ".vscode", ".dsh", ".DS_Store"
]);
/** Trailing punctuation that cannot be part of a path token (CJK + ASCII). */
const TRAILING_PUNCT = /[，。！？；：、（）【】《》〈〉“”‘’"'()\[\]{}<>|&$#%^=+,;:!?]+$/g;

/**
 * Find every `@token` mention in a text. A token starts at an `@` whose
 * previous char is not an ASCII word char (so `a@b` / `user@example.com`
 * never trigger), runs to the next whitespace or `@`, and has trailing
 * punctuation trimmed. Returns [{ start, end, token }] in text order; `end`
 * is exclusive and covers exactly the consumed `@` + token span.
 */
function tokenizeAt(text) {
	const out = [];
	let i = 0;
	while (i < text.length) {
		const at = text.indexOf("@", i);
		if (at === -1) break;
		const prev = at > 0 ? text[at - 1] : "";
		if (/[A-Za-z0-9_]/.test(prev)) {
			i = at + 1;
			continue;
		}
		let j = at + 1;
		while (j < text.length && !/\s/.test(text[j]) && text[j] !== "@") j++;
		let raw = text.slice(at + 1, j);
		raw = raw.replace(TRAILING_PUNCT, "");
		if (raw.length > 0) {
			out.push({ start: at, end: at + 1 + raw.length, token: raw });
		}
		i = j;
	}
	return out;
}

/**
 * Expand one token into its attached-file block, or return null when the
 * token does not name a readable text file inside the workspace root.
 */
async function inlineToken(fs, cwd, cwdTarget, token, signal) {
	let target;
	try {
		target = await fs.resolve(token, { cwd });
	} catch {
		return null;
	}
	let info;
	try {
		info = await fs.stat(target, signal);
	} catch {
		return null;
	}
	if (!info || info.type !== "file") return null;
	if (!fs.contains(cwdTarget, target)) return null;
	const size = typeof info.size === "number" ? info.size : undefined;
	if (size !== undefined && size > MAX_INLINE_BYTES) {
		return `[附件 @${token} 超过 ${MAX_INLINE_BYTES} 字节（实际 ${size} 字节），未内联；如需内容请用 read 工具查看]`;
	}
	let content;
	try {
		content = await fs.readText(target, signal);
	} catch {
		// Binary / unreadable: keep the token so the model can open it itself.
		return null;
	}
	const rel = token.split(/[\\/]/).join("/").replace(/^\.\//, "");
	return `<attached file: ${rel} (${size ?? content.length} bytes)>\n${content}\n</attached file>`;
}

/** Expand every resolvable `@token` in one text block. */
async function expandText(fs, cwd, cwdTarget, text, signal) {
	const tokens = tokenizeAt(text);
	if (tokens.length === 0) return text;
	const parts = [];
	let cursor = 0;
	let changed = false;
	for (const tok of tokens) {
		signal.throwIfAborted();
		const replacement = await inlineToken(fs, cwd, cwdTarget, tok.token, signal);
		if (replacement === null) continue;
		changed = true;
		parts.push(text.slice(cursor, tok.start), replacement);
		cursor = tok.end;
	}
	if (!changed) return text;
	parts.push(text.slice(cursor));
	return parts.join("");
}

/**
 * Expand user-role messages' text blocks. Returns the SAME array reference
 * when nothing changed, so the pre-step handler can cheaply keep the
 * downstream decision untouched.
 */
async function expandMessages(fs, agent, messages, signal) {
	const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd;
	if (!cwd || !Array.isArray(messages)) return messages;
	let cwdTarget;
	try {
		cwdTarget = await fs.resolve(cwd);
	} catch {
		return messages;
	}
	let changed = false;
	const out = [];
	for (const message of messages) {
		if (message.role !== "user" || !Array.isArray(message.content)) {
			out.push(message);
			continue;
		}
		let blockChanged = false;
		const content = [];
		for (const block of message.content) {
			if (block && block.type === "text" && typeof block.text === "string") {
				signal.throwIfAborted();
				const expanded = await expandText(fs, cwd, cwdTarget, block.text, signal);
				if (expanded !== block.text) {
					blockChanged = true;
					content.push({ ...block, text: expanded });
				} else {
					content.push(block);
				}
			} else {
				content.push(block);
			}
		}
		if (blockChanged) {
			changed = true;
			out.push({ ...message, content });
		} else {
			out.push(message);
		}
	}
	return changed ? out : messages;
}

/** Recursive workspace walk; collects files with relative forward-slash paths. */
async function walk(fs, target, rel, files, depth) {
	if (files.length >= MAX_LIST_FILES || depth > MAX_DEPTH) return;
	let entries;
	try {
		entries = await fs.listDir(target);
	} catch {
		return;
	}
	if (!Array.isArray(entries)) return;
	for (const entry of entries) {
		if (files.length >= MAX_LIST_FILES) return;
		const childRel = rel ? rel + "/" + entry.name : entry.name;
		if (entry.type === "directory") {
			if (SKIP_DIRS.has(entry.name)) continue;
			await walk(fs, entry.target, childRel, files, depth + 1);
		} else if (entry.type === "file") {
			files.push({
				path: childRel,
				name: entry.name,
				size: typeof entry.size === "number" ? entry.size : undefined
			});
		}
	}
}

function byPath(a, b) {
	const la = a.path.toLowerCase();
	const lb = b.path.toLowerCase();
	if (la < lb) return -1;
	if (la > lb) return 1;
	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Rank files by how well they match the picker query. */
function filterFiles(files, q) {
	if (!q) {
		return files.slice().sort(byPath);
	}
	const lower = q.toLowerCase();
	const scored = [];
	for (const f of files) {
		const p = f.path.toLowerCase();
		const n = f.name.toLowerCase();
		let score = -1;
		if (n.startsWith(lower)) score = 0;
		else if (p.startsWith(lower)) score = 1;
		else if (p.includes(lower)) score = 2;
		else if (n.includes(lower)) score = 3;
		if (score >= 0) scored.push({ f, score });
	}
	scored.sort((a, b) => a.score - b.score || byPath(a.f, b.f));
	return scored.map((s) => s.f);
}

function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}

/** Mount the routes and the message-expansion hook. */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-at-file/list",
		handler: async (req, res) => {
			try {
				const url = new URL(req.url ?? "/", "http://dsh.local");
				const cwd = url.searchParams.get("cwd") || "";
				const q = (url.searchParams.get("q") || "").trim();
				if (!cwd) {
					sendJson(res, 400, { ok: false, error: "missing cwd" });
					return;
				}
				const root = await ctx.fs.resolve(cwd);
				const info = await ctx.fs.stat(root);
				if (!info || info.type !== "directory") {
					sendJson(res, 400, { ok: false, error: "cwd is not a directory" });
					return;
				}
				const files = [];
				await walk(ctx.fs, root, "", files, 0);
				const matches = filterFiles(files, q).slice(0, MAX_RESULTS);
				sendJson(res, 200, { ok: true, cwd, q, count: matches.length, files: matches });
			} catch (error) {
				sendJson(res, 500, {
					ok: false,
					error: String((error && error.message) || error)
				});
			}
		}
	}), "at-file: list route");

	ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject") return decision;
		try {
			signal.throwIfAborted();
			const expanded = await expandMessages(ctx.fs, agent, decision.messages, signal);
			signal.throwIfAborted();
			if (expanded === decision.messages) return decision;
			return { kind: "enter", messages: expanded };
		} catch (error) {
			if (signal.aborted) throw error;
			// Fail soft: keep the downstream messages untouched.
			return decision;
		}
	});
}
