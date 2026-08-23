---
"@fusion/core": patch
---

summary: Honor resolved review lanes when checking whether a task is ready to merge.
category: fix
dev: Thread `reviewColumns` through `isTaskReadyForMerge` so custom review-lane workflows do not fall back to the legacy `in-review` literal.
