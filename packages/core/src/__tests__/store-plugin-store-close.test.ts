import { describe, expect, it, vi } from "vitest";
import { PluginStore } from "../plugin-store.js";
import { createTaskStoreTestHarness } from "./store-test-helpers.js";

async function withTaskStoreHarness<T>(
  fn: (harness: ReturnType<typeof createTaskStoreTestHarness>) => Promise<T>,
): Promise<T> {
  const harness = createTaskStoreTestHarness();
  await harness.beforeEach();
  try {
    return await fn(harness);
  } finally {
    await harness.afterEach();
  }
}

describe("TaskStore pluginStore close lifecycle", () => {
  it("closes and nulls the cached plugin store when TaskStore.close runs", async () => {
    await withTaskStoreHarness(async (harness) => {
      const store = harness.store();
      const pluginStore = store.getPluginStore();
      await pluginStore.listPlugins();
      const closeSpy = vi.spyOn(pluginStore, "close");

      await store.close();

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect((store as any).pluginStore).toBeNull();

      await expect(store.close()).resolves.toBeUndefined();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("does not attempt plugin-store teardown when the cached store was never created", async () => {
    await withTaskStoreHarness(async (harness) => {
      const store = harness.store();
      const prototypeCloseSpy = vi.spyOn(PluginStore.prototype, "close");

      await expect(store.close()).resolves.toBeUndefined();

      expect(prototypeCloseSpy).not.toHaveBeenCalled();
      expect((store as any).pluginStore).toBeNull();
      prototypeCloseSpy.mockRestore();
    });
  });

  it("closes disk-backed plugin stores during reopenDiskBackedStore", async () => {
    await withTaskStoreHarness(async (harness) => {
      await harness.reopenDiskBackedStore();
      const originalStore = harness.store();
      const pluginStore = originalStore.getPluginStore();
      await pluginStore.listPlugins();
      const closeSpy = vi.spyOn(pluginStore, "close");

      await expect(harness.reopenDiskBackedStore()).resolves.toBeUndefined();

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect((originalStore as any).pluginStore).toBeNull();
      expect((harness.store() as any).pluginStore).toBeNull();
    });
  });
});
