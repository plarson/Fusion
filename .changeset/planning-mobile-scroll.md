---
"@runfusion/fusion": patch
---

summary: Fix Planning Mode not scrolling on mobile so action buttons stay reachable.
category: fix
dev: The global mobile `.modal-lg`/`.modal:not(.confirm-dialog)` 100dvh rule was matching the embedded Planning shell (`.planning-modal--embedded`) and stretching it past its bounded `.planning-view` pane, clipping the footer under `overflow:hidden`. Mobile rule now qualifies as `.planning-view.open .planning-modal--embedded` (specificity 0,3,0) and re-pins `max-height:100%` so the inner flex scroll chain works.
