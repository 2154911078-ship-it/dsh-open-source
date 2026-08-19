/**
 * dsh-wallpaper-control — client half (browser bundle).
 *
 * Right-bottom 🖼️ wallpaper manager: pick a file / pick from the wallpapers
 * folder / opacity slider / pause-play / status. Also injects CSS that makes
 * the Cordis plugin panel compact (one row per plugin, latest version only,
 * red exclamation hover hints).
 */
window.__ModuleLoader__.load({
	id: "dsh-wallpaper-control",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const inject = ["slots"];

		let bgDisposer = null;
		let tokenDisposer = null;
		let themeSvc = null;
		let fileInputEl = null;

		// Cordis 插件面板简洁化 CSS
		const PANEL_MIN_CSS =
			"[data-cordis-panel]{padding:4px!important;font-size:12px!important}" +
			"[data-cordis-panel] [data-cordis-row]{padding:3px 6px!important;margin:1px 0!important;position:relative!important}" +
			"[data-cordis-panel] [data-cordis-row] *{font-size:12px!important;line-height:1.3!important}" +
			"[data-cordis-panel] [data-cordis-badge]{font-size:11px!important;padding:1px 6px!important;border-radius:6px!important}" +
			"[data-cordis-panel] button{font-size:11px!important;padding:1px 6px!important;min-height:0!important}" +
			"[data-cordis-panel] select{display:none!important}" +
			"[data-cordis-panel] label{font-size:11px!important}" +
			"[data-cordis-panel] [data-cordis-row] > div:first-child > span:first-child{display:none!important}" +
			"[data-cordis-panel] [class*=\"rowPurpose\"]{display:none!important}" +
			"[data-cordis-panel] [class*=\"versionPicker\"]{display:none!important}" +
			"[data-cordis-panel] [class*=\"transition\"]{display:none!important}" +
			"[data-cordis-panel] [class*=\"activeVersion\"]{font-weight:600!important;color:var(--dsw-alias-label-primary,#e8eaf0)!important}" +
			"[data-cordis-panel] [data-cordis-row][data-cordis-awaiting]::before," +
			"[data-cordis-panel] [data-cordis-row][data-cordis-status=\"failed\"]::before," +
			"[data-cordis-panel] [data-cordis-row][data-cordis-render-failure]::before{" +
			"content:\"!\"!important;position:absolute!important;top:-3px!important;right:-3px!important;" +
			"width:16px!important;height:16px!important;background:#e5484d!important;color:#fff!important;" +
			"border-radius:50%!important;font-size:11px!important;font-weight:700!important;" +
			"display:flex!important;align-items:center!important;justify-content:center!important;z-index:6!important;" +
			"box-shadow:0 1px 4px rgba(0,0,0,.4)!important}" +
			"[data-cordis-panel] [data-cordis-row][data-cordis-awaiting]::after," +
			"[data-cordis-panel] [data-cordis-row][data-cordis-status=\"failed\"]::after," +
			"[data-cordis-panel] [data-cordis-row][data-cordis-render-failure]::after{" +
			"position:absolute!important;top:0!important;right:16px!important;background:rgba(15,17,23,.92)!important;" +
			"color:#fff!important;font-size:11px!important;line-height:1.4!important;padding:2px 8px!important;" +
			"border-radius:6px!important;white-space:nowrap!important;z-index:7!important;display:none!important;" +
			"box-shadow:0 2px 8px rgba(0,0,0,.35)!important}" +
			"[data-cordis-panel] [data-cordis-row][data-cordis-awaiting]::after{content:\"待批准\"!important}" +
			"[data-cordis-panel] [data-cordis-row][data-cordis-status=\"failed\"]::after{content:\"失败\"!important}" +
			"[data-cordis-panel] [data-cordis-row][data-cordis-render-failure]::after{content:\"渲染失败\"!important}" +
			"[data-cordis-panel] [data-cordis-row][data-cordis-awaiting]:hover::after," +
			"[data-cordis-panel] [data-cordis-row][data-cordis-status=\"failed\"]:hover::after," +
			"[data-cordis-panel] [data-cordis-row][data-cordis-render-failure]:hover::after{display:block!important}";

		// ── style injection (cleanup-aware) ──────────────────────────────
		function styleInsert(css) {
			const el = document.createElement("style");
			el.dataset.plugin = "dsh-wallpaper-control";
			el.textContent = css;
			document.head.appendChild(el);
			return () => { el.remove(); };
		}

		function setWallpaperBg(url) {
			if (bgDisposer) { bgDisposer(); bgDisposer = null; }
			bgDisposer = styleInsert(
				"body { background-image: url(\"" + url + "\") !important; background-size: cover !important; " +
				"background-position: center center !important; background-attachment: fixed !important; background-repeat: no-repeat !important; }"
			);
		}

		function applyOpacity(v) {
			if (tokenDisposer) { tokenDisposer(); tokenDisposer = null; }
			if (!themeSvc) return;
			const r = (x) => Math.round(x * 1000) / 1000;
			const a = 0.5 - 0.38 * (v / 100);
			const cA = Math.max(0.12, Math.min(0.5, a));
			tokenDisposer = themeSvc.overrideTokens("wallpaper-panel", {
				"--dsw-alias-bg-base": { light: "rgba(249,250,252," + r(cA) + ")", dark: "rgba(15,17,23," + r(cA + 0.04) + ")" },
				"--dsw-alias-bg-layer-1": { light: "rgba(255,255,255," + r(Math.max(0.55, cA + 0.25)) + ")", dark: "rgba(26,29,37," + r(Math.max(0.6, cA + 0.28)) + ")" },
				"--dsw-specific-sidebar-fill": { light: "rgba(248,249,251," + r(cA - 0.02) + ")", dark: "rgba(13,15,21," + r(cA + 0.02) + ")" }
			});
		}

		// 纯 JS 字节 → base64
		function bytesToBase64(bytes) {
			const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
			let result = "";
			const len = bytes.length;
			for (let i = 0; i < len; i += 3) {
				const b0 = bytes[i];
				const b1 = i + 1 < len ? bytes[i + 1] : 0;
				const b2 = i + 2 < len ? bytes[i + 2] : 0;
				const n = (b0 << 16) | (b1 << 8) | b2;
				result += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + (i + 1 < len ? CHARS[(n >> 6) & 63] : "=") + (i + 2 < len ? CHARS[n & 63] : "=");
			}
			return result;
		}

		function WallpaperPanel() {
			const [open, setOpen] = react.useState(false);
			const [items, setItems] = react.useState([]);
			const [cur, setCur] = react.useState("default");
			const [fileDataUrl, setFileDataUrl] = react.useState(null);
			const [fileName, setFileName] = react.useState(null);
			const [opacity, setOpacity] = react.useState(60);
			const [paused, setPaused] = react.useState(false);
			const [info, setInfo] = react.useState(null);
			const [err, setErr] = react.useState(null);

			react.useEffect(() => {
				let alive = true;
				fetch("/wallpaper/list", { cache: "no-store" })
					.then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
					.then((r) => { if (alive && r && r.ok) setItems(r.items || []); })
					.catch(() => {});
				fetch("/wallpaper/status", { cache: "no-store" })
					.then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
					.then((r) => { if (alive && r && r.ok) setInfo(r); })
					.catch(() => {});
				return () => { alive = false; };
			}, []);

			const pick = (id, url) => {
				setCur(id);
				setPaused(false);
				setErr(null);
				setWallpaperBg(url);
			};

			const currentUrl = () => {
				if (cur === "default") return "/dsh-wallpaper";
				if (cur === "file") return fileDataUrl || "/dsh-wallpaper";
				return "/assets/wallpapers/" + encodeURIComponent(cur);
			};

			const togglePause = () => {
				const next = !paused;
				setPaused(next);
				setWallpaperBg(next ? "/dsh-wallpaper-static" : currentUrl());
			};

			const changeOpacity = (v) => {
				setOpacity(v);
				applyOpacity(v);
			};

			const onPickFile = (e) => {
				const file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				file.arrayBuffer().then((buf) => {
					const b64 = bytesToBase64(new Uint8Array(buf));
					const mime = (file.type && file.type.indexOf("/") > 0) ? file.type : "image/png";
					const dataUrl = "data:" + mime + ";base64," + b64;
					setFileDataUrl(dataUrl);
					setFileName(file.name);
					setCur("file");
					setPaused(false);
					setErr(null);
					setWallpaperBg(dataUrl);
				}).catch((err2) => {
					setErr("读取失败: " + String((err2 && err2.message) || err2));
				});
			};

			const btnStyle = {
				position: "fixed",
				right: "16px",
				bottom: "84px",
				zIndex: 20,
				width: "40px",
				height: "40px",
				borderRadius: "50%",
				border: "1px solid rgba(255,255,255,0.3)",
				backgroundColor: open ? "rgba(255,255,255,0.25)" : "transparent",
				backgroundImage: "url('/wallpaper/icon.png')",
				backgroundSize: "cover",
				backgroundPosition: "center",
				cursor: "pointer",
				boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
				pointerEvents: "auto",
				fontFamily: "inherit",
				lineHeight: "1"
			};
			const panelStyle = {
				position: "fixed",
				right: "16px",
				bottom: "132px",
				zIndex: 20,
				width: "240px",
				maxHeight: "62vh",
				overflowY: "auto",
				borderRadius: "14px",
				padding: "12px",
				border: "1px solid rgba(255,255,255,0.14)",
				background: "rgba(15,17,23,0.88)",
				boxShadow: "0 12px 36px rgba(0,0,0,0.45)",
				color: "#fff",
				fontSize: "12px",
				pointerEvents: "auto",
				fontFamily: "inherit"
			};
			const rowStyle = {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "5px 8px",
				borderRadius: "8px",
				cursor: "pointer",
				border: "1px solid transparent",
				marginBottom: "3px"
			};
			const thumbStyle = {
				width: "40px",
				height: "26px",
				borderRadius: "5px",
				backgroundSize: "cover",
				backgroundPosition: "center",
				flexShrink: "0",
				border: "1px solid rgba(255,255,255,0.25)"
			};
			const label = { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

			return react.createElement(react.Fragment, null,
				react.createElement("button", { title: "壁纸管理", onClick: () => setOpen(!open), style: btnStyle }, null),
				open ? react.createElement("div", { style: panelStyle },
					react.createElement("div", { style: { fontSize: "13px", fontWeight: 600, marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" } },
						react.createElement("span", null, "壁纸"),
						react.createElement("span", { style: { flex: "1" } }),
						react.createElement("button", { onClick: () => setOpen(false), style: { background: "transparent", border: "none", color: "#aaa", cursor: "pointer", fontSize: "14px" } }, "✕")
					),
					err ? react.createElement("div", { style: { color: "#ff7a7a", marginBottom: "6px", wordBreak: "break-all" } }, err) : null,
					react.createElement("div", { style: { marginBottom: "6px" } },
						react.createElement("button", {
							onClick: () => { if (fileInputEl) fileInputEl.click(); },
							style: {
								width: "100%", padding: "6px 0", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.3)",
								background: "transparent", color: "#fff", cursor: "pointer", fontSize: "12px", fontFamily: "inherit"
							}
						}, "📁 选择文件"),
						react.createElement("input", {
							ref: (el) => { fileInputEl = el; },
							type: "file", accept: "image/*,.gif,.webp",
							style: { display: "none" },
							onChange: onPickFile
						})
					),
					react.createElement("div", { style: { marginBottom: "6px" } },
						react.createElement("div", {
							style: Object.assign({}, rowStyle, cur === "default" ? { borderColor: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.1)" } : {}),
							onClick: () => pick("default", "/dsh-wallpaper")
						},
							react.createElement("div", { style: Object.assign({}, thumbStyle, { backgroundImage: "url(\"/dsh-wallpaper\")" }) }),
							react.createElement("span", { style: label }, "默认")
						),
						items.map((it) => react.createElement("div", {
							key: it.name,
							style: Object.assign({}, rowStyle, cur === it.name ? { borderColor: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.1)" } : {}),
							onClick: () => pick(it.name, "/assets/wallpapers/" + encodeURIComponent(it.name))
						},
							react.createElement("div", { style: Object.assign({}, thumbStyle, { backgroundImage: "url(\"/assets/wallpapers/" + encodeURIComponent(it.name) + "\")" }) }),
							react.createElement("span", { style: label }, it.name)
						)),
						items.length === 0 ? react.createElement("div", { style: { color: "#9aa3b2", padding: "3px 8px" } }, "暂无壁纸") : null,
						cur === "file" ? react.createElement("div", { style: Object.assign({}, rowStyle, { borderColor: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.1)" }) },
							react.createElement("div", { style: Object.assign({}, thumbStyle, { backgroundImage: fileDataUrl ? "url(\"" + fileDataUrl + "\")" : "none" }) }),
							react.createElement("span", { style: label }, fileName || "自定义")
						) : null
					),
					react.createElement("div", { style: { marginBottom: "6px", display: "flex", alignItems: "center", gap: "8px" } },
						react.createElement("span", { style: { color: "#9aa3b2", whiteSpace: "nowrap" } }, "透明度 " + opacity + "%"),
						react.createElement("input", {
							type: "range", min: "0", max: "100", value: String(opacity),
							onChange: (e) => changeOpacity(Number(e.target.value)),
							style: { flex: "1" }
						})
					),
					react.createElement("div", { style: { marginBottom: "6px" } },
						react.createElement("button", {
							onClick: togglePause,
							style: {
								width: "100%", padding: "6px 0", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.3)",
								background: "transparent", color: "#fff", cursor: "pointer", fontSize: "12px", fontFamily: "inherit"
							}
						}, paused ? "▶ 播放" : "⏸ 暂停")
					),
					info ? react.createElement("div", { style: { color: "#9aa3b2", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
						"当前: " + (info.name || "") + " · " + Math.round((info.size || 0) / 1048576) + "MB"
					) : null
				) : null
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			themeSvc = ctx.get("theme");
			styleInsert(PANEL_MIN_CSS);
			slots.inject("shell.overlay", () => slots.register(
				{ name: "shell.overlay", id: "wallpaper-control", order: 95, label: "壁纸管理" },
				() => react.createElement(WallpaperPanel, null)
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
