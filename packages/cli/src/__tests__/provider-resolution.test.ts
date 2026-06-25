import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRoot = join(__dirname, "..", "..", "..", "..");
const packageContexts = ["packages/engine", "packages/cli"] as const;

function resolvePiAiPackage(context: (typeof packageContexts)[number]): string {
  return realpathSync(join(workspaceRoot, context, "node_modules", "@earendil-works", "pi-ai"));
}

describe("pi-ai provider artifact resolution", () => {
  it.each(packageContexts)("loads openai-codex-responses from %s package context", async (context) => {
    const packageRoot = resolvePiAiPackage(context);
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const codexExport = packageJson.exports?.["./openai-codex-responses"];

    expect(packageJson.version).toBe("0.79.9");
    expect(codexExport?.import).toBe("./dist/providers/openai-codex-responses.js");
    expect(codexExport?.types).toBe("./dist/providers/openai-codex-responses.d.ts");

    const registerBuiltins = join(packageRoot, "dist", "providers", "register-builtins.js");
    const codexResponses = join(packageRoot, "dist", "providers", "openai-codex-responses.js");
    const codexResponsesTypes = join(packageRoot, "dist", "providers", "openai-codex-responses.d.ts");

    expect(existsSync(registerBuiltins), `${context}: register-builtins.js must be installed`).toBe(true);
    expect(existsSync(codexResponses), `${context}: openai-codex-responses.js must be installed`).toBe(true);
    expect(existsSync(codexResponsesTypes), `${context}: openai-codex-responses.d.ts must be installed`).toBe(true);

    await expect(import(pathToFileURL(registerBuiltins).href)).resolves.toBeTypeOf("object");
    await expect(import(pathToFileURL(codexResponses).href)).resolves.toBeTypeOf("object");
  });
});
