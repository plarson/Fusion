import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { loadAllAppCss } from "../test/cssFixture";

/*
FNXC:TaskDetailLayout 2026-07-31-20:50:
FN-8630 diagnoses the desktop/tablet residual end inset as the UA scrollbar reservation on
`.detail-body`, not header controls, section padding, or a breakpoint cascade. jsdom has no
layout or numeric native scrollbar width, so this test emulates the shell box model rather than
measuring geometry: ordered matching declarations expand padding shorthands, map LTR physical
left/right to logical start/end, and sum root, body/header, and section padding.

Long content uses SCROLLBAR_GUTTER_PX only as a deterministic stand-in for UA reservation; it
must never be replaced with a measured native scrollbar. Absent content contributes no gutter;
`auto`/unset contributes end only, `stable` contributes end only, and `stable both-edges`
contributes both sides. FN-8630 requires the latter contract on `.detail-body` so modal,
pop-out, and embedded Task Detail shells remain symmetric at every breakpoint. The separate
FN-8624 first-row overlay-clearance assertions preserve the tokenized exception that prevents
`.activity-expand-toggle--overlay` from covering log text.
*/

export const SCROLLBAR_GUTTER_PX = 12;

type Inset = { start: number; end: number };
type CssRule = { selectors: string[]; declarations: Map<string, string>; media?: string };
type ShellVariant = "modal" | "pop-out" | "embedded";

const DEFAULT_PADDING: Inset = { start: 0, end: 0 };

function splitCssValues(value: string): string[] {
  const values: string[] = [];
  let token = "";
  let depth = 0;
  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (token) values.push(token), token = "";
    } else {
      token += character;
    }
  }
  if (token) values.push(token);
  return values;
}

function parseDeclarations(block: string): Map<string, string> {
  return new Map(
    block.split(";").flatMap((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) return [];
      return [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()] as const];
    }),
  );
}

function parseRules(css: string, media?: string): CssRule[] {
  const rules: CssRule[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open === -1) break;
    const prelude = css.slice(cursor, open).trim();
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth > 0) {
      if (css[close] === "{") depth += 1;
      if (css[close] === "}") depth -= 1;
      close += 1;
    }
    const block = css.slice(open + 1, close - 1);
    if (prelude.startsWith("@media")) {
      rules.push(...parseRules(block, prelude));
    } else if (!prelude.startsWith("@")) {
      rules.push({ selectors: prelude.split(",").map((selector) => selector.trim()), declarations: parseDeclarations(block), media });
    }
    cursor = close;
  }
  return rules;
}

function mediaMatches(media: string | undefined, width: number): boolean {
  if (!media) return true;
  const min = media.match(/min-width:\s*(\d+(?:\.\d+)?)px/)?.[1];
  const max = media.match(/max-width:\s*(\d+(?:\.\d+)?)px/)?.[1];
  return (!min || width >= Number(min)) && (!max || width <= Number(max));
}

function matchesElement(selector: string, element: "root" | "header" | "body" | "section", variant: ShellVariant): boolean {
  const terminalClass = {
    root: "task-detail-content",
    header: "modal-header",
    body: "detail-body",
    section: "detail-section",
  }[element];
  const terminal = selector.trim().split(/[ >+~]/).filter(Boolean).at(-1) ?? "";
  if (!terminal.split(":")[0].split(".").includes(terminalClass)) return false;
  if (selector.includes("task-detail-content--embedded") && variant !== "embedded") return false;
  if (selector.includes("floating-window--task-detail") && variant !== "pop-out") return false;
  return true;
}

function resolveVariables(value: string, variables: Map<string, string>): string {
  let resolved = value;
  for (let iteration = 0; iteration < 8 && resolved.includes("var("); iteration += 1) {
    resolved = resolved.replace(/var\((--[\w-]+)(?:,\s*[^)]+)?\)/g, (_match, name: string) => variables.get(name) ?? "0px");
  }
  return resolved;
}

function cssNumber(value: string, variables: Map<string, string>): number {
  const expression = resolveVariables(value, variables)
    .replace(/calc\(/g, "(")
    .replace(/px\b/g, "")
    .trim();
  if (!/^[\d.()+\-*/\s]+$/.test(expression)) throw new Error(`Unsupported deterministic inset value: ${value}`);
  return Number(Function(`"use strict"; return (${expression});`)());
}

function applyPadding(style: Inset, property: string, value: string, variables: Map<string, string>): Inset {
  const next = { ...style };
  const values = splitCssValues(resolveVariables(value, variables)).map((part) => cssNumber(part, variables));
  if (property === "padding") {
    next.start = values.length === 1 ? values[0]! : values[3] ?? values[1]!;
    next.end = values.length === 1 ? values[0]! : values[1]!;
  } else if (property === "padding-inline") {
    next.start = values[0]!;
    next.end = values[1] ?? values[0]!;
  } else if (property === "padding-inline-start" || property === "padding-left") {
    next.start = values[0]!;
  } else if (property === "padding-inline-end" || property === "padding-right") {
    next.end = values[0]!;
  }
  return next;
}

function rootVariables(rules: CssRule[]): Map<string, string> {
  const variables = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(":root")) continue;
    for (const [property, value] of rule.declarations) if (property.startsWith("--")) variables.set(property, value);
  }
  return variables;
}

