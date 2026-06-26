---
"@runfusion/fusion": minor
---

summary: Adjust the global concurrency cap from the footer and dashboard; settings grouped by global vs project scope.
category: feature
dev: Added a Global Max Concurrent slider (wired to fetch/updateGlobalConcurrency) to EngineControlMenu (footer) and the dashboard CommandCenterControls Concurrency card, with debounced saves matching the existing project sliders. SchedulingSection now groups fields under labeled "Global — all projects" and "This project" subheadings with scope badges so the global cap is not mistaken for a per-project setting (clearer on mobile).
