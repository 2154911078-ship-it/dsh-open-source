/**
 * petdex → dsh-shark-pet 适配器
 *
 * 把 petdex/Codex 规格的宠物（8×9 网格、单元格 192×208、WebP）转换成
 * dsh-shark-pet 插件读取的格式（8×9 网格、单元格 256×256、PNG + pet.json）。
 *
 * 转换是等比缩放（contain），所以图像不会变形；脚底位置按比例换算成 anchor_y。
 * 用法：node adapt-petdex-pet.mjs <源目录> <输出目录>
 *   源目录需含 sprite.webp + pet.json（petdex 的 manifest）
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const require = createRequire("C:\\Users\\lenovo\\.dsh\\profiles\\node_modules\\dsh\\package.json");
const sharp = require("sharp");

const SRC_DIR = resolve(process.argv[2] ?? "D:\\桌面\\deepseek\\petdex-line-puppy");
const OUT_DIR = resolve(process.argv[3] ?? "D:\\桌面\\deepseek\\pets\\line-puppy");

const COLS = 8;
const ROWS = 9;
const DST_CELL = 256;
const DST_W = COLS * DST_CELL;
const DST_H = ROWS * DST_CELL;

/** Codex/petdex 的九行状态 → 本插件的六个动作（按行优先的格子区间）。 */
const ACTION_MAP = [
	{ action: "idle", row: 0, fps: 6, loop: true, label: "待机" },
	{ action: "walk", row: 1, fps: 10, loop: true, label: "行走（取 running-right 行）" },
	{ action: "run", row: 7, fps: 12, loop: true, label: "奔跑" },
	{ action: "sleep", row: 6, fps: 4, loop: true, label: "休眠（取 waiting 行）" },
	{ action: "interact", row: 3, fps: 8, loop: false, label: "点击互动（取 waving 行）" },
	{ action: "jump_fall", row: 4, fps: 8, loop: false, label: "跳跃（取 jumping 行）" }
];

function fail(message) {
	console.error("错误：" + message);
	process.exit(1);
}

