# VoiceStrike BUILD 7 v0.8.11 CLEAN — Rebuild Notes

- Built directly over v0.8.10 after Windows E1 stress testing showed that a direct solicited reply (`B184`) was rejected as `WAKE_REQUIRED` if the ordinary 15 s wake window expired while VoiceStrike was asking/waiting for clarification.
- Added a one-shot, 30 s, command-bound solicited clarification window opened only after a non-interrupted agent reply when the current command is `COLLECTING`.
- Clarification-like worker replies may continue the same command without repeating `VoiceStrike`; unrelated ambient/TV speech is rejected and does not consume the window.
- The accepted clarification receives conversational authority for read-tool continuity. Protected `reverse scan` / `confirm reverse scan` speech is unchanged: CriticalSpeechTrustGate still runs first and still requires explicit `VoiceStrike`.
- Read-tool pre-call refusal wording is grounded: no fabricated tool failure/unavailability and no request for system-known job/station identifiers.
- No changes to TurnAuthority mutation semantics, SafeActionExecutor, recovery, server mutation endpoints, or Worker/Supervisor persistence.
- Internal v0.8.11 validation: **171/171 structural PASS**, **211/211 reliability core PASS**; voice module transpile probe PASS. Full production build remains the Windows launcher gate.
- Windows runtime acceptance is R19 in `evidence/build7/BUILD7_TEST_PLAN.md`.

# VoiceStrike BUILD 7 v0.8.10 CLEAN — Rebuild Notes

- Built directly over v0.8.9 after Windows runtime revealed that Worker → Supervisor navigation unmounted `WorkerView` and therefore disconnected the live `VoiceAgentClient`.
- Fix is UI-lifecycle only: after dashboard state loads, Worker and Supervisor view trees stay mounted; the inactive view uses the native `hidden` attribute.
- The same `VoicePanel` instance, AssemblyAI sessionId, transcript and in-memory reliability authority therefore survive dashboard inspection.
- No changes to TurnAuthority, CommandRegistry, speech gates, read/mutation gates, SafeActionExecutor, recovery or server mutation logic.
- Structural regression gates assert persistent mounting and exactly one VoicePanel owner.
- Historical v0.8.10 validation: **162/162 structural PASS**, **200/200 reliability core PASS**; Worker/Supervisor persistence runtime PASS.
- Windows runtime acceptance is R18 in `evidence/build7/BUILD7_TEST_PLAN.md`.

# VoiceStrike BUILD 7 v0.8.9 CLEAN — Rebuild Notes

- Built directly over v0.8.8 after R16-A passed end-to-end on Windows.
- Stress testing found a sequential-workflow lifecycle bug: after completed recovery, a later `WRONG_COMPONENT` utterance could be merged into the still-active `REVERSE_SCAN` command. The subsequent B184 then became a new component-only command and remained `COLLECTING`.
- Root cause fixed in `CommandRegistry.shouldMergeClarification()`: READY-command continuation is now allow-listed only for the recovery progression `SCAN_CONTEXT -> MISTAKEN_SCAN -> REVERSE_SCAN -> REVERSE_SCAN(confirm)`.
- Unrelated later intents start a fresh commandId; the existing read-tool readiness gate is unchanged and was not weakened.
- Added deterministic regression reproducing the exact sequence: successful recovery command chain -> new wrong-component report -> B184.
- Internal v0.8.9 validation: **159/159 structural PASS**, **200/200 reliability core PASS**; changed reliability module TypeScript compile PASS. Full production build remains the Windows launcher gate.

# VoiceStrike BUILD 7 v0.8.8 CLEAN — Rebuild Notes

