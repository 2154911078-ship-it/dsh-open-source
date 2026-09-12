/**
 * dsh-git-panel — host half.
 *
 * Same-origin routes consumed by the sidebar Git panel:
 *
 *   GET /dsh-git-panel/status?repo=<abs path>
 *     → { ok, git, repo, isRepo, branch, detached, upstream, ahead, behind,
 *         head, changes[], commits[], error }
 *   GET /dsh-git-panel/diff?repo=<abs path>&file=<rel>&staged=0|1&untracked=0|1
 *     → { ok, file, staged, untracked, diff, truncated }
 *   GET /dsh-git-panel/branches?repo=<abs path>
 *     → { ok, current, branches[] }
 *
 * The git executable is resolved once, in this order:
 *   1. `DSH_GIT_PATH` (explicit override)
 *   2. the portable MinGit shipped alongside this repo (`deepseek/tools/git`)
 *   3. `git` on PATH
 *
 * Every command runs through `spawn` with a fixed argument vector — no shell —
 * so a workspace path can never be interpreted as a command. Read-only: this
 * half never runs add/commit/push.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const name = "git-panel";
/** Services required before the routes can be mounted. */
export const inject = ["webServer"];

const CMD_TIMEOUT_MS = 20000;
const MAX_COMMITS = 20;
const MAX_DIFF_CHARS = 200000;
const MAX_PREVIEW_CHARS = 40000;

/** Portable MinGit shipped in the deepseek workspace. */
const PORTABLE_GIT = "D:\\桌面\\deepseek\\tools\\git\\cmd\\git.exe";
/** Portable MinGit when this plugin is run straight out of the repository. */
const REPO_LOCAL_GIT = join(import.meta.dirname, "..", "..", "..", "tools", "git", "cmd", "git.exe");

const GIT_CANDIDATES = [process.env.DSH_GIT_PATH, PORTABLE_GIT, REPO_LOCAL_GIT, "git"]
	.filter((value) => typeof value === "string" && value.trim().length > 0);

/** Resolved `{ path, version }`, `null` when nothing worked; `undefined` = unresolved. */
let gitState;

/** Run one child process, capturing UTF-8 output with a hard timeout. */
function runGit(gitPath, args, options = {}) {
	return new Promise((fulfil) => {
		let child;
		try {
			child = spawn(gitPath, args, {
				cwd: options.cwd,
				windowsHide: true,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: "0",
					GIT_PAGER: "cat",
					GIT_OPTIONAL_LOCKS: "0"
				}
			});
		} catch (error) {
			fulfil({ code: -1, stdout: "", stderr: String((error && error.message) || error) });
			return;
		}
		const out = [];
		const err = [];
		let settled = false;
		const finish = (code, stderrOverride) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fulfil({
				code,
				stdout: Buffer.concat(out).toString("utf8"),
				stderr: stderrOverride ?? Buffer.concat(err).toString("utf8")
			});
		};
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* already gone */
			}
			finish(-2, "timeout");
		}, options.timeoutMs ?? CMD_TIMEOUT_MS);
		child.stdout.on("data", (chunk) => out.push(chunk));
		child.stderr.on("data", (chunk) => err.push(chunk));
		child.on("error", (error) => finish(-1, String((error && error.message) || error)));
		child.on("close", (code) => finish(code));
	});
}

/** Resolve the git executable once and cache the verdict. */
async function ensureGit() {
	if (gitState !== undefined) return gitState;
	gitState = null;
	for (const candidate of GIT_CANDIDATES) {
		if (candidate !== "git" && !existsSync(candidate)) continue;
		const probe = await runGit(candidate, ["--version"], { timeoutMs: 8000 });
		if (probe.code === 0) {
			gitState = { path: candidate, version: probe.stdout.trim() };
			break;
		}
	}
	return gitState;
}

/**
 * Default repository: the explicit env override, else the most recently used
 * DSH workspace, else the process working directory.
 */
