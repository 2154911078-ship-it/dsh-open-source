/** Route payloads served by the dsh-git-panel host half. */

/** One working-tree row from `git status --porcelain=v1`. */
export interface GitChangeRow {
	/** Index (staged) status letter. */
	index: string;
	/** Work-tree status letter. */
	worktree: string;
	/** Repository-relative path. */
	path: string;
	/** `??` row. */
	untracked: boolean;
	/** Index side carries a change. */
	staged: boolean;
	/** Work-tree side carries a change. */
	modified: boolean;
}

/** One `git log` row. */
export interface GitCommitRow {
	short: string;
	hash: string;
	author: string;
	date: string;
	subject: string;
}

/** `/dsh-git-panel/status` response. */
export interface GitStatusPayload {
	ok: boolean;
	git?: { path: string; version: string };
	repo?: string;
	isRepo?: boolean;
	branch?: string | null;
	detached?: boolean;
	upstream?: string | null;
	ahead?: number;
	behind?: number;
	head?: GitCommitRow | null;
	changes?: GitChangeRow[];
	commits?: GitCommitRow[];
	error?: string | null;
}

/** `/dsh-git-panel/diff` response. */
export interface GitDiffPayload {
	ok: boolean;
	file?: string;
	staged?: boolean;
	untracked?: boolean;
	diff?: string;
	truncated?: boolean;
	error?: string;
}

/** `/dsh-git-panel/branches` response. */
export interface GitBranchesPayload {
	ok: boolean;
	branches?: string[];
	error?: string;
}

/** Mount the route table on the host web server. */
export declare function apply(ctx: unknown): void;
/** Plugin identity. */
export declare const name = "git-panel";
/** Required services. */
export declare const inject: string[];
