import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { Task } from "@fusion/core";

const execFileAsync = promisify(execFile);

export const DEFAULT_CANONICAL_FUSION_RUNTIME_CHECKOUT = "/Users/plarson/src/Fusion-local-runtime";

type ReviewCheckoutSource = "task-worktree" | "external-fusion-runtime";

export type ReviewCheckoutResolution =
  | { ok: true; cwd: string; source: ReviewCheckoutSource }
  | { ok: false; reason: string };

export interface ReviewCheckoutResolveOptions {
  canonicalFusionRuntimeCheckout?: string;
}

interface ExternalReviewCheckoutMetadata {
  kind?: unknown;
  path?: unknown;
}

function hasWorkspaceWorktrees(task: Pick<Task, "workspaceWorktrees">): boolean {
  const entries = task.workspaceWorktrees ? Object.keys(task.workspaceWorktrees) : [];
  return entries.length > 0;
}

function normalizeMetadataEntries(raw: unknown): ExternalReviewCheckoutMetadata[] | undefined {
  if (raw == null) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((value) => {
    if (typeof value === "string") return { kind: "canonical-fusion-runtime", path: value };
    if (value && typeof value === "object") return value as ExternalReviewCheckoutMetadata;
    return { kind: undefined, path: undefined };
  });
}

function explicitExternalCheckoutMetadata(task: Pick<Task, "sourceMetadata">): ExternalReviewCheckoutMetadata[] | undefined {
  const metadata = task.sourceMetadata as Record<string, unknown> | undefined;
  if (!metadata || !("externalReviewCheckout" in metadata)) return undefined;
  return normalizeMetadataEntries(metadata.externalReviewCheckout);
}

async function gitTopLevel(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveReviewCheckoutForTask(
  task: Pick<Task, "sourceMetadata" | "workspaceWorktrees">,
  fallbackWorktreePath: string,
  options: ReviewCheckoutResolveOptions = {},
): Promise<ReviewCheckoutResolution> {
  // Workspace mode is already modeled as a set of acquired reviewable worktrees.
  // The caller loops those entries; this single-checkout resolver must not
  // override them with an unrelated external checkout.
  if (hasWorkspaceWorktrees(task)) {
    return { ok: true, cwd: fallbackWorktreePath, source: "task-worktree" };
  }

  const entries = explicitExternalCheckoutMetadata(task);
  if (!entries) {
    return { ok: true, cwd: fallbackWorktreePath, source: "task-worktree" };
  }
  if (entries.length === 0) {
    return { ok: false, reason: "external review checkout metadata is empty" };
  }

  const canonicalConfigured = options.canonicalFusionRuntimeCheckout ?? DEFAULT_CANONICAL_FUSION_RUNTIME_CHECKOUT;
  let canonicalRealpath: string;
  try {
    canonicalRealpath = await realpath(canonicalConfigured);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `canonical Fusion runtime checkout is not available: ${message}` };
  }

  const resolved = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "canonical-fusion-runtime") {
      return { ok: false, reason: "external review checkout metadata kind is not supported" };
    }
    if (typeof entry.path !== "string" || entry.path.trim().length === 0) {
      return { ok: false, reason: "external review checkout path is missing" };
    }

    let candidateRealpath: string;
    try {
      candidateRealpath = await realpath(entry.path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `external review checkout is not available: ${message}` };
    }

    const topLevel = await gitTopLevel(candidateRealpath);
    if (!topLevel) {
      return { ok: false, reason: `external review checkout is not a git repository: ${candidateRealpath}` };
    }

    let topLevelRealpath: string;
    try {
      topLevelRealpath = await realpath(topLevel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `external review checkout git root is not available: ${message}` };
    }

    if (topLevelRealpath !== candidateRealpath) {
      return { ok: false, reason: `external review checkout must be the git repository root: ${candidateRealpath}` };
    }
    if (topLevelRealpath !== canonicalRealpath) {
      return { ok: false, reason: `external review checkout must be the canonical Fusion runtime checkout: ${candidateRealpath}` };
    }
    resolved.add(topLevelRealpath);
  }

  if (resolved.size !== 1) {
    return { ok: false, reason: "external review checkout metadata is ambiguous" };
  }

  return { ok: true, cwd: [...resolved][0], source: "external-fusion-runtime" };
}
