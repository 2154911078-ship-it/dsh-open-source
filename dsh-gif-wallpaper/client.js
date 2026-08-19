/**
 * dsh-gif-wallpaper — client half (browser bundle).
 *
 * Right-top Q-style hollow star + vertical opacity slider that controls the
 * wallpaper visibility (0–100%). The star fills with yellow as the value
 * rises. Also keeps: page background served by the host half, pause/play in
 * the sidebar footer, Cordis badge localization, Cordis panel width aligned
 * to the sidebar, and the banner image above the plugin bar (aligned to the
 * sidebar width, never exceeding it).
 */
window.__ModuleLoader__.load({
	id: "dsh-gif-wallpaper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const inject = ["slots", "theme"];

		// ── wallpaper control state ──────────────────────────────────────────
		let currentVersion = null;
		let paused = false;
		let meta = null;
		let styleEl = null;
		let tokenDisposer = null;
		let opacityValue = 60; // 0-100, wallpaper visibility
		let library = []; // [{ id, name, file, rev, local }] — manifest + IndexedDB wallpapers
		let currentId = null; // selected wallpaper id; null = legacy GIF wallpaper
		let selectionInitialized = false;
		const localUrls = new Map(); // local wallpaper id → blob object URL

		// ── IndexedDB: user-added wallpapers (picked via the file button) ───
		const IDB_NAME = "dsh-gif-wallpaper";
		const IDB_STORE = "local";
		function dbOpen() {
			return new Promise((resolve, reject) => {
				let req;
				try {
					req = indexedDB.open(IDB_NAME, 1);
				} catch (error) {
					reject(error);
					return;
				}
				req.onupgradeneeded = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: "id" });
				};
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
		}
		function dbGetAll() {
			return dbOpen().then((db) => new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, "readonly");
				const req = tx.objectStore(IDB_STORE).getAll();
				req.onsuccess = () => { db.close(); resolve(req.result || []); };
				req.onerror = () => { db.close(); reject(req.error); };
			}));
		}
		function dbPut(record) {
			return dbOpen().then((db) => new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, "readwrite");
				tx.objectStore(IDB_STORE).put(record);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); reject(tx.error); };
			}));
		}
		function dbDelete(id) {
			return dbOpen().then((db) => new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, "readwrite");
				tx.objectStore(IDB_STORE).delete(id);
				tx.oncomplete = () => { db.close(); resolve(); };
				tx.onerror = () => { db.close(); reject(tx.error); };
			}));
		}

		// ── Q-style star geometry ────────────────────────────────────────────
		// A stack of concentric five-pointed stars (large → small, inward
		// overlap) forming one big star. Each layer fades in/out smoothly as
		// the wallpaper visibility changes.
		function starPoints(cx, cy, R, r, rotationDeg) {
			const pts = [];
			const rot = (rotationDeg || 0) * Math.PI / 180;
			for (let i = 0; i < 10; i++) {
				const radius = i % 2 === 0 ? R : r;
				const angle = -Math.PI / 2 + (i * Math.PI) / 5 + rot;
				pts.push((cx + radius * Math.cos(angle)).toFixed(2) + "," + (cy + radius * Math.sin(angle)).toFixed(2));
			}
			return pts.join(" ");
		}
		// layer config: [outer radius, inner ratio, per-layer opacity, rotation]
		const STAR_LAYERS = [
			[20.0, 0.62, 0.30, 0],
			[17.2, 0.60, 0.45, 5],
			[14.6, 0.58, 0.62, 10],
			[12.2, 0.56, 0.78, 15],
			[10.0, 0.54, 0.92, 20],
			[8.0, 0.52, 1.00, 25]
		];
		// ── content-layer opacity derived from the wallpaper value ───────────
		function contentAlpha(v) {
			// v=100 → 0.12 (wallpaper shows through strongly), v=0 → 0.5 (opaque)
			const a = 0.5 - 0.38 * (v / 100);
			return Math.max(0.12, Math.min(0.5, a));
		}

		function tokenOverrides(v) {
			const a = contentAlpha(v);
			const r = (x) => Math.round(x * 1000) / 1000;
			return {
				"--dsw-alias-bg-base": { light: "rgba(249, 250, 252, " + r(a) + ")", dark: "rgba(15, 17, 23, " + r(a + 0.04) + ")" },
				"--dsw-alias-bg-layer-1": { light: "rgba(255, 255, 255, " + r(Math.max(0.55, a + 0.25)) + ")", dark: "rgba(26, 29, 37, " + r(Math.max(0.6, a + 0.28)) + ")" },
				// layer-2 stays near-opaque: it backs the settings window and
				// other popovers, which must stay readable at every opacity.
				"--dsw-alias-bg-layer-2": { light: "rgba(255, 255, 255, 0.96)", dark: "rgba(24, 27, 34, 0.96)" },
				"--dsw-specific-sidebar-fill": { light: "rgba(248, 249, 251, " + r(a - 0.02) + ")", dark: "rgba(13, 15, 21, " + r(a + 0.02) + ")" }
			};
		}

		// ── style application ────────────────────────────────────────────────
		// Resolve the active wallpaper URL: a picked library image when
		// `currentId` is set, otherwise the host-served legacy GIF (with the
		// static-frame swap while paused).
		function wallpaperUrl() {
			const item = currentId === null ? null : library.find((i) => i.id === currentId);
			if (item) {
				if (item.local) {
					const url = localUrls.get(item.id);
					if (url) return url;
				}
				return "/assets/wallpapers/" + encodeURIComponent(item.file) + (item.rev ? "?v=" + encodeURIComponent(item.rev) : "");
			}
			const safe = String(currentVersion || "").replace(/[^A-Za-z0-9:._-]/g, "");
			return (paused ? "/dsh-wallpaper-static?v=" : "/dsh-wallpaper?v=") + safe;
		}

		function applyWallpaper() {
			if (currentVersion === null && currentId === null) return;
			if (!styleEl) {
				styleEl = document.createElement("style");
				styleEl.dataset.plugin = "dsh-gif-wallpaper";
				document.head.appendChild(styleEl);
			}
			const url = wallpaperUrl();
			const v = opacityValue;
			// Only the main content surfaces go translucent so the wallpaper
			// shows through; menus/popovers/settings windows keep their own
			// opaque theme so text stays readable.
			styleEl.textContent =
				"html::before { content: \"\"; position: fixed; inset: 0; z-index: -1; pointer-events: none; " +
				"background-image: url(\"" + url + "\"); background-size: cover; background-position: center; " +
				"background-repeat: no-repeat; opacity: " + (v / 100).toFixed(3) + "; }" +
				"html { background-color: var(--dsw-alias-bg-base, #101318); }" +
				"body { background-color: transparent !important; }" +
				"[data-cordis-badge] span:nth-of-type(1) { font-size: 0; }" +
				"[data-cordis-badge] span:nth-of-type(1)::after { content: \"Cordis 插件\"; font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary, #e8eaf0); letter-spacing: 0.3px; }" +
				"[data-cordis-panel] { width: 280px !important; max-width: calc(100vw - 24px); }";
		}

		function applyTokens(theme) {
			if (theme === undefined) return;
			if (tokenDisposer) tokenDisposer();
			tokenDisposer = theme.overrideTokens("dsh-gif-wallpaper", tokenOverrides(opacityValue));
		}

		function check() {
			fetch("/dsh-wallpaper/status", { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.then((res) => {
					if (res && res.ok && res.version) {
						meta = res;
						if (res.version !== currentVersion) {
							currentVersion = res.version;
							if (currentId === null) applyWallpaper();
						}
					}
				})
				.catch(() => {});
		}

		// ── wallpaper library (custom switching) ─────────────────────────────
		// The library = manifest wallpapers (installed by sync-wallpapers.ps1)
		// merged with user-picked wallpapers stored in IndexedDB. The current
		// pick is persisted in localStorage.
		function loadLibrary(onDone) {
			fetch("/assets/wallpapers/manifest.json?v=" + Date.now(), { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.then((data) => {
					const manifest = data && Array.isArray(data.wallpapers) ? data.wallpapers : [];
					dbGetAll()
						.then((records) => {
							for (const rec of records || []) {
								if (!localUrls.has(rec.id)) localUrls.set(rec.id, URL.createObjectURL(rec.blob));
								if (!manifest.some((i) => i.id === rec.id)) manifest.push({ id: rec.id, name: rec.name, file: null, rev: null, local: true });
							}
							library = manifest;
							if (currentId !== null && !library.some((i) => i.id === currentId)) {
								currentId = null; // picked item no longer in the library
								applyWallpaper();
							}
							if (!selectionInitialized) {
								selectionInitialized = true;
								try {
									const saved = localStorage.getItem("dsh-wallpaper-current");
									if (saved !== null && library.some((i) => i.id === saved)) currentId = saved;
								} catch (_e) {}
								applyWallpaper();
							}
							if (onDone) onDone();
						})
						.catch(() => {
							library = manifest;
							if (onDone) onDone();
						});
				})
				.catch(() => {
					library = [];
					if (onDone) onDone();
				});
		}

		function pickWallpaper(id) {
			currentId = id;
			paused = false;
			try {
				if (id === null) localStorage.removeItem("dsh-wallpaper-current");
				else localStorage.setItem("dsh-wallpaper-current", id);
			} catch (_e) {}
			applyWallpaper();
		}

		// ── right-top star + vertical slider ─────────────────────────────────
		// Star on top, bar directly below it, no outer frame, no numbers.
		// Bar fills from the top downward: value rises as the fill extends down.
		function StarSlider({ theme }) {
			const [v, setV] = react.useState(opacityValue);
			const dragRef = react.useRef(null);

			const setValue = (next) => {
				const clamped = Math.max(0, Math.min(100, Math.round(next)));
				opacityValue = clamped;
				setV(clamped);
				applyTokens(theme);
				applyWallpaper();
			};

			const onPointerDown = (e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				dragRef.current = { top: rect.top, height: rect.height };
				e.currentTarget.setPointerCapture(e.pointerId);
				updateFromY(e, dragRef.current);
			};
			const onPointerMove = (e) => {
				if (!dragRef.current) return;
				updateFromY(e, dragRef.current);
			};
			const onPointerUp = (e) => {
				dragRef.current = null;
				try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_err) {}
			};
			const updateFromY = (e, ref) => {
				// top of the bar = 0 (fade out), bottom = 100 (show)
				const frac = (e.clientY - ref.top) / ref.height;
				setValue(frac * 100);
			};

			const fillFrac = Math.max(0, Math.min(1, v / 100)); // 0..1, fills from top

			return react.createElement(
				"div",
				{
					style: {
						position: "fixed", top: 88, right: 16, zIndex: 9999,
						display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
						userSelect: "none", pointerEvents: "auto"
					},
					title: "壁纸透明度：向上减少 · 向下增加"
				},
				// stack of concentric stars, small ones overlapping inward;
				// whole group fades with the value and disappears entirely at 0
				react.createElement(
					"svg",
					{ width: 44, height: 44, viewBox: "0 0 48 48", style: { display: "block", opacity: fillFrac.toFixed(3), transition: "opacity 0.35s ease", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" } },
					STAR_LAYERS.map(([R, innerRatio, baseOpacity, rotation], i) => {
						return react.createElement("polygon", {
							key: i,
							points: starPoints(24, 24, R, R * innerRatio, rotation),
							fill: "#FFC107",
							fillOpacity: baseOpacity.toFixed(3),
							style: { transition: "fill-opacity 0.35s ease" }
						});
					})
				),
				// vertical track: only the fill is visible, no empty-track outline
				react.createElement(
					"div",
					{
						onPointerDown, onPointerMove, onPointerUp,
						style: {
							position: "relative", width: 8, height: 96,
							cursor: "ns-resize", touchAction: "none", background: "transparent"
						}
					},
					react.createElement("div", {
						style: {
							position: "absolute", left: 0, right: 0, top: 0,
							height: (fillFrac * 100) + "%",
							borderRadius: 999,
							background: "linear-gradient(to bottom, #FFD54F, #FFC107)"
						}
					}),
					// draggable thumb
					react.createElement("div", {
						style: {
							position: "absolute", left: "50%", top: (fillFrac * 100) + "%",
							width: 16, height: 16, borderRadius: "50%",
							transform: "translate(-50%, -50%)",
							background: "#FFD54F", border: "2px solid rgba(255,255,255,0.85)",
							boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
							pointerEvents: "none"
						}
					})
				)
			);
		}

		// ── settings: wallpaper manager row ─────────────────────────────────
		// The wallpaper switcher lives in 设置 → 常规 (settings.general.item).
		// Shared icon-button look.
		const HUB_ICON_BTN = {
			width: 26, height: 26, flex: "none", border: "none", borderRadius: 8,
			background: "transparent", color: "var(--dsw-alias-label-secondary, #9aa3b2)",
			fontSize: 13, lineHeight: 1, fontFamily: "inherit", cursor: "pointer",
			display: "inline-flex", alignItems: "center", justifyContent: "center",
			transition: "background 0.15s ease, color 0.15s ease"
		};

		// "?" help bubble — hovering reveals the add-wallpaper instructions.
		function HelpBubble() {
			return react.createElement(
				"span",
				{ className: "gwp-help", style: { position: "relative", display: "inline-flex", flex: "none" } },
				react.createElement(
					"span",
					{
						"aria-hidden": "true",
						style: {
							width: 16, height: 16, borderRadius: 999, cursor: "help", fontSize: 11, lineHeight: 1,
							display: "inline-flex", alignItems: "center", justifyContent: "center",
							color: "var(--dsw-alias-label-tertiary, #8a93a5)",
							background: "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))",
							border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.1))"
						}
					},
					"?",
					react.createElement("span", {
						className: "gwp-help-pop",
						role: "tooltip",
						style: {
							position: "absolute", left: 0, bottom: "calc(100% + 8px)", zIndex: 9999,
							width: "max-content", maxWidth: 300, whiteSpace: "pre-line",
							background: "var(--dsw-specific-menu, rgba(21,24,31,0.96))",
							border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))",
							borderRadius: 10, padding: "10px 12px", fontSize: 12, lineHeight: 1.6,
							color: "var(--dsw-alias-label-secondary, #c3c9d4)",
							boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
							pointerEvents: "none"
						}
					}, "添加壁纸：\n1. 点「选择壁纸」直接选图添加\n2. 或放入 D:\\桌面\\deepseek\\wallpapers 运行 sync-wallpapers.ps1 批量导入\n3. 本地添加的壁纸可用 ✕ 删除")
				)
			);
		}

		// ── sidebar footer: plugin hub button + wallpaper manager panel ─────
		const pluginItems = [
			{
				id: "gif-wallpaper",
				title: "壁纸",
				render: () => react.createElement(WallpaperManager, {})
			}
		];

		function WallpaperManager() {
			const [isPaused, setIsPaused] = react.useState(paused);
			const [items, setItems] = react.useState([]);
			const [sel, setSel] = react.useState(currentId);
			const [history, setHistory] = react.useState([]);
			const fileRef = react.useRef(null);

			const readHistoryIds = () => {
				let ids = [];
				try {
					ids = JSON.parse(localStorage.getItem("dsh-wallpaper-history") || "[]");
				} catch (_e) {}
				return Array.isArray(ids) ? ids : [];
			};
			const resolveHistory = () => {
				const seen = new Set();
				return readHistoryIds()
					.map((hid) => library.find((i) => i.id === hid))
					.filter(Boolean)
					.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
			};
			const pushHistory = (id) => {
				const ids = [id, ...readHistoryIds().filter((x) => x !== id)].slice(0, 8);
				try {
					localStorage.setItem("dsh-wallpaper-history", JSON.stringify(ids));
				} catch (_e) {}
				setHistory(resolveHistory());
			};
			const reload = () => {
				loadLibrary(() => {
					setItems(library.slice());
					setSel(currentId);
					setHistory(resolveHistory());
				});
			};
			react.useEffect(() => {
				check();
				const id = setInterval(check, 15000);
				reload();
				return () => clearInterval(id);
			}, []);
			const toggle = () => {
				paused = !isPaused;
				setIsPaused(paused);
				if (currentVersion) applyWallpaper();
			};
			const pick = (id) => {
				pickWallpaper(id);
				setSel(id);
				setIsPaused(false);
				pushHistory(id);
			};
			const refresh = reload;

			// direct file picking: no folder/script round-trip
			const addFiles = (files) => {
				const list = Array.from(files || []).filter((f) => f.type && f.type.indexOf("image/") === 0);
				if (!list.length) return;
				let firstId = null;
				list.forEach((file) => {
					const id = "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
					if (firstId === null) firstId = id;
					dbPut({ id, name: file.name, blob: file }).catch(() => {});
					if (!localUrls.has(id)) localUrls.set(id, URL.createObjectURL(file));
					if (!library.some((i) => i.id === id)) library.push({ id, name: file.name, file: null, rev: null, local: true });
				});
				setItems(library.slice());
				if (firstId !== null) pick(firstId);
			};
			const ensureInput = () => {
				if (fileRef.current) return fileRef.current;
				const input = document.createElement("input");
				input.type = "file";
				input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
				input.multiple = true;
				input.style.display = "none";
				input.addEventListener("change", () => {
					const files = input.files ? Array.from(input.files) : [];
					input.value = "";
					addFiles(files);
				});
				document.body.appendChild(input);
				fileRef.current = input;
				return input;
			};
			const openPicker = () => {
				ensureInput().click();
			};
			const removeLocal = (id) => {
				const url = localUrls.get(id);
				if (url) {
					URL.revokeObjectURL(url);
					localUrls.delete(id);
				}
				dbDelete(id).catch(() => {});
				library = library.filter((i) => i.id !== id);
				if (currentId === id) {
					currentId = null;
					try {
						localStorage.removeItem("dsh-wallpaper-current");
					} catch (_e) {}
					applyWallpaper();
				}
				setItems(library.slice());
				setSel(currentId);
				setHistory(resolveHistory());
			};
			const removeHistory = (id) => {
				const ids = readHistoryIds().filter((x) => x !== id);
				try {
					localStorage.setItem("dsh-wallpaper-history", JSON.stringify(ids));
				} catch (_e) {}
				setHistory(resolveHistory());
			};

			const labelStyle = {
				flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--dsw-alias-label-primary, #e8eaf0)",
				whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
			};
			const rowStyle = (active) => ({
				display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", margin: "1px 4px",
				cursor: "pointer", borderRadius: 10,
				background: active ? "linear-gradient(90deg, rgba(255,193,7,0.18), rgba(255,193,7,0.04))" : "transparent",
				transition: "background 0.15s ease"
			});
			const badge = react.createElement("span", {
				style: {
					flex: "none", fontSize: 10, lineHeight: 1, padding: "3px 7px", borderRadius: 999,
					background: "rgba(255,193,7,0.16)", color: "#FFC107",
					border: "1px solid rgba(255,193,7,0.35)", fontWeight: 600
				}
			}, "使用中");
			const xBtn = (onClick) => react.createElement("button", {
				type: "button",
				title: "删除",
				onClick: (e) => {
					e.stopPropagation();
					onClick();
				},
				className: "gwp-iconbtn gwp-xbtn",
				style: Object.assign({}, HUB_ICON_BTN, { width: 22, height: 22, fontSize: 12 })
			}, "✕");
			const thumbBox = (inner, gif) => react.createElement("span", {
				style: {
					width: 44, height: 28, flex: "none", display: "inline-flex", alignItems: "center",
					justifyContent: "center", fontSize: 13, borderRadius: 8, overflow: "hidden",
					background: gif ? "linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02))" : "#0b0e14",
					border: "1px solid rgba(255,255,255,0.08)"
				}
			}, inner);
			const thumb = (item) => {
				const isGif = /\.gif$/i.test(item.name);
				if (isGif && item.local) return thumbBox("🎞️", true);
				const src = item.local ? (localUrls.get(item.id) || null) : ("/assets/wallpapers/" + encodeURIComponent(item.file));
				return src ? thumbBox(react.createElement("img", {
					src,
					alt: item.name,
					loading: "lazy",
					style: { width: "100%", height: "100%", objectFit: "cover", display: "block" }
				}), false) : thumbBox("🖼️", true);
			};
			const listRow = (item, active, trailing) => react.createElement(
				"div",
				{ key: item.id, onClick: () => pick(item.id), className: "gwp-row" + (active ? " gwp-row-active" : ""), style: rowStyle(active) },
				thumb(item),
				react.createElement("span", { style: labelStyle }, item.name),
				active ? badge : null,
				trailing
			);
			const currentItem = sel === null ? null : (library.find((i) => i.id === sel) || null);
			const historyItems = history.filter((h) => h.id !== sel);

			return react.createElement(
				"div",
				{ style: { padding: "2px 0 2px" } },
				// section header: label + help + refresh + pause
				react.createElement(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 6, padding: "2px 10px 6px" } },
					react.createElement("span", {
						style: {
							fontSize: 12, fontWeight: 600, letterSpacing: "0.3px",
							color: "var(--dsw-alias-label-secondary, #9aa3b2)"
						}
					}, "壁纸"),
					react.createElement(HelpBubble, null),
					react.createElement("span", { style: { flex: 1 } }),
					react.createElement("button", { type: "button", title: "重新扫描壁纸库", onClick: refresh, className: "gwp-iconbtn", style: HUB_ICON_BTN }, "🔄"),
					react.createElement("button", { type: "button", title: isPaused ? "继续播放" : "暂停播放", onClick: toggle, className: "gwp-iconbtn", style: HUB_ICON_BTN }, isPaused ? "▶" : "❚❚")
				),
				// pick-from-disk button — no folder/script round-trip needed
				react.createElement(
					"button",
					{
						type: "button",
						onClick: openPicker,
						className: "gwp-addbtn",
						style: {
							width: "calc(100% - 12px)", margin: "2px 6px 8px", height: 34, borderRadius: 10,
							border: "1px dashed var(--dsw-alias-border-l2, rgba(255,255,255,0.22))",
							background: "rgba(255,255,255,0.04)",
							color: "var(--dsw-alias-label-primary, #e8eaf0)", fontSize: 12.5, fontFamily: "inherit",
							cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
							transition: "background 0.15s ease"
						}
					},
					"🖼 选择壁纸"
				),
				// library list
				react.createElement(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: 2 } },
					react.createElement(
						"div",
						{ onClick: () => pick(null), className: "gwp-row" + (sel === null ? " gwp-row-active" : ""), style: rowStyle(sel === null) },
						thumbBox("🎬", true),
						react.createElement("span", { style: labelStyle }, "默认壁纸"),
						sel === null ? badge : null
					),
					items.map((item) => listRow(item, sel === item.id, item.local ? xBtn(() => removeLocal(item.id)) : null)),
					items.length === 0 ? react.createElement(
						"div",
						{ style: { margin: "2px 8px", padding: "10px 12px", fontSize: 11, lineHeight: 1.6, color: "var(--dsw-alias-label-tertiary, #8a93a5)", background: "rgba(255,255,255,0.04)", borderRadius: 10 } },
						"壁纸库为空，点上方「选择壁纸」添加"
					) : null
				),
				// recent section (正在使用 + 历史)
				currentItem !== null || historyItems.length > 0 ? react.createElement(
					react.Fragment,
					null,
					react.createElement(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 6, padding: "10px 10px 2px" } },
						react.createElement("span", {
							style: {
								fontSize: 11, fontWeight: 600, letterSpacing: "0.4px",
								color: "var(--dsw-alias-label-tertiary, #8a93a5)"
							}
						}, "最近使用")
					),
					react.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 2 } },
						currentItem !== null ? listRow(currentItem, true, currentItem.local ? xBtn(() => removeLocal(currentItem.id)) : null) : null,
						historyItems.map((h) => listRow(h, false, xBtn(() => removeHistory(h.id))))
					)
				) : null
			);
		}

		function PluginsHub() {
			const [open, setOpen] = react.useState(false);
			const [pos, setPos] = react.useState({ left: 12, bottom: 60 });
			const btnRef = react.useRef(null);

			const toggle = () => {
				if (!open && btnRef.current) {
					const r = btnRef.current.getBoundingClientRect();
					setPos({ left: r.left, bottom: (window.innerHeight - r.top) + 8 });
				}
				setOpen(!open);
			};

			return react.createElement(
				react.Fragment,
				null,
				react.createElement(
					"button",
					{
						type: "button",
						ref: btnRef,
						title: "插件",
						"aria-expanded": open,
						onClick: toggle,
						style: {
							width: "100%", height: 40, border: "none", borderRadius: 10,
							background: open ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.07))" : "transparent",
							color: "var(--dsw-alias-label-primary, #e8eaf0)",
							fontFamily: "inherit", fontSize: 13, cursor: "pointer",
							display: "flex", alignItems: "center", gap: 10,
							padding: "0 10px", textAlign: "left",
							transition: "background 0.15s ease"
						},
						onMouseEnter: (e) => { if (!open) e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))"; },
						onMouseLeave: (e) => { if (!open) e.currentTarget.style.background = "transparent"; }
					},
					react.createElement("span", { style: { fontSize: 16, lineHeight: 1 } }, "🧩"),
					react.createElement("span", { style: { flex: 1 } }, "插件"),
					react.createElement("span", {
						style: {
							fontSize: 9, color: "var(--dsw-alias-label-tertiary, #8a93a5)",
							transition: "transform 0.2s ease", transform: open ? "rotate(180deg)" : "none"
						}
					}, "▼")
				),
				open ? react.createElement(
					"div",
					{
						className: "gwp-panel",
						style: {
							position: "fixed", left: pos.left, bottom: pos.bottom, zIndex: 9998,
							width: 268, maxWidth: "calc(100vw - 24px)", maxHeight: "68vh",
							overflowY: "auto", borderRadius: 14, padding: "6px",
							border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))",
							background: "var(--dsw-specific-menu, rgba(21,24,31,0.9))",
							boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 2px 10px rgba(0,0,0,0.3)",
							backdropFilter: "blur(16px) saturate(1.3)",
							WebkitBackdropFilter: "blur(16px) saturate(1.3)"
						}
					},
					// panel header
					react.createElement(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 8px 12px" } },
						react.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e8eaf0)" } }, "插件"),
						react.createElement("span", { style: { flex: 1 } }),
						react.createElement("button", { type: "button", title: "关闭", onClick: () => setOpen(false), className: "gwp-iconbtn", style: HUB_ICON_BTN }, "✕")
					),
					react.createElement("div", { style: { height: 1, margin: "0 8px 4px", background: "var(--dsw-alias-border-l1, rgba(255,255,255,0.07))" } }),
					pluginItems.map((item) => react.createElement(
						"div",
						{ key: item.id },
						item.render({})
					)),
					pluginItems.length === 0 ? react.createElement("div", { style: { padding: "10px 12px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #8a93a5)" } }, "暂无插件") : null
				) : null
			);
		}

		function apply(ctx) {
			const theme = ctx.get("theme");
			applyTokens(theme);
			ctx.effect(() => {
				return () => {
					if (tokenDisposer) {
						tokenDisposer();
						tokenDisposer = null;
					}
				};
			}, "gif-wallpaper: tokens cleanup");
			ctx.effect(() => {
				return () => {
					if (styleEl) {
						styleEl.remove();
						styleEl = null;
					}
				};
			}, "gif-wallpaper: style cleanup");
			// ── brand overrides ─────────────────────────────────────────────
			// Home hero: replace the fish logo left of the headline with the
			// custom image and drop the "预览版" badge. Sidebar: replace the
			// top brand wordmark (and the collapsed rail fish) with the image.
			ctx.effect(() => {
				const brandEl = document.createElement("style");
				brandEl.dataset.plugin = "dsh-gif-wallpaper";
				brandEl.dataset.pluginCss = "dsh-gif-wallpaper/brand-overrides";
				brandEl.textContent =
					'[class*="headline"] { grid-template-columns: 64px auto auto; }' +
					'[class*="fishHitbox"] { width: 64px !important; height: 64px !important; background: url("/assets/dsh-logo.png?v=2") center / contain no-repeat !important; }' +
					'[class*="fishHitbox"] svg { display: none !important; }' +
					'[class*="previewBadge"] { display: none !important; }' +
					'[class*="logoRow"] { height: 80px !important; }' +
					'[class*="collapsed"] [class*="logoRow"] { height: 36px !important; }' +
					'[class*="logoRow"] [class*="brand"] { height: 56px !important; padding-left: 58px !important; background: url("/assets/dsh-logo.png?v=2") left center / auto 56px no-repeat !important; }' +
					'[class*="railFish"] { display: none !important; }' +
					'[class*="collapsed"] [class*="toggle"] { background: url("/assets/dsh-logo.png?v=2") center / auto 36px no-repeat !important; }' +
					'[class*="collapsed"] [class*="toggle"]:hover { background-image: none !important; }';
				document.head.appendChild(brandEl);
				return () => {
					brandEl.remove();
				};
			}, "gif-wallpaper: brand overrides");
			// ── plugin-bar banner ───────────────────────────────────────────
			// The image sits directly above the plugin bar (the sidebar foot
			// row holding the Cordis 插件 badge and the 🧩 hub button). It is
			// the first flex child of the sidebar foot area, and its box spans
			// the same full-bleed footprint as the workspace list area above
			// (left -4px / right past the inline padding) so the left/right
			// edges line up with the workspace rows; it can never exceed the
			// sidebar. No fade/dim mask and no background fill are applied:
			// the image shows fully bright, as-is, from its very top. The
			// shell's `.qDHVXG_fade` band below the workspace list is blanked
			// to transparent so it never draws a translucent gray bar at the
			// seam. Only the bottom edge keeps the rounded card look against
			// the plugin bar. Hidden while the sidebar is collapsed to the
			// rail.
			ctx.effect(() => {
				const bannerEl = document.createElement("style");
				bannerEl.dataset.plugin = "dsh-gif-wallpaper";
				bannerEl.dataset.pluginCss = "dsh-gif-wallpaper/banner";
				bannerEl.textContent =
					'[class*="footArea"]::before { content: ""; flex: none; pointer-events: none; ' +
					'width: calc(100% + 4px + var(--dsh-sidebar-inline-padding, 12px)); ' +
					'margin-left: -4px; margin-right: calc(-1 * var(--dsh-sidebar-inline-padding, 12px)); ' +
					'margin-bottom: 10px; border-radius: 0 0 12px 12px; aspect-ratio: 658 / 298; ' +
					'background-image: url("/assets/dsh-plugin-banner.png?v=2"); ' +
					'background-size: cover; background-position: center; background-repeat: no-repeat; }' +
					'[class*="_fade"] { background: transparent !important; }' +
					'[class*="collapsed"] [class*="footArea"]::before { display: none; }';
				document.head.appendChild(bannerEl);
				return () => {
					bannerEl.remove();
				};
			}, "gif-wallpaper: plugin-bar banner");
			// ── plugin hub panel styles ──────────────────────────────────────
			ctx.effect(() => {
				const hubEl = document.createElement("style");
				hubEl.dataset.plugin = "dsh-gif-wallpaper";
				hubEl.dataset.pluginCss = "dsh-gif-wallpaper/hub";
				hubEl.textContent =
					"@keyframes gwp-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }" +
					".gwp-panel { animation: gwp-in 0.18s ease-out; }" +
					".gwp-row { transition: background 0.15s ease; }" +
					".gwp-row:hover { background: rgba(255,255,255,0.06); }" +
					".gwp-row-active { background: linear-gradient(90deg, rgba(255,193,7,0.18), rgba(255,193,7,0.04)); }" +
					".gwp-row-active:hover { background: linear-gradient(90deg, rgba(255,193,7,0.24), rgba(255,193,7,0.08)); }" +
					".gwp-iconbtn:hover { background: rgba(255,255,255,0.09); color: var(--dsw-alias-label-primary, #e8eaf0); }" +
					".gwp-addbtn:hover { background: rgba(255,255,255,0.08); }" +
					".gwp-xbtn:hover { background: rgba(255,80,80,0.16); color: var(--dsw-alias-state-error-primary, #ff7a7a); }" +
					".gwp-help-pop { opacity: 0; visibility: hidden; transition: opacity 0.15s ease, visibility 0.15s ease; }" +
					".gwp-help:hover .gwp-help-pop, .gwp-help:focus-within .gwp-help-pop { opacity: 1; visibility: visible; }" +
					".gwp-panel::-webkit-scrollbar { width: 8px; }" +
					".gwp-panel::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l2, rgba(255,255,255,0.12)); border-radius: 999px; }" +
					".gwp-panel::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l2, rgba(255,255,255,0.2)); }";
				document.head.appendChild(hubEl);
				return () => {
					hubEl.remove();
				};
			}, "gif-wallpaper: hub styles");
			const slots = ctx.get("slots");
			if (slots !== undefined) {
				ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: "gif-wallpaper-hub",
					order: 30,
					label: () => "插件",
					inject: () => ({})
				}, PluginsHub));
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "gif-wallpaper-star",
					order: 90,
					label: () => "壁纸透明度",
					inject: () => ({ theme })
				}, StarSlider));
			}
			check();
			loadLibrary();
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
