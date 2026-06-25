---
"@fusion/core": patch
"@fusion/engine": patch
---

Fix file-scope overlap classification so forbidden/non-goal prompt sections remain excluded from scheduler leases, and keep `.github/workflows/**` paths lease-significant for true CI workflow conflicts.
