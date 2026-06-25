import React from "react";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, extname, join, relative, resolve } from "path";
import { render, screen } from "@testing-library/react";
import { Loader2, RefreshCw } from "lucide-react";

const SHARED_SPINNER_KEYFRAME = "fusion-spinner-spin";
const CSS_ROOT = resolve(__dirname, "..");
const COMPONENTS_ROOT = resolve(CSS_ROOT, "components");

function extractBlock(content: string, pattern: RegExp): string {
  const match = content.match(pattern);
  expect(match?.index).toBeDefined();

  const start = match!.index! + match![0].length;
  let index = start;
  let depth = 1;

  while (index < content.length && depth > 0) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") depth -= 1;
    index += 1;
  }

  expect(depth).toBe(0);
  return content.slice(match!.index!, index);
}

function collectCssFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const absolutePath = join(root, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      return collectCssFiles(absolutePath);
    }
    return extname(entry) === ".css" ? [absolutePath] : [];
  });
}

function assertBlockUsesSharedAnimation(block: string, selector: string): void {
  expect(block, selector).toContain(SHARED_SPINNER_KEYFRAME);
  expect(block, selector).toContain("transform-origin: center;");
  expect(block, selector).not.toContain("animation: spin");
  expect(block, selector).not.toContain("animation-name: spin");
}

function assertSharedSpinnerCssContract(css: string): void {
  const sharedKeyframeBlock = extractBlock(css, new RegExp(`@keyframes\\s+${SHARED_SPINNER_KEYFRAME}\\s*\\{`));
  const animateSpinBlock = extractBlock(css, /\.animate-spin\s*\{/);
  const spinBlock = extractBlock(css, /\.spin\s*\{/);
  const spinnerBlock = extractBlock(css, /\.spinner,\s*\n\.spinning\s*\{/);
  const svgSpinnerBlock = extractBlock(css, /svg\.animate-spin,\s*\nsvg\.spin,\s*\nsvg\.spinner,\s*\nsvg\.spinning\s*\{/);

  expect(sharedKeyframeBlock).toContain("transform: rotate(360deg);");
  expect(css).not.toMatch(/@keyframes\s+spin\s*\{/);

  assertBlockUsesSharedAnimation(animateSpinBlock, ".animate-spin");
  assertBlockUsesSharedAnimation(spinBlock, ".spin");
  assertBlockUsesSharedAnimation(spinnerBlock, ".spinner/.spinning");

  expect(svgSpinnerBlock).toContain("transform-box: fill-box;");
  expect(svgSpinnerBlock).toContain("svg.animate-spin");
  expect(svgSpinnerBlock).toContain("svg.spin");
  expect(svgSpinnerBlock).toContain("svg.spinner");
  expect(svgSpinnerBlock).toContain("svg.spinning");
}

function assertRenderedSpinnerClass(className: string): void {
  const testId = `spinner-${className}`;
  render(React.createElement(Loader2, { className, "data-testid": testId }));

  const spinner = screen.getByTestId(testId);
  expect(spinner.tagName.toLowerCase()).toBe("svg");
  expect(spinner).toHaveAttribute("class", expect.stringContaining(className));
  expect(spinner).toHaveAttribute("fill", "none");
  expect(spinner).toHaveAttribute("viewBox", "0 0 24 24");
}

describe("global spinner animation utility", () => {
  const css = readFileSync(resolve(CSS_ROOT, "styles.css"), "utf8");

  it("keeps every shared utility on the collision-proof spinner keyframe", () => {
    assertSharedSpinnerCssContract(css);
  });

  it("keeps representative lucide svg spinner classes wired for the shared contract", () => {
    ["spin", "animate-spin", "spinner", "spinning"].forEach(assertRenderedSpinnerClass);

    render(React.createElement(RefreshCw, { className: "spinning", "data-testid": "refresh-spinner" }));
    expect(screen.getByTestId("refresh-spinner")).toHaveAttribute("class", expect.stringContaining("spinning"));
  });

  it("protects the FN-6916 first-paint svg transform box contract", () => {
    expect(() => assertSharedSpinnerCssContract(css.replace("transform-box: fill-box;", "transform-box: view-box;"))).toThrow();
  });

  it("fails the contract if shared utilities regress back to a generic spin keyframe", () => {
    const regressedCss = css
      .replaceAll(SHARED_SPINNER_KEYFRAME, "spin")
      .replace("@keyframes spin", "@keyframes spin");

    expect(() => assertSharedSpinnerCssContract(regressedCss)).toThrow();
  });

  it("keeps component css chunks from defining globally colliding spin keyframes or utility overrides", () => {
    const offenders = collectCssFiles(COMPONENTS_ROOT)
      .map((file) => ({ file, content: readFileSync(file, "utf8") }))
      .filter(({ content }) => /@keyframes\s+spin\s*\{|^\.(?:spin|animate-spin|spinner|spinning)\s*\{/m.test(content))
      .map(({ file }) => relative(CSS_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it("keeps css-only spinner surfaces on isolated keyframes", () => {
    const expectedCssOnlySurfaces = [
      ["components/TerminalModal.css", ".terminal-spinner", "terminal-spin"],
      ["components/TaskCard.css", ".card-edit-loading-spinner", "task-card-edit-spinner-spin"],
      ["components/FileMentionPopup.css", ".file-mention-popup-loading .spinner", "file-mention-popup-spinner-spin"],
      ["components/IssueMentionPopup.css", ".issue-mention-popup-loading .spinner", "issue-mention-popup-spinner-spin"],
      ["components/WorkflowResultsTab.css", ".workflow-results-spinner", "workflow-results-spinner-spin"],
    ] as const;

    for (const [relativeFile, selector, keyframeName] of expectedCssOnlySurfaces) {
      const filePath = resolve(CSS_ROOT, relativeFile);
      expect(existsSync(filePath), relativeFile).toBe(true);
      const fileCss = readFileSync(filePath, "utf8");
      expect(fileCss, `${relativeFile} defines ${keyframeName}`).toMatch(new RegExp(`@keyframes\\s+${keyframeName}\\s*\\{`));
      expect(fileCss, `${relativeFile} animates ${selector}`).toContain(`animation: ${keyframeName}`);
    }
  });

  it("keeps renamed local spinner classes connected to rendered loading affordances", () => {
    const customProvidersSource = readFileSync(resolve(COMPONENTS_ROOT, "CustomProvidersSection.tsx"), "utf8");
    const taskCardSource = readFileSync(resolve(COMPONENTS_ROOT, "TaskCard.tsx"), "utf8");
    const terminalModalSource = readFileSync(resolve(COMPONENTS_ROOT, "TerminalModal.tsx"), "utf8");

    expect(customProvidersSource).toContain('className="custom-provider-spin"');
    expect(taskCardSource).toContain('className="card-edit-loading-spinner"');
    expect(terminalModalSource).toContain('className="terminal-spinner"');
  });

  it("records the searched dashboard spinner surface inventory", () => {
    const surfaceFiles = collectCssFiles(COMPONENTS_ROOT)
      .filter((file) => /spinner|spin|keyframes/.test(readFileSync(file, "utf8")))
      .map((file) => basename(file))
      .sort();

    expect(surfaceFiles).toEqual(expect.arrayContaining([
      "FileMentionPopup.css",
      "GitHubImportModal.css",
      "Header.css",
      "IssueMentionPopup.css",
      "NodesView.css",
      "ScriptsModal.css",
      "TaskCard.css",
      "TaskDetailModal.css",
      "TerminalModal.css",
      "TodoView.css",
      "WorkflowResultsTab.css",
    ]));
  });
});