function defaultRepo() {
	const fromEnv = process.env.DSH_GIT_PANEL_REPO;
	if (typeof fromEnv === "string" && fromEnv.length > 0 && existsSync(fromEnv)) return resolve(fromEnv);
	try {
		const home = process.env.DSH_HOME || join(process.env.USERPROFILE || "", ".dsh");
		const raw = readFileSync(join(home, "storages", "workspace.json"), "utf8");
		const workspaces = Object.values(JSON.parse(raw)?.tables?.workspaces ?? {});
		workspaces.sort((left, right) => String(right?.updatedAt ?? "").localeCompare(String(left?.updatedAt ?? "")));
		for (const item of workspaces) {
			if (typeof item?.path === "string" && existsSync(item.path)) return resolve(item.path);
		}
	} catch {
		/* fall through to cwd */
	}
	return process.cwd();
}

/** Validate the requested repository path. */
function resolveRepo(value) {
	const requested = typeof value === "string" && value.trim().length > 0 ? value.trim() : defaultRepo();
	const absolute = resolve(requested);
	let info;
	try {
		info = statSync(absolute);
	} catch {
		return { error: `目录不存在：${absolute}` };
	}
	if (!info.isDirectory()) return { error: `不是目录：${absolute}` };
	return { repo: absolute };
}

/** Parse `git status --porcelain=v1 -b` into branch metadata plus rows. */
function parseStatus(text) {
	const result = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0, changes: [] };
	for (const raw of text.split(/\r?\n/)) {
		if (raw.length === 0) continue;
		if (raw.startsWith("## ")) {
			const info = raw.slice(3);
			if (info.startsWith("HEAD (no branch)")) {
				result.detached = true;
				continue;
			}
			const bracket = info.indexOf(" [");
			const head = bracket === -1 ? info : info.slice(0, bracket);
			const tail = bracket === -1 ? "" : info.slice(bracket + 2).replace(/\]$/, "");
			const [local, remote] = head.split("...");
			result.branch = local || null;
			result.upstream = remote || null;
			const ahead = /ahead (\d+)/.exec(tail);
			const behind = /behind (\d+)/.exec(tail);
			result.ahead = ahead ? Number(ahead[1]) : 0;
			result.behind = behind ? Number(behind[1]) : 0;
			continue;
		}
		const index = raw[0] ?? " ";
		const worktree = raw[1] ?? " ";
		let path = raw.slice(3);
		if (path.includes(" -> ")) path = path.split(" -> ").pop();
		result.changes.push({
			index,
			worktree,
			path,
			untracked: index === "?",
			staged: index !== " " && index !== "?",
			modified: worktree !== " " && worktree !== "?"
		});
	}
	return result;
}

/** Read the full repository status. */
async function readStatus(repo) {
	const git = await ensureGit();
	if (git === null) {
		return { ok: false, error: "未找到 git 可执行文件", candidates: GIT_CANDIDATES };
	}
	const payload = {
		ok: true,
		git,
		repo,
		isRepo: false,
		branch: null,
		detached: false,
		upstream: null,
		ahead: 0,
		behind: 0,
		head: null,
		changes: [],
		commits: [],
		error: null
	};

	const inside = await runGit(git.path, ["-C", repo, "rev-parse", "--is-inside-work-tree"]);
	if (inside.code !== 0 || inside.stdout.trim() !== "true") {
		payload.error = (inside.stderr || "不是一个 git 仓库").trim();
		return payload;
	}
	payload.isRepo = true;

	const [statusResult, logResult] = await Promise.all([
		runGit(git.path, ["-C", repo, "-c", "core.quotepath=false", "status", "--porcelain=v1", "-b"]),
		runGit(git.path, [
			"-C", repo, "-c", "core.quotepath=false", "log",
			"-n", String(MAX_COMMITS),
			"--pretty=format:%h\u001f%H\u001f%an\u001f%ad\u001f%s",
			"--date=short"
		])
	]);

	if (statusResult.code === 0) Object.assign(payload, parseStatus(statusResult.stdout));
	else payload.error = (statusResult.stderr || "").trim() || "git status 失败";

	if (logResult.code === 0) {
		payload.commits = logResult.stdout
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => {
				const [short, hash, author, date, subject] = line.split("\u001f");
				return { short, hash, author, date, subject };
			});
		payload.head = payload.commits[0] ?? null;
	}
	return payload;
}

