/**
 * dsh-at-file — client half (browser bundle).
 *
 * Composer @-picker: type `@` in the input box (at a word boundary) and a
 * popup lists workspace files, ranked by how well they match the token after
 * the `@`. Picking one replaces the token with `@<path>`; the host half then
 * inlines the file's content into the model step at agent/pre-step.
 *
 * Lives in the conversation.input.overlay slot (the InputBar floating overlay
 * anchor — a zero-height absolute box at the top of the composer card), so it
 * renders nothing while closed and floats above the composer when open.
 */
window.__ModuleLoader__.load({
	id: "dsh-at-file",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const inject = ["slots"];

		// ── @-trigger detection ────────────────────────────────────────────
		// Find the LAST `@token` in the draft whose `@` is not preceded by an
		// ASCII word char (so emails and a@b stay inert). The token runs to
		// whitespace or another `@`, with trailing punctuation trimmed.
		const TRAILING_PUNCT = /[，。！？；：、（）【】《》〈〉“”‘’"'()\[\]{}<>|&$#%^=+,;:!?]+$/g;

		function findTrigger(draft) {
			let best = null;
			for (let i = 0; i < draft.length; i++) {
				if (draft[i] !== "@") continue;
				const prev = i > 0 ? draft[i - 1] : "";
				if (/[A-Za-z0-9_]/.test(prev)) continue;
				let j = i + 1;
				while (j < draft.length && !/\s/.test(draft[j]) && draft[j] !== "@") j++;
				let raw = draft.slice(i + 1, j);
				raw = raw.replace(TRAILING_PUNCT, "");
				best = { start: i, end: i + 1 + raw.length, query: raw };
			}
			return best;
		}

		function formatSize(size) {
			if (typeof size !== "number" || !isFinite(size)) return "";
			if (size < 1024) return size + " B";
			if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
			return (size / (1024 * 1024)).toFixed(1) + " MB";
		}

		// ── the picker component ───────────────────────────────────────────
		function AtFilePopup(props) {
			const useInput = props.useInput;
			const inputActions = props.inputActions;
			const useSessions = props.useSessions;
			const sessionId = props.sessionId;

			const draft = useInput ? useInput((s) => s.draft) : "";
			const cwd = useSessions ? useSessions((s) => {
				const row = s.byId[sessionId];
				return row ? row.cwd : undefined;
			}) : undefined;

			const [open, setOpen] = react.useState(false);
			const [query, setQuery] = react.useState("");
			const [items, setItems] = react.useState([]);
			const [selected, setSelected] = react.useState(0);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState(null);
			// After a pick, keep the committed `@path` closed until the user
			// edits it (start + query both match → still suppressed).
			const [suppressed, setSuppressed] = react.useState(null);
			const rootRef = react.useRef(null);
			const fetchSeq = react.useRef(0);

			const trigger = react.useMemo(() => findTrigger(draft || ""), [draft]);

			// Open/close on draft changes.
			react.useEffect(() => {
				const t = trigger;
				if (!t || !cwd) {
					setOpen(false);
					setQuery("");
					return;
				}
				if (suppressed && suppressed.start === t.start && suppressed.query === t.query) {
					return;
				}
				setSuppressed(null);
				setQuery(t.query);
				setSelected(0);
				setOpen(true);
			}, [draft, cwd]);

			// Fetch the ranked file list (debounced 120 ms).
			react.useEffect(() => {
				if (!open || !cwd) return;
				const seq = ++fetchSeq.current;
				setLoading(true);
				setError(null);
				const handle = setTimeout(() => {
					const url = "/dsh-at-file/list?cwd=" + encodeURIComponent(cwd) + "&q=" + encodeURIComponent(query);
					fetch(url, { cache: "no-store" })
						.then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
						.then((data) => {
							if (fetchSeq.current !== seq) return;
							setItems(data && Array.isArray(data.files) ? data.files : []);
							setSelected(0);
							setLoading(false);
						})
						.catch((e) => {
							if (fetchSeq.current !== seq) return;
							setError(String((e && e.message) || e));
							setItems([]);
							setLoading(false);
						});
				}, 120);
				return () => clearTimeout(handle);
			}, [open, query, cwd]);

			// Keyboard navigation while open (capture phase: runs before the
			// input machine's own handlers).
			react.useEffect(() => {
				if (!open) return;
				const onKey = (e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						setOpen(false);
						return;
					}
					if (e.key === "ArrowDown") {
						e.preventDefault();
						e.stopPropagation();
						setSelected((s) => Math.min(Math.max(items.length - 1, 0), s + 1));
						return;
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						e.stopPropagation();
						setSelected((s) => Math.max(0, s - 1));
						return;
					}
					if (e.key === "Enter") {
						e.preventDefault();
						e.stopPropagation();
						const item = items[selected] || items[0];
						if (item) {
							commitPick(item);
						} else {
							setOpen(false);
						}
					}
				};
				window.addEventListener("keydown", onKey, true);
				return () => window.removeEventListener("keydown", onKey, true);
			}, [open, items, selected, draft, trigger]);

			// Click-away closes.
			react.useEffect(() => {
				if (!open) return;
				const onDown = (e) => {
					if (rootRef.current && rootRef.current.contains(e.target)) return;
					setOpen(false);
				};
				document.addEventListener("mousedown", onDown, true);
				return () => document.removeEventListener("mousedown", onDown, true);
			}, [open]);

			function commitPick(item) {
				const t = trigger;
				if (!t) {
					setOpen(false);
					return;
				}
				const next = draft.slice(0, t.start) + "@" + item.path + draft.slice(t.end);
				setOpen(false);
				setSuppressed({ start: t.start, query: item.path });
				if (inputActions && typeof inputActions.setDraft === "function") {
					inputActions.setDraft(next);
				}
			}

			if (!open) return null;

			const rows = items.map((item, index) => react.createElement(
				"div",
				{
					key: item.path,
					className: "atf-row" + (index === selected ? " atf-row-active" : ""),
					onMouseEnter: () => setSelected(index),
					onClick: () => commitPick(item),
					onMouseDown: (e) => e.stopPropagation()
				},
				react.createElement("span", { className: "atf-file" },
					react.createElement("span", { className: "atf-icon" }, "\uD83D\uDCC4"),
					react.createElement("span", { className: "atf-name" }, item.name)
				),
				react.createElement("span", { className: "atf-meta" },
					react.createElement("span", { className: "atf-path" }, item.path),
					react.createElement("span", { className: "atf-size" }, formatSize(item.size))
				)
			));

			const empty = !loading && !error && items.length === 0;

			return react.createElement(
				"div",
				{
					ref: rootRef,
					className: "atf-popup",
					role: "listbox",
					onMouseDown: (e) => e.stopPropagation()
				},
				react.createElement(
					"div",
					{ className: "atf-header" },
					react.createElement("span", { className: "atf-title" }, "\uD83D\uDCCE @\u6587\u4EF6\u9644\u52A0"),
					query ? react.createElement("span", { className: "atf-query" }, query) : null,
					react.createElement("span", { className: "atf-spacer" }),
					react.createElement("button", {
						type: "button",
						className: "atf-close",
						title: "关闭 (Esc)",
						onClick: () => setOpen(false)
					}, "\u2715")
				),
				loading ? react.createElement("div", { className: "atf-hint" }, "\u52A0\u8F7D\u4E2D\u2026") : null,
				error ? react.createElement("div", { className: "atf-hint atf-error" }, "\u52A0\u8F7D\u5931\u8D25: " + error) : null,
				empty ? react.createElement("div", { className: "atf-hint" }, "\u65E0\u5339\u914D\u6587\u4EF6") : null,
				rows.length > 0 ? react.createElement("div", { className: "atf-list" }, rows) : null,
				react.createElement(
					"div",
					{ className: "atf-footer" },
					"\u2191\u2193 \u9009\u62E9 \u00B7 Enter \u9644\u52A0 \u00B7 Esc \u5173\u95ED"
				)
			);
		}

		// ── apply ──────────────────────────────────────────────────────────
		const POPUP_CSS =
			".atf-popup{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));max-height:min(420px,60vh);display:flex;flex-direction:column;border-radius:14px;padding:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.12));background:var(--dsw-specific-menu,rgba(21,24,31,0.94));box-shadow:0 16px 48px rgba(0,0,0,0.5),0 2px 10px rgba(0,0,0,0.3);backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);z-index:30;animation:atf-in .16s ease-out}" +
			"@keyframes atf-in{from{opacity:0;transform:translateX(-50%) translateY(8px) scale(.97)}to{opacity:1;transform:translateX(-50%)}}" +
			".atf-header{display:flex;align-items:center;gap:8px;padding:6px 8px 8px 12px}" +
			".atf-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaf0)}" +
			".atf-query{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa4b5);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));border-radius:6px;padding:1px 7px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
			".atf-spacer{flex:1}" +
			".atf-close{background:none;border:none;cursor:pointer;color:var(--dsw-alias-label-tertiary,#8a93a5);font-size:13px;padding:2px 6px;border-radius:6px}" +
			".atf-close:hover{background:rgba(255,255,255,.09);color:var(--dsw-alias-label-primary,#e8eaf0)}" +
			".atf-list{overflow-y:auto;padding:2px;flex:1;min-height:0}" +
			".atf-list::-webkit-scrollbar{width:8px}" +
			".atf-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(255,255,255,.12));border-radius:999px}" +
			".atf-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 10px;border-radius:8px;cursor:pointer;transition:background .12s ease}" +
			".atf-row:hover{background:rgba(255,255,255,.06)}" +
			".atf-row-active{background:linear-gradient(90deg,rgba(77,144,254,.22),rgba(77,144,254,.05))}" +
			".atf-row-active:hover{background:linear-gradient(90deg,rgba(77,144,254,.28),rgba(77,144,254,.08))}" +
			".atf-file{display:flex;align-items:center;gap:8px;min-width:0}" +
			".atf-icon{flex:none;font-size:13px}" +
			".atf-name{font-size:13px;color:var(--dsw-alias-label-primary,#e8eaf0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
			".atf-meta{display:flex;align-items:center;gap:10px;flex:none}" +
			".atf-path{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a93a5);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
			".atf-size{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a93a5);flex:none}" +
			".atf-hint{padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a93a5)}" +
			".atf-error{color:var(--dsw-alias-state-error-primary,#ff7a7a)}" +
			".atf-footer{padding:6px 10px 4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a93a5);border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));margin-top:4px;text-align:center}";

		function apply(ctx) {
			ctx.effect(() => {
				const styleEl = document.createElement("style");
				styleEl.dataset.plugin = "dsh-at-file";
				styleEl.dataset.pluginCss = "dsh-at-file/popup";
				styleEl.textContent = POPUP_CSS;
				document.head.appendChild(styleEl);
				return () => {
					styleEl.remove();
				};
			}, "at-file: popup styles");

			const slots = ctx.get("slots");
			if (slots !== undefined) {
				ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
					name: "conversation.input.overlay",
					id: "at-file",
					order: 2,
					label: () => "@文件",
					inject: () => ({})
				}, AtFilePopup));
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