// ── 1. 读取源 ───────────────────────────────────────────────────────────────
const manifestPath = join(SRC_DIR, "pet.json");
const spritePath = join(SRC_DIR, "sprite.webp");
if (!existsSync(manifestPath)) fail(`找不到 ${manifestPath}`);
if (!existsSync(spritePath)) fail(`找不到 ${spritePath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const meta = await sharp(spritePath).metadata();
if (meta.width % COLS !== 0 || meta.height % ROWS !== 0) {
	fail(`图集尺寸 ${meta.width}x${meta.height} 不能整除 ${COLS}x${ROWS}`);
}
const srcCellW = meta.width / COLS;
const srcCellH = meta.height / ROWS;
console.log(`源图集 ${meta.width}x${meta.height}（单元格 ${srcCellW}x${srcCellH}，${meta.format}）`);
console.log(`宠物：${manifest.displayName ?? manifest.id ?? basename(SRC_DIR)}`);

// ── 2. 逐格等比缩放并重排 ───────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const layers = [];
let maxFootY = 0;
for (let row = 0; row < ROWS; row++) {
	for (let col = 0; col < COLS; col++) {
		const cell = await sharp(spritePath)
			.extract({
				left: Math.round(col * srcCellW),
				top: Math.round(row * srcCellH),
				width: Math.round(srcCellW),
				height: Math.round(srcCellH)
			})
			.resize(DST_CELL, DST_CELL, {
				fit: "contain",
				background: { r: 0, g: 0, b: 0, alpha: 0 }
			})
			.png()
			.toBuffer();
		layers.push({ input: cell, left: col * DST_CELL, top: row * DST_CELL });
	}
}

const outPng = join(OUT_DIR, "pet.png");
await sharp({
	create: { width: DST_W, height: DST_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
})
	.composite(layers)
	.png({ compressionLevel: 9 })
	.toFile(outPng);

const footSrcY = await measureFootY(spritePath, srcCellW, srcCellH, COLS, ROWS);
const anchorY = Math.max(1, Math.min(DST_CELL, Math.round((footSrcY * DST_CELL) / srcCellH)));
console.log(`source foot y=${footSrcY} (cell height ${srcCellH}) -> anchor_y=${anchorY}`);
console.log(`图集已输出 ${outPng}（${DST_W}x${DST_H}，单元格 ${DST_CELL}x${DST_CELL}）`);
console.log(`anchor_y 推算为 ${anchorY}`);

// ── 3. 生成 pet.json ────────────────────────────────────────────────────────
const animations = {};
for (const item of ACTION_MAP) {
	const start = item.row * COLS;
	const count = await countFrames(spritePath, item.row, srcCellW, srcCellH, COLS);
	animations[item.action] = {
		start_frame: start,
		end_frame: start + Math.max(1, count) - 1,
		frame_count: Math.max(1, count),
		fps: item.fps,
		loop: item.loop,
		description: item.label,
		...(item.loop ? {} : { next_animation: "idle" })
	};
	console.log(`  ${item.action.padEnd(10)} row${item.row} → cells ${start}..${start + Math.max(1, count) - 1}（${count} 帧）`);
}

const petJson = {
	name: manifest.displayName ?? manifest.id ?? "petdex pet",
	name_en: manifest.id ?? "",
	author: "petdex.dev",
	version: "1.0.0",
	description: manifest.description ?? "",
	sprite: {
		image: "pet.png",
		cols: COLS,
		rows: ROWS,
		cell_width: DST_CELL,
		cell_height: DST_CELL,
		total_cells: COLS * ROWS,
		anchor_x: DST_CELL / 2,
		anchor_y: anchorY
	},
	animations,
	behaviors: {
		default_state: "idle",
		fallback_animation: "idle",
		idle: {
			random_actions: [
				{ animation: "idle", weight: 70, min_duration: 3000, max_duration: 8000 },
				{ animation: "sleep", weight: 15, min_duration: 5000, max_duration: 15000 },
				{ animation: "walk", weight: 15, min_duration: 2000, max_duration: 5000 }
			],
			sleep_after_idle: 30000
		},
		interaction: {
			on_click: { animation: "interact", cooldown: 500, priority: 10 },
			on_drag_start: { animation: "interact", priority: 5 },
			on_drag_end: { animation: "jump_fall", priority: 5 }
		},
		movement: {
			walk_speed: 1.5,
			run_speed: 3.0,
			walk_animation: "walk",
			run_animation: "run",
			gravity: 0.5,
			jump_force: 12,
			jump_animation: "jump_fall"
		}
	},
	physics: { width: 120, height: 160, collision_offset_x: 68, collision_offset_y: 50, collision_width: 120, collision_height: 180 },
	metadata: {
		source: "petdex.dev/" + (manifest.id ?? ""),
		adapted_from: `${meta.width}x${meta.height} (${srcCellW}x${srcCellH} cells, ${meta.format})`,
		adapted_at: new Date().toISOString().slice(0, 10)
	},
	// 空对齐表：本宠物的每格不需要 dx/dy 补偿（插件的默认表是给鲨鱼熊调的）
	align: {}
};

const outJson = join(OUT_DIR, "pet.json");
writeFileSync(outJson, JSON.stringify(petJson, null, 2) + "\n", "utf8");
console.log(`配置已输出 ${outJson}`);

/** 测量整张图里宠物脚底相对「格顶」的最大偏移（用于 anchor_y）。 */
async function measureFootY(file, cellW, cellH, cols, rows) {
	const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const W = info.width;
	const C = info.channels;
	let maxFoot = 0;
	for (let row = 0; row < rows; row++) {
		const top = Math.round(row * cellH);
		const bottom = Math.round((row + 1) * cellH);
		for (let col = 0; col < cols; col++) {
			const left = Math.round(col * cellW);
			const right = Math.round((col + 1) * cellW);
			let maxY = -1;
			for (let y = bottom - 1; y >= top && maxY < 0; y--) {
				for (let x = left; x < right; x++) {
					if (data[(y * W + x) * C + 3] > 8) {
						maxY = y;
						break;
					}
				}
			}
			if (maxY >= 0) {
				const rel = maxY - top;
				if (rel > maxFoot) maxFoot = rel;
			}
		}
	}
	return maxFoot;
}

/** 统计某一行有内容的格子数（未使用格为全透明）。 */
async function countFrames(file, row, cellW, cellH, cols) {
	const { data, info } = await sharp(file)
		.extract({ left: 0, top: Math.round(row * cellH), width: cols * Math.round(cellW), height: Math.round(cellH) })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const W = info.width;
	const C = info.channels;
	const cw = Math.round(cellW);
	let used = 0;
	for (let col = 0; col < cols; col++) {
		let opaque = 0;
		for (let y = 0; y < info.height; y++) {
			for (let x = col * cw; x < (col + 1) * cw; x++) {
				if (data[(y * W + x) * C + 3] > 8) {
					opaque++;
					if (opaque > 12) break;
				}
			}
			if (opaque > 12) break;
		}
		if (opaque > 12) used++;
	}
	return used;
}
