---
"@fusion/core": patch
"@fusion/engine": patch
---

summary: Fix false file-scope overlap blocks from forbidden prompt sections.
category: fix
dev: Keeps forbidden/non-goal prompt sections out of effective write-scope leases while preserving `.github/workflows/**` as lease-significant for true CI workflow conflicts.
