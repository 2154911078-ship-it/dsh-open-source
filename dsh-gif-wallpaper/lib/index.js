/**
 * dsh-gif-wallpaper — host half.
 *
 * Serves the current GIF wallpaper over the same-origin web server:
 *
 *   GET /dsh-wallpaper            — the animated GIF bytes (image/gif)
 *   GET /dsh-wallpaper-static     — the first frame extracted as JPEG
 *   GET /dsh-wallpaper/status     — { ok, version, size, name } for change detection
 *
 * The browser client sets the page background to these URLs and polls
 * /dsh-wallpaper/status every 15s, so replacing the GIF file (or the
 * Wallpaper Engine workshop asset) switches the wallpaper live.
 */
import { existsSync } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export const name = "gif-wallpaper";
/** Services required before the routes can be mounted. */
export const inject = ["webServer"];

const MAX_BYTES = 64 * 1024 * 1024;
const POWERSHELL = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
/**
 * Wallpaper GIF candidate paths, in priority order.
 * Override with the DSH_WALLPAPER_PATH environment variable; the defaults
 * are only used when it is unset.
 */
const CANDIDATES = process.env.DSH_WALLPAPER_PATH
	? [process.env.DSH_WALLPAPER_PATH]
	: [
		"D:\\steam\\steamapps\\workshop\\content\\431960\\3557414095\\copy_71FD5ABE-6315-4C8E-8BCA-77E8261F341B.gif",
		"D:\\桌面\\deepseek\\wallpaper.gif"
	];
const STATIC_PATH = join(tmpdir(), "dsh-wallpaper-static.jpg");
/** Persistent, update-surviving static assets bundled with this plugin. */
const ASSETS_DIR = join(import.meta.dirname, "..", "assets");
const ASSET_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".json": "application/json" };

let staticCache = { version: null };

/** Return the first existing candidate GIF path, or null. */
async function findGif() {
	for (const path of CANDIDATES) {
		try {
			const info = await stat(path);
			if (info.isFile()) return path;
		} catch {
			/* try next candidate */
		}
	}
	return null;
}

function versionOf(info) {
	return `${info.size}:${Math.round(info.mtimeMs)}`;
}

/** Extract the first frame of a GIF into STATIC_PATH via System.Drawing. */
function extractStaticFrame(srcPath) {
	return new Promise((resolve, reject) => {
		const script =
			"Add-Type -AssemblyName System.Drawing; " +
			`$src = '${srcPath}'; ` +
			"$dst = Join-Path $env:TEMP 'dsh-wallpaper-static.jpg'; " +
			"if (Test-Path $dst) { Remove-Item $dst -Force }; " +
			"$img = [System.Drawing.Image]::FromFile($src); " +
			"$bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height); " +
			"$g = [System.Drawing.Graphics]::FromImage($bmp); " +
			"$g.DrawImage($img, 0, 0, $img.Width, $img.Height); " +
			"$bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Jpeg); " +
			"$g.Dispose(); $bmp.Dispose(); $img.Dispose(); " +
			"Write-Output $dst";
		const child = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], {
			stdio: "ignore",
			windowsHide: true
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve(STATIC_PATH);
			else reject(new Error(`powershell exit ${code}`));
		});
	});
}

async function serveFile(res, path, contentType) {
	try {
		const bytes = await readFile(path);
		if (bytes.length > MAX_BYTES) throw new Error("file too large");
		res.writeHead(200, {
			"content-type": contentType,
			"cache-control": "no-store",
			"content-length": bytes.length
		});
		res.end(bytes);
	} catch (error) {
		res.writeHead(500, { "content-type": "text/plain" });
		res.end("wallpaper error: " + String(error && error.message ? error.message : error));
	}
}

function sendJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

