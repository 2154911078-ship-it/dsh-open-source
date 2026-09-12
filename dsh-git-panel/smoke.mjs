/**
 * dsh-git-panel — host-half smoke test.
 *
 * Drives apply() against a mock ctx, then calls each route handler with a mock
 * request/response and prints the JSON verdict. Run: node smoke.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apply } from "./lib/index.js";

const GIT = "D:\\桌面\\deepseek\\tools\\git\\cmd\\git.exe";
const SANDBOX = "D:\\桌面\\deepseek\\tools\\_gitpanel_smoke";

const routes = new Map();
const ctx = {
	effect(fn) {
		return fn();
	},
	webServer: {
		register(route) {
			if (routes.has(route.path)) throw new Error("duplicate route " + route.path);
			routes.set(route.path, route);
			return () => routes.delete(route.path);
		}
	}
};

apply(ctx);
console.log("routes:", [...routes.keys()].join(", "));

/** Call one registered handler with a mock exchange. */
async function call(path, query = "") {
	const route = routes.get(path);
	if (route === undefined) throw new Error("route missing: " + path);
	const result = await new Promise((fulfil) => {
		const res = {
			status: 0,
			headers: null,
			body: "",
			writeHead(status, headers) {
				this.status = status;
				this.headers = headers;
			},
			end(body) {
				this.body = body ?? "";
				fulfil(this);
			}
		};
		route.handler({ url: path + query, method: "GET" }, res);
	});
	return { status: result.status, json: JSON.parse(result.body || "{}") };
}

function git(args, cwd) {
	return execFileSync(GIT, args, { cwd, encoding: "utf8" });
}

// ── fixture: a throwaway repository ─────────────────────────────────────────
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });
git(["init", "-q", "-b", "main"], SANDBOX);
writeFileSync(join(SANDBOX, "tracked.txt"), "one\n", "utf8");
git(["-c", "user.email=smoke@test", "-c", "user.name=smoke", "add", "-A"], SANDBOX);
git(["-c", "user.email=smoke@test", "-c", "user.name=smoke", "commit", "-q", "-m", "init commit"], SANDBOX);
writeFileSync(join(SANDBOX, "tracked.txt"), "one\ntwo\n", "utf8");
writeFileSync(join(SANDBOX, "untracked.txt"), "hello\n", "utf8");

try {
	const status = await call("/dsh-git-panel/status", "?repo=" + encodeURIComponent(SANDBOX));
	console.log("\n[status]", status.status);
	console.log(JSON.stringify({
		ok: status.json.ok,
		isRepo: status.json.isRepo,
		branch: status.json.branch,
		head: status.json.head && status.json.head.short,
		changes: (status.json.changes || []).map((row) => row.index + row.worktree + " " + row.path),
		commits: (status.json.commits || []).length,
		git: status.json.git && status.json.git.version
	}, void 0, 2));

	const diff = await call("/dsh-git-panel/diff", "?repo=" + encodeURIComponent(SANDBOX) + "&file=tracked.txt");
	console.log("\n[diff]", diff.status, JSON.stringify(diff.json.diff));

	const preview = await call("/dsh-git-panel/diff", "?repo=" + encodeURIComponent(SANDBOX) + "&file=untracked.txt&untracked=1");
	console.log("[untracked preview]", preview.status, JSON.stringify(preview.json));

	const branches = await call("/dsh-git-panel/branches", "?repo=" + encodeURIComponent(SANDBOX));
	console.log("[branches]", branches.status, JSON.stringify(branches.json));

	const notRepo = await call("/dsh-git-panel/status", "?repo=" + encodeURIComponent("D:\\桌面\\deepseek\\dsh-open-source"));
	console.log("[non-repo]", notRepo.status, JSON.stringify({ ok: notRepo.json.ok, isRepo: notRepo.json.isRepo, error: notRepo.json.error }));

	const missing = await call("/dsh-git-panel/status", "?repo=" + encodeURIComponent("D:\\nope\\missing"));
	console.log("[missing dir]", missing.status, JSON.stringify(missing.json));
} finally {
	rmSync(SANDBOX, { recursive: true, force: true });
	console.log("\nsandbox removed:", !existsSync(SANDBOX));
}