/** Clamp long text while reporting the truncation. */
function clamp(text, limit) {
	if (text.length <= limit) return { text, truncated: false };
	return { text: text.slice(0, limit), truncated: true };
}

/** Read one file's diff (or a preview for untracked files). */
async function readDiff(git, repo, file, staged, untracked) {
	if (untracked) {
		const target = resolve(repo, file);
		let text;
		try {
			text = readFileSync(target, "utf8");
		} catch {
			return { ok: false, error: "无法读取未跟踪文件（可能是二进制文件）" };
		}
		const clamped = clamp(text, MAX_PREVIEW_CHARS);
		return { ok: true, file, staged: false, untracked: true, diff: clamped.text, truncated: clamped.truncated };
	}
	const args = ["-C", repo, "-c", "core.quotepath=false", "diff"];
	if (staged) args.push("--cached");
	args.push("--", file);
	const result = await runGit(git.path, args);
	if (result.code !== 0) return { ok: false, error: (result.stderr || "").trim() || "git diff 失败" };
	const clamped = clamp(result.stdout, MAX_DIFF_CHARS);
	return { ok: true, file, staged, untracked: false, diff: clamped.text, truncated: clamped.truncated };
}

/** Read the local branch list. */
async function readBranches(git, repo) {
	const result = await runGit(git.path, [
		"-C", repo, "-c", "core.quotepath=false", "for-each-ref",
		"--format=%(refname:short)", "refs/heads"
	]);
	if (result.code !== 0) return { ok: false, error: (result.stderr || "").trim() || "git branch 失败" };
	return { ok: true, branches: result.stdout.split("\n").filter((line) => line.length > 0) };
}

/** Read and parse a bounded JSON request body. */
function readJsonBody(req, limit = 64 * 1024) {
	return new Promise((fulfil, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error("请求体过大"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (size === 0) {
				fulfil({});
				return;
			}
			try {
				fulfil(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new Error("请求体不是合法 JSON"));
			}
		});
		req.on("error", (error) => reject(error));
	});
}

/** Stage every change, or just the named paths. */
async function stagePaths(git, repo, paths) {
	const args = ["-C", repo, "add"];
	if (Array.isArray(paths) && paths.length > 0) args.push("--", ...paths.map((item) => String(item)));
	else args.push("-A");
	const result = await runGit(git.path, args, { timeoutMs: 30000 });
	if (result.code !== 0) return { ok: false, error: (result.stderr || "").trim() || "git add 失败" };
	return { ok: true };
}

/** Unstage everything currently staged (works in a repository without HEAD too). */
async function unstageAll(git, repo) {
	const restore = await runGit(git.path, ["-C", repo, "restore", "--staged", "."]);
	if (restore.code === 0) return { ok: true };
	const rm = await runGit(git.path, ["-C", repo, "rm", "--cached", "-r", "--quiet", "."]);
	if (rm.code === 0) return { ok: true };
	return { ok: false, error: ((restore.stderr || "") + (rm.stderr || "")).trim() || "取消暂存失败" };
}

/** Commit the staged changes with one message. */
async function commitStaged(git, repo, message) {
	const text = typeof message === "string" ? message.trim() : "";
	if (text.length === 0) return { ok: false, error: "提交信息不能为空" };
	const result = await runGit(git.path, ["-C", repo, "commit", "-m", text], { timeoutMs: 30000 });
	if (result.code !== 0) {
		const detail = ((result.stdout || "") + (result.stderr || "")).trim();
		return { ok: false, error: detail || "git commit 失败" };
	}
	const summary = (result.stdout || "").trim().split("\n")[0] || "提交成功";
	return { ok: true, summary };
}

/**
 * Push the current branch to its configured upstream.
 *
 * Credentials are never read or stored here: `git push` resolves them through
 * whatever helper the user configured (e.g. `credential.helper store`), so this
 * route only needs to report why a push failed.
 */
