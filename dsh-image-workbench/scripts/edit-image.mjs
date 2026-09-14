/**
 * edit-image.mjs —— 图片编辑 / 局部重绘命令行工具
 *
 * 对接 gpt-image-2.5-flare-c 的 OpenAI 兼容端点 /v1/images/edits。
 *
 * 用法：
 *   node edit-image.mjs --input <图片> --prompt "<编辑指令>" [--region x,y,w,h] [--feather 8] [--size 1024x1024] [-o 输出]
 *
 * 参数：
 *   --input    输入图片（必填）
 *   --prompt   编辑指令（必填），例如 "把红色领带改成金色"
 *   --region   局部编辑区域，0~1 的比例 "x,y,w,h"（相对画面）。
 *              省略 = 整图重绘（相当于按提示词重做一张）
 *   --feather  mask 羽化半径（像素，默认 12），让重绘边缘自然过渡
 *   --size     输出尺寸（默认 1024x1024；输入会被缩放到该尺寸）
 *   -o         输出路径（默认 out/edit-<时间戳>.png）
 *
 * 密钥来源：环境变量 IMAGE_API_KEY，或脚本同目录的 .image-key
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire("C:\\Users\\lenovo\\.dsh\\profiles\\node_modules\\dsh\\package.json");
const sharp = require("sharp");

const API_BASE = process.env.IMAGE_API_BASE || "https://api.tiantoken.com";
const MODEL = process.env.IMAGE_MODEL || "gpt-image-2.5-flare-c";

// ── 参数解析 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const options = { input: null, prompt: null, region: null, feather: 12, size: "1024x1024", out: null };
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === "--input" || arg === "-i") options.input = argv[++i];
	else if (arg === "--prompt" || arg === "-p") options.prompt = argv[++i];
	else if (arg === "--region" || arg === "-r") options.region = argv[++i];
	else if (arg === "--feather") options.feather = Number(argv[++i]) || 0;
	else if (arg === "--size") options.size = argv[++i];
	else if (arg === "-o" || arg === "--out") options.out = argv[++i];
	else if (arg === "-h" || arg === "--help") {
		console.log('用法: node edit-image.mjs --input <图片> --prompt "编辑指令" [--region x,y,w,h] [--feather 12] [--size 1024x1024] [-o 输出]');
		process.exit(0);
	} else if (options.input === null) options.input = arg;
	else if (options.prompt === null) options.prompt = arg;
}
if (options.input === null || options.prompt === null) {
	console.error("错误：需要 --input <图片> 与 --prompt <编辑指令>");
	process.exit(2);
}

function apiKey() {
	if (process.env.IMAGE_API_KEY) return process.env.IMAGE_API_KEY.trim();
	const file = join(HERE, ".image-key");
	if (existsSync(file)) return readFileSync(file, "utf8").trim();
	console.error("错误：未找到密钥（IMAGE_API_KEY 或同目录 .image-key）");
	process.exit(3);
}

// ── 准备 image / mask ───────────────────────────────────────────────────────
const [sizeW, sizeH] = options.size.split("x").map((value) => Number(value) || 1024);
const srcPath = resolve(options.input);
if (!existsSync(srcPath)) {
	console.error("错误：找不到输入图片 " + srcPath);
	process.exit(4);
}

const imageBuffer = await sharp(srcPath)
	.resize(sizeW, sizeH, { fit: "cover", position: "centre" })
	.png()
	.toBuffer();

let maskBuffer = null;
if (options.region) {
	const parts = String(options.region).split(",").map((value) => Number(value.trim()));
	if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
		console.error('错误：--region 需要四个 0~1 的数字，例如 "0.3,0.3,0.4,0.4"');
		process.exit(5);
	}
	const [rx, ry, rw, rh] = parts;
	const mw = Math.max(1, Math.round(rw * sizeW));
	const mh = Math.max(1, Math.round(rh * sizeH));
	const mx = Math.round(rx * sizeW);
	const my = Math.round(ry * sizeH);
	const hole = await sharp({
		create: { width: mw, height: mh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
	}).png().toBuffer();
	let mask = sharp({
		create: { width: sizeW, height: sizeH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } }
	}).composite([{ input: hole, left: mx, top: my }]);
	if (options.feather > 0) mask = mask.blur(Math.max(0.3, options.feather / 4));
	maskBuffer = await mask.png().toBuffer();
	console.log(`局部编辑：区域 x=${mx} y=${my} ${mw}×${mh}（羽化 ${options.feather}px）`);
} else {
	console.log("整图重绘（未指定 --region）");
}

// ── 调用 edits ──────────────────────────────────────────────────────────────
const form = new FormData();
form.append("model", MODEL);
form.append("prompt", options.prompt);
form.append("image", new Blob([imageBuffer], { type: "image/png" }), "image.png");
if (maskBuffer) form.append("mask", new Blob([maskBuffer], { type: "image/png" }), "mask.png");
form.append("n", "1");
form.append("size", `${sizeW}x${sizeH}`);

console.log(`模型 ${MODEL} · ${sizeW}x${sizeH}`);
console.log(`指令：${options.prompt}`);

const started = Date.now();
let response;
try {
	response = await fetch(`${API_BASE}/v1/images/edits`, {
		method: "POST",
		headers: { authorization: "Bearer " + apiKey() },
		body: form,
		signal: AbortSignal.timeout(300000)
	});
} catch (error) {
	console.error("请求失败：" + ((error.cause && error.cause.message) || error.message));
	process.exit(6);
}

const raw = await response.text();
if (!response.ok) {
	console.error(`HTTP ${response.status}：` + raw.slice(0, 400));
	process.exit(7);
}

let payload;
try {
	payload = JSON.parse(raw);
} catch {
	console.error("响应不是合法 JSON：" + raw.slice(0, 300));
	process.exit(8);
}
const item = (payload.data || [])[0];
if (item === undefined) {
	console.error("响应里没有图片：" + raw.slice(0, 300));
	process.exit(9);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = options.out ? resolve(options.out) : join(HERE, `edit-${stamp}.png`);
mkdirSync(dirname(target), { recursive: true });

if (item.b64_json) {
	writeFileSync(target, Buffer.from(item.b64_json, "base64"));
} else if (item.url) {
	const download = await fetch(item.url, { signal: AbortSignal.timeout(120000) });
	if (!download.ok) {
		console.error(`下载失败 HTTP ${download.status}：${item.url}`);
		process.exit(10);
	}
	writeFileSync(target, Buffer.from(await download.arrayBuffer()));
} else {
	console.error("返回既没有 b64_json 也没有 url");
	process.exit(11);
}

console.log(`已保存：${target}  (${(readFileSync(target).length / 1024).toFixed(0)} KB)`);
console.log(`用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (item.revised_prompt) console.log(`模型改写后的提示词：${item.revised_prompt}`);
