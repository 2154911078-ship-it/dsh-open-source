/**
 * dsh-git-panel — client half (browser bundle).
 *
 * Primary surface: a right-sidebar tab (`sidebar.right.pane.tab`), registered
 * through the `sidebarRightTabs` type registry so it shows up in the right
 * pane's tab menu / guide alongside 文件 and 文档预览.
 *
 * Secondary surface: a compact `⑂ Git` chip in the session header actions that
 * opens that tab; if the right sidebar service is unavailable it falls back to
 * the same panel rendered as a popover.
 *
 * Read-only: it renders what the host half reports over /dsh-git-panel/*.
 */
window.__ModuleLoader__.load({
	id: "dsh-git-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const inject = ["slots"];

		const PLUGIN_ID = "dsh-git-panel";
		const TAB_KIND = "git-panel";
		const STORAGE_KEY = "dsh-git-panel-repo";
		const STATUS_INTERVAL_MS = 10000;
		const MAX_DIFF_LINES = 2000;

		// ── small helpers ───────────────────────────────────────────────────
		function readSavedRepo() {
			try {
				return localStorage.getItem(STORAGE_KEY) || "";
			} catch (_error) {
				return "";
			}
		}
		function saveRepo(value) {
			try {
				if (value) localStorage.setItem(STORAGE_KEY, value);
				else localStorage.removeItem(STORAGE_KEY);
			} catch (_error) {}
		}

		/** Status-letter → colour, matching git's own convention. */
		function letterColor(row) {
			const letter = row.untracked ? "?" : (row.index !== " " ? row.index : row.worktree);
			if (letter === "?") return "#8a93a5";
			if (row.index === "D" || row.worktree === "D") return "#ff7a7a";
			if (row.index === "A") return "#7ee787";
			if (letter === "R" || letter === "C") return "#c8a2ff";
			if (letter === "U") return "#ff9f43";
			return "#ffc107";
		}
		function letterOf(row) {
			if (row.untracked) return "?";
			if (row.index !== " " && row.worktree !== " ") return row.index + row.worktree;
			return row.index !== " " ? row.index : row.worktree;
		}

		const MUTED = { color: "var(--dsw-alias-label-tertiary, #8a93a5)", fontSize: 12 };
		const MONO = { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" };

		function iconButtonStyle() {
			return {
				width: 26, height: 26, flex: "none", border: "none", borderRadius: 8,
				background: "transparent", color: "var(--dsw-alias-label-secondary, #9aa3b2)",
				fontSize: 13, lineHeight: 1, fontFamily: "inherit", cursor: "pointer",
				display: "inline-flex", alignItems: "center", justifyContent: "center"
			};
		}

		/** Small glyph used by the right-pane guide entry. */
		function GitGlyph() {
			return react.createElement("span", { style: { fontSize: 14, lineHeight: 1 } }, "⑂");
		}

		// ── panel body (right-sidebar tab + popover fallback) ───────────────
		function GitPanelBody() {
			const [repo, setRepo] = react.useState("");
			const [repoInput, setRepoInput] = react.useState("");
			const [data, setData] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState("");
			const [view, setView] = react.useState("changes");
			const [selected, setSelected] = react.useState(null);
			const [diff, setDiff] = react.useState(null);
			const [commitMessage, setCommitMessage] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState("");
			/** True while the path box has focus: the 10s refresh must not overwrite typing. */
			const editingRepo = react.useRef(false);

			const load = react.useCallback(async (target) => {
				setLoading(true);
				setError("");
				try {
					const query = target ? "?repo=" + encodeURIComponent(target) : "";
					const response = await fetch("/dsh-git-panel/status" + query, { cache: "no-store" });
					const payload = await response.json();
					setData(payload);
					if (payload && typeof payload.repo === "string" && payload.repo.length > 0) {
						setRepo(payload.repo);
						// Never clobber what the user is currently typing.
						if (!editingRepo.current) setRepoInput(payload.repo);
						saveRepo(payload.repo);
					}
					if (!payload || payload.ok !== true) setError((payload && payload.error) || "读取失败");
					else if (payload.isRepo !== true) setError(payload.error || "不是一个 git 仓库");
				} catch (cause) {
					setError(String((cause && cause.message) || cause));
				} finally {
					setLoading(false);
				}
			}, []);

			react.useEffect(() => {
				load(readSavedRepo());
				const id = setInterval(() => load(repo || readSavedRepo()), STATUS_INTERVAL_MS);
				return () => clearInterval(id);
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, []);

			const openDiff = async (row) => {
				setSelected(row);
				setView("diff");
				setDiff(null);
				const params = new URLSearchParams({ repo, file: row.path });
				if (row.untracked) params.set("untracked", "1");
				else if (row.modified === false && row.staged === true) params.set("staged", "1");
				try {
					const response = await fetch("/dsh-git-panel/diff?" + params.toString(), { cache: "no-store" });
					setDiff(await response.json());
				} catch (cause) {
					setDiff({ ok: false, error: String((cause && cause.message) || cause) });
				}
			};

			const applyRepo = () => {
				const next = repoInput.trim();
				if (next.length === 0) return;
				setSelected(null);
				setDiff(null);
				setView("changes");
				load(next);
			};

			/** Fire one write route (stage / unstage / commit), then refresh. */
			const write = async (action, payload) => {
				setBusy(true);
				setNotice("");
				try {
					const response = await fetch("/dsh-git-panel/" + action, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(Object.assign({ repo }, payload))
					});
					if (response.status === 404 || response.status === 405) {
						setNotice("写接口尚未加载：重启 DSH 后可用");
						return false;
					}
					const result = await response.json();
					if (result && result.ok === true) {
						setNotice(result.summary || "完成");
						await load(repo);
						return true;
					}
					setNotice((result && result.error) || "操作失败");
					return false;
				} catch (cause) {
					setNotice(String((cause && cause.message) || cause));
					return false;
				} finally {
					setBusy(false);
				}
			};

			const commit = async () => {
				if (commitMessage.trim().length === 0) {
					setNotice("请先填提交信息");
					return;
				}
				const ok = await write("commit", { message: commitMessage });
				if (ok) setCommitMessage("");
			};

			const renderDiff = () => {
				if (diff === null) return react.createElement("div", { style: MUTED }, "加载中…");
				if (diff.ok !== true) return react.createElement("div", { style: { color: "#ff7a7a", fontSize: 12 } }, diff.error || "读取失败");
				const lines = String(diff.diff || "").split("\n").slice(0, MAX_DIFF_LINES);
				if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
					return react.createElement("div", { style: MUTED }, "没有差异");
				}
				return react.createElement(
					"pre",
					{ style: Object.assign({ margin: 0, fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre", overflowX: "auto" }, MONO) },
					lines.map((line, index) => {
						let color = "var(--dsw-alias-label-primary, #e8eaf0)";
						let background = "transparent";
						if (line.startsWith("@@")) color = "#7aa2f7";
						else if (line.startsWith("+++") || line.startsWith("---")) color = "var(--dsw-alias-label-tertiary, #8a93a5)";
						else if (line.startsWith("+")) {
							color = "#7ee787";
							background = "rgba(46,160,67,0.12)";
						} else if (line.startsWith("-")) {
							color = "#ffa198";
							background = "rgba(248,81,73,0.12)";
						}
						return react.createElement("div", { key: index, style: { color, background, whiteSpace: "pre" } }, line.length > 0 ? line : " ");
					})
				);
			};

			const renderChanges = () => {
				const changes = (data && data.changes) || [];
				if (changes.length === 0) return react.createElement("div", { style: Object.assign({ padding: "10px 12px" }, MUTED) }, "工作区干净");
				return react.createElement(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: 1 } },
					changes.map((row) =>
						react.createElement(
							"div",
							{
								key: row.path,
								onClick: () => openDiff(row),
								title: row.path,
								style: {
									display: "flex", alignItems: "center", gap: 8, padding: "4px 12px",
									cursor: "pointer", fontSize: 12.5,
									color: "var(--dsw-alias-label-primary, #e8eaf0)"
								}
							},
							react.createElement(
								"span",
								{ style: Object.assign({ flex: "none", width: 18, textAlign: "center", fontWeight: 700, fontSize: 11, color: letterColor(row) }, MONO) },
								letterOf(row)
							),
							react.createElement(
								"span",
								{ style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
								row.path
							)
						)
					)
				);
			};

			const renderCommits = () => {
				const commits = (data && data.commits) || [];
				if (commits.length === 0) return react.createElement("div", { style: Object.assign({ padding: "10px 12px" }, MUTED) }, "没有提交");
				return react.createElement(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: 2 } },
					commits.map((commit) =>
						react.createElement(
							"div",
							{ key: commit.hash, style: { padding: "5px 12px", display: "flex", flexDirection: "column", gap: 2 } },
							react.createElement(
								"div",
								{ style: { display: "flex", gap: 8, fontSize: 12.5, color: "var(--dsw-alias-label-primary, #e8eaf0)" } },
								react.createElement("span", { style: Object.assign({ flex: "none", color: "#ffc107" }, MONO) }, commit.short),
								react.createElement("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, commit.subject)
							),
							react.createElement("div", { style: MUTED }, (commit.author || "") + " · " + (commit.date || ""))
						)
					)
				);
			};

			const tabButton = (id, label, badge) =>
				react.createElement(
					"button",
					{
						type: "button",
						onClick: () => setView(id),
						style: {
							flex: "none", height: 26, padding: "0 10px", borderRadius: 8, border: "none",
							cursor: "pointer", fontFamily: "inherit", fontSize: 12,
							background: view === id ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))" : "transparent",
							color: view === id ? "var(--dsw-alias-label-primary, #e8eaf0)" : "var(--dsw-alias-label-secondary, #9aa3b2)"
						}
					},
					label + (badge !== undefined ? " " + badge : "")
				);

			const branchLine = () => {
				if (!data || data.isRepo !== true) return null;
				const parts = [];
				parts.push(react.createElement("span", { key: "b", style: { color: "#ffc107", fontWeight: 600 } }, data.detached ? "(detached)" : (data.branch || "(unknown)")));
				if (data.upstream) parts.push(react.createElement("span", { key: "u", style: MUTED }, "→ " + data.upstream));
				if (data.ahead > 0) parts.push(react.createElement("span", { key: "a", style: { color: "#7ee787" } }, "↑" + data.ahead));
				if (data.behind > 0) parts.push(react.createElement("span", { key: "h", style: { color: "#ff9f43" } }, "↓" + data.behind));
				if (data.head) parts.push(react.createElement("span", { key: "c", style: Object.assign({ color: "var(--dsw-alias-label-tertiary, #8a93a5)" }, MONO) }, data.head.short));
				return react.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", padding: "2px 12px 6px", fontSize: 12, flexWrap: "wrap" } }, parts);
			};

			return react.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } },
				// repo picker
				react.createElement(
					"div",
					{ style: { display: "flex", gap: 6, padding: "8px 10px 6px", flex: "none" } },
					react.createElement("input", {
						value: repoInput,
						spellCheck: false,
						placeholder: "仓库路径（默认当前工作区）",
						onFocus: () => {
							editingRepo.current = true;
						},
						onBlur: () => {
							editingRepo.current = false;
						},
						onChange: (event) => setRepoInput(event.target.value),
						onKeyDown: (event) => {
							if (event.key === "Enter") applyRepo();
						},
						style: {
							flex: 1, minWidth: 0, height: 28, borderRadius: 8, padding: "0 8px",
							border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))",
							background: "rgba(255,255,255,0.04)",
							color: "var(--dsw-alias-label-primary, #e8eaf0)",
							fontFamily: "inherit", fontSize: 12
						}
					}),
					react.createElement(
						"button",
						{
							type: "button",
							title: "刷新",
							onClick: () => load(repo || readSavedRepo()),
							style: iconButtonStyle()
						},
						"↻"
					),
					react.createElement(
						"button",
						{
							type: "button",
							onClick: applyRepo,
							style: {
								flex: "none", height: 28, padding: "0 12px", borderRadius: 8, border: "none",
								background: "rgba(255,193,7,0.16)", color: "#ffc107",
								fontFamily: "inherit", fontSize: 12, cursor: "pointer"
							}
						},
						"应用"
					)
				),
				branchLine(),
				error ? react.createElement("div", { style: { padding: "2px 12px 8px", fontSize: 12, color: "#ff9f43" } }, error) : null,
				// tabs
				react.createElement(
					"div",
					{ style: { display: "flex", gap: 4, padding: "0 10px 6px", flex: "none", alignItems: "center" } },
					tabButton("changes", "改动", data && data.changes ? "(" + data.changes.length + ")" : ""),
					tabButton("commits", "提交"),
					selected ? tabButton("diff", "差异") : null,
					loading || busy ? react.createElement("span", { style: Object.assign({ marginLeft: "auto" }, MUTED) }, busy ? "执行中…" : "读取中…") : null
				),
				// write bar: stage / unstage / commit (changes view only)
				view === "changes"
					? react.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 6, padding: "0 10px 8px", flex: "none" } },
						react.createElement(
							"div",
							{ style: { display: "flex", gap: 6 } },
							react.createElement("input", {
								value: commitMessage,
								spellCheck: false,
								placeholder: "提交信息…（回车即提交）",
								onChange: (event) => setCommitMessage(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter" && !busy) commit();
								},
								style: {
									flex: 1, minWidth: 0, height: 28, borderRadius: 8, padding: "0 8px",
									border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))",
									background: "rgba(255,255,255,0.04)",
									color: "var(--dsw-alias-label-primary, #e8eaf0)",
									fontFamily: "inherit", fontSize: 12
								}
							}),
							react.createElement(
								"button",
								{
									type: "button",
									disabled: busy,
									onClick: commit,
									title: "提交已暂存的改动",
									style: {
										flex: "none", height: 28, padding: "0 12px", borderRadius: 8, border: "none",
										background: "rgba(255,193,7,0.18)", color: "#ffc107",
										fontFamily: "inherit", fontSize: 12, cursor: busy ? "default" : "pointer",
										opacity: busy ? 0.6 : 1
									}
								},
								"提交"
							)
						),
						react.createElement(
							"div",
							{ style: { display: "flex", gap: 6, alignItems: "center" } },
							react.createElement(
								"button",
								{
									type: "button",
									disabled: busy,
									onClick: () => write("stage", {}),
									title: "git add -A",
									style: {
										flex: "none", height: 24, padding: "0 10px", borderRadius: 7,
										border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))",
										background: "transparent", color: "var(--dsw-alias-label-secondary, #9aa3b2)",
										fontFamily: "inherit", fontSize: 11.5, cursor: busy ? "default" : "pointer"
									}
								},
								"暂存全部"
							),
							react.createElement(
								"button",
								{
									type: "button",
									disabled: busy,
									onClick: () => write("unstage", {}),
									title: "取消所有暂存",
									style: {
										flex: "none", height: 24, padding: "0 10px", borderRadius: 7,
										border: "1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))",
										background: "transparent", color: "var(--dsw-alias-label-secondary, #9aa3b2)",
										fontFamily: "inherit", fontSize: 11.5, cursor: busy ? "default" : "pointer"
									}
								},
								"取消暂存"
							),
							notice ? react.createElement("span", { style: Object.assign({ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, MUTED) }, notice) : null
						)
					)
					: null,
				react.createElement("div", { style: { height: 1, background: "var(--dsw-alias-border-l1, rgba(255,255,255,0.07))", flex: "none" } }),
				// body
				react.createElement(
					"div",
					{ style: { flex: 1, minHeight: 0, overflow: "auto", padding: "6px 0 10px" } },
					view === "changes" ? renderChanges() : null,
					view === "commits" ? renderCommits() : null,
					view === "diff"
						? react.createElement(
							"div",
							null,
							react.createElement("div", { style: Object.assign({ padding: "2px 12px 6px" }, MONO, MUTED) }, selected ? selected.path : ""),
							react.createElement("div", { style: { padding: "0 12px" } }, renderDiff())
						)
						: null
				)
			);
		}

		/** Chip shown in the right-pane tab strip. */
		function GitTabTitle() {
			return react.createElement(
				"span",
				{ style: { display: "inline-flex", alignItems: "center", gap: 6 } },
				react.createElement(GitGlyph, null),
				react.createElement("span", null, "Git")
			);
		}

		/**
		 * Session-header launcher. Opens the right-sidebar tab when the service
		 * exists; otherwise toggles the identical panel as a popover.
		 */
		function GitLauncher(props) {
			const [popoverOpen, setPopoverOpen] = react.useState(false);
			const [pos, setPos] = react.useState({ top: 96, right: 16 });
			const btnRef = react.useRef(null);

			const onClick = () => {
				const openTab = props && props.openTab;
				if (typeof openTab === "function" && openTab(TAB_KIND)) {
					setPopoverOpen(false);
					return;
				}
				if (btnRef.current) {
					const rect = btnRef.current.getBoundingClientRect();
					setPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
				}
				setPopoverOpen(!popoverOpen);
			};

			return react.createElement(
				react.Fragment,
				null,
				react.createElement(
					"button",
					{
						type: "button",
						ref: btnRef,
						title: "Git 面板",
						"aria-expanded": popoverOpen,
						onClick,
						style: {
							display: "inline-flex", alignItems: "center", gap: 6, flex: "none",
							height: 28, padding: "0 9px", border: "none", borderRadius: 8,
							background: popoverOpen ? "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.08))" : "transparent",
							color: "var(--dsw-alias-label-secondary, #9aa3b2)",
							fontFamily: "inherit", fontSize: 12.5, cursor: "pointer",
							transition: "background 0.15s ease, color 0.15s ease"
						},
						onMouseEnter: (event) => {
							if (!popoverOpen) event.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))";
						},
						onMouseLeave: (event) => {
							if (!popoverOpen) event.currentTarget.style.background = "transparent";
						}
					},
					react.createElement(GitGlyph, null),
					react.createElement("span", null, "Git")
				),
				popoverOpen
					? react.createElement(
						"div",
						{
							style: {
								position: "fixed", top: pos.top, right: pos.right, zIndex: 9998,
								width: 480, maxWidth: "calc(100vw - 24px)", height: "62vh",
								display: "flex", flexDirection: "column",
								borderRadius: 14, overflow: "hidden",
								border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.12))",
								background: "var(--dsw-specific-menu, rgba(21,24,31,0.96))",
								boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 2px 10px rgba(0,0,0,0.3)",
								backdropFilter: "blur(16px) saturate(1.3)",
								WebkitBackdropFilter: "blur(16px) saturate(1.3)"
							}
						},
						react.createElement(
							"div",
							{ style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 0 12px", flex: "none" } },
							react.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e8eaf0)" } }, "Git 面板"),
							react.createElement("span", { style: { flex: 1 } }),
							react.createElement("button", { type: "button", title: "关闭", onClick: () => setPopoverOpen(false), style: iconButtonStyle() }, "✕")
						),
						react.createElement(GitPanelBody, null)
					)
					: null
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;

			// Primary surface: a right-sidebar tab type.
			const tabs = ctx.get("sidebarRightTabs");
			if (tabs !== undefined && typeof tabs.register === "function") {
				ctx.effect(() => tabs.register({
					id: PLUGIN_ID,
					kind: TAB_KIND,
					priority: "builtin",
					title: () => "Git",
					guide: [{
						order: 20,
						title: () => "Git",
						description: () => "查看仓库状态、改动、提交与 diff",
						icon: GitGlyph
					}]
				}), "git-panel: tab type");

				ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
					name: "sidebar.right.pane.tab",
					key: PLUGIN_ID
				}, GitPanelBody));

				ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
					name: "sidebar.right.pane.tab.title",
					key: PLUGIN_ID
				}, GitTabTitle));
			}

			// Entry point: header chip that opens (or falls back to) the panel.
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "git-panel",
				order: 30,
				inject: () => ({
					openTab: (kind) => {
						const service = ctx.get("sidebarRight");
						if (service === undefined || typeof service.openTab !== "function") return false;
						try {
							service.openTab(kind);
							return true;
						} catch (_error) {
							return false;
						}
					}
				})
			}, GitLauncher));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
