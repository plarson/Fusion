import { describe, it, expect, vi } from "vitest";
import { buildBoardWorkflowsPayload, DEFAULT_WORKFLOW_LANE_ID } from "../board-workflows.js";
import type { WorkflowDefinition } from "@fusion/core";
import { parseWorkflowIr } from "@fusion/core";

// A minimal custom v2 workflow with an intake + complete column.
const CUSTOM: WorkflowDefinition = {
  id: "wf-custom",
  name: "Custom Flow",
  description: "",
  ir: parseWorkflowIr({
    version: "v2",
    name: "Custom Flow",
    columns: [
      { id: "intake", name: "Intake", traits: [{ trait: "intake" }] },
      { id: "done", name: "Done", traits: [{ trait: "complete" }] },
    ],
    nodes: [
      { id: "start", kind: "start", column: "intake" },
      { id: "end", kind: "end", column: "done" },
    ],
    edges: [{ from: "start", to: "end" }],
  }),
  layout: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function makeStore(opts: {
  flagOn: boolean;
  selections: Record<string, string>;
  defs?: Record<string, WorkflowDefinition>;
}) {
  return {
    async getSettings() {
      return { experimentalFeatures: { workflowColumns: opts.flagOn } } as never;
    },
    getTaskWorkflowSelection(taskId: string) {
      const workflowId = opts.selections[taskId];
      return workflowId ? { workflowId, stepIds: [] } : undefined;
    },
    async getWorkflowDefinition(id: string) {
      return opts.defs?.[id];
    },
    async listWorkflowDefinitions() {
      return Object.values(opts.defs ?? {});
    },
  };
}

describe("buildBoardWorkflowsPayload", () => {
  // FNXC:WorkflowColumns 2026-06-25-13:20: workflowColumns graduated from the
  // experimental flag (isWorkflowColumnsEnabled always returns true; a stale
  // persisted/explicit `false` must resolve as enabled). The retired flag-OFF
  // empty single-lane shape no longer exists. Assert the graduation invariant:
  // even with persisted workflowColumns:false the payload is fully enabled and
  // maps the visible card to the default workflow lane. Mirrors the route test
  // (board-workflows-route.test.ts, FNXC:WorkflowColumns 2026-06-25-11:40).
  it("treats persisted workflowColumns:false as enabled (graduated)", async () => {
    const store = makeStore({ flagOn: false, selections: {} });
    const payload = await buildBoardWorkflowsPayload(store as never, ["FN-1"]);
    expect(payload.flagEnabled).toBe(true);
    expect(payload.workflows.length).toBeGreaterThan(0);
    expect(payload.taskWorkflowIds["FN-1"]).toBe(DEFAULT_WORKFLOW_LANE_ID);
  });

  it("resolves null selections to the default workflow lane", async () => {
    const store = makeStore({ flagOn: true, selections: {} });
    const payload = await buildBoardWorkflowsPayload(store as never, ["FN-1", "FN-2"]);
    expect(payload.flagEnabled).toBe(true);
    expect(payload.taskWorkflowIds["FN-1"]).toBe(DEFAULT_WORKFLOW_LANE_ID);
    expect(payload.taskWorkflowIds["FN-2"]).toBe(DEFAULT_WORKFLOW_LANE_ID);
    const defaultWf = payload.workflows.find((w) => w.id === DEFAULT_WORKFLOW_LANE_ID);
    expect(defaultWf).toBeDefined();
    // Default workflow columns are the legacy enum ids in order.
    expect(defaultWf!.columns.map((c) => c.id)).toEqual([
      "triage",
      "todo",
      "in-progress",
      "in-review",
      "done",
      "archived",
    ]);
    expect(defaultWf!.columns.map((c) => c.name)).toEqual([
      "Triage",
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Archived",
    ]);
    const inReview = defaultWf!.columns.find((c) => c.id === "in-review");
    expect(inReview).toBeDefined();
    expect(inReview!.flags.mergeBlocker).toBe(true);
    expect(inReview!.flags.humanReview).toBe(true);
  });

  it("includes user-defined workflows even when no visible task references them", async () => {
    const store = makeStore({
      flagOn: true,
      selections: {},
      defs: { "wf-custom": CUSTOM },
    });
    const payload = await buildBoardWorkflowsPayload(store as never, ["FN-1"]);
    expect(payload.workflows.map((w) => w.id).sort()).toEqual([DEFAULT_WORKFLOW_LANE_ID, "wf-custom"]);
  });

  it("logs when workflow definition listing fails and falls back to referenced workflows", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = {
      ...makeStore({ flagOn: true, selections: {} }),
      async listWorkflowDefinitions() {
        throw new Error("db unavailable");
      },
    };

    try {
      const payload = await buildBoardWorkflowsPayload(store as never, ["FN-1"]);
      expect(payload.workflows.map((w) => w.id)).toContain(DEFAULT_WORKFLOW_LANE_ID);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[board-workflows] listWorkflowDefinitions failed"),
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("describes a custom workflow's columns with resolved trait flags", async () => {
    const store = makeStore({
      flagOn: true,
      selections: { "FN-9": "wf-custom" },
      defs: { "wf-custom": CUSTOM },
    });
    const payload = await buildBoardWorkflowsPayload(store as never, ["FN-9"]);
    expect(payload.taskWorkflowIds["FN-9"]).toBe("wf-custom");
    const custom = payload.workflows.find((w) => w.id === "wf-custom");
    expect(custom).toBeDefined();
    expect(custom!.name).toBe("Custom Flow");
    const intake = custom!.columns.find((c) => c.id === "intake");
    const done = custom!.columns.find((c) => c.id === "done");
    expect(intake!.flags.intake).toBe(true);
    expect(done!.flags.complete).toBe(true);
  });

  it("deduplicates referenced workflows and always includes the default lane", async () => {
    const store = makeStore({
      flagOn: true,
      selections: { "FN-1": "wf-custom", "FN-2": "wf-custom" },
      defs: { "wf-custom": CUSTOM },
    });
    const payload = await buildBoardWorkflowsPayload(store as never, ["FN-1", "FN-2"]);
    const ids = payload.workflows.map((w) => w.id).sort();
    expect(ids).toEqual([DEFAULT_WORKFLOW_LANE_ID, "wf-custom"]);
  });
});
