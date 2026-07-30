---
"@fusion/core": patch
"@fusion/engine": patch
"@fusion/dashboard": patch
"@runfusion/fusion": patch
---

summary: Dependency displays now distinguish live blockers from done, archived, in-review, duplicate, and missing history.
category: fix
dev: Adds a shared browser-safe dependency-status classifier used by CLI, dashboard, scheduler, fan-out, planning, and recovery paths so scheduling gates and diagnostics operate only on unique live unresolved dependencies.
