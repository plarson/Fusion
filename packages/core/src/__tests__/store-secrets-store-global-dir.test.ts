import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../store.js";

/*
FNXC:GlobalDirGuard 2026-06-25-23:05:
Symptom-based regression for the "all my global settings reset" bug. The root cause was getSecretsStore() (and dashboard routes) constructing CentralCore with `store.getFusionDir()` (the project's `.fusion/`), which created a stray per-project `fusion-central.db` seeded with default global state that shadowed the real global DB. These tests assert the INVARIANT directly: the secrets store's central DB lands in the resolved GLOBAL dir and NOT inside the project `.fusion/` dir, and that getGlobalSettingsDir() is distinct from getFusionDir(). Surface enumeration: this covers the store/secrets surface; the resolveGlobalDir guard surfaces are covered in global-settings-guard.test.ts.
*/
describe("TaskStore.getSecretsStore() central DB location (global, not project-local)", () => {
  let root: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "fn-secrets-global-dir-"));
    globalDir = join(root, ".fusion-global-settings");
    store = new TaskStore(root, globalDir, { inMemoryDb: true });
    await store.init();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves getGlobalSettingsDir() to the global dir, distinct from getFusionDir()", () => {
    expect(store.getGlobalSettingsDir()).toBe(globalDir);
    expect(store.getFusionDir()).toBe(join(root, ".fusion"));
    expect(store.getGlobalSettingsDir()).not.toBe(store.getFusionDir());
  });

  it("creates the secrets central DB in the global dir and never in the project .fusion/", async () => {
    await store.getSecretsStore();

    // The central DB must live in the resolved global dir...
    expect(existsSync(join(globalDir, "fusion-central.db"))).toBe(true);
    // ...and must NOT have spawned a stray per-project central DB (the original bug).
    expect(existsSync(join(store.getFusionDir(), "fusion-central.db"))).toBe(false);
  });

  it("returns a stable singleton secrets store across calls", async () => {
    const a = await store.getSecretsStore();
    const b = await store.getSecretsStore();
    expect(a).toBe(b);
  });
});
