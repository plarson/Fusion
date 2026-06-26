import { describe, expect, it } from "vitest";
import { getUnmetSchedulingDependencies } from "../scheduler.js";
import type { Task } from "@fusion/core";

function task(id: string, column: Task["column"], overrides: Partial<Task> = {}): Task {
  return {
    id,
    description: id,
    title: id,
    column,
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Task;
}

describe("scheduler dependency status", () => {
  it("returns only live unresolved dependencies for an FN-823-shaped fixture", () => {
    const dependent = task("FN-823", "todo", { dependencies: ["FN-801", "FN-803", "FN-819", "FN-807"] });
    const tasks = [
      dependent,
      task("FN-801", "done"),
      task("FN-803", "todo"),
      task("FN-819", "archived"),
      task("FN-807", "in-progress"),
    ];

    expect(getUnmetSchedulingDependencies(dependent, tasks)).toEqual(["FN-803", "FN-807"]);
  });

  it("does not make missing dependency ids active blockers", () => {
    const dependent = task("FN-MISSING", "todo", { dependencies: ["DELETED", "LIVE"] });
    const tasks = [dependent, task("LIVE", "triage")];

    expect(getUnmetSchedulingDependencies(dependent, tasks)).toEqual(["LIVE"]);
  });
});
