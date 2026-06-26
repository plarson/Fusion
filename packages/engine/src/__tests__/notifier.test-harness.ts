import { EventEmitter } from "node:events";
import { expect, vi } from "vitest";
import type { Task, Column, MergeResult, Settings } from "@fusion/core";

/*
FNXC:EngineTests 2026-06-25-17:44:
Shared notifier test harness for the FN-7035 suite split. MockTaskStore, createTask, and flushAsyncWork stay in one helper so notifier.test.ts and notifier.runtime.test.ts can split whole describe blocks under the line-count cap without duplicating event-store behavior.
*/

interface MockTaskStoreEvents {
  "task:moved": [{ task: Task; from: Column; to: Column }];
  "task:updated": [Task];
  "task:merged": [MergeResult];
  "settings:updated": [{ settings: Settings; previous: Settings }];
}

export async function flushAsyncWork(): Promise<void> {
  await vi.waitFor(() => {
    expect(true).toBe(true);
  });
}

export class MockTaskStore extends EventEmitter<MockTaskStoreEvents> {
  private settings: Settings = {
    maxConcurrent: 2,
    maxWorktrees: 4,
    pollIntervalMs: 15000,
    groupOverlappingFiles: false,
    autoMerge: true,
    ntfyEnabled: false,
    ntfyTopic: undefined,
    failureNotificationMode: "all",
    failureNotificationDelayMs: 0,
  };

  getSettings(): Settings {
    return { ...this.settings };
  }

  setSettings(settings: Partial<Settings>): void {
    const previous = { ...this.settings };
    this.settings = { ...this.settings, ...settings };
    this.emit("settings:updated", { settings: this.settings, previous });
  }

  triggerTaskMoved(task: Task, from: Column, to: Column): void {
    this.emit("task:moved", { task, from, to });
  }

  triggerTaskUpdated(task: Task): void {
    this.emit("task:updated", task);
  }

  triggerTaskMerged(result: MergeResult): void {
    this.emit("task:merged", result);
  }
}

export const createTask = (id: string, title?: string, status?: string): Task => ({
  id,
  title,
  description: "Test task",
  column: "in-progress",
  dependencies: [],
  steps: [],
  currentStep: 0,
  status,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  log: [],
});
