# VS-001 Fix Evidence

Date: 22/09/2026  
Branch: `fix/VS-001-spoken-result-authority`  
Baseline: `750e5897d1eff9b601b2e41b6db49e0940d13e2b` (`baseline-original`)  
Failing regression commit: `4a63a1d` (`test: reproduce VS-001 spoken result contradiction`)

## Defect

`VS-001` — a fresh E3 CONFIRM could complete exactly one reversal mutation and independently verify `VERIFIED_SUCCESS`, while the provider narration still said `I apologize, but I could not complete the reversal.` The false narration was also released as audio.

## Structural repair

The application-code change is restricted to:

- `client/src/reliability/replyClaims.ts`
- `client/src/voice/voiceAgent.ts`

A command-bound E3 CONFIRM speech authority now moves from `PENDING` to the final deterministic `ReliabilityOutcome`. The reply claim gate is bidirectional:

- before a final CONFIRM outcome, failure narration is rejected;
- after `VERIFIED_SUCCESS`, contradictory failure narration is rejected;
- after a non-success final outcome, success narration remains forbidden;
- the fallback transcript is outcome-aware and does not say `could not verify` when authoritative verification actually succeeded.

No E1/E2 workflow code, confirmation semantics, protected speech windows, SafeActionExecutor, server route, or database code was changed.

## Test-first evidence

Before application code was changed, the permanent `VS-001` regression was added and executed. It produced:

- PREPARE: PASS
- authoritative CONFIRM = `VERIFIED_SUCCESS`: PASS
- provider `reverse_last_scan` joins code-owned action, total mutation count = 1: PASS
- false failure narration rejected: FAIL
- false failure audio withheld: FAIL

See `../VS-001_BEFORE_FIX.txt`.

## Post-fix gates executed in this environment

| Gate | Result |
|---|---|
| `VS-001` end-to-end harness | PASS — 6/6 |
| BUILD 7 structural validation | PASS — 246/246 |
| Reliability core | PASS — 410/410 |
| Command-context acceptance | PASS — 1068/1068 |
| Reply lifecycle | PASS — 35/35 |
| Claim gate | PASS — 26/26 |
| Live-session deterministic regression | PASS — 26/26 |
| Production build | NOT TESTED — repository contains no installed dependencies; build stops on missing package/type modules before product compilation can be evaluated |
| Express/SQLite event-pipeline integration | NOT TESTED — `express` is not installed, so the harness cannot start |
| Real AssemblyAI runtime/audio | NOT TESTED |
| GitHub-hosted CI run | NOT TESTED |
| GitHub branch protection / required-check enforcement | NOT IMPLEMENTED — this local repository has no configured remote |
| Merge to `main` | NOT IMPLEMENTED |

The environment cannot resolve `registry.npmjs.org`, and the uploaded candidate contains no dependency lockfile or `node_modules`. Therefore build/integration are not promoted to PASS from historical evidence.

## CI

`.github/workflows/ci.yml` now defines a required-gates job for pull requests and pushes to `main`:

1. install repository/workspace dependencies;
2. run the candidate's full v0.10.0 validation suite, including permanent `VS-001` regression;
3. run the production build.

`package.json` exposes `ci:required` for the same gate. The workflow file exists locally, but actual merge blocking requires a GitHub remote plus branch protection/ruleset requiring the workflow check.

## Decision

`VS-001` application fix: PASS under executable local deterministic gates.  
Full branch acceptance: NOT TESTED, because production build, event-pipeline integration, and real AssemblyAI runtime proof are still outstanding.  
`main` must remain at `baseline-original` until those gates are completed.
