/**
 * dsh-at-file — host half smoke test.
 * Drives the real lib/index.js apply() against a mocked ctx: fake fs tree,
 * fake webServer (captures routes), fake event sink (captures listeners).
 */
import { name, inject, apply } from "./lib/index.js";

const ROOT = "C:\\ws";
const FILES = {
  "README.md": "hello readme",
  "wallpapers\\说明.txt": "壁纸说明文件内容",
  "src\\util\\deep.ts": "export const deep = 1;",
  "big.log": "x".repeat(70000),
};
const DIRS = new Set(["", "wallpapers", "src", "src\\util"]);

function norm(p) {
  return String(p).replace(/[\\/]+/g, "\\");
}

function relOf(p) {
  const n = norm(p);
  return n === ROOT ? "" : n.replace(ROOT + "\\", "");
}

const fs = {
  async resolve(path, opts) {
    if (opts && opts.cwd) {
      const joined = norm(opts.cwd) + "\\" + norm(path).replace(/^[\\/]+/, "");
      return { displayPath: joined };
    }
    return { displayPath: norm(path) };
  },
  async stat(target) {
    const p = norm(target.displayPath);
    const rel = p === ROOT ? "" : p.replace(ROOT + "\\", "");
    if (DIRS.has(rel)) {
      return { type: "directory", size: undefined };
    }
    if (rel in FILES) {
      return { type: "file", size: FILES[rel].length };
    }
    return undefined;
  },
  contains(parent, child) {
    return child.displayPath.startsWith(parent.displayPath + "\\") || child.displayPath === parent.displayPath;
  },
  async readText(target) {
    const rel = relOf(target.displayPath);
    if (!(rel in FILES)) throw new Error("binary/unreadable");
    return FILES[rel];
  },
  async listDir(target) {
    const rel = relOf(target.displayPath);
    const prefix = rel ? rel + "\\" : "";
    const names = new Set();
    for (const key of Object.keys(FILES)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const idx = rest.indexOf("\\");
      names.add(idx === -1 ? rest : rest.slice(0, idx));
    }
    for (const d of DIRS) {
      if (d === "" || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      const idx = rest.indexOf("\\");
      names.add(idx === -1 ? rest : rest.slice(0, idx));
    }
    return [...names].map((n) => {
      const full = prefix + n;
      return {
        name: n,
        type: DIRS.has(full) ? "directory" : "file",
        target: { displayPath: ROOT + "\\" + full },
        size: FILES[full] !== undefined ? FILES[full].length : undefined,
      };
    });
  },
};

const routes = [];
const listeners = {};
const ctx = {
  fs,
  effect(fn) { return fn(); },
  on(name, fn) { listeners[name] = fn; },
  webServer: {
    register(route) { routes.push(route); return () => {}; },
  },
};

apply(ctx);

let failures = 0;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + label);
  if (!cond) failures++;
}

check("name/inject exports", name === "at-file" && Array.isArray(inject) && inject.includes("fs") && inject.includes("webServer"));
check("list route registered", routes.some((r) => r.kind === "exact" && r.path === "/dsh-at-file/list"));
check("pre-step listener registered", typeof listeners["agent/pre-step"] === "function");

// ── pre-step expansion ─────────────────────────────────────────────────
const signal = new AbortController().signal;
const next = async () => ({
  kind: "enter",
  messages: [
    { id: "m1", role: "user", content: [{ type: "text", text: "请看 @README.md 谢谢" }], source: { kind: "user" } },
    { id: "m2", role: "user", content: [{ type: "text", text: "参考 @wallpapers/说明.txt" }], source: { kind: "user" } },
    { id: "m3", role: "user", content: [{ type: "text", text: "没有这个文件 @nowhere" }], source: { kind: "user" } },
    { id: "m4", role: "user", content: [{ type: "text", text: "邮箱 user@example.com 不是文件" }], source: { kind: "user" } },
    { id: "m5", role: "user", content: [{ type: "text", text: "大文件 @big.log 看这里" }], source: { kind: "user" } },
  ],
});

const decision = await listeners["agent/pre-step"]({ agent: { session: { header: { cwd: ROOT } } }, signal }, next);
const texts = decision.messages.map((m) => m.content[0].text);

check("expand README.md content", texts[0].includes("<attached file: README.md") && texts[0].includes("hello readme"));
check("expand CJK path 说明.txt", texts[1].includes("壁纸说明文件内容") && texts[1].includes("wallpapers/说明.txt"));
check("unresolvable token stays", texts[2] === "没有这个文件 @nowhere");
check("email stays inert", texts[3] === "邮箱 user@example.com 不是文件");
check("oversized file replaced by notice", texts[4].includes("超过 65536 字节") && texts[4].includes("@big.log") && !texts[4].includes("xxxx"));

// ── list route ─────────────────────────────────────────────────────────
const route = routes.find((r) => r.path === "/dsh-at-file/list");
function fakeRes() {
  let status = 0; let body = "";
  return {
    writeHead(s) { status = s; },
    end(b) { body = b; },
    _status: () => status,
    _json: () => JSON.parse(body),
  };
}

let res = fakeRes();
await route.handler({ url: "/dsh-at-file/list?cwd=" + encodeURIComponent(ROOT) + "&q=readme" }, res);
const r1 = res._json();
check("list query readme → README.md", res._status() === 200 && r1.ok && r1.files.length === 1 && r1.files[0].path === "README.md");

res = fakeRes();
await route.handler({ url: "/dsh-at-file/list?cwd=" + encodeURIComponent(ROOT) + "&q=deep" }, res);
const r2 = res._json();
check("list query deep → src/util/deep.ts", r2.ok && r2.files.length === 1 && r2.files[0].path === "src/util/deep.ts");

res = fakeRes();
await route.handler({ url: "/dsh-at-file/list?cwd=" + encodeURIComponent(ROOT) + "&q=" }, res);
const r3 = res._json();
check("list empty query returns sorted files", r3.ok && r3.files.length === 4 && r3.files[0].path === "big.log");

res = fakeRes();
await route.handler({ url: "/dsh-at-file/list" }, res);
check("list missing cwd → 400", res._status() === 400);

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
