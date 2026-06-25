---
"@runfusion/fusion": patch
---

summary: Fix unreadable info-toast contrast and dashboard CSS token regressions.
category: fix
dev: Tokenized raw rgba/undefined CSS vars across ~15 dashboard component stylesheets, defined missing --border-strong / right-dock width tokens, enrolled the shadcn-custom light theme in the dark-text toast correction (WCAG AA). Also repairs ~19 stale dashboard tests that trailed intentional product changes (workflowColumns graduation, onboarding flow, theme relabels, header divider removal).
