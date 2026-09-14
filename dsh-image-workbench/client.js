/**
 * dsh-image-workbench — client half.
 *
 * 右侧栏的「图片」标签页：一个图片工作台。
 *   · 顶部：刷新 / 输出尺寸 / 状态
 *   · 缩略图条：图片库里所有图，点一下切换当前图
 *   · 主区：当前图，可用鼠标拖拽框选一块区域
 *   · 底部：提示词 + 「整图重做」「重绘选区」「删除」
 *
 * 所有网络请求都打到 host 端的 /dsh-image-workbench/* 路由；生成与编辑由 host
 * 调用 out/ 目录下的 Node 脚本完成。
 */
window.__ModuleLoader__.load({
	id: "dsh-image-workbench",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		const inject = ["slots"];
		const PLUGIN_ID = "dsh-image-workbench";
		const TAB_KIND = "image-workbench";
		const API = "/dsh-image-workbench";

		const MUTED = { color: "var(--dsw-alias-label-tertiary, #8a93a5)", fontSize: 12 };
		const MONO = { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" };
		const SIZES = ["1024x1024", "1536x1024", "1024x1536", "2048x2048"];

		function fileUrl(name) {
			return API + "/file/" + encodeURIComponent(name);
		}
		function clamp01(value) {
			return Math.max(0, Math.min(1, value));
		}
		function iconButtonStyle() {
			return {
				width: 26, height: 26, flex: "none", border: "none", borderRadius: 8,
				background: "transparent", color: "var(--dsw-alias-label-secondary, #9aa3b2)",
				fontSize: 13, lineHeight: 1, fontFamily: "inherit", cursor: "pointer",
				display: "inline-flex", alignItems: "center", justifyContent: "center"
			};
		}
		function actionStyle(primary) {
			return {
				flex: "none", height: 28, padding: "0 12px", borderRadius: 8, border: "none",
				background: primary ? "rgba(255,193,7,0.18)" : "transparent",
				color: primary ? "#ffc107" : "var(--dsw-alias-label-secondary, #9aa3b2)",
				borderColor: "transparent",
				fontFamily: "inherit", fontSize: 12, cursor: "pointer",
				...(primary ? {} : { border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))" })
			};
		}

		function WorkbenchBody() {
			const [files, setFiles] = react.useState([]);
			const [current, setCurrent] = react.useState(null);
			const [prompt, setPrompt] = react.useState("");
			const [size, setSize] = react.useState("1024x1024");
			const [region, setRegion] = react.useState(null);
			const [drag, setDrag] = react.useState(null);
			const [natural, setNatural] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState("");
			const boxRef = react.useRef(null);

			const refresh = react.useCallback(async (selectFirst) => {
				try {
					const response = await fetch(API + "/list", { cache: "no-store" });
					const payload = await response.json();
					const list = (payload && payload.files) || [];
					setFiles(list);
					if (selectFirst || !list.some((item) => item.name === current)) {
						setCurrent(list.length > 0 ? list[0].name : null);
					}
				} catch (cause) {
					setNotice("读取图片库失败：" + String((cause && cause.message) || cause));
				}
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [current]);

			react.useEffect(() => {
				refresh(true);
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, []);

			const select = (name) => {
				setCurrent(name);
				setRegion(null);
				setDrag(null);
				setNatural(null);
				setNotice("");
			};

			/** 把鼠标位置换算成「相对图片本身」的 0~1 坐标（排除 contain 留白）。 */
			const pointerToImage = (event) => {
				const box = boxRef.current;
				if (box === null) return null;
				const rect = box.getBoundingClientRect();
				const pad = 8;
				const innerW = rect.width - pad * 2;
				const innerH = rect.height - pad * 2;
				let dispW = innerW;
				let dispH = innerH;
				let offsetX = pad;
				let offsetY = pad;
				if (natural !== null && natural.w > 0 && natural.h > 0) {
					const scale = Math.min(innerW / natural.w, innerH / natural.h);
					dispW = natural.w * scale;
					dispH = natural.h * scale;
					offsetX = pad + (innerW - dispW) / 2;
					offsetY = pad + (innerH - dispH) / 2;
				}
				return {
					x: clamp01((event.clientX - rect.left - offsetX) / dispW),
					y: clamp01((event.clientY - rect.top - offsetY) / dispH)
				};
			};

			const onPointerDown = (event) => {
				if (current === null || busy) return;
				const point = pointerToImage(event);
				if (point === null) return;
				setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch (_error) {
					/* 忽略 */
				}
			};

			const onPointerMove = (event) => {
				if (drag === null) return;
				const point = pointerToImage(event);
				if (point === null) return;
				setDrag({ x0: drag.x0, y0: drag.y0, x1: point.x, y1: point.y });
			};

			const onPointerUp = () => {
				if (drag === null) return;
				const x = Math.min(drag.x0, drag.x1);
				const y = Math.min(drag.y0, drag.y1);
				const w = Math.abs(drag.x1 - drag.x0);
				const h = Math.abs(drag.y1 - drag.y0);
				setDrag(null);
				if (w < 0.015 || h < 0.015) {
					setRegion(null);
					return;
				}
				setRegion({ x, y, w, h });
			};

			const call = async (path, body, label) => {
				setBusy(true);
				setNotice(label + "…");
				try {
					const response = await fetch(API + path, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					});
					const payload = await response.json();
					if (!payload || payload.ok !== true) {
						setNotice("失败：" + ((payload && payload.error) || "未知错误"));
						return;
					}
					const created = payload.created || [];
					setRegion(null);
					await refresh(false);
					if (created.length > 0) setCurrent(created[0]);
					setNotice((created.length > 0 ? "已生成 " + created.length + " 张：" + created.join("、") : "完成") + (payload.log ? "\n" + payload.log : ""));
				} catch (cause) {
					setNotice("请求失败：" + String((cause && cause.message) || cause));
				} finally {
					setBusy(false);
				}
			};

			const generate = () => {
				if (prompt.trim().length === 0) {
					setNotice("请先写提示词");
					return;
				}
				call("/generate", { prompt: prompt.trim(), size }, "正在生成（约 40 秒）");
			};

			const redoAll = () => {
				if (current === null || prompt.trim().length === 0) {
					setNotice("需要先选一张图并写提示词");
					return;
				}
				call("/edit", { file: current, prompt: prompt.trim(), size, feather: 0 }, "正在整图重做（约 50 秒）");
			};

			const repaint = () => {
				if (current === null || region === null || prompt.trim().length === 0) {
					setNotice("需要先框选区域并写提示词");
					return;
				}
				const spec = [region.x, region.y, region.w, region.h].map((value) => value.toFixed(4)).join(",");
				call("/edit", { file: current, prompt: prompt.trim(), region: spec, size, feather: 12 }, "正在重绘选区（约 50 秒）");
			};

			const remove = async () => {
				if (current === null) return;
				setBusy(true);
				try {
					await fetch(API + "/delete", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ file: current })
					});
					setCurrent(null);
					setRegion(null);
					await refresh(true);
					setNotice("已删除 " + current);
				} catch (cause) {
					setNotice("删除失败：" + String((cause && cause.message) || cause));
				} finally {
					setBusy(false);
				}
			};

			const boxRect = drag !== null
				? {
					x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1),
					w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0)
				}
				: region;

			return react.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 300, minWidth: 0, overflow: "hidden" } },
				// 工具栏
				react.createElement(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 6px", flex: "none" } },
					react.createElement("span", { style: { fontSize: 12.5, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e8eaf0)" } }, "图片工作台"),
					react.createElement(
						"select",
						{
							value: size,
							onChange: (event) => setSize(event.target.value),
							style: {
								height: 24, borderRadius: 7, border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))",
								background: "transparent", color: "var(--dsw-alias-label-secondary, #9aa3b2)",
								fontFamily: "inherit", fontSize: 11.5, padding: "0 4px"
							}
						},
						SIZES.map((item) => react.createElement("option", { key: item, value: item }, item))
					),
					react.createElement("span", { style: { flex: 1 } }),
					busy ? react.createElement("span", { style: MUTED }, "处理中…") : null,
					react.createElement("button", { type: "button", title: "刷新列表", onClick: () => refresh(true), style: iconButtonStyle() }, "↻")
				),
				// 缩略图条
				react.createElement(
					"div",
					{ style: { display: "flex", gap: 6, overflowX: "auto", padding: "0 10px 8px", flex: "none" } },
					files.length === 0
						? react.createElement("span", { style: MUTED }, "图片库为空，先在下面写提示词生成一张")
						: files.map((item) =>
							react.createElement("img", {
								key: item.name,
								src: fileUrl(item.name),
								title: item.name,
								onClick: () => select(item.name),
								style: {
									width: 52, height: 52, flex: "none", objectFit: "cover", borderRadius: 8, cursor: "pointer",
									border: item.name === current ? "2px solid #ffc107" : "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))"
								}
							})
						)
				),
				// 主预览 + 框选
				react.createElement(
					"div",
					{
						ref: boxRef,
						onPointerDown,
						onPointerMove,
						onPointerUp,
						onPointerCancel: onPointerUp,
						style: {
							flex: 1, minHeight: 0, position: "relative", padding: 8, boxSizing: "border-box",
							display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
							cursor: current === null ? "default" : "crosshair", touchAction: "none",
							background: "rgba(255,255,255,0.02)"
						}
					},
					current === null
						? react.createElement("span", { style: MUTED }, "选一张图，或直接生成一张")
						: react.createElement("img", {
							src: fileUrl(current),
							draggable: false,
							onLoad: (event) => setNatural({ w: event.target.naturalWidth, h: event.target.naturalHeight }),
							style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", userSelect: "none", pointerEvents: "none" }
						}),
					boxRect !== null && boxRect.w > 0
						? react.createElement("div", {
							style: {
								position: "absolute",
								left: `calc(8px + ${(boxRect.x * 100).toFixed(3)}% - ${(boxRect.x * 16).toFixed(2)}px)`,
								top: `calc(8px + ${(boxRect.y * 100).toFixed(3)}% - ${(boxRect.y * 16).toFixed(2)}px)`,
								width: `${(boxRect.w * 100).toFixed(3)}%`,
								height: `${(boxRect.h * 100).toFixed(3)}%`,
								border: "1px dashed #ffc107",
								background: "rgba(255,193,7,0.16)",
								pointerEvents: "none",
								borderRadius: 2
							}
						})
						: null
				),
				// 底部操作区
				react.createElement(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px 10px", flex: "none" } },
					react.createElement("input", {
						value: prompt,
						spellCheck: false,
						placeholder: "提示词：要生成什么 / 要改什么",
						onChange: (event) => setPrompt(event.target.value),
						style: {
							height: 30, borderRadius: 8, padding: "0 8px",
							border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))",
							background: "rgba(255,255,255,0.04)",
							color: "var(--dsw-alias-label-primary, #e8eaf0)",
							fontFamily: "inherit", fontSize: 12
						}
					}),
					react.createElement(
						"div",
						{ style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
						react.createElement("button", { type: "button", disabled: busy, onClick: generate, style: actionStyle(true) }, "生成"),
						react.createElement("button", { type: "button", disabled: busy || current === null, onClick: redoAll, style: actionStyle(false) }, "整图重做"),
						react.createElement("button", {
							type: "button",
							disabled: busy || current === null || region === null,
							onClick: repaint,
							style: region === null
								? Object.assign(actionStyle(false), { opacity: 0.5 })
								: Object.assign(actionStyle(false), { border: "1px solid rgba(255,193,7,0.5)", color: "#ffc107" })
						}, "重绘选区"),
						react.createElement("span", { style: { flex: 1 } }),
						region !== null
							? react.createElement("span", { style: MUTED }, `选区 ${(region.w * 100).toFixed(0)}%×${(region.h * 100).toFixed(0)}%`)
							: null,
						react.createElement("button", { type: "button", disabled: busy || current === null, onClick: remove, style: actionStyle(false) }, "删除")
					),
					notice
						? react.createElement(
							"div",
							{ style: Object.assign({ whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.45, maxHeight: 90, overflow: "auto" }, MUTED) },
							notice
						)
						: null
				)
			);
		}

		function WorkbenchTitle() {
			return react.createElement(
				"span",
				{ style: { display: "inline-flex", alignItems: "center", gap: 6 } },
				react.createElement("span", { style: { fontSize: 14, lineHeight: 1 } }, "🖼"),
				react.createElement("span", null, "图片")
			);
		}

		/** 入口按钮：标题栏用紧凑样式，侧栏底部用整行样式（props.variant === "row"）。 */
		function WorkbenchLauncher(props) {
			const [pending, setPending] = react.useState(false);
			const row = props !== null && props !== undefined && props.variant === "row";
			const onClick = () => {
				const open = props && props.open;
				if (typeof open !== "function") return;
				setPending(true);
				try {
					if (!open()) console.warn("dsh-image-workbench: 右侧栏当前不可用");
				} catch (error) {
					console.warn("dsh-image-workbench: 入口调用出错", error);
				}
				window.setTimeout(() => setPending(false), 400);
			};
			const shape = row
				? {
					width: "100%", height: 40, borderRadius: 10, padding: "0 10px",
					display: "flex", alignItems: "center", gap: 10,
					fontSize: 13, color: "var(--dsw-alias-label-primary, #e8eaf0)"
				}
				: {
					display: "inline-flex", alignItems: "center", gap: 6,
					height: 28, padding: "0 9px", borderRadius: 8,
					fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #9aa3b2)"
				};
			return react.createElement(
				"button",
				{
					type: "button",
					title: "打开图片工作台",
					onClick,
					style: Object.assign(
						{ flex: "none", border: "none", fontFamily: "inherit", cursor: "pointer", background: "transparent" },
						shape,
						pending ? { background: "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))" } : {}
					),
					onMouseEnter: (event) => {
						event.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))";
					},
					onMouseLeave: (event) => {
						if (!pending) event.currentTarget.style.background = "transparent";
					}
				},
				react.createElement("span", { style: { fontSize: row ? 15 : 14, lineHeight: 1 } }, "🖼"),
				react.createElement("span", { style: row ? { flex: 1, textAlign: "left" } : null }, "图片")
			);
		}

		/**
		 * 错误边界：工作台内部一旦抛错，界面上会显示原因而不是一片空白
		 * （白屏时无法判断是没渲染还是渲染失败，这一步是为了让问题可见）。
		 */
		class WorkbenchBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			componentDidCatch(error, info) {
				console.error("dsh-image-workbench render error:", error, info);
			}
			render() {
				if (this.state.error !== null) {
					return react.createElement(
						"div",
						{ style: { padding: 12, color: "#ff8a8a", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", overflow: "auto" } },
						"图片工作台渲染出错：\n" + String((this.state.error && this.state.error.message) || this.state.error)
					);
				}
				return this.props.children;
			}
		}

		function WorkbenchSafe() {
			return react.createElement(WorkbenchBoundary, null, react.createElement(WorkbenchBody, null));
		}

		/** 打开工作台标签：先尝试放标签，失败则先把右侧栏展开再放。 */
		function openWorkbench(ctx) {
			try {
				const service = ctx.get("sidebarRight");
				const layout = ctx.get("layout");
				const place = () => {
					if (service === undefined || typeof service.openTab !== "function") return false;
					try {
						service.openTab(TAB_KIND);
						return true;
					} catch (_error) {
						return false;
					}
				};
				if (place()) return true;
				if (layout !== undefined && typeof layout.openRightbar === "function") {
					try {
						layout.openRightbar(true, false);
					} catch (_error) {
						return false;
					}
					return place();
				}
				return false;
			} catch (error) {
				console.warn("dsh-image-workbench: 打开标签失败", error);
				return false;
			}
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			// 入口先注册，且**不依赖**右侧栏服务是否已就绪：一旦它还没挂载，
			// 后面的 return 会把入口一起跳过（之前就是这样，界面上根本没有入口）。
			// 官方插件的统一写法：座位注册包在 ctx.effect 里执行，确保它发生在
			// fiber 就绪之后；直接同步调用可能在服务尚未挂载时注册落空（表现为白屏）。
			ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "image-workbench",
				order: 25,
				inject: () => ({ open: () => openWorkbench(ctx) })
			}, WorkbenchLauncher)), "image-workbench: header entry");

			// 第二个入口：侧栏底部（更显眼，作为兜底）
			ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "image-workbench",
				order: 35,
				inject: () => ({ open: () => openWorkbench(ctx), variant: "row" })
			}, WorkbenchLauncher)), "image-workbench: sidebar entry");

			const tabs = ctx.get("sidebarRightTabs");
			if (tabs === undefined || typeof tabs.register !== "function") return;

			ctx.effect(() => tabs.register({
				id: PLUGIN_ID,
				kind: TAB_KIND,
				priority: "builtin",
				title: () => "图片",
				guide: [{
					order: 30,
					title: () => "图片工作台",
					description: () => "看图、生成、框选局部重绘",
					icon: () => "🖼"
				}]
			}), "image-workbench: tab type");

			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: PLUGIN_ID
			}, WorkbenchSafe)), "image-workbench: tab body");

			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: PLUGIN_ID
			}, WorkbenchTitle)), "image-workbench: tab title");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
