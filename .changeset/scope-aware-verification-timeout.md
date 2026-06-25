---
"@runfusion/fusion": patch
---

summary: Verification (merge/step gate) timeout now scales with command scope instead of a flat 10 minutes.
category: fix
dev: verification-utils runVerificationCommand derives its default from the command — package-scoped (pnpm --filter/-F) gets 300s, workspace-scoped gets 900s — matching fn_run_verification (DEFAULT_TIMEOUT_PACKAGE_SEC/WORKSPACE_SEC). Project verificationCommandTimeoutMs still overrides; the 1800s hard cap still applies. Fixes workspace-scoped suites being killed as a 10-min infra timeout during merge/step verification.
