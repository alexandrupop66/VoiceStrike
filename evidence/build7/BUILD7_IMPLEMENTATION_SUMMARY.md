# BUILD 7 — Implementation Summary

Version: 0.8.10
Status: BUILD 7 v0.8.10 CLEAN — internal structural/core gates PASS; Windows production build + R18 view-persistence regression plus remaining runtime/audio evidence required before CLOSED

## Implemented reliability layers

- Critical technical-ID normalisation and correction handling.
- Transcript Sanity Gate, including short ambiguous approvals, unexpected-script drift, and non-operational Latin drift for mutation authority.
- VoiceStrike wake phrase and Ambient Speech Gate. Before wake, speech is not operational authority; unrelated TV/background replies and tool calls are suppressed.
- 15-second wake/clarification window; only accepted operational/clarification speech extends it.
- Microphone hardening: echo cancellation + noise suppression, AGC disabled, optional `voiceIsolation`, VAD threshold 0.6, and a conservative local RMS noise gate.
- Pending-command state with COLLECTING / READY / INVALIDATED.
- Technical-ID continuation handles spoken/compact/punctuated STT variants including `B1 + 84` and `B1 + 8-4` → `B184`.
- Bidirectional clarification retention: intent → entity and entity → intent.
- Stale-command rejection for interruptions and corrections.
- Central pre-mutation gates for incomplete commands, explicit cancellation, ambiguous critical IDs, transcript/tool-ID mismatch, and wake authority.
- Common Safe Action Executor: AUTHORISE → MUTATE → independent authoritative VERIFY.
- Mutation success cannot self-declare verification.
- No blind mutation retry after unknown/post-mutation failure.
- Critical Speech Trust Gate rejects false protected commands before pending-command acceptance using wake + fresh VAD + post-TTS quiet + recovery/prepared context.
- Dangerous full mutation phrases are excluded from AssemblyAI keyterms; technical IDs/wake terms remain.
- Local Reliability DEV panel exposes rejection reason/trust score separately from audit.
- Recovery reversal uses deterministic two-turn authority: `VoiceStrike, reverse scan <exact component>` prepares only, then a separate turn `VoiceStrike, confirm reverse scan <exact component>` is required to mutate.
- Failure injection, including REVERSE_AFTER_MUTATION and verification failures.
- Recovery-first reconnect with mutation blocking until authoritative state refresh.
- Separate reliability telemetry and operational audit.
- Latency-stage telemetry: speech end, final transcript, tool call/result, verification, response start.
- Keyterms A/B switch via `/?keyterms=off`.
- Ambient-speaker identity limitation documented explicitly.
- v0.8.8: immutable turn-bound `TurnAuthority`; delayed tool calls keep the authority of the accepted turn; rejected later speech cannot revoke it; authority never transfers to another command/session; one mutation attempt per turn per tool.
- v0.8.9: READY commands no longer absorb unrelated later intents; sequential workflows in one long-lived Worker session get isolated commandIds while the recovery progression retains continuity.
- v0.8.10: Worker/Supervisor navigation preserves the mounted VoicePanel and live VoiceAgentClient session; navigation no longer causes a disconnect/reconnect or transcript reset.

## Automated validation completed in build environment

- Structural validator: **PASS (158/158)**.
- Reliability core + authority tests: **PASS (195/195)**, metrics M2/M3/M4/M5 asserted at 100%/0%/0%/100%.
- Full production build (`npm run build`: server tsc, client tsc -b + vite): **PASS** with installed dependencies.

## Runtime findings incorporated

- v0.8.1: production TypeScript config + ESM-safe runner + read-tool readiness + compact fragmented ID.
- v0.8.2: numeric STT continuation (`84`) after an incomplete technical ID.
- v0.8.3: punctuated continuation (`8-4`), bidirectional clarification retention, and ambient-TV protection.
- v0.8.4: duplex/self-echo suppression plus two-turn reversal confirmation bound to command/action/entity/turn.
- v0.8.5: false-critical-transcript suppression before command authority; prepared-context binding; safe keyterms; DEV trust observability.
- v0.8.6: same-command entity confirmation continuity for fragmented IDs; truthful tool-result semantics so pre-call gate refusals cannot masquerade as TOOL_FAILED.
- v0.8.7: adaptive endpointing; command-bound recovery inspection authority.
- v0.8.8: final protected confirmation was revoked by later rejected speech (mutable `lastInputAuthorised`); replaced by immutable turn-bound authority.

## Still required before BUILD 7 can be CLOSED

- Safe Launcher/new-build gate on Windows: dependency install (when needed) + full `npm run build`. If npm explicitly blocks a required package install script, resolve that npm prompt before continuing; do not disable antivirus or ExecutionPolicy.
- `npm run validate:build7` → 158/158.
- `npm run test:reliability-core` → 195/195.
- End-to-end runtime regression of BUILD 3 / 5 / 6.
- Real microphone accent/noise/ambient tests, including TV on in the room.
- Confirm wake flow: `VoiceStrike, I scanned…` → `B1` → `8-4` → `It was a mistake` retains B184 and reaches inspection.
- Prepare protected recovery: `VoiceStrike, reverse scan B184`; then separately confirm: `VoiceStrike, confirm reverse scan B184`.
- Failure-injection runtime tests.
- Connection-loss/reconnect test.
- Keyterms A/B evidence capture.

Do not mark BUILD 7 CLOSED until the Windows/runtime gates pass.