- Root cause of the final-confirmation failure proven in code: `voiceAgent.ts` gated every `tool.call` on the mutable session flag `lastInputAuthorised`, which the three rejected-speech branches (duplex/echo, untrusted critical speech, ambient/wake) reset to `false`. A rejected transcript arriving between the accepted `VoiceStrike, confirm reverse scan B184` turn and the delayed `tool.call` therefore revoked the confirmation (`AMBIENT_SPEECH_IGNORED`, "latest speech was not wake-authorised"). The suspected diagnosis in the build prompt was correct.
- Secondary defects fixed at the same time: `lastFinalTurnId` and the `X-VoiceStrike-Wake-Authority` header were also read from live state at tool-call time (turn-id drift from rejected transcripts; 15 s wake-window expiry could reject a legitimate delayed call), and `CommandRegistry` re-bound tool calls from an interrupted reply to the *new* corrected command instead of refusing them as stale.
- New `client/src/reliability/authority.ts`: immutable `TurnAuthority {sessionId, turnId, commandId, transcript, wakeAuthorised, criticalSpeechTrusted, criticalKind, intent, componentId, createdAt, expiresAt}` granted once per ACCEPTED turn. No revoke API exists; it becomes unusable only via command invalidation, session reset, TTL (60 s) or mutation consumption. One accepted turn authorises at most one attempt per mutation tool.
- `tool.call` now resolves that authority (command + session + current + trust) and derives turn id, transcript, wake header and prepared-confirmation input from it, not from live session state.
- Tool calls stay bound to the command that owned their reply; after correction/barge-in/supersede they are refused as `STALE_COMMAND` rather than transferred.
- Worker UI: tool events are `BLOCKED` (amber) for any non-verified outcome; green `COMPLETED` only for verified mutations or successful reads.
- Automated suite extended: mandatory delayed-`tool.call` regression (A1), inverse cases wrong commandId / wrong component / stale / reconnect / cancelled / no wake (A2–A8), authority-object properties (A9), and §36 metrics M1–M5 printed and asserted.
- Internal v0.8.8 validation: **158/158 structural PASS**, **195/195 reliability core PASS**, **full `npm run build` PASS** (server tsc + client tsc -b + vite), historical validators unchanged versus v0.8.7.

# VoiceStrike BUILD 7 v0.8.7 CLEAN — Rebuild Notes

- Clean incremental rebuild from v0.8.6 CLEAN.
- Restores natural AssemblyAI adaptive/neural endpointing by removing explicit fixed `min_silence` / `max_silence` overrides.
- Keeps `vad_threshold: 0.6`, browser echo cancellation, Duplex/Echo Guard, fresh-VAD critical gate and post-TTS quiet-gap protection.
- Makes recovery inspection authority explicit and command-bound: `commandId + actionId + componentId + observedAt`.
- Successful `inspect_last_action` stores command binding in server audit.
- Missing browser recovery context can be restored only from a real recent matching server audit record; the recovery-context endpoint is read-only and cannot invent or perform an inspection.
- No matching authoritative inspection => protected reverse preparation remains blocked with `RECOVERY_CONTEXT_REQUIRED`.
- Existing entity confirmation continuity and truthful tool reporting from v0.8.6 remain intact.
- Internal v0.8.7 validation: **141/141 structural PASS**, **131/131 reliability core PASS**, client voice/reliability strict TypeScript **PASS**, server transpile/syntax probe **PASS**.

# VoiceStrike BUILD 7 v0.8.6 CLEAN — Rebuild Notes

- Clean incremental rebuild from v0.8.5 CLEAN; no v0.8.3–v0.8.5 investigation or TV/self-echo retest is required before the new build exists.
- Adds explicit `entity_confirmation` continuity for fragmented reconstructed technical IDs.
- `I scanned → B1 → 84 → B184` remains on one `commandId`; the reconstructed B184 stays `COLLECTING` until the complete ID is repeated.
- `inspect_last_action` remains blocked until the entity confirmation makes the command `READY`.
- A different repeated ID supersedes the reconstructed candidate instead of being merged with it.
- Tool-result reporting is grounded in the real pipeline: pre-call gate outcomes are not exposed as `TOOL_FAILED`; only an actual returned failed operational tool call may carry `TOOL_FAILED`.
- Existing v0.8.5 critical-speech, wake, duplex/echo, reversal-confirmation, and post-mutation verification protections are preserved.
- Internal v0.8.6 validation: **135/135 structural PASS**, **126/126 reliability core PASS**, changed-module strict TypeScript **PASS**.

# VoiceStrike BUILD 7 v0.8.4 CLEAN — Rebuild Notes