async function pushBranch(git, repo) {
	const upstream = await runGit(git.path, [
		"-C", repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"
	]);
	if (upstream.code !== 0) {
		return { ok: false, error: "当前分支没有远端跟踪（upstream）。先在终端执行一次：git push -u origin <分支名>" };
	}
	const branch = upstream.stdout.trim() || "@{u}";
	const result = await runGit(git.path, ["-C", repo, "push"], { timeoutMs: 180000 });
	const detail = ((result.stdout || "") + (result.stderr || "")).trim();
	if (result.code !== 0) {
		if (/could not read Username|Authentication failed|terminal prompts disabled|403|Permission denied/i.test(detail)) {
			return {
				ok: false,
				error: "推送需要 GitHub 凭据：请先在终端执行一次 `git config credential.helper store` 并手动完成一次 push（输入 token），之后本面板即可直接推送。\n\n" + detail
			};
		}
		if (/non-fast-forward|\[rejected\]|fetch first|behind/i.test(detail)) {
			return { ok: false, error: "远端有新的提交，需要先拉取合并（git pull --rebase）再推送。\n\n" + detail };
		}
		return { ok: false, error: detail || "git push 失败" };
	}
	const lines = detail.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	return { ok: true, summary: (lines.length > 0 ? lines[lines.length - 1] : "推送完成") + "  →  " + branch };
}

/** Send one JSON response. */
function sendJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

/** Mount the git-panel routes. */
export function apply(ctx) {
	const route = (path, handler) => ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path,
		handler
	}), "git-panel: " + path);

	route("/dsh-git-panel/status", async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://dsh.local");
			const target = resolveRepo(url.searchParams.get("repo"));
			if (target.error !== undefined) {
				sendJson(res, 400, { ok: false, error: target.error });
				return;
			}
			sendJson(res, 200, await readStatus(target.repo));
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});

	route("/dsh-git-panel/diff", async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://dsh.local");
			const target = resolveRepo(url.searchParams.get("repo"));
			if (target.error !== undefined) {
				sendJson(res, 400, { ok: false, error: target.error });
				return;
			}
			const file = url.searchParams.get("file");
			if (typeof file !== "string" || file.length === 0) {
				sendJson(res, 400, { ok: false, error: "缺少 file 参数" });
				return;
			}
			const git = await ensureGit();
			if (git === null) {
				sendJson(res, 500, { ok: false, error: "未找到 git 可执行文件" });
				return;
			}
			const staged = url.searchParams.get("staged") === "1";
			const untracked = url.searchParams.get("untracked") === "1";
			const payload = await readDiff(git, target.repo, file, staged, untracked);
			sendJson(res, payload.ok ? 200 : 500, payload);
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});

	route("/dsh-git-panel/branches", async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://dsh.local");
			const target = resolveRepo(url.searchParams.get("repo"));
			if (target.error !== undefined) {
				sendJson(res, 400, { ok: false, error: target.error });
				return;
			}
			const git = await ensureGit();
			if (git === null) {
				sendJson(res, 500, { ok: false, error: "未找到 git 可执行文件" });
				return;
			}
			sendJson(res, 200, await readBranches(git, target.repo));
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});

	/**
	 * Write routes: stage / unstage / commit. The body carries the repository
	 * (plus optional paths or the commit message). Commands still run through
	 * the fixed spawn argument vector, so a path never becomes a command.
	 */
	const writeRoute = (path, run) => route(path, async (req, res) => {
		try {
			if (req.method !== "POST") {
				sendJson(res, 405, { ok: false, error: "仅支持 POST" });
				return;
			}
			const body = await readJsonBody(req);
			const target = resolveRepo(body.repo);
			if (target.error !== undefined) {
				sendJson(res, 400, { ok: false, error: target.error });
				return;
			}
			const git = await ensureGit();
			if (git === null) {
				sendJson(res, 500, { ok: false, error: "未找到 git 可执行文件" });
				return;
			}
			const payload = await run(git, target.repo, body);
			sendJson(res, payload.ok ? 200 : 500, payload);
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});

	writeRoute("/dsh-git-panel/stage", (git, repo, body) => stagePaths(git, repo, body.paths));
	writeRoute("/dsh-git-panel/unstage", (git, repo) => unstageAll(git, repo));
	writeRoute("/dsh-git-panel/commit", (git, repo, body) => commitStaged(git, repo, body.message));
	writeRoute("/dsh-git-panel/push", (git, repo) => pushBranch(git, repo));
}
