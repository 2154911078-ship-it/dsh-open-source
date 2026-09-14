/**
 * gen-image.mjs —— 文生图命令行工具
 *
 * 对接 gpt-image-2.5-flare-c（OpenAI 兼容 /v1/images/generations）。
 * 支持返回 b64_json 或 url，自动保存到磁盘并打印文件路径。
 *
 * 用法：
 *   node gen-image.mjs "提示词" [-o 输出文件] [--size 1024x1024] [--n 1]
 *
 * 密钥来源（按顺序）：
 *   1. 环境变量 IMAGE_API_KEY
 *   2. 脚本同目录的 .image-key 文件
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.IMAGE_API_BASE || "https://api.tiantoken.com";
const MODEL = process.env.IMAGE_MODEL || "gpt-image-2.5-flare-c";
const DEFAULT_DIR = HERE;

// ── 参数解析 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const promptParts = [];
let out = null;
let size = "1024x1024";
let count = 1;
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === "-o" || arg === "--out") out = argv[++i];
	else if (arg === "--size") size = argv[++i];
	else if (arg === "--n") count = Number(argv[++i]) || 1;
	else if (arg === "-h" || arg === "--help") {
		console.log('用法: node gen-image.mjs "提示词" [-o 输出文件] [--size 1024x1024] [--n 1]');
		process.exit(0);
	} else promptParts.push(arg);
}
const prompt = promptParts.join(" ").trim();
if (prompt.length === 0) {
	console.error("错误：缺少提示词");
	process.exit(2);
}

// ── 密钥 ────────────────────────────────────────────────────────────────────
function apiKey() {
	if (process.env.IMAGE_API_KEY) return process.env.IMAGE_API_KEY.trim();
	const file = join(HERE, ".image-key");
	if (existsSync(file)) return readFileSync(file, "utf8").trim();
	console.error("错误：未找到密钥（设置环境变量 IMAGE_API_KEY，或在本目录放 .image-key）");
	process.exit(3);
}

// ── 调用 ────────────────────────────────────────────────────────────────────
const started = Date.now();
console.log(`模型 ${MODEL} · 尺寸 ${size} · n=${count}`);
console.log(`提示词：${prompt}`);

let response;
try {
	response = await fetch(`${API_BASE}/v1/images/generations`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer " + apiKey() },
		body: JSON.stringify({ model: MODEL, prompt, n: count, size }),
		signal: AbortSignal.timeout(300000)
	});
} catch (error) {
	console.error("请求失败：" + ((error.cause && error.cause.message) || error.message));
	process.exit(4);
}

const raw = await response.text();
if (!response.ok) {
	console.error(`HTTP ${response.status}：` + raw.slice(0, 500));
	process.exit(5);
}

let payload;
try {
	payload = JSON.parse(raw);
} catch {
	console.error("响应不是合法 JSON：" + raw.slice(0, 300));
	process.exit(6);
}

const items = Array.isArray(payload.data) ? payload.data : [];
if (items.length === 0) {
	console.error("响应里没有图片：" + raw.slice(0, 300));
	process.exit(7);
}

// ── 落盘 ────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const saved = [];
for (let i = 0; i < items.length; i++) {
	const item = items[i];
	const target = out
		? resolve(out)
		: join(DEFAULT_DIR, `img-${stamp}${items.length > 1 ? `-${i + 1}` : ""}.png`);
	mkdirSync(dirname(target), { recursive: true });

	if (item.b64_json) {
		writeFileSync(target, Buffer.from(item.b64_json, "base64"));
	} else if (item.url) {
		const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(120000) });
		if (!imageResponse.ok) {
			console.error(`下载失败 HTTP ${imageResponse.status}：${item.url}`);
			continue;
		}
		writeFileSync(target, Buffer.from(await imageResponse.arrayBuffer()));
	} else {
		console.error("第 " + (i + 1) + " 张既没有 b64_json 也没有 url");
		continue;
	}
	const bytes = readFileSync(target).length;
	saved.push(target);
	console.log(`已保存：${target}  (${(bytes / 1024).toFixed(0)} KB)`);
}

if (saved.length === 0) process.exit(8);
console.log(`用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (extname(saved[0]).toLowerCase() !== ".png") console.log("提示：扩展名不是 .png，read_image 会自动识别格式");
