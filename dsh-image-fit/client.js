/**
 * dsh-image-fit — client half.
 *
 * DSH 的右侧文档预览按**原始像素**渲染图片（ImageBody 的 CSS 写死
 * `max-width:none; max-height:none`，源码注释也说明 "without fitting or scaling
 * them to the pane"），所以大图必须滚动才看得全。
 *
 * 这个插件做两件事：
 *   1. 向 `documentPreviews` 注册表注册一个**自己的图片预览实现**（priority 非
 *      builtin，因此优先于内置实现），组件按面板大小等比缩放图片并居中；
 *   2. 点击图片可在「适应面板 / 原始尺寸」之间切换，右下角显示像素尺寸。
 *
 * 另外仍注入一段兜底样式，万一注册未被选中，图片也不会溢出面板。
 */
window.__ModuleLoader__.load({
	id: "dsh-image-fit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		const inject = [];
		const PREVIEW_ID = "dsh-image-fit";
		const STYLE_ID = "dsh-image-fit/styles";
		const FILE_PREFIX = "dsh-resource://file/";
		const EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"];
		const MEDIA_TYPES = {
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif",
			webp: "image/webp",
			bmp: "image/bmp",
			ico: "image/x-icon",
			svg: "image/svg+xml"
		};

		/** 兜底样式：即使注册的组件没被选中，图片也不会撑出面板。 */
		const CSS = [
			'img[class*="_image"]{width:auto !important;height:auto !important;',
			"max-width:100% !important;max-height:100% !important;",
			"object-fit:contain !important;margin:auto !important;}",
			'div[class*="_frame"]:has(> img[class*="_image"]){width:100% !important;height:100% !important;',
			"align-items:center !important;justify-content:center !important;}"
		].join("");

		const MUTED = { color: "var(--dsw-alias-label-secondary, #9aa3b2)", fontSize: 13, padding: 12, margin: 0 };

		/** 从 `dsh-resource://file/session/<id>/<path>` 取出文件路径。 */
		function filePathOf(address) {
			if (typeof address !== "string" || address.startsWith(FILE_PREFIX) === false) return "";
			const end = address.search(/[?#]/);
			const body = address.slice(FILE_PREFIX.length, end === -1 ? undefined : end);
			const parts = body.split("/");
			const scope = parts.shift();
			if (scope === "session") {
				parts.shift();
				return parts.map(decodeURIComponent).join("/");
			}
			if (scope === "absolute") return parts.map(decodeURIComponent).join("/");
			return "";
		}

		/** 路径 → 图片 MIME。 */
		function mediaTypeOf(path) {
			const name = String(path).replaceAll("\\", "/").toLowerCase();
			const dot = name.lastIndexOf(".");
			if (dot === -1) return undefined;
			return MEDIA_TYPES[name.slice(dot + 1)];
		}

		/**
		 * 图片预览主体：默认等比缩放到面板内；点击在「适应 / 原始尺寸」间切换。
		 * 收到的 props 与内置实现一致：`content`（bytes）、`resourceAddress`。
		 */
		function FitImageBody(props) {
			const content = props ? props.content : undefined;
			const resourceAddress = props ? props.resourceAddress : undefined;
			const path = react.useMemo(() => filePathOf(resourceAddress), [resourceAddress]);
			const mediaType = react.useMemo(() => mediaTypeOf(path), [path]);

			const [url, setUrl] = react.useState(null);
			const [failed, setFailed] = react.useState(false);
			const [fit, setFit] = react.useState(true);
			const [natural, setNatural] = react.useState(null);

			react.useEffect(() => {
				const bytes = content && content.kind === "bytes" ? content.data : undefined;
				if (bytes === undefined || mediaType === undefined) return undefined;
				let objectUrl;
				try {
					objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
					setUrl(objectUrl);
					setFailed(false);
				} catch (_error) {
					setFailed(true);
				}
				return () => {
					if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
				};
			}, [content, mediaType]);

			if (mediaType === undefined || (content && content.kind !== "bytes")) {
				return react.createElement("p", { style: MUTED }, "无法预览该文件");
			}
			if (failed) return react.createElement("p", { style: MUTED }, "图片渲染失败");
			if (url === null) return react.createElement("p", { style: MUTED }, "加载中…");

			const imgStyle = fit
				? {
					width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%",
					objectFit: "contain", display: "block", margin: "auto", cursor: "zoom-in"
				}
				: {
					width: "auto", height: "auto", maxWidth: "none", maxHeight: "none",
					display: "block", margin: "auto", cursor: "zoom-out"
				};

			const badge = natural === null
				? null
				: react.createElement(
					"div",
					{
						style: {
							position: "absolute", right: 10, bottom: 8, padding: "2px 8px", borderRadius: 8,
							background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, lineHeight: "16px",
							pointerEvents: "none", fontFamily: "ui-monospace, Consolas, monospace"
						}
					},
					natural.w + "×" + natural.h + " · " + (fit ? "适应面板" : "原始尺寸")
				);

			return react.createElement(
				"div",
				{
					style: {
						width: "100%", height: "100%", boxSizing: "border-box", padding: 8,
						display: "flex", alignItems: "center", justifyContent: "center",
						overflow: "auto", position: "relative"
					}
				},
				react.createElement("img", {
					src: url,
					alt: path,
					title: fit ? "点击查看原始尺寸" : "点击适应面板",
					style: imgStyle,
					onClick: () => setFit((value) => !value),
					onLoad: (event) => setNatural({ w: event.target.naturalWidth, h: event.target.naturalHeight })
				}),
				badge
			);
		}

		function apply(ctx) {
			// 1) 兜底样式
			if (typeof document !== "undefined" && document.getElementById(STYLE_ID) === null) {
				const tag = document.createElement("style");
				tag.id = STYLE_ID;
				tag.dataset.plugin = "dsh-image-fit";
				tag.textContent = CSS;
				document.head.appendChild(tag);
				ctx.effect(() => () => {
					tag.remove();
				}, "image-fit: stylesheet");
			}

			// 2) 注册自己的预览实现（priority 非 builtin ⇒ 排在内置图片预览之前）
			const registry = ctx.get("documentPreviews");
			if (registry === undefined || typeof registry.register !== "function") return;
			ctx.effect(() => registry.register({
				id: PREVIEW_ID,
				extensions: EXTENSIONS,
				priority: "extension",
				title: () => "图片（适应面板）"
			}), "image-fit: preview metadata");

			const slots = ctx.get("slots");
			if (slots === undefined) return;
			ctx.slots.inject("sidebar.right.tab.document", () => ctx.slots.register({
				name: "sidebar.right.tab.document",
				key: PREVIEW_ID
			}, FitImageBody));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
