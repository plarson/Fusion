---
"@runfusion/fusion": patch
---

summary: Workflow and automation steps now use the configured project Execution model instead of the default.
category: fix
dev: Workflow/AI-prompt step model resolution now consults the execution lane (resolveExecutorSessionModel / resolveExecutionSettingsModel) instead of resolveProjectDefaultModel, fixing executeWorkflowStep (executor.ts), cron-runner.ts, and dashboard routes.ts. FN-7039.
