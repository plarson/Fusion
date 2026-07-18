import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { pgDescribe } from "../../../core/src/__test-utils__/pg-test-harness.js";
import { createPgExtensionHarness } from "./pg-extension-harness.js";

const resolveProjectMock = vi.hoisted(() => vi.fn());
const closeProjectStoreMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../project-context.js", () => ({
  resolveProject: resolveProjectMock,
  closeProjectStore: closeProjectStoreMock,
}));

import { runTaskList, runTaskShow } from "../commands/task.js";

const logs: string[] = [];
const pgTest = pgDescribe;

pgTest("task dependency CLI output", () => {
  const h = createPgExtensionHarness("fn-task-dependency-output");
  let ids: {
    done: string;
    todo: string;
    archived: string;
    progress: string;
    dependent: string;
  };

  beforeAll(h.beforeAll);
  beforeEach(async () => {
    await h.beforeEach();
    const store = h.store();
    resolveProjectMock.mockResolvedValue({
      store,
      projectId: h.rootDir(),
      projectPath: h.rootDir(),
      projectName: "test",
      isRegistered: false,
    });

    logs.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    const done = await store.createTask({ title: "Done dependency", description: "done", column: "done" });
    const todo = await store.createTask({ title: "Live todo dependency", description: "todo", column: "todo" });
    const archived = await store.createTask({ title: "Archived dependency", description: "archived", column: "todo" });
    await store.archiveTask(archived.id);
    const progress = await store.createTask({ title: "Live progress dependency", description: "progress", column: "in-progress" });
    const dependent = await store.createTask({
      title: "Mixed dependent",
      description: "dependent",
      column: "todo",
      dependencies: [done.id, todo.id, archived.id, progress.id],
    });
    ids = {
      done: done.id,
      todo: todo.id,
      archived: archived.id,
      progress: progress.id,
      dependent: dependent.id,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resolveProjectMock.mockReset();
    closeProjectStoreMock.mockClear();
    await h.afterEach();
  });
  afterAll(h.afterAll);

  it("labels active and resolved dependencies in task list output", async () => {
    await expect(runTaskList()).rejects.toThrow("process.exit:0");

    const output = logs.join("\n");
    expect(output).toContain(
      `${ids.dependent}  Mixed dependent [active deps: ${ids.todo}, ${ids.progress}; resolved deps: ${ids.done} (done/resolved), ${ids.archived} (archived/resolved)]`,
    );
    expect(output).not.toContain(`[${ids.done}, ${ids.todo}, ${ids.archived}, ${ids.progress}]`);
  });

  it("labels active and resolved dependencies in task show output", async () => {
    await runTaskShow(ids.dependent);

    const output = logs.join("\n");
    expect(output).toContain(
      `Dependencies: active deps: ${ids.todo}, ${ids.progress}; resolved deps: ${ids.done} (done/resolved), ${ids.archived} (archived/resolved)`,
    );
    expect(output).not.toContain(`Dependencies: ${ids.done}, ${ids.todo}, ${ids.archived}, ${ids.progress}`);
    expect(process.exit).not.toHaveBeenCalled();
  });
});
