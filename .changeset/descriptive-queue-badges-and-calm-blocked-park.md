---
"@runfusion/fusion": patch
---

summary: Waiting states name their wait, and dependency-free blocked exits replan without a failed badge.
category: fix
dev: getTaskStatusBadgeLabel gains a context param (idle, overlapBlockedBy) threaded from TaskCard/ListView; fn_task_done(outcome=blocked) with empty blockedBy parks needs-replan in the replan column (run-audit metadata gains parkedAs), dependency-carrying blocks unchanged.
