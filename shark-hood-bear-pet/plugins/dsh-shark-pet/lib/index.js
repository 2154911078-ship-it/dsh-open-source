/**
 * dsh-shark-pet — host half.
 *
 * Serves the pet sprite atlas and its config over the same-origin web server:
 *
 *   GET /pet-assets/sprite.png  — pet.png atlas bytes (image/png)
 *   GET /pet-assets/config.json — { config, spriteUrl, align } for the client
 *
 * The browser client fetches config.json and renders the floating pet with the
 * exact animation specs from pet.json (fps, frame ranges, loops, behaviors),
 * plus per-cell alignment data that cancels AI frame jitter.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const name = "shark-pet";
/** Services required before the routes can be mounted. */
export const inject = ["webServer"];

/**
 * Pet assets base directory, resolved in priority order:
 *   1. DSH_PET_BASE environment variable (recommended, portable)
 *   2. <repo root>/shark-hood-bear-pet/pet/pet  (repo-relative layout)
 *   3. Author's original absolute path (legacy fallback)
 */
function resolvePetBase() {
	if (process.env.DSH_PET_BASE) return process.env.DSH_PET_BASE;
	const repoRel = join(import.meta.dirname, "..", "..", "shark-hood-bear-pet", "pet", "pet");
	if (existsSync(join(repoRel, "pet.png"))) return repoRel;
	return "D:/桌面/deepseek/shark_hood_bear_pet_full/pet";
}
const PET_BASE = resolvePetBase();
const SPRITE_PATH = PET_BASE + "/pet.png";
const CONFIG_PATH = PET_BASE + "/pet.json";
const SPRITE_URL = "/pet-assets/sprite.png";
const MAX_BYTES = 64 * 1024 * 1024;

/** Per-cell alignment compensation (dx/dy px, relative to each action's base frame). */
const ALIGN = {0:{dx:0,dy:0},1:{dx:1,dy:5},2:{dx:1,dy:3},3:{dx:1,dy:5},4:{dx:0,dy:0},5:{dx:1,dy:5},6:{dx:1,dy:3},7:{dx:0,dy:7},8:{dx:1,dy:3},9:{dx:1,dy:5},10:{dx:0,dy:0},11:{dx:1,dy:5},12:{dx:0,dy:0},13:{dx:0,dy:-7},14:{dx:4,dy:1},15:{dx:3,dy:-9},16:{dx:0,dy:0},17:{dx:0,dy:-7},18:{dx:4,dy:1},19:{dx:3,dy:-9},20:{dx:0,dy:0},21:{dx:0,dy:-7},22:{dx:4,dy:1},23:{dx:3,dy:-9},24:{dx:0,dy:0},25:{dx:0,dy:-7},26:{dx:4,dy:1},27:{dx:3,dy:-9},28:{dx:0,dy:0},29:{dx:-3,dy:-1},30:{dx:-3,dy:-4},31:{dx:-3,dy:-4},32:{dx:0,dy:0},33:{dx:-3,dy:-1},34:{dx:-3,dy:-4},35:{dx:-3,dy:-4},36:{dx:0,dy:0},37:{dx:-3,dy:-1},38:{dx:-3,dy:-4},39:{dx:-3,dy:-4},40:{dx:0,dy:0},41:{dx:-1,dy:6},42:{dx:1,dy:17},43:{dx:1,dy:-2},44:{dx:1,dy:-2},45:{dx:1,dy:17},46:{dx:-1,dy:6},47:{dx:0,dy:0},48:{dx:0,dy:0},49:{dx:-1,dy:-5},50:{dx:-2,dy:-5},51:{dx:-1,dy:-4},52:{dx:-2,dy:6},53:{dx:3,dy:0},54:{dx:3,dy:0},55:{dx:-2,dy:6},56:{dx:-1,dy:-4},57:{dx:-2,dy:-5},58:{dx:-1,dy:-5},59:{dx:0,dy:0},60:{dx:0,dy:0},61:{dx:8,dy:-1},62:{dx:1,dy:-4},63:{dx:-1,dy:10},64:{dx:-1,dy:10},65:{dx:1,dy:-4},66:{dx:8,dy:-1},67:{dx:0,dy:0}};

let spriteCache = null;
let configCache = null;

async function loadSprite(ctx) {
	if (spriteCache) return spriteCache;
	const fs = ctx.get("fs");
	if (!fs) throw new Error("fs 服务不可用");
	const target = await fs.resolve(SPRITE_PATH);
	const info = await fs.stat(target);
	if (!info) throw new Error("pet.png 不存在: " + SPRITE_PATH);
	const bytes = await fs.readBytes(target, undefined, MAX_BYTES);
	spriteCache = bytes;
	return bytes;
}

async function loadConfig(ctx) {
	if (configCache) return configCache;
	const fs = ctx.get("fs");
	if (!fs) throw new Error("fs 服务不可用");
	const target = await fs.resolve(CONFIG_PATH);
	const text = await fs.readText(target);
	configCache = JSON.parse(text);
	return configCache;
}

function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}

/** Mount the pet asset routes. */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: SPRITE_URL,
		handler: async (req, res) => {
			try {
				const bytes = await loadSprite(ctx);
				res.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "no-store",
					"content-length": bytes.length
				});
				res.end(bytes);
			} catch (error) {
				res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
				res.end("pet sprite error: " + String((error && error.message) || error));
			}
		}
	}), "shark-pet: sprite route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/pet-assets/config.json",
		handler: async (req, res) => {
			try {
				const config = await loadConfig(ctx);
				sendJson(res, 200, { config, spriteUrl: SPRITE_URL, align: ALIGN });
			} catch (error) {
				sendJson(res, 500, {
					ok: false,
					error: String((error && error.message) || error)
				});
			}
		}
	}), "shark-pet: config route");

	// 自动重建面板占位条目（尽力而为、fail-safe）：
	// 等待会话出现后创建，最多约 30 秒；条目 idle 状态，功能全由本静态插件提供。
	{
		let tries = 0;
		const id = setInterval(() => {
			tries++;
			try {
				const runner = ctx.get("dynamicCordisRunner");
				if (!runner || typeof runner.define !== "function" || !runner.registry) return;
				const exists = runner.registry.all().some((p) =>
					p.packages && [...p.packages.values()].some((d) => d.name === "鲨鱼帽小熊桌宠")
				);
				if (!exists) {
					const sessions = ctx.get("sessions");
					const list = sessions && typeof sessions.list === "function" ? sessions.list() : [];
					if (list && list.length > 0) {
						runner.define({
							name: "鲨鱼帽小熊桌宠",
							purpose: "面板占位条目：功能由静态插件 dsh-shark-pet 提供（页面桌宠 + 图集/配置路由）",
							plugin: { kind: "new", idPrefix: "shark" },
							sessionId: list[0].id,
							code: { host: "return { apply(ctx) {} };" }
						});
						clearInterval(id);
					}
				} else {
					clearInterval(id);
				}
			} catch (err) {
				// fail-safe: 忽略，不影响静态功能
			}
			if (tries >= 10) clearInterval(id);
		}, 3000);
		ctx.effect(() => () => clearInterval(id));
	}
}
