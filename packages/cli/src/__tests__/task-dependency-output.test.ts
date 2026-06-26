import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "@fusion/core";
import { runTaskList, runTaskShow } from "../commands/task.js";

const logs: string[] = [];

async function seedMixedDependencies(rootDir: string): Promise<void> {
  const store = new TaskStore(rootDir);
  await store.init();
  await store.createTask({ title: "Done dependency", description: "done", column: "done" }); // FN-001
  await store.createTask({ title: "Live todo dependency", description: "todo", column: "todo" }); // FN-002
  const archived = await store.createTask({ title: "Archived dependency", description: "archived", column: "todo" }); // FN-003
  await store.archiveTask(archived.id);
  await store.createTask({ title: "Live progress dependency", description: "progress", column: "in-progress" }); // FN-004
  await store.createTask({
    title: "Mixed dependent",
    description: "dependent",
    column: "todo",
    dependencies: ["FN-001", "FN-002", "FN-003", "FN-004"],
  });
}

describe("task dependency CLI output", () => {
  const originalCwd = process.cwd();
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "fusion-task-deps-cli-"));
    process.chdir(tmpDir);
    logs.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    await seedMixedDependencies(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("labels active and resolved dependencies in task list output", async () => {
    await expect(runTaskList()).rejects.toThrow("process.exit:0");

    const output = logs.join("\n");
    expect(output).toContain("FN-005  Mixed dependent [active deps: FN-002, FN-004; resolved deps: FN-001 (done/resolved), FN-003 (archived/resolved)]");
    expect(output).not.toContain("[FN-001, FN-002, FN-003, FN-004]");
  });

  it("labels active and resolved dependencies in task show output", async () => {
    await runTaskShow("FN-005");

    const output = logs.join("\n");
    expect(output).toContain("Dependencies: active deps: FN-002, FN-004; resolved deps: FN-001 (done/resolved), FN-003 (archived/resolved)");
    expect(output).not.toContain("Dependencies: FN-001, FN-002, FN-003, FN-004");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