- Rebuilt as an integrated source tree from v0.8.3 CLEAN; no external patch chain is required.
- Adds `DuplexEchoGuard` for TTS/self-echo authority suppression based on actual speech-start timing.
- Shortens the wake clarification window to 15 seconds.
- Adds a deterministic two-turn `CriticalConfirmationGate` for scan reversal.
- First protected phrase (`VoiceStrike, reverse scan B184`) prepares only; second separate turn (`VoiceStrike, confirm reverse scan B184`) is required for mutation.
- Second confirmation is bound to the same command, exact inspected action/component, different turn, and a 20-second TTL.
- Server independently checks prepared-authority headers and the second-stage phrase before reversal.
- Existing mutation → independent authoritative verification contract remains unchanged.
- Internal structural validation: **108/108 PASS**.
- Reliability core/authority tests: **99/99 PASS**.
- Client voice/reliability strict TypeScript compile: **PASS**.
- TS/TSX/MTS syntax probe: **28 files, 0 errors**.
- Full installed production build remains a Windows gate.

# VoiceStrike BUILD 7 v0.8.3 CLEAN — Rebuild Notes

- Rebuilt from v0.8.2 clean source; no external patch chain required.
- Adds wake phrase / ambient speech gate, stronger microphone constraints, local RMS noise gate, 8-4 STT continuation, and bidirectional clarification context retention.
- Critical reversal confirmation now requires the latest worker turn to include VoiceStrike + reverse + scan + exact component.

# VoiceStrike BUILD 7 v0.8.2 — Clean Rebuild Notes

This package supersedes BUILD 7 v0.8.1 after runtime STT continuation validation.

Baseline: BUILD 6 v0.7 + final BUILD 6 independent-verification fix.

Integrated directly into the main source tree:

- BUILD 7 Reliability implementation;
- production-safe TypeScript config;
- ESM-safe `.mts` reliability test runner;
- Transcript Sanity Gate;
- critical technical-ID resolver;
- short-utterance ambiguity protection;
- stale-command and cancellation protection;
- verified mutation executor;
- failure injection and recovery-first reconnect;
- read-tool readiness gate: operational reads cannot run while a command is `COLLECTING`;
- compact fragmented-ID handling: `B1` remains incomplete, while `B1` + `eight four` resolves to `B184`;
- controlled 30-case corpus and regression assertions.

Internal clean-rebuild evidence:

- BUILD 7 structural validation: 76/76 PASS
- Reliability core/authority tests: 61/61 PASS
- Client reliability TypeScript typecheck: PASS
- TS/TSX/MTS syntax/transpile check: 24 files, 0 syntax errors

Windows production build and voice-runtime validation remain required before BUILD 7 can be CLOSED/PASS.

## v0.8.2 runtime finding
- AssemblyAI may finalize spoken "eight four" as `84`.
- Numeric-only continuation is accepted only when a command is already COLLECTING an incomplete technical ID.
- `B1 + 84` and `B one + 84` resolve to `B184`; standalone numeric speech does not gain authority.


## v0.8.5 clean hardening

This clean build incorporates the v0.8.4 Windows false-critical-transcript finding directly into the source tree. It adds a Critical Speech Trust Gate before command acceptance, binds first-stage reversal speech to a recent authoritative `inspect_last_action` result, binds second-stage confirmation to the prepared exact component, removes complete mutation phrases from AssemblyAI keyterms, suppresses rejected critical reply audio/transcripts, and adds a local Reliability DEV panel.

Permanent rule: **False transcript may happen. False mutation must not.**


## v0.8.11
- Added command-bound, one-shot 30 s solicited clarification response window after agent `reply.done` for COLLECTING commands.
- Direct clarification replies (for example `B184`) receive conversational authority without repeating `VoiceStrike`; unrelated TV/background speech is still rejected.
- Protected critical reversal speech is unchanged and still requires explicit wake phrase + CriticalSpeechTrustGate.
- Grounded blocked-read wording: no fabricated tool failure and no request for system-known job/station identifiers.
- Added deterministic E1/wake-expiry regression coverage.
