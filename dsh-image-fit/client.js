/**
 * dsh-image-fit — client half.
 *
 * DSH 的右侧文档预览里，图片是按**原始像素尺寸**渲染的（ImageBody 的 CSS 写着
 * `max-width:none; max-height:none`，源码注释也说明 "without fitting or scaling
 * them to the pane"），所以大图在窄面板里必须滚动才能看全。
 *
 * 这个插件只做一件事：注入一段样式，把预览里的图片改成**等比缩放到面板内**
 * （object-fit: contain），并且让承载它的 frame 撑满面板、居中显示。
 *
 * 选择器用 CSS Modules 的命名后缀（`<hash>_image` / `<hash>_frame`），不依赖
 * 具体构建哈希，所以 DSH 小版本更新后依然有效。
 */
window.__ModuleLoader__.load({
	id: "dsh-image-fit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const inject = [];

		const STYLE_ID = "dsh-image-fit/styles";
		const CSS = [
			// 图片：等比缩放，永远完整可见
			'img[class*="_image"]{',
			"width:auto !important;",
			"height:auto !important;",
			"max-width:100% !important;",
			"max-height:100% !important;",
			"object-fit:contain !important;",
			"margin:auto !important;",
			"}",
			// 承载图片的 frame：铺满面板并居中（原来是 width:max-content + 滚动）
			'div[class*="_frame"]:has(> img[class*="_image"]){',
			"width:100% !important;",
			"height:100% !important;",
			"align-items:center !important;",
			"justify-content:center !important;",
			"overflow:auto !important;",
			"}"
		].join("");

		function apply(ctx) {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const tag = document.createElement("style");
			tag.id = STYLE_ID;
			tag.dataset.plugin = "dsh-image-fit";
			tag.textContent = CSS;
			document.head.appendChild(tag);
			ctx.effect(() => () => {
				tag.remove();
			}, "image-fit: stylesheet");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
