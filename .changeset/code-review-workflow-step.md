---
"@runfusion/fusion": minor
---

summary: Add a default-on, toggleable pre-merge Code Review step to the built-in coding workflows.
category: feature
dev: New `code-review` optional-group node (defaultOn:true, toolMode readonly, gateMode advisory, phase pre-merge) on the pre-merge success path (execute → browser-verification → code-review → review) of both the built-in coding and stepwise coding workflows. Runs for every coding task by default (seeded into enabledWorkflowSteps via resolveDefaultOnOptionalGroupIds) but is toggleable off per task; advisory so it does not change merge outcomes (operators can promote it to a blocking gate). Also fixes default-workflow task creation to seed default-on optional groups for interpreter-deferred built-ins (previously dropped). Reuses the shared prompt-gate verdict machinery (no engine verification code). The `code-review` WORKFLOW_STEP_TEMPLATE is also available in the editor palette.
