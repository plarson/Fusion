import type { WorkflowIrNode } from "./workflow-ir-types.js";
import { WORKFLOW_STEP_TEMPLATES } from "./types.js";

/*
FNXC:CodeReviewStep 2026-06-25-15:00:
Code Review is a DEFAULT-ON but TOGGLEABLE step in the built-in coding and
stepwise-coding workflows: an `optional-group` container node with `defaultOn: true`.
It is part of the existing flows and runs for every coding task by default (the
default-on resolver seeds `code-review` into a new task's enabledWorkflowSteps), yet an
operator can turn it off per task by removing `code-review` from enabledWorkflowSteps —
when disabled the group passes through byte-inert, restoring the exact prior flow.

The group sits on the pre-merge success path (execute → [browser-verification optional]
→ code-review → review). The group node id `code-review` is the STABLE per-task enable
key; the inner template node carries a DISTINCT id (`code-review-step`) because a template
node id may not collide with the group/top-level node id (U1 validation).

The inner node mirrors the dashboard's `stepTemplateToNode` projection of the canonical
`code-review` WORKFLOW_STEP_TEMPLATE: a `prompt` node carrying the template's prompt,
`toolMode` (readonly — review reads the diff, never mutates), and `gateMode` (advisory —
non-blocking, like the existing review; operators can promote to a gate). Sourcing
prompt/toolMode/gateMode from the catalog keeps the built-in byte-identical to the
template a human would insert from the palette (KTD-5).
*/

function resolveCodeReviewTemplate() {
  const tpl = WORKFLOW_STEP_TEMPLATES.find((t) => t.id === "code-review");
  if (!tpl) {
    throw new Error("code-review WORKFLOW_STEP_TEMPLATE is missing");
  }
  return tpl;
}

const CODE_REVIEW_TEMPLATE = resolveCodeReviewTemplate();

/** Stable per-task enable key + group node id. */
export const CODE_REVIEW_GROUP_ID = "code-review";

/** Inner template node id — distinct from the group id (template-node-id collision rule, U1). */
export const CODE_REVIEW_STEP_NODE_ID = "code-review-step";

/**
 * Build the `code-review` optional-group node placed on a workflow's pre-merge path.
 * `defaultOn: true` makes it run by default while remaining togglable per task. `column`
 * matches where the browser-verification group sits (in-progress) so the editor renders
 * the group in the implementation column.
 *
 * Mirrors `stepTemplateToNode(code-review)`: a single `prompt` node whose config carries
 * the catalog prompt + `toolMode: "readonly"` + `gateMode: "advisory"`.
 */
export function codeReviewOptionalGroupNode(column: string): WorkflowIrNode {
  const tpl = CODE_REVIEW_TEMPLATE;
  return {
    id: CODE_REVIEW_GROUP_ID,
    kind: "optional-group",
    column,
    config: {
      name: tpl.name,
      // Default-ON: runs for every coding task by default, but operators can toggle it
      // off per task (remove `code-review` from enabledWorkflowSteps).
      defaultOn: true,
      template: {
        nodes: [
          {
            id: CODE_REVIEW_STEP_NODE_ID,
            kind: "prompt",
            config: {
              name: tpl.name,
              description: tpl.description,
              prompt: tpl.prompt ?? "",
              toolMode: tpl.toolMode === "coding" ? "coding" : "readonly",
              gateMode: tpl.gateMode ?? "advisory",
            },
          },
        ],
        edges: [],
      },
    },
  };
}
