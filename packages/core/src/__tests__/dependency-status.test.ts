import { describe, expect, it } from "vitest";
import {
  classifyDependencyStatuses,
  formatDependencySummary,
  isDependencySchedulingSatisfied,
} from "../dependency-status.js";
import type { Task } from "../types.js";

function task(id: string, column: Task["column"]): Pick<Task, "id" | "column"> {
  return { id, column };
}

describe("dependency status classification", () => {
  it("splits mixed FN-823-shaped dependencies into active and resolved history", () => {
    const summary = classifyDependencyStatuses(
      ["FN-801", "FN-803", "FN-819", "FN-807"],
      [task("FN-801", "done"), task("FN-803", "todo"), task("FN-819", "archived"), task("FN-807", "in-progress")],
    );

    expect(summary.active.map((dep) => dep.id)).toEqual(["FN-803", "FN-807"]);
    expect(summary.resolved.map((dep) => [dep.id, dep.kind])).toEqual([
      ["FN-801", "resolved-done"],
      ["FN-819", "resolved-archived"],
    ]);
    expect(formatDependencySummary(summary)).toBe(
      "active deps: FN-803, FN-807; resolved deps: FN-801 (done/resolved), FN-819 (archived/resolved)",
    );
  });

  it("deduplicates dependency ids while preserving duplicate evidence", () => {
    const summary = classifyDependencyStatuses(["A", "A", "B"], [task("A", "todo"), task("B", "done")]);

    expect(summary.statuses.map((dep) => [dep.id, dep.duplicate, dep.occurrences])).toEqual([
      ["A", true, 2],
      ["B", false, 1],
    ]);
    expect(formatDependencySummary(summary)).toBe("active deps: A ×2; resolved deps: B (done/resolved)");
  });

  it("treats done archived and in-review dependencies as scheduling-satisfied", () => {
    expect(isDependencySchedulingSatisfied(task("done", "done"))).toBe(true);
    expect(isDependencySchedulingSatisfied(task("archived", "archived"))).toBe(true);
    expect(isDependencySchedulingSatisfied(task("review", "in-review"))).toBe(true);
    expect(isDependencySchedulingSatisfied(task("todo", "todo"))).toBe(false);
    expect(isDependencySchedulingSatisfied(undefined)).toBe(true);
  });

  it("labels missing dependencies as not active blockers", () => {
    const summary = classifyDependencyStatuses(["MISSING"], []);

    expect(summary.active).toEqual([]);
    expect(summary.missing.map((dep) => dep.id)).toEqual(["MISSING"]);
    expect(formatDependencySummary(summary)).toBe("missing deps: MISSING (missing/not active)");
  });


  it("returns an empty summary for tasks without dependencies", () => {
    const summary = classifyDependencyStatuses([], [task("FN-1", "todo")]);

    expect(summary.statuses).toEqual([]);
    expect(formatDependencySummary(summary)).toBe("");
  });

  it("labels only archived dependencies as resolved history", () => {
    const summary = classifyDependencyStatuses(["FN-819"], [task("FN-819", "archived")]);

    expect(summary.active).toEqual([]);
    expect(summary.resolved.map((dep) => [dep.id, dep.kind])).toEqual([["FN-819", "resolved-archived"]]);
    expect(formatDependencySummary(summary)).toBe("resolved deps: FN-819 (archived/resolved)");
  });

  it("labels only live dependencies as active blockers", () => {
    const summary = classifyDependencyStatuses(["FN-803", "FN-807"], [task("FN-803", "todo"), task("FN-807", "in-progress")]);

    expect(summary.active.map((dep) => dep.id)).toEqual(["FN-803", "FN-807"]);
    expect(summary.resolved).toEqual([]);
    expect(formatDependencySummary(summary)).toBe("active deps: FN-803, FN-807");
  });
});
