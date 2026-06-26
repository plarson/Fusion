---
"@runfusion/fusion": patch
---

summary: Fix task Workflow tab showing "Step definition not found." for Code Review and other optional steps.
category: fix
dev: WorkflowResultsTab configuredSteps now shows the not-found message only when a step id is absent from the step lookup, not when a found optional-group step has an empty description.
