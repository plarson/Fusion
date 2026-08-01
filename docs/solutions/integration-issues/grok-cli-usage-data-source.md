---
category: integration-issues
module: packages/dashboard/src/usage.ts
tags: [grok, usage, billing, redacted-capture, source-provenance]
problem_type: upstream-provenance-mismatch
applies_when: investigating a third-party CLI usage display whose installed release cannot be mapped to inspectable source
---

# Do not derive Grok usage from an unproven CLI source

## Symptom

Fusion's Grok card was authenticated but empty because `GET
https://cli-chat-proxy.grok.com/v1/billing?format=credits` did not provide
`config.creditUsagePercent`. The installed `grok` command documents `/usage`
(and alias `/cost`) as credit usage, but the request and arithmetic behind that
display were not available from the source trees named in the original
integration evidence.

## Evidence recorded on 2026-08-01

The local command resolves to a standalone `grok-0.2.118-macos-aarch64` Mach-O
binary. It was never executed or treated as source.

Two disposable, source-only retrievals were inspected without installing or
executing code:

1. `npm pack @vibe-kit/grok-cli@0.0.34` supplied package version `0.0.34`. Its
   source contains no `/usage`, `/cost`, billing, `creditUsagePercent`,
   `productUsage`, or `cli-chat-proxy` reference.
2. A read-only shallow clone of `https://github.com/superagent-ai/grok-cli.git`
   at `fb97af83f06dca873281d60168430f06c8de6324` identifies itself as
   `grok-dev@1.1.7`. It has no `/usage` or `/cost` slash-command handler and no
   Grok billing-endpoint or response-field reference. No upstream tag matching
   `0.2.118` was available during the inspection.

These are version-skewed from the installed binary and cannot establish its
request, response schema, or display formula. The original package/repository
references therefore do not currently supply auditable source provenance for
this installed CLI release.

## Redacted replay of Fusion's existing request

A disposable in-memory harness read the credential locally, made only Fusion's
existing request, parsed the response in memory, sanitized every key segment,
and self-deleted. It printed status `200` and only this allow-listed shape:

```text
config.currentPeriod.type: string=<redacted>
config.currentPeriod.start: string=<redacted>
config.currentPeriod.end: string=<redacted>
config.onDemandCap.val: number=<redacted>
config.onDemandUsed.val: number=<redacted>
config.<key1>: boolean=<redacted>
config.prepaidBalance.val: number=<redacted>
config.topUpMethod: string=<redacted>
config.billingPeriodStart: string=<redacted>
config.billingPeriodEnd: string=<redacted>
```

`config.creditUsagePercent` was absent. The generic `*.val` leaves remained
redacted because their names do not prove that they form credits, usage, limits,
or a valid used/total pair. No raw response body, string value, credential, or
dynamic account key was recorded.

## Verdict: BLOCKED — actual CLI request and meter derivation unconfirmed

This is not a conclusion that no meter exists. The authenticated replay proves
only that Fusion's current request does not expose the percentage it needs. It
does not prove which request the installed CLI issues, nor support a percentage
formula.

## Blocked pending operator capture

Before any implementation, obtain source provenance for the installed
`grok-0.2.118-macos-aarch64` release: the exact source archive or repository
commit that built it, plus its `/usage`/`/cost` handler. From that source,
record the exact method, URL, query parameters, non-secret headers, response
fields, and display arithmetic.

Then an operator must replay that **source-identified exact request** through a
harness equivalent to the one above: read the credential in-process; never
print it or a raw body; print only HTTP status, sanitized structural paths,
allow-listed meter numbers, and redacted non-meter values. Report the
source-read fields and every numeric input to the formatter. Do not use a CLI
screen, `curl`, or an unsanitized proxy capture as evidence.

## What FN-8668 should implement

Nothing yet. FN-8668 must remain blocked until the installed CLI's source and
harness-backed response identify meterable fields and an exact formula. In
particular, it must not infer a percentage from missing
`config.creditUsagePercent` or from the unclassified `*.val` fields.
