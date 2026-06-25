/*
FNXC:Workspace 2026-06-22-00:30:
U2 KTD3 — per-repo review (BOTH call sites) + conjunction aggregation tests. The reviewer is an AGENT
spawned with `cwd = worktree`; per-repo review means ONE reviewer agent per sub-repo with the CALLERS
looping the single-cwd `reviewStep`. These tests assert the LOOP + aggregation, not the reviewer's content:
`reviewStep` is mocked (the narrow AI seam — FN-5048: no mock-the-world, no real AI spawn) and we record
the cwd of each call. Coverage:
- conjunction: two-repo task → two reviewer passes (one per repo cwd); review record reflects both; reviewed
  only when BOTH pass; one repo REVISE → aggregate REVISE tagged with that repo.
- finding tag: a finding in repo B is repo-tagged in the aggregated review body.
- in-session seam (createReviewStepTool / fn_review_step): a workspace task reviews each sub-repo cwd, not the root.
- step-inversion seam (createAuthoritativeWorkflowSeams().stepReview, executor.ts:5668): same — each sub-repo, not root.
- regression: single-repo (non-workspace) task → exactly one reviewStep call at the singular worktree.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewResult } from "../reviewer.js";

// Narrow AI seam: only reviewStep (the agent boundary) is mocked. Everything else is the real executor.
vi.mock("../reviewer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../reviewer.js")>();
  return { ...actual, reviewStep: vi.fn() };
});

import { reviewStep as mockedReviewStepFn } from "../reviewer.js";
import { TaskExecutor } from "../executor.js";
import { FOREACH_ACTIVE_CONTEXT_KEY } from "../workflow-node-handlers.js";
import { resolveReviewCheckoutForTask } from "../review-checkout-routing.js";
import type { Task, TaskStore, WorkspaceConfig } from "@fusion/core";

const mockedReviewStep = vi.mocked(mockedReviewStepFn);
const execFileAsync = promisify(execFile);

const ROOT = "/tmp/ws-root"; // NON-git workspace root — must never be a review cwd in workspace mode.
const WT_A = "/tmp/ws-root/repo-a/.worktrees/fn-1";
const WT_B = "/tmp/ws-root/repo-b/.worktrees/fn-1";

function makeStore(task: Task): TaskStore & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getTask: vi.fn().mockResolvedValue(task),
    getSettings: vi.fn().mockResolvedValue({ autoMerge: false }),
    updateStep: vi.fn().mockResolvedValue(undefined),
    logEntry: vi.fn().mockResolvedValue(undefined),
    getRunContextFor: vi.fn(),
    // mergeEffectiveSettings degrades to base on any resolver error; these reject → base used.
    getTaskWorkflowSelection: vi.fn().mockRejectedValue(new Error("no workflow")),
    getWorkflowDefinition: vi.fn().mockRejectedValue(new Error("no workflow")),
    getWorkflowSettingValues: vi.fn().mockRejectedValue(new Error("no workflow")),
  }) as unknown as TaskStore & EventEmitter;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-1",
    title: "WS",
    description: "",
    column: "in-progress",
    dependencies: [],
    steps: [
      { name: "Step 0", status: "done" },
      { name: "Step 1", status: "in-progress" },
    ],
    currentStep: 1,
    log: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

const TWO_REPO_WORKTREES = {
  "repo-a": { worktreePath: WT_A, branch: "fusion/fn-1", baseCommitSha: "aaa" },
  "repo-b": { worktreePath: WT_B, branch: "fusion/fn-1", baseCommitSha: "bbb" },
};

/** Script reviewStep to return a per-cwd verdict and record the cwd it was called with. */
function scriptReviewByCwd(byCwd: Record<string, ReviewResult>): string[] {
  const seenCwds: string[] = [];
  mockedReviewStep.mockImplementation((async (cwd: string) => {
    seenCwds.push(cwd);
    return byCwd[cwd] ?? { verdict: "APPROVE", review: `ok ${cwd}`, summary: `ok ${cwd}` };
  }) as any);
  return seenCwds;
}