/** Serve one bundled asset, rejecting traversal outside ASSETS_DIR. */
async function servePluginAsset(res, relPath) {
	const target = resolve(join(ASSETS_DIR, relPath));
	if (target !== ASSETS_DIR && !target.startsWith(ASSETS_DIR + sep)) {
		res.writeHead(403, { "content-type": "text/plain" });
		res.end("forbidden");
		return;
	}
	try {
		const bytes = await readFile(target);
		const ct = ASSET_MIME[extname(target)] ?? "application/octet-stream";
		res.writeHead(200, { "content-type": ct, "cache-control": "no-store", "content-length": bytes.length });
		res.end(bytes);
	} catch (error) {
		res.writeHead(404, { "content-type": "text/plain" });
		res.end("asset missing: " + relPath);
	}
}

/** Mount the wallpaper routes. */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-wallpaper",
		handler: async (req, res) => {
			const gif = await findGif();
			if (!gif) {
				res.writeHead(404, { "content-type": "text/plain" });
				res.end("no gif wallpaper");
				return;
			}
			await serveFile(res, gif, "image/gif");
		}
	}), "gif-wallpaper: gif route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-wallpaper-static",
		handler: async (req, res) => {
			const gif = await findGif();
			if (!gif) {
				res.writeHead(404, { "content-type": "text/plain" });
				res.end("no gif wallpaper");
				return;
			}
			try {
				const info = await stat(gif);
				const version = versionOf(info);
				if (staticCache.version !== version) {
					await extractStaticFrame(gif);
					staticCache = { version };
				}
				if (!existsSync(STATIC_PATH)) {
					res.writeHead(500, { "content-type": "text/plain" });
					res.end("static frame missing");
					return;
				}
				await serveFile(res, STATIC_PATH, "image/jpeg");
			} catch (error) {
				res.writeHead(500, { "content-type": "text/plain" });
				res.end("static error: " + String(error && error.message ? error.message : error));
			}
		}
	}), "gif-wallpaper: static route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-wallpaper/status",
		handler: async (req, res) => {
			try {
				const gif = await findGif();
				if (!gif) {
					sendJson(res, 404, { ok: false, error: "no gif wallpaper" });
					return;
				}
				const info = await stat(gif);
				sendJson(res, 200, {
					ok: true,
					version: versionOf(info),
					size: info.size,
					name: gif.split(/[\\/]/).pop()
				});
			} catch (error) {
				sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
			}
		}
	}), "gif-wallpaper: status route");

	// ── persistent plugin-bundled static assets (survive DSH updates) ──────
	// These take precedence over the frontend-static dist fallback, so the
	// custom logo/banner/wallpaper library keep working even after `npx`
	// re-installs and wipes the official `dsh-web-frontend` dist assets.
	const assetRoute = (kind, path, rel) => ctx.effect(() => ctx.webServer.register({
		kind,
		path,
		handler: async (req, res) => {
			await servePluginAsset(res, rel);
		}
	}), "gif-wallpaper: asset " + path);
	assetRoute("exact", "/assets/dsh-logo.png", "dsh-logo.png");
	assetRoute("exact", "/assets/dsh-plugin-banner.png", "dsh-plugin-banner.png");
	assetRoute("exact", "/assets/wallpapers/manifest.json", "wallpapers/manifest.json");
	const WALLPAPERS_PREFIX = "/assets/wallpapers/";
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: WALLPAPERS_PREFIX,
		handler: async (req, res) => {
			try {
				const p = new URL(req.url ?? "/", "http://dsh.local").pathname;
				if (!p.startsWith(WALLPAPERS_PREFIX)) {
					res.writeHead(404, { "content-type": "text/plain" });
					res.end();
					return;
				}
				await servePluginAsset(res, "wallpapers/" + p.slice(WALLPAPERS_PREFIX.length));
			} catch (error) {
				res.writeHead(500, { "content-type": "text/plain" });
				res.end("asset error: " + String((error && error.message) || error));
			}
		}
	}), "gif-wallpaper: wallpapers prefix");
}
