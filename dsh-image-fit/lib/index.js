/**
 * dsh-image-fit — host half.
 *
 * 这个插件不需要任何 Host 能力：功能全部在浏览器端（注入一段样式让预览图片
 * 自适应面板大小）。这里只提供插件身份，让 Loader 有一个合法的 Host 条目。
 */
export const name = "image-fit";
/** No services required. */
export const inject = [];
/** Nothing to mount on the host side. */
export function apply() {}