function workspaceExecutor(store: TaskStore & EventEmitter): TaskExecutor {
  const executor = new TaskExecutor(store, ROOT);
  (executor as any).workspaceConfig = { repos: ["repo-a", "repo-b"] } as WorkspaceConfig;
  return executor;
}

beforeEach(() => {
  mockedReviewStep.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("U2 KTD3 — reviewWorkspacePerRepo conjunction + tagging (the shared loop both call sites use)", () => {
  // FNXC:Workspace 2026-06-21-15:00: F7 — the per-repo callback is single-arg `(cwd)` now; tests map
  // cwd→repo themselves (the loop no longer passes repoRel through to runForCwd).
  const repoOfCwd = (cwd: string): string => (cwd === WT_A ? "repo-a" : cwd === WT_B ? "repo-b" : cwd);

  it("conjunction: two repos both APPROVE → aggregate APPROVE, one reviewer pass per repo cwd", async () => {
    const task = makeTask({ workspaceWorktrees: TWO_REPO_WORKTREES });
    const executor = workspaceExecutor(makeStore(task));
    const seen: string[] = [];
    const result = await (executor as any).reviewWorkspacePerRepo(task, async (cwd: string) => {
      seen.push(cwd);
      return { verdict: "APPROVE", review: `clean in ${repoOfCwd(cwd)}`, summary: `clean ${repoOfCwd(cwd)}` };
    });
    expect(seen).toEqual([WT_A, WT_B]); // one pass per sub-repo cwd, never ROOT
    expect(result.verdict).toBe("APPROVE");
    expect(result.review).toContain("repo-a");
    expect(result.review).toContain("repo-b");
  });

  it("conjunction: one repo REVISE → aggregate REVISE, tagged with the failing repo", async () => {
    const task = makeTask({ workspaceWorktrees: TWO_REPO_WORKTREES });
    const executor = workspaceExecutor(makeStore(task));
    const result = await (executor as any).reviewWorkspacePerRepo(task, async (cwd: string) => {
      const repo = repoOfCwd(cwd);
      return repo === "repo-b"
        ? { verdict: "REVISE", review: `bug in ${repo}`, summary: `revise ${repo}` }
        : { verdict: "APPROVE", review: `clean ${repo}`, summary: `clean ${repo}` };
    });
    expect(result.verdict).toBe("REVISE");
    expect(result.review).toContain("repo-b"); // finding repo-tagged
    expect(result.review).toContain("bug in repo-b");
    expect(result.summary).toMatch(/^repo-b:/);
  });

  // FNXC:Workspace 2026-06-21-15:00: F3 — break on the FIRST non-APPROVE repo.
  it("F3: repo-a APPROVE + repo-b REVISE (no throw) → aggregate REVISE tagged repo-b", async () => {
    const task = makeTask({ workspaceWorktrees: TWO_REPO_WORKTREES });
    const executor = workspaceExecutor(makeStore(task));
    const result = await (executor as any).reviewWorkspacePerRepo(task, async (cwd: string) => {
      const repo = repoOfCwd(cwd);
      return repo === "repo-a"
        ? { verdict: "APPROVE", review: "clean repo-a", summary: "clean a" }
        : { verdict: "REVISE", review: "bug repo-b", summary: "revise b" };
    });
    expect(result.verdict).toBe("REVISE");
    expect(result.summary).toMatch(/^repo-b:/);
  });

  it("F3: repo-a REVISE + repo-b throws → REVISE preserved (break before repo-b; NOT masked to UNAVAILABLE)", async () => {
    const task = makeTask({ workspaceWorktrees: TWO_REPO_WORKTREES });
    const executor = workspaceExecutor(makeStore(task));
    const seen: string[] = [];
    const result = await (executor as any).reviewWorkspacePerRepo(task, async (cwd: string) => {
      seen.push(cwd);
      if (cwd === WT_B) throw new Error("repo-b reviewer blew up");
      return { verdict: "REVISE", review: "bug repo-a", summary: "revise a" };
    });
    // repo-a recorded the first non-APPROVE and the loop BROKE, so repo-b's reviewer is never invoked.
    expect(seen).toEqual([WT_A]);
    expect(result.verdict).toBe("REVISE");
    expect(result.summary).toMatch(/^repo-a:/);
  });

  it("zero-acquire workspace task → UNAVAILABLE (caller routes; no fabricated APPROVE)", async () => {
    const task = makeTask({ workspaceWorktrees: {} });
    const executor = workspaceExecutor(makeStore(task));
    const invoke = vi.fn();
    const result = await (executor as any).reviewWorkspacePerRepo(task, invoke);
    expect(result.verdict).toBe("UNAVAILABLE");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("U2 KTD3 — in-session fn_review_step (createReviewStepTool) loops per sub-repo", () => {
  it("workspace task: code review spawns one reviewer per sub-repo cwd, not the root", async () => {
    const task = makeTask({ workspaceWorktrees: TWO_REPO_WORKTREES });
    const store = makeStore(task);
    const executor = workspaceExecutor(store);
    const seen = scriptReviewByCwd({
      [WT_A]: { verdict: "APPROVE", review: "a ok", summary: "a" },
      [WT_B]: { verdict: "APPROVE", review: "b ok", summary: "b" },
    });
    const tool = (executor as any).createReviewStepTool(
      task.id,
      ROOT, // singular worktreePath = the non-git root; workspace mode must NOT review it
      "PROMPT",
      new Map(),
      { current: null },
      new Map(),
      task,
      undefined,
    );
    const res = await tool.execute("call-1", { step: 1, type: "code", step_name: "Step 1", baseline: "base" });
    expect(seen).toEqual([WT_A, WT_B]);
    expect(seen).not.toContain(ROOT);
    // Aggregate APPROVE flows through the tool's verdict→text mapping unchanged.
    expect(res.content[0].text).toBe("APPROVE");
  });

  it("regression: single-repo (non-workspace) task → exactly one reviewStep call at the singular worktree", async () => {
    const task = makeTask();
    const store = makeStore(task);
    const executor = new TaskExecutor(store, ROOT); // no workspaceConfig → singular path
    const seen = scriptReviewByCwd({ [WT_A]: { verdict: "APPROVE", review: "ok", summary: "ok" } });
    const tool = (executor as any).createReviewStepTool(
      task.id,
      WT_A,
      "PROMPT",
      new Map(),
      { current: null },
      new Map(),
      task,
      undefined,
    );
    await tool.execute("call-1", { step: 1, type: "code", step_name: "Step 1", baseline: "base" });
    expect(seen).toEqual([WT_A]);
  });
});

describe("U2 KTD3 — step-inversion review seam (executor.ts:5668) loops per sub-repo", () => {
  it("workspace task: stepReview spawns one reviewer per sub-repo cwd, not active.worktreePath/root", async () => {
    const task = makeTask({ workspaceWorktrees: TWO_REPO_WORKTREES, worktree: ROOT });
    const store = makeStore(task);
    const executor = workspaceExecutor(store);
    const seen = scriptReviewByCwd({
      [WT_A]: { verdict: "APPROVE", review: "a", summary: "a" },
      [WT_B]: { verdict: "APPROVE", review: "b", summary: "b" },
    });
    const seams = executor.createAuthoritativeWorkflowSeams({ autoMerge: false } as any);
    // Drive the foreach-active step-review handler directly with a scripted active context.
    const context = {
      [FOREACH_ACTIVE_CONTEXT_KEY]: { stepIndex: 1, worktreePath: ROOT, baselineSha: "base" },
    } as any;
    const result = await seams.stepReview!(task as any, context, { type: "code", advisory: true } as any);
    expect(seen).toEqual([WT_A, WT_B]);
    expect(seen).not.toContain(ROOT);
    expect(result.verdict).toBe("APPROVE");
  });

  it("regression: single-repo stepReview reviews the active worktree once", async () => {
    const task = makeTask({ worktree: WT_A });
    const store = makeStore(task);
    const executor = new TaskExecutor(store, ROOT); // no workspaceConfig
    const seen = scriptReviewByCwd({ [WT_A]: { verdict: "APPROVE", review: "a", summary: "a" } });
    const seams = executor.createAuthoritativeWorkflowSeams({ autoMerge: false } as any);
    const context = { [FOREACH_ACTIVE_CONTEXT_KEY]: { stepIndex: 1, worktreePath: WT_A, baselineSha: "base" } } as any;
    await seams.stepReview!(task as any, context, { type: "code", advisory: true } as any);
    expect(seen).toEqual([WT_A]);
  });
});


const CANONICAL_FUSION_CHECKOUT = "/Users/plarson/src/Fusion-local-runtime";
const ATLAS_TASK_WORKTREE = "/Users/plarson/Source/phillarson-xyz/atlas-notes/.worktrees/fn-779-shaped";

function externalCheckoutTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: "FN-779-SHAPED",
    title: "Suppress duplicate no-op heartbeat logs in Fusion engine",
    worktree: ATLAS_TASK_WORKTREE,
    sourceMetadata: {
      externalReviewCheckout: {
        kind: "canonical-fusion-runtime",
        path: CANONICAL_FUSION_CHECKOUT,
      },
    },
    ...overrides,
  });
}

describe("FN-803 — validated external Fusion checkout review routing", () => {
  it("in-session fn_review_step routes explicit FN-779-shaped tasks to the canonical Fusion checkout", async () => {
    const task = externalCheckoutTask();
    const store = makeStore(task);
    const executor = new TaskExecutor(store, "/Users/plarson/Source/phillarson-xyz/atlas-notes");
    const seen = scriptReviewByCwd({
      [CANONICAL_FUSION_CHECKOUT]: { verdict: "APPROVE", review: "external ok", summary: "external ok" },
      [ATLAS_TASK_WORKTREE]: { verdict: "REVISE", review: "wrong cwd", summary: "wrong cwd" },
    });
    const tool = (executor as any).createReviewStepTool(
      task.id,
      ATLAS_TASK_WORKTREE,
      "# Task: FN-779\n\nExpected implementation checkout: /Users/plarson/src/Fusion-local-runtime",
      new Map(),
      { current: null },
      new Map(),
      task,
      undefined,
    );

    const res = await tool.execute("call-1", { step: 1, type: "code", step_name: "Implementation", baseline: "base" });

    expect(seen).toEqual([CANONICAL_FUSION_CHECKOUT]);
    expect(seen).not.toContain(ATLAS_TASK_WORKTREE);
    expect(res.content[0].text).toBe("APPROVE");
  });

  it("workflow step-review routes explicit FN-779-shaped tasks to the same external checkout", async () => {
    const task = externalCheckoutTask();
    const store = makeStore(task);
    const executor = new TaskExecutor(store, "/Users/plarson/Source/phillarson-xyz/atlas-notes");
    const seen = scriptReviewByCwd({
      [CANONICAL_FUSION_CHECKOUT]: { verdict: "APPROVE", review: "external ok", summary: "external ok" },
    });
    const seams = executor.createAuthoritativeWorkflowSeams({ autoMerge: false } as any);
    const context = {
      [FOREACH_ACTIVE_CONTEXT_KEY]: { stepIndex: 1, worktreePath: ATLAS_TASK_WORKTREE, baselineSha: "base" },
    } as any;

    const result = await seams.stepReview!(task as any, context, { type: "code", advisory: true } as any);

    expect(seen).toEqual([CANONICAL_FUSION_CHECKOUT]);
    expect(result.verdict).toBe("APPROVE");
  });

  it("keeps ordinary single-repo and workspace routing unchanged", async () => {
    await expect(resolveReviewCheckoutForTask(makeTask(), WT_A, { canonicalFusionRuntimeCheckout: CANONICAL_FUSION_CHECKOUT })).resolves.toMatchObject({
      ok: true,
      cwd: WT_A,
      source: "task-worktree",
    });

    const workspaceTask = makeTask({
      worktree: ATLAS_TASK_WORKTREE,
      workspaceWorktrees: TWO_REPO_WORKTREES,
      sourceMetadata: { externalReviewCheckout: { kind: "canonical-fusion-runtime", path: CANONICAL_FUSION_CHECKOUT } },
    });
    await expect(resolveReviewCheckoutForTask(workspaceTask, ATLAS_TASK_WORKTREE, { canonicalFusionRuntimeCheckout: CANONICAL_FUSION_CHECKOUT })).resolves.toMatchObject({
      ok: true,
      cwd: ATLAS_TASK_WORKTREE,
      source: "task-worktree",
    });
  });

  it("rejects prompt-only, missing, non-git, and non-canonical outside checkouts", async () => {
    const promptOnly = makeTask({
      worktree: ATLAS_TASK_WORKTREE,
      prompt: "Expected implementation checkout: /Users/plarson/src/Fusion-local-runtime",
    } as Partial<Task>);
    await expect(resolveReviewCheckoutForTask(promptOnly, ATLAS_TASK_WORKTREE, { canonicalFusionRuntimeCheckout: CANONICAL_FUSION_CHECKOUT })).resolves.toMatchObject({
      ok: true,
      cwd: ATLAS_TASK_WORKTREE,
      source: "task-worktree",
    });

    await expect(resolveReviewCheckoutForTask(externalCheckoutTask({
      sourceMetadata: { externalReviewCheckout: { kind: "canonical-fusion-runtime", path: "/definitely/missing/Fusion-local-runtime" } },
    }), ATLAS_TASK_WORKTREE, { canonicalFusionRuntimeCheckout: CANONICAL_FUSION_CHECKOUT })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("not available"),
    });

    const temp = await mkdtemp(join(tmpdir(), "fn-803-non-git-"));
    try {
      await expect(resolveReviewCheckoutForTask(externalCheckoutTask({
        sourceMetadata: { externalReviewCheckout: { kind: "canonical-fusion-runtime", path: temp } },
      }), ATLAS_TASK_WORKTREE, { canonicalFusionRuntimeCheckout: CANONICAL_FUSION_CHECKOUT })).resolves.toMatchObject({
        ok: false,
        reason: expect.stringContaining("not a git repository"),
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }

    const otherGit = await mkdtemp(join(tmpdir(), "fn-803-other-git-"));
    try {
      await execFileAsync("git", ["init"], { cwd: otherGit });
      await expect(resolveReviewCheckoutForTask(externalCheckoutTask({
        sourceMetadata: { externalReviewCheckout: { kind: "canonical-fusion-runtime", path: otherGit } },
      }), ATLAS_TASK_WORKTREE, { canonicalFusionRuntimeCheckout: CANONICAL_FUSION_CHECKOUT })).resolves.toMatchObject({
        ok: false,
        reason: expect.stringContaining("canonical Fusion runtime checkout"),
      });
    } finally {
      await rm(otherGit, { recursive: true, force: true });
    }
  });

  it("accepts duplicate/symlink metadata only after all entries collapse to the canonical realpath", async () => {
    const link = join(tmpdir(), `fn-803-fusion-link-${process.pid}`);
    await rm(link, { recursive: true, force: true });
    await symlink(CANONICAL_FUSION_CHECKOUT, link);
    try {
      await expect(resolveReviewCheckoutForTask(externalCheckoutTask({
        sourceMetadata: {
          externalReviewCheckout: [
            { kind: "canonical-fusion-runtime", path: CANONICAL_FUSION_CHECKOUT },
            { kind: "canonical-fusion-runtime", path: link },
          ],
        },
      }), ATLAS_TASK_WORKTREE, { canonicalFusionRuntimeCheckout: CANONICAL_FUSION_CHECKOUT })).resolves.toMatchObject({
        ok: true,
        cwd: CANONICAL_FUSION_CHECKOUT,
        source: "external-fusion-runtime",
      });
    } finally {
      await rm(link, { recursive: true, force: true });
    }
  });
});
