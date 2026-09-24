# VS-002 — CRLF-sensitive BUILD 7 validator

Status: PASS (deterministic regression)

## Symptom
On a Windows checkout with `core.autocrlf=true`, `scripts/validate-build7.mjs` reported 244/246 even though the relevant runtime source statements were present.

## Root cause
The structural validator used multiline `String.includes()` needles containing LF (`\n`) while `readFileSync(..., 'utf8')` preserved CRLF (`\r\n`) from the Windows checkout. Two multiline assertions therefore failed only because of line endings.

## Test-first reproduction
`scripts/test-validator-crlf.mjs` copies the repository, converts `client/src/voice/voiceAgent.ts` to CRLF without changing content, and runs the BUILD 7 validator. Before the fix it exits non-zero with the same two failed assertions.

## Minimal fix
Normalize CRLF to LF in the validator's central `read()` helper before structural checks. Runtime/application files are untouched.

## Evidence
- `VS-002_BEFORE_FIX.txt`: FAIL, BUILD 7 244/246.
- `VS-002_AFTER_FIX.txt`: PASS under an equivalent CRLF checkout.
- Direct BUILD 7 validation after fix: 246/246 PASS.
