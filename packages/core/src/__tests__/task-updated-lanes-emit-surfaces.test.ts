import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { TaskStore } from "../store.js";
import type { Task } from "../types.js";

const REPO_ROOT = resolve(__dirname, "../../../..");
const CORE_ROOT = join(REPO_ROOT, "packages/core/src");

const EMIT_SURFACES = [
  "packages/core/src/store.ts",
  "packages/core/src/task-store/audit-ops.ts",
  "packages/core/src/task-store/branch-group-ops.ts",
  "packages/core/src/task-store/comments-ops.ts",
  "packages/core/src/task-store/lifecycle-ops.ts",
  "packages/core/src/task-store/merge-queue-ops.ts",
  "packages/core/src/task-store/moves.ts",
  "packages/core/src/task-store/project-store-ops.ts",
  "packages/core/src/task-store/task-artifacts-ops.ts",
  "packages/core/src/task-store/task-mutation-ops.ts",
  "packages/core/src/task-store/workflow-task-create-ops.ts",
] as const;

/*
FNXC:WorkflowEvents 2026-08-01-07:35:
These are producer paths, not a sampled list of listeners. The static scan makes a newly added
producer fail closed, while the receiver assertion below proves each existing producer invokes the
TaskStore instance seam that is exercised with warm and cold cache states in this suite.
*/
const TASK_STORE_EMIT_RECEIVERS: Record<(typeof EMIT_SURFACES)[number], readonly string[]> = {
  "packages/core/src/store.ts": ["this.emit"],
  "packages/core/src/task-store/audit-ops.ts": ["store.emit", "store.emitTaskLifecycleEventSafely"],
  "packages/core/src/task-store/branch-group-ops.ts": ["store.emit"],
  "packages/core/src/task-store/comments-ops.ts": ["store.emit"],
  "packages/core/src/task-store/lifecycle-ops.ts": ["store.emit"],
  "packages/core/src/task-store/merge-queue-ops.ts": ["store.emit"],
  "packages/core/src/task-store/moves.ts": ["store.emit"],
  "packages/core/src/task-store/project-store-ops.ts": ["store.emit"],
  "packages/core/src/task-store/task-artifacts-ops.ts": ["store.emit"],
  "packages/core/src/task-store/task-mutation-ops.ts": ["store.emitTaskLifecycleEventSafely", "store.emit"],
  "packages/core/src/task-store/workflow-task-create-ops.ts": ["store.emit", "store.emitTaskLifecycleEventSafely"],
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith(".ts")) yield path;
  }
}

const task = { id: "FN-surface", column: "building" } as Task;

/*
FNXC:WorkflowEvents 2026-08-01-06:57:
Every production core update producer invokes the TaskStore instance emitter, not EventEmitter's
prototype or a private relay. That structural boundary is what lets one decorated TaskStore seam
cover every producer warm and cold without adding an IR read to hot mutation paths.
*/
describe("core task:updated emit surface", () => {
  it("registers every production producer and constrains each to TaskStore's decorated emitter", () => {
    const emittingModules = [...walk(CORE_ROOT)]
      .filter((file) => readFileSync(file, "utf8").includes('emit("task:updated"'))
      .map((file) => relative(REPO_ROOT, file).split("\\").join("/"))
      .sort();

    expect(emittingModules).toEqual([...EMIT_SURFACES].sort());
    expect(Object.keys(TASK_STORE_EMIT_RECEIVERS).sort()).toEqual([...EMIT_SURFACES].sort());
    for (const file of emittingModules) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      const receivers = TASK_STORE_EMIT_RECEIVERS[file as keyof typeof TASK_STORE_EMIT_RECEIVERS];
      expect(receivers.some((receiver) => source.includes(receiver)), `${file} must call the TaskStore emitter`).toBe(true);
      expect(source).not.toMatch(/EventEmitter\.prototype\.emit\([^\n]*task:updated/);
    }
  });

  it("delivers the warm and cold result at the TaskStore seam used by every registered producer", () => {
    const store = new TaskStore(process.cwd());
    const received: Array<{ lanes?: { wip?: string } } | undefined> = [];
    store.on("task:updated", (_task, meta) => received.push(meta));

    // The producers above all invoke this real TaskStore override; this verifies their shared delivery
    // contract rather than allowing a module-specific helper to silently bypass cache decoration.
    store.laneCache.set(task.id, { wip: "building" });
    store.emit("task:updated", task);
    store.laneCache.invalidate(task.id);
    store.emit("task:updated", task);

    expect(received).toEqual([{ lanes: { wip: "building" } }, undefined]);
  });
});
