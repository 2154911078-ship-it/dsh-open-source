/**
 * dsh-wallpaper-control — host half.
 *
 * Serves wallpaper metadata over the same-origin web server:
 *
 *   GET /wallpaper/status — current wallpaper file info { ok, name, size }
 *   GET /wallpaper/list   — image files in the wallpapers folder
 *
 * The client (right-bottom 🖼️ panel) fetches these to list and pick wallpapers.
 */
export const name = "wallpaper-control";
/** Services required before the routes can be mounted. */
export const inject = ["webServer"];

const WALLPAPERS_DIR = "D:/桌面/deepseek/wallpapers";
const WALLPAPER_FILE = "D:/steam/steamapps/workshop/content/431960/3557414095/copy_71FD5ABE-6315-4C8E-8BCA-77E8261F341B.gif";

/** Resolve the plugin-bundled icon.png to an absolute filesystem path. */
const ICON_PATH = (() => {
	try {
		const u = new URL("./icon.png", import.meta.url);
		let p = decodeURIComponent(u.pathname);
		if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
		return p;
	} catch (err) {
		return "D:/桌面/deepseek/dsh-wallpaper-control/icon.png";
	}
})();

function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}

/** Mount the wallpaper metadata routes. */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/wallpaper/status",
		handler: async (req, res) => {
			try {
				const fs = ctx.get("fs");
				if (!fs) {
					sendJson(res, 200, { ok: true, note: "fs 服务不可用" });
					return;
				}
				const target = await fs.resolve(WALLPAPER_FILE);
				const info = await fs.stat(target);
				if (!info) {
					sendJson(res, 200, { ok: false, error: "壁纸文件不存在" });
					return;
				}
				sendJson(res, 200, {
					ok: true,
					name: "copy_71FD5ABE-6315-4C8E-8BCA-77E8261F341B.gif",
					size: info.size
				});
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
			}
		}
	}), "wallpaper-control: status route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/wallpaper/list",
		handler: async (req, res) => {
			try {
				const fs = ctx.get("fs");
				if (!fs) {
					sendJson(res, 200, { ok: false, error: "fs 服务不可用" });
					return;
				}
				const dir = await fs.resolve(WALLPAPERS_DIR);
				const entries = await fs.listDir(dir);
				const items = [];
				for (let i = 0; i < entries.length; i++) {
					const e = entries[i];
					const name = String((e && (e.name || e.filename)) || "");
					if (/\.(gif|png|jpe?g|webp)$/i.test(name)) items.push({ name });
				}
				sendJson(res, 200, { ok: true, dir: WALLPAPERS_DIR, items });
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
			}
		}
	}), "wallpaper-control: list route");

	// 🖼️ 按钮图标：/wallpaper/icon.png（插件自带 icon.png）
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/wallpaper/icon.png",
		handler: async (req, res) => {
			try {
				const fs = ctx.get("fs");
				if (!fs) {
					res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
					res.end("fs 不可用");
					return;
				}
				const target = await fs.resolve(ICON_PATH);
				const bytes = await fs.readBytes(target, undefined, 8 * 1024 * 1024);
				res.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "no-store",
					"content-length": bytes.length
				});
				res.end(bytes);
			} catch (error) {
				res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
				res.end("icon error: " + String((error && error.message) || error));
			}
		}
	}), "wallpaper-control: icon route");

	// 自动重建面板占位条目（尽力而为、fail-safe）：同上，等待会话出现后创建。
	{
		let tries = 0;
		const id = setInterval(() => {
			tries++;
			try {
				const runner = ctx.get("dynamicCordisRunner");
				if (!runner || typeof runner.define !== "function" || !runner.registry) return;
				const exists = runner.registry.all().some((p) =>
					p.packages && [...p.packages.values()].some((d) => d.name === "壁纸控制")
				);
				if (!exists) {
					const sessions = ctx.get("sessions");
					const list = sessions && typeof sessions.list === "function" ? sessions.list() : [];
					if (list && list.length > 0) {
						runner.define({
							name: "壁纸控制",
							purpose: "面板占位条目：功能由静态插件 dsh-wallpaper-control 提供（🖼️ 壁纸管理 + 面板简洁 CSS）",
							plugin: { kind: "new", idPrefix: "wall" },
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
