/**
 * dsh-image-workbench — host half.
 *
 * 图片工作台的后端：把 `out/` 目录当成图片库，对外提供四类只读/操作路由，
 * 生成与编辑则交给同目录下的 Node 脚本执行（脚本进程里注入加速工具的根证书，
 * 这样通过 Steam++ 之类工具访问图片 API 不会因证书失败）。
 *
 *   GET  /dsh-image-workbench/list            列出图片库
 *   GET  /dsh-image-workbench/file/<name>     取一张图的字节
 *   POST /dsh-image-workbench/generate        { prompt, size }        → 文生图
 *   POST /dsh-image-workbench/edit            { file, prompt, region, size } → 局部重绘 / 整图重做
 *   POST /dsh-image-workbench/delete          { file }                → 删除一张图
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const name = "image-workbench";
/** Services required before the routes can be mounted. */
export const inject = ["webServer"];

/** 图片库目录（生成结果都落在这里）。 */
const LIBRARY_DIR = "D:\\桌面\\deepseek\\out";
const NODE_BIN = "D:\\node\\node.exe";
const GENERATE_SCRIPT = join(LIBRARY_DIR, "gen-image.mjs");
const EDIT_SCRIPT = join(LIBRARY_DIR, "edit-image.mjs");
/** 加速工具的根证书：脚本子进程里注入，避免 HTTPS 证书校验失败。 */
const CA_CANDIDATES = [
	join(process.env.LOCALAPPDATA ?? "", "Steam++", "Plugins", "Accelerator", "SteamTools.Certificate.cer"),
	join(process.env.ProgramFiles ?? "", "Steam++", "Plugins", "Accelerator", "SteamTools.Certificate.cer")
];

const MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp"
};
const MAX_BYTES = 64 * 1024 * 1024;
const SCRIPT_TIMEOUT_MS = 300000;

/** 列出图片库（按修改时间倒序）。 */
function listImages() {
	if (!existsSync(LIBRARY_DIR)) return [];
	const files = [];
	for (const name of readdirSync(LIBRARY_DIR)) {
		const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
		if (MIME[ext] === undefined) continue;
		try {
			const info = statSync(join(LIBRARY_DIR, name));
			if (!info.isFile()) continue;
			files.push({ name, size: info.size, mtime: Math.round(info.mtimeMs) });
		} catch {
			/* 跳过读不到的文件 */
		}
	}
	files.sort((left, right) => right.mtime - left.mtime);
	return files;
}

/** 只允许访问图片库内的图片文件。 */
function resolveImage(name) {
	if (typeof name !== "string" || name.length === 0) return { error: "缺少文件名" };
	if (name !== basename(name)) return { error: "文件名不合法" };
	const full = resolve(join(LIBRARY_DIR, name));
	const root = resolve(LIBRARY_DIR);
	if (full !== join(root, name)) return { error: "路径越界" };
	const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
	if (MIME[ext] === undefined) return { error: "不是支持的图片格式" };
	if (!existsSync(full)) return { error: "文件不存在：" + name };
	return { path: full, name, ext };
}

/** 生成脚本子进程的环境（带上加速工具证书）。 */
function scriptEnv() {
	const env = { ...process.env };
	for (const candidate of CA_CANDIDATES) {
		if (candidate.length > 0 && existsSync(candidate)) {
			env.NODE_EXTRA_CA_CERTS = candidate;
			break;
		}
	}
	return env;
}

/** 运行一个 Node 脚本，捕获输出。 */
function runScript(script, args) {
	return new Promise((fulfil) => {
		if (!existsSync(script)) {
			fulfil({ code: -1, out: "", err: "脚本不存在：" + script });
			return;
		}
		let child;
		try {
			child = spawn(NODE_BIN, [script, ...args], { env: scriptEnv(), windowsHide: true });
		} catch (error) {
			fulfil({ code: -1, out: "", err: String((error && error.message) || error) });
			return;
		}
		const out = [];
		const err = [];
		let settled = false;
		const finish = (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fulfil({
				code,
				out: Buffer.concat(out).toString("utf8"),
				err: Buffer.concat(err).toString("utf8")
			});
		};
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* 已经结束 */
			}
			finish(-2);
		}, SCRIPT_TIMEOUT_MS);
		child.stdout.on("data", (chunk) => out.push(chunk));
		child.stderr.on("data", (chunk) => err.push(chunk));
		child.on("error", (error) => {
			err.push(Buffer.from(String((error && error.message) || error)));
			finish(-1);
		});
		child.on("close", (code) => finish(code));
	});
}

/** 读取并解析 JSON 请求体。 */
function readJsonBody(req, limit = 1024 * 1024) {
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
		req.on("error", reject);
	});
}

function sendJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

/** 比较前后两次列表，找出新生成的文件。 */
function newFiles(before, after) {
	const seen = new Set(before.map((item) => item.name));
	return after.filter((item) => !seen.has(item.name));
}

/** Mount the workbench routes. */
export function apply(ctx) {
	const route = (path, handler) => ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path,
		handler
	}), "image-workbench: " + path);

	// ── 列出图片库 ────────────────────────────────────────────────────────
	route("/dsh-image-workbench/list", async (req, res) => {
		try {
			sendJson(res, 200, { ok: true, dir: LIBRARY_DIR, files: listImages() });
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});

	// ── 取图片字节 ────────────────────────────────────────────────────────
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-image-workbench/file/",
		handler: async (req, res) => {
			try {
				const pathname = new URL(req.url ?? "/", "http://dsh.local").pathname;
				const name = decodeURIComponent(pathname.slice("/dsh-image-workbench/file/".length));
				const target = resolveImage(name);
				if (target.error !== undefined) {
					res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
					res.end(target.error);
					return;
				}
				const info = statSync(target.path);
				if (info.size > MAX_BYTES) {
					res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
					res.end("图片过大");
					return;
				}
				const bytes = readFileSync(target.path);
				res.writeHead(200, {
					"content-type": MIME[target.ext],
					"cache-control": "no-store",
					"content-length": bytes.length
				});
				res.end(bytes);
			} catch (error) {
				res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
				res.end(String((error && error.message) || error));
			}
		}
	}), "image-workbench: file route");

	// ── 文生图 ────────────────────────────────────────────────────────────
	route("/dsh-image-workbench/generate", async (req, res) => {
		try {
			if (req.method !== "POST") {
				sendJson(res, 405, { ok: false, error: "仅支持 POST" });
				return;
			}
			const body = await readJsonBody(req);
			const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
			if (prompt.length === 0) {
				sendJson(res, 400, { ok: false, error: "提示词不能为空" });
				return;
			}
			const size = typeof body.size === "string" && /^\d+x\d+$/.test(body.size) ? body.size : "1024x1024";
			const before = listImages();
			const result = await runScript(GENERATE_SCRIPT, [prompt, "--size", size]);
			const after = listImages();
			if (result.code !== 0) {
				sendJson(res, 500, {
					ok: false,
					error: (result.err || result.out || "").trim().slice(-600) || "生成失败",
					code: result.code
				});
				return;
			}
			const created = newFiles(before, after);
			sendJson(res, 200, { ok: true, created: created.map((item) => item.name), log: result.out.trim().slice(-400) });
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});

	// ── 局部重绘 / 整图重做 ───────────────────────────────────────────────
	route("/dsh-image-workbench/edit", async (req, res) => {
		try {
			if (req.method !== "POST") {
				sendJson(res, 405, { ok: false, error: "仅支持 POST" });
				return;
			}
			const body = await readJsonBody(req);
			const target = resolveImage(body.file);
			if (target.error !== undefined) {
				sendJson(res, 400, { ok: false, error: target.error });
				return;
			}
			const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
			if (prompt.length === 0) {
				sendJson(res, 400, { ok: false, error: "提示词不能为空" });
				return;
			}
			const size = typeof body.size === "string" && /^\d+x\d+$/.test(body.size) ? body.size : "1024x1024";
			const args = ["--input", target.path, "--prompt", prompt, "--size", size];
			if (typeof body.region === "string" && body.region.trim().length > 0) {
				args.push("--region", body.region.trim());
			}
			if (Number.isFinite(body.feather)) args.push("--feather", String(body.feather));

			const before = listImages();
			const result = await runScript(EDIT_SCRIPT, args);
			const after = listImages();
			if (result.code !== 0) {
				sendJson(res, 500, {
					ok: false,
					error: (result.err || result.out || "").trim().slice(-600) || "编辑失败",
					code: result.code
				});
				return;
			}
			const created = newFiles(before, after);
			sendJson(res, 200, { ok: true, created: created.map((item) => item.name), log: result.out.trim().slice(-400) });
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});

	// ── 删除 ──────────────────────────────────────────────────────────────
	route("/dsh-image-workbench/delete", async (req, res) => {
		try {
			if (req.method !== "POST") {
				sendJson(res, 405, { ok: false, error: "仅支持 POST" });
				return;
			}
			const body = await readJsonBody(req);
			const target = resolveImage(body.file);
			if (target.error !== undefined) {
				sendJson(res, 400, { ok: false, error: target.error });
				return;
			}
			unlinkSync(target.path);
			sendJson(res, 200, { ok: true, deleted: target.name });
		} catch (error) {
			sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
		}
	});
}
