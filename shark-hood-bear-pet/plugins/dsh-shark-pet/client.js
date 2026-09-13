/**
 * dsh-shark-pet — client half (browser bundle).
 *
 * Floating desktop pet rendered from the pet sprite atlas served by the host
 * half. Uses the exact animation specs from pet.json (fetched from
 * /pet-assets/config.json) plus per-cell alignment data. Interactions:
 * left-click interact, drag & toss with inertia, right-click head-top arc menu.
 */
window.__ModuleLoader__.load({
	id: "dsh-shark-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const inject = ["slots"];

		// ── engine constants ─────────────────────────────────────────────
		const TICK_MS = 50;
		const CELL = 256;
		const COLS = 8;
		const ROWS = 9;
		const ANCHOR_Y = 230;
		const SCALE = 0.65;
		const DISPLAY_CELL = Math.round(CELL * SCALE);
		const GROUND_MARGIN = 24;
		const WALK_SPEED = 0.55;
		const JUMP_V = 3.2;
		const GRAVITY = 0.45;
		const DRAG_THRESHOLD = 5;
		const AWAKE_AFTER_INTERACT = 5000;
		const SLEEP_FPS = 2;
		const SLEEP_SEQ = [0, 1, 3, 3, 1, 0];
		const ARC_R = 84;
		const ARC_GAP = 24;
		const ANIM_NAMES = { idle: "待机", walk: "散步", run: "奔跑", sleep: "睡觉", interact: "互动", jump_fall: "跳跃" };
		const BUTTONS = [
			{ anim: "idle", label: "待机" }, { anim: "walk", label: "散步" }, { anim: "run", label: "奔跑" },
			{ anim: "sleep", label: "睡觉" }, { anim: "interact", label: "互动" }, { anim: "jump_fall", label: "跳跃" }
		];

		// module-scope engine state (survives across renders for the plugin's life)
		let appCtx = null;
		const pet = {
			cfg: null, spriteUrl: "", ready: false, rootEl: null, alignMap: null,
			anim: "idle", frame: 0, acc: 0, finished: false,
			forced: null, action: null, move: null,
			x: 0, feetY: 0, dir: 1, airborne: false, vy: 0,
			dragging: false, dragMoved: false, pointerId: null,
			offsetX: 0, offsetY: 0, startPointer: { x: 0, y: 0 }, lastPointer: { x: 0, y: 0 }, dragVx: 0,
			cooldownUntil: 0, idleElapsed: 0, nextActionAt: 0,
			vw: 1280, vh: 720,
			menu: { open: false }
		};

		// ── style injection (cleanup-aware) ──────────────────────────────
		function styleInsert(css) {
			const el = document.createElement("style");
			el.dataset.plugin = "dsh-shark-pet";
			el.textContent = css;
			document.head.appendChild(el);
			return () => { el.remove(); };
		}

		function rand(min, max) { return min + Math.random() * (max - min); }

		function measureViewport() {
			const el = pet.rootEl;
			if (!el) return null;
			try {
				const r = el.getBoundingClientRect();
				if (r && r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
			} catch (err) { /* ignore */ }
			return null;
		}

		function setAnim(name) {
			pet.anim = name;
			pet.frame = 0;
			pet.acc = 0;
			pet.finished = false;
		}

		function switchAnim(c, name) {
			const target = c.animations[name];
			if (!target) return;
			const prevA = c.animations[pet.anim];
			const walking = name === "walk" || name === "run";
			const prevWalking = pet.anim === "walk" || pet.anim === "run";
			let newFrame = 0;
			if (walking && prevWalking && target.loop && prevA && prevA.loop) {
				const ratio = prevA.frame_count > 0 ? pet.frame / prevA.frame_count : 0;
				newFrame = Math.min(target.frame_count - 1, Math.round(ratio * target.frame_count));
			}
			pet.anim = name;
			pet.frame = newFrame;
			pet.acc = 0;
			pet.finished = false;
		}

		function triggerForced(c, anim) {
			const a = c.animations[anim];
			if (!a) return;
			pet.forced = anim;
			pet.action = null;
			pet.move = null;
			pet.idleElapsed = 0;
			setAnim(anim);
		}

		function startAction(c, anim, minDur, maxDur) {
			pet.action = { anim: anim, until: Date.now() + rand(minDur, maxDur) };
			if (anim === "walk") {
				pet.move = { type: "walk", dir: Math.random() < 0.5 ? -1 : 1, speed: WALK_SPEED };
				pet.dir = pet.move.dir;
			}
			setAnim(anim);
		}

		function pickRandomAction(c) {
			const base = (c.behaviors && c.behaviors.idle && c.behaviors.idle.random_actions) || [];
			const pool = base.slice();
			if (pool.length > 0) {
				pool.push({ animation: "run", weight: 8, min_duration: 1500, max_duration: 3000 });
			}
			let total = 0;
			for (let i = 0; i < pool.length; i++) total += pool[i].weight || 0;
			if (total <= 0) return;
			let r = Math.random() * total;
			let chosen = pool[pool.length - 1];
			for (let i = 0; i < pool.length; i++) {
				r -= pool[i].weight || 0;
				if (r <= 0) { chosen = pool[i]; break; }
			}
			if (chosen.animation === "idle") {
				pet.nextActionAt = Date.now() + rand(chosen.min_duration, chosen.max_duration);
				return;
			}
			let min = chosen.min_duration;
			let max = chosen.max_duration;
			if (chosen.animation === "sleep") {
				min = Math.round(min * 2);
				max = Math.round(max * 1.7);
			}
			startAction(c, chosen.animation, min, max);
		}

		function updateBehavior(c, now) {
			if (pet.forced) {
				const a = c.animations[pet.forced];
				if (a && !a.loop && pet.finished) {
					pet.forced = null;
					if (pet.move) {
						pet.dir = pet.move.dir;
						switchAnim(c, pet.move.type === "run" ? "run" : "walk");
					} else {
						switchAnim(c, "idle");
					}
					pet.nextActionAt = now + AWAKE_AFTER_INTERACT;
				}
				return;
			}
			if (pet.move && pet.move.vx != null) return;
			if (pet.action) {
				if (now >= pet.action.until) {
					if (pet.action.anim === "sleep") pet.idleElapsed = 0;
					pet.action = null;
					pet.move = null;
					switchAnim(c, "idle");
					pet.nextActionAt = now + 1200;
				}
				return;
			}
			pet.idleElapsed += TICK_MS;
			if (pet.idleElapsed >= (c.behaviors && c.behaviors.idle && c.behaviors.idle.sleep_after_idle) || 30000) {
				pet.idleElapsed = 0;
				startAction(c, "sleep", 12000, 25000);
				return;
			}
			if (!pet.nextActionAt) pet.nextActionAt = now + 2000;
			if (now >= pet.nextActionAt) {
				pet.nextActionAt = 0;
				pickRandomAction(c);
			}
		}

		function advanceFrame(c) {
			const a = c.animations[pet.anim];
			if (!a) return;
			const isSleep = pet.anim === "sleep";
			const fps = isSleep ? SLEEP_FPS : (a.fps || 6);
			const count = isSleep ? SLEEP_SEQ.length : a.frame_count;
			pet.acc += TICK_MS;
			const stepMs = 1000 / fps;
			let advanced = false;
			while (pet.acc >= stepMs) {
				pet.acc -= stepMs;
				pet.frame++;
				advanced = true;
			}
			if (a.loop) {
				if (advanced) pet.frame = pet.frame % count;
			} else {
				if (pet.frame >= count) {
					pet.frame = count - 1;
					pet.finished = true;
				}
			}
		}

		function step(c) {
			const now = Date.now();
			updateBehavior(c, now);
			if (pet.airborne) {
				pet.vy += GRAVITY;
				pet.feetY += pet.vy;
				const ground = pet.vh - GROUND_MARGIN;
				if (pet.feetY >= ground) {
					pet.feetY = ground;
					pet.airborne = false;
					pet.vy = 0;
				}
			}
			if (!pet.dragging && !pet.airborne && pet.move) {
				pet.x += pet.move.dir * pet.move.speed;
				pet.dir = pet.move.dir;
				if (pet.move.vx != null) {
					pet.move.vx *= 0.9;
					if (Math.abs(pet.move.vx) < 0.15) {
						pet.move = null;
						if (!pet.forced) setAnim("idle");
					}
				}
			}
			const half = DISPLAY_CELL / 2;
			if (pet.x < half) { pet.x = half; if (pet.move) { pet.move.dir = 1; pet.dir = 1; } }
			if (pet.x > pet.vw - half) { pet.x = pet.vw - half; if (pet.move) { pet.move.dir = -1; pet.dir = -1; } }
			pet.feetY = Math.max(ANCHOR_Y * SCALE, Math.min(pet.vh - GROUND_MARGIN, pet.feetY));
			advanceFrame(c);
		}

		function handlePointerDown(e) {
			if (!pet.cfg) return;
			if (e.button !== 0) return;
			pet.dragging = true;
			pet.dragMoved = false;
			pet.pointerId = e.pointerId;
			pet.offsetX = e.clientX - pet.x;
			pet.offsetY = e.clientY - pet.feetY;
			pet.startPointer = { x: e.clientX, y: e.clientY };
			pet.lastPointer = { x: e.clientX, y: e.clientY };
			pet.dragVx = 0;
			try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { }
			const now = Date.now();
			pet.idleElapsed = 0;
			pet.nextActionAt = now + AWAKE_AFTER_INTERACT;
			if (now >= pet.cooldownUntil) {
				pet.cooldownUntil = now + 500;
				triggerForced(pet.cfg, "interact");
			}
		}

		function handlePointerMove(e) {
			if (!pet.dragging || e.pointerId !== pet.pointerId) return;
			const dx = e.clientX - pet.lastPointer.x;
			pet.dragVx = pet.dragVx * 0.5 + dx * 0.5;
			pet.lastPointer = { x: e.clientX, y: e.clientY };
			if (Math.abs(e.clientX - pet.startPointer.x) + Math.abs(e.clientY - pet.startPointer.y) > DRAG_THRESHOLD) {
				pet.dragMoved = true;
			}
			if (dx !== 0) pet.dir = dx < 0 ? -1 : 1;
			const half = DISPLAY_CELL / 2;
			pet.x = Math.max(half, Math.min(pet.vw - half, e.clientX - pet.offsetX));
			pet.feetY = Math.max(ANCHOR_Y * SCALE, Math.min(pet.vh - GROUND_MARGIN, e.clientY - pet.offsetY));
			pet.airborne = false;
			pet.vy = 0;
		}

		function tossFromDrag() {
			const vx = Math.max(-3.5, Math.min(3.5, pet.dragVx || 0));
			if (Math.abs(vx) > 0.5) {
				pet.move = { type: "run", dir: vx < 0 ? -1 : 1, speed: Math.abs(vx) * 0.6, vx: Math.abs(vx) * 0.6 };
				pet.dir = pet.move.dir;
			}
		}

		function handlePointerUp(e) {
			if (e.pointerId !== pet.pointerId) return;
			const pid = e.pointerId;
			pet.dragging = false;
			pet.pointerId = null;
			try { e.currentTarget.releasePointerCapture(pid); } catch (err) { }
			if (pet.dragMoved) {
				pet.airborne = true;
				pet.vy = -JUMP_V;
				pet.idleElapsed = 0;
				pet.nextActionAt = Date.now() + AWAKE_AFTER_INTERACT;
				triggerForced(pet.cfg, "jump_fall");
				tossFromDrag();
			}
		}

		function handlePointerCancel(e) {
			if (e.pointerId !== pet.pointerId) return;
			pet.dragging = false;
			pet.pointerId = null;
			pet.dragMoved = false;
			try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { }
		}

		function handleContextMenu(e) {
			e.preventDefault();
			e.stopPropagation();
			pet.menu.open = !pet.menu.open;
		}

		function manualTrigger(c, anim) {
			if (!c) return;
			pet.idleElapsed = 0;
			if (anim === "idle") {
				pet.forced = null;
				pet.action = null;
				pet.move = null;
				setAnim("idle");
				pet.nextActionAt = Date.now() + 3000;
			} else if (anim === "interact") {
				triggerForced(c, "interact");
			} else if (anim === "jump_fall") {
				pet.airborne = true;
				pet.vy = -JUMP_V;
				pet.nextActionAt = Date.now() + AWAKE_AFTER_INTERACT;
				triggerForced(c, "jump_fall");
			} else if (anim === "walk") {
				startAction(c, "walk", 4000, 6000);
			} else if (anim === "run") {
				startAction(c, "run", 2000, 3500);
			} else if (anim === "sleep") {
				startAction(c, "sleep", 12000, 20000);
			}
		}

		const rootStyle = {
			position: "fixed",
			inset: "0",
			overflow: "hidden",
			pointerEvents: "none",
			zIndex: 5
		};

		const labelStyle = {
			position: "absolute",
			bottom: "100%",
			left: "50%",
			transform: "translateX(-50%)",
			marginBottom: "6px",
			padding: "3px 10px",
			borderRadius: "10px",
			background: "rgba(15,17,23,0.62)",
			color: "#fff",
			fontSize: "12px",
			lineHeight: "16px",
			whiteSpace: "nowrap",
			pointerEvents: "none"
		};

		const arcBtnStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			width: "34px",
			height: "34px",
			padding: "0",
			borderRadius: "50%",
			border: "1px solid rgba(255,255,255,0.35)",
			background: "rgba(15,17,23,0.78)",
			color: "#fff",
			fontSize: "11px",
			lineHeight: "13px",
			cursor: "pointer",
			fontFamily: "inherit",
			boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
			pointerEvents: "auto",
			zIndex: 50,
			userSelect: "none"
		};

		function PetView() {
			const [ready, setReady] = react.useState(false);
			const [, setV] = react.useState(0);

			react.useEffect(() => {
				let alive = true;
				fetch("/pet-assets/config.json", { cache: "no-store" })
					.then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
					.then((r) => {
						if (!alive) return;
						if (!r || !r.config) {
							console.error("桌宠配置加载失败", r && r.error);
							return;
						}
						pet.cfg = r.config;
						pet.spriteUrl = r.spriteUrl || "";
						pet.alignMap = r.align || null;
						const m = measureViewport();
						if (m) { pet.vw = m.w; pet.vh = m.h; }
						pet.x = pet.vw - 220;
						pet.feetY = pet.vh - GROUND_MARGIN;
						pet.dir = -1;
						setAnim(r.config.behaviors.default_state || "idle");
						pet.idleElapsed = 0;
						pet.nextActionAt = Date.now() + 3000;
						pet.ready = true;
						setReady(true);
					})
					.catch((err) => {
						if (alive) console.error("桌宠配置加载失败", err);
					});
				return () => { alive = false; };
			}, []);

			react.useEffect(() => {
				if (!pet.ready || !pet.cfg) return;
				const id = setInterval(() => {
					const m = measureViewport();
					if (m) { pet.vw = m.w; pet.vh = m.h; }
					step(pet.cfg);
					setV((x) => x + 1);
				}, TICK_MS);
				return () => clearInterval(id);
			}, [ready]);

			if (!pet.ready || !pet.cfg) {
				return react.createElement("div", { ref: (el) => { pet.rootEl = el; }, style: rootStyle });
			}
			const c = pet.cfg;
			const a = c.animations[pet.anim] || c.animations[c.behaviors.fallback_animation] || c.animations.idle;
			const isSleep = pet.anim === "sleep";
			const cell = isSleep && SLEEP_SEQ[pet.frame] != null
				? a.start_frame + SLEEP_SEQ[pet.frame]
				: a.start_frame + pet.frame;
			const col = cell % COLS;
			const row = Math.floor(cell / COLS);
			const D = DISPLAY_CELL;
			const ag = pet.alignMap && pet.alignMap[cell] ? pet.alignMap[cell] : null;
			const ax = ag ? (ag.dx * SCALE) : 0;
			const ay = ag ? (ag.dy * SCALE) : 0;

			const wrapperStyle = {
				position: "absolute",
				left: (pet.x - D / 2) + "px",
				top: (pet.feetY - ANCHOR_Y * SCALE) + "px",
				width: D + "px",
				height: D + "px",
				pointerEvents: "none"
			};
			const petStyle = {
				position: "absolute",
				left: "0px",
				top: "0px",
				width: D + "px",
				height: D + "px",
				backgroundImage: "url(\"" + pet.spriteUrl + "\")",
				backgroundSize: (COLS * CELL * SCALE) + "px " + (ROWS * CELL * SCALE) + "px",
				backgroundPosition: (-col * D) + "px " + (-row * D) + "px",
				transform: "translate(" + ax + "px," + ay + "px) scaleX(" + pet.dir + ")",
				transition: "transform 0.22s ease",
				pointerEvents: "auto",
				cursor: "grab",
				userSelect: "none",
				WebkitUserSelect: "none",
				touchAction: "none"
			};

			const n = BUTTONS.length;
			const arcCx = pet.x;
			const arcBaseY = pet.feetY - ANCHOR_Y * SCALE - ARC_GAP;
			const arcBtns = pet.menu.open ? BUTTONS.map((btn, i) => {
				const theta = (Math.PI * i) / (n - 1);
				const bx = arcCx + ARC_R * Math.cos(theta) - 17;
				const by = arcBaseY - ARC_R * Math.sin(theta) - 17;
				return react.createElement("button", {
					key: btn.anim,
					onPointerDown: (e) => { e.stopPropagation(); e.preventDefault(); manualTrigger(pet.cfg, btn.anim); pet.menu.open = false; },
					style: Object.assign({}, arcBtnStyle,
						pet.anim === btn.anim ? { background: "rgba(255,255,255,0.32)" } : {},
						{ position: "fixed", left: Math.max(4, Math.min(pet.vw - 38, bx)) + "px", top: Math.max(4, by) + "px" })
				}, btn.label);
			}) : null;

			return react.createElement("div", { ref: (el) => { pet.rootEl = el; }, style: rootStyle },
				react.createElement("div", { style: wrapperStyle },
					react.createElement("div", { style: labelStyle }, ANIM_NAMES[pet.anim] || pet.anim),
					react.createElement("div", {
						style: petStyle,
						onPointerDown: handlePointerDown,
						onPointerMove: handlePointerMove,
						onPointerUp: handlePointerUp,
						onPointerCancel: handlePointerCancel,
						onContextMenu: handleContextMenu
					})
				),
				arcBtns
			);
		}

		function apply(ctx) {
			appCtx = ctx;
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("shell.overlay", () => slots.register(
				{ name: "shell.overlay", id: "shark-pet", order: 80, label: "鲨鱼帽小熊桌宠" },
				() => react.createElement(PetView, null)
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
