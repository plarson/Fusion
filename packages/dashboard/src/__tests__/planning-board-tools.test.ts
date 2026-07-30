import { describe, expect, it, vi } from "vitest";
import { MAX_TASK_LIST_TEXT_CHARS, type TaskStore } from "@fusion/core";
import { createPlanningBoardTools, resolveTaskListFormatter } from "../planning-board-tools.js";

function createStoreMock(overrides?: {
  listTasks?: TaskStore["listTasks"];
  getTask?: TaskStore["getTask"];
}): TaskStore {
  return {
    listTasks: overrides?.listTasks ?? vi.fn(async () => []),
    getTask: overrides?.getTask ?? vi.fn(async () => {
      throw new Error("not found");
    }),
  } as unknown as TaskStore;
}


describe("fn_task_list resilience (FN-6573)", () => {
  it("returns bounded text when formatter exports are unavailable", () => {
    const boardLines = [
      `FN-1 (todo): Dashboard duplicate check ${"x".repeat(6_000)}`,
      `FN-2 (triage): Dashboard duplicate check ${"x".repeat(6_000)}`,
    ];

    /*
    FNXC:TaskListOutput 2026-06-17-07:38:
    FN-6573 drives the dashboard formatter resolver seam because the tool closure imports the live @fusion/core namespace at module load. The seam reproduces stale dist namespaces where formatTaskListText, or both task-list helpers, are absent and must still produce one bounded text block.
    */
    for (const coreNamespace of [
      { formatTaskListText: undefined, clampTaskListText: () => "unused" },
      { formatTaskListText: undefined, clampTaskListText: undefined },
    ]) {
      const formatter = resolveTaskListFormatter(coreNamespace);
      const text = formatter(boardLines, { clamp: coreNamespace.clampTaskListText }).trimEnd();
      expect(text).toBeTruthy();
      expect(text.length).toBeLessThanOrEqual(MAX_TASK_LIST_TEXT_CHARS);
    }
  });
});


describe("createPlanningBoardTools", () => {
  it("fn_task_list does not throw TypeError on happy path and excludes done tasks", async () => {
    const store = createStoreMock({
      listTasks: vi.fn(async () => [
        {
          id: "FN-1",
          column: "todo",
          title: "Task one",
          description: "Task one description",
          dependencies: ["FN-0"],
        },
        {
          id: "FN-2",
          column: "done",
          title: "Done",
          description: "Done description",
          dependencies: [],
        },
      ]) as TaskStore["listTasks"],
      getTask: vi.fn(async (id: string) => ({ id, column: "todo", title: id, description: id, dependencies: [] })) as TaskStore["getTask"],
    });

    const taskList = createPlanningBoardTools(store).find((tool) => tool.name === "fn_task_list");
    expect(taskList).toBeDefined();
    await expect(taskList!.execute("c1", {})).resolves.not.toThrow();
    const result = await taskList!.execute("c1", {});
    expect(result.content[0]?.text).toBe("FN-1 (todo): Task one [active deps: FN-0]");

    const emptyStore = createStoreMock({ listTasks: vi.fn(async () => []) as TaskStore["listTasks"] });
    const emptyResult = await createPlanningBoardTools(emptyStore)
      .find((tool) => tool.name === "fn_task_list")!
      .execute("c2", {});
    expect(emptyResult.content[0]?.text).toBe("No active tasks.");
  });

  it("fn_task_show returns full details and not-found fallback", async () => {
    const store = createStoreMock({
      getTask: vi.fn(async (id: string) => {
        const byId: Record<string, unknown> = {
          "FN-10": { id, column: "in-progress", description: "Detailed task", dependencies: ["FN-801", "FN-803", "FN-819", "FN-807"], prompt: "# Prompt body" },
          "FN-801": { id: "FN-801", column: "done", description: "Done dep", dependencies: [] },
          "FN-803": { id: "FN-803", column: "todo", description: "Todo dep", dependencies: [] },
          "FN-819": { id: "FN-819", column: "archived", description: "Archived dep", dependencies: [] },
          "FN-807": { id: "FN-807", column: "in-progress", description: "Live dep", dependencies: [] },
        };
        return byId[id] as Awaited<ReturnType<TaskStore["getTask"]>>;
      }) as TaskStore["getTask"],
    });

    const taskGet = createPlanningBoardTools(store).find((tool) => tool.name === "fn_task_show");
    expect(taskGet).toBeDefined();
    const result = await taskGet!.execute("c3", { id: "FN-10" });
    expect(result.content[0]?.text).toContain("ID: FN-10");
    expect(result.content[0]?.text).toContain("Column: in-progress");
    expect(result.content[0]?.text).toContain("Description: Detailed task");
    expect(result.content[0]?.text).toContain("Dependencies: active deps: FN-803, FN-807; resolved deps: FN-801 (done/resolved), FN-819 (archived/resolved)");
    expect(result.content[0]?.text).toContain("PROMPT.md:");
    expect(result.content[0]?.text).toContain("# Prompt body");

    const notFoundStore = createStoreMock();
    const missingResult = await createPlanningBoardTools(notFoundStore)
      .find((tool) => tool.name === "fn_task_show")!
      .execute("c4", { id: "FN-404" });
    expect(missingResult.content[0]?.text).toBe("Task FN-404 not found.");
  });
});