function resolvedElementStyle(rules: CssRule[], variables: Map<string, string>, width: number, variant: ShellVariant, element: "root" | "header" | "body" | "section"): { inset: Inset; overflowY?: string; scrollbarGutter?: string } {
  let inset = { ...DEFAULT_PADDING };
  let overflowY: string | undefined;
  let scrollbarGutter: string | undefined;
  for (const rule of rules) {
    if (!mediaMatches(rule.media, width) || !rule.selectors.some((selector) => matchesElement(selector, element, variant))) continue;
    for (const [property, value] of rule.declarations) {
      if (["padding", "padding-inline", "padding-inline-start", "padding-inline-end", "padding-left", "padding-right"].includes(property)) {
        inset = applyPadding(inset, property, value, variables);
      }
      if (property === "overflow-y") overflowY = value;
      if (property === "scrollbar-gutter") scrollbarGutter = value;
    }
  }
  return { inset, overflowY, scrollbarGutter };
}

/** Resolves the deterministic FN-8630 effective inset model; this is intentionally exported as the shared test helper. */
export function resolveTaskDetailInsets(css: string, width: number, variant: ShellVariant, scrollbarPresent: boolean): { body: Inset; header: Inset; scrollbarGutter?: string } {
  document.documentElement.dir = "ltr";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  const rules = parseRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  const variables = rootVariables(rules);
  const root = resolvedElementStyle(rules, variables, width, variant, "root").inset;
  const bodyStyle = resolvedElementStyle(rules, variables, width, variant, "body");
  const section = resolvedElementStyle(rules, variables, width, variant, "section").inset;
  const headerStyle = resolvedElementStyle(rules, variables, width, variant, "header");
  const gutter = scrollbarPresent && /^(auto|scroll)$/.test(bodyStyle.overflowY ?? "")
    ? bodyStyle.scrollbarGutter === "stable both-edges"
      ? { start: SCROLLBAR_GUTTER_PX, end: SCROLLBAR_GUTTER_PX }
      : { start: 0, end: SCROLLBAR_GUTTER_PX }
    : DEFAULT_PADDING;
  return {
    body: { start: root.start + bodyStyle.inset.start + section.start + gutter.start, end: root.end + bodyStyle.inset.end + section.end + gutter.end },
    header: { start: root.start + headerStyle.inset.start, end: root.end + headerStyle.inset.end },
    scrollbarGutter: bodyStyle.scrollbarGutter,
  };
}

function renderShell(variant: ShellVariant): void {
  const embedded = variant === "embedded" ? " task-detail-content--embedded" : "";
  const popOut = variant === "pop-out" ? "floating-window--task-detail" : "";
  render(createElement("div", { className: popOut }, createElement("div", { className: `task-detail-content${embedded}` }, createElement("header", { className: "modal-header" }), createElement("main", { className: "detail-body" }, createElement("section", { className: "detail-section" })))));
}

describe("FN-8630 Task Detail effective inset symmetry", () => {
  const css = loadAllAppCss();
  const taskDetailCss = css.slice(css.indexOf("/* === Detail Modal ==="), css.indexOf("/* === Detail Modal ===") + css.slice(css.indexOf("/* === Detail Modal ===")).length);

  it("keeps the modeled shell inset symmetric across all required variants, widths, and scrollbar states", () => {
    for (const width of [1280, 900, 420]) {
      for (const variant of ["modal", "pop-out", "embedded"] as const) {
        for (const scrollbarPresent of [false, true]) {
          renderShell(variant);
          const insets = resolveTaskDetailInsets(css, width, variant, scrollbarPresent);
          expect(insets.body, `${variant} ${width}px scrollbar=${scrollbarPresent}`).toEqual({ start: insets.body.start, end: insets.body.start });
          expect(insets.header, `${variant} ${width}px header`).toEqual({ start: insets.header.start, end: insets.header.start });
        }
      }
    }
  });

  it("pins the diagnosed stable both-edges scrollbar-gutter contract", () => {
    for (const width of [1280, 900, 420]) {
      expect(resolveTaskDetailInsets(css, width, "modal", true).scrollbarGutter).toBe("stable both-edges");
    }
  });

  it("retains FN-8624 first-row overlay clearance while interventions remain inset-free", () => {
    expect(css).toMatch(/\.detail-activity:not\(\.detail-activity--interventions\) > h4[\s\S]*?padding-inline-end:\s*calc\(var\(--space-2xl\) \+ var\(--space-md\)\)/);
    const activityIndex = taskDetailCss.indexOf(".detail-activity {");
    const mobileCss = taskDetailCss.slice(taskDetailCss.indexOf("@media (max-width: 768px)", activityIndex));
    expect(mobileCss).toMatch(/\.detail-activity:not\(\.detail-activity--interventions\) > h4[\s\S]*?padding-inline-end:\s*calc\(var\(--space-2xl\) \+ var\(--space-sm\)\)/);
    expect(css).toMatch(/\.detail-activity--interventions\s*\{\s*padding-inline-end:\s*0;/);
  });
});
