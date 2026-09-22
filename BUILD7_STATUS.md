## v0.10.0 RC5 — Code-owned Protected Actions + Sentence Claim Gate

Status: **AUTOMATED PASS — LIVE WINDOWS/MICROPHONE/TV ACCEPTANCE PENDING**

Built on the RC4 Lifecycle Ledger. Closes the three live problems left open by RC4: spoken-ID contamination in the E2 claim gate (plus a spelled-location false negative), E3 CONFIRM depending on the LLM emitting `reverse_last_scan`, and whole-reply PCM buffering. Safety gates unchanged. Evidence: `evidence/build7/v0.10.0_RC5_CODE_OWNED_ACTIONS_AND_STREAMING_GATE.md`; runtime plan: `evidence/build7/v0.10.0_RC5_RUNTIME_ACCEPTANCE_PLAN.md`.

Automated RC5 gates: **245/245 structural**, **410/410 reliability core**, **1,068/1,068 command-context**, **26/26 live regression**, **35/35 lifecycle**, **22/22 claims**, **54/54 event pipeline**, production build PASS.

## v0.10.0 RC4 — Runtime Lifecycle Ledger

Status: **AUTOMATED PASS — LIVE WINDOWS/MICROPHONE/TV ACCEPTANCE PENDING**

RC4 fixes the live orchestration defects (E3 `CRITICAL_SPEECH_NOT_TRUSTED`/`COMMAND_MISMATCH` loops, orphaned tool continuations, stranded tool results) by serializing provider event processing, replacing RC2/RC3 ownership heuristics with an explicit reply-causality ledger, and following AssemblyAI's documented tool-result handoff rule. No safety gate was changed. A new harness drives the real VoiceAgentClient against the real API: RC3 fails it with the live symptoms, RC4 passes 27/27.

Automated RC4 gates: **236/236 structural**, **410/410 reliability core**, **1,068/1,068 command-context**, **26/26 live regression**, **23/23 lifecycle ledger**, **27/27 event pipeline**, production build PASS. Runtime plan: `evidence/build7/v0.10.0_RC4_RUNTIME_ACCEPTANCE_PLAN.md`.

## v0.10.0 Command Context Closure RC3 — Runtime Ownership & Latency

Status: **AUTOMATED PASS — LIVE WINDOWS/MICROPHONE ACCEPTANCE PENDING**

RC3 addresses the second live-session evidence from 20/09/2026. The remaining fault was not E1/E2 business logic: delayed provider tool calls could arrive after `reply.done`, after `openTurn` had already been closed. The tool could still execute against the old command, but its `tool.result` continuation no longer had a causal owner, producing repeated `COMMAND_MISMATCH`, orphan/late continuations, false-failure speech, and long apparent response delays. RC3 rehydrates the exact delayed-tool owner before execution, gives protected E3 leases precedence over stale generic reply bindings, and treats every accepted worker turn as a hard reply-causality boundary.

All nine operational tools now use AssemblyAI `execution_mode: hold`, removing intermediate transition replies while tools are executing and reducing provider reply/tool interleaving. Worker speech sensitivity is restored from `vad_threshold: 0.6` to `0.45`; deterministic ambient/wake, duplex, critical-speech and mutation gates remain unchanged. The command-scoped hard claim gate is preserved.

Automated RC3 gates: **230/230 structural**, **1,068/1,068 command-context**, **410/410 reliability core**, **26/26 exact live regression**. Unsafe Mutation Rate **0%**; False Success Rate **0%** in deterministic Layer A. Windows/microphone/AssemblyAI re-test remains the final closure gate.

## v0.10.0 Command Context Closure RC2 — Live-Evidence Fix

Version: **0.10.0**

RC2 addresses the exact failures captured in the first v0.10.0 Windows session: connection-greeting ownership race, residual transcript semantic authority in the server mutation guard, provider-dependent E2 chaining, and unsupported alternative-inventory speech. Fresh speech now interrupts reply binding without transferring stale authority; mutation requests carry typed workflow/readiness; complete E2 reports continue deterministically in code; and E1/E2/E3 operational PCM is buffered until command-scoped evidence authorises the final claims.

Automated RC2 gates: **230/230 structural**, **1,068/1,068 command-context**, **410/410 reliability core**, **19/19 exact live regression**. Unsafe Mutation Rate **0%**; False Success Rate **0%**. Windows/microphone/AssemblyAI re-test remains the final closure gate.

## v0.10.0 Command Context Refactor — Release Candidate

Version: **0.10.0**

BUILD 7 now uses explicit command-scoped workflow context as the operational source of truth. Transcript remains interpretation evidence only. E1/E2/E3 own distinct command IDs; typed clarifications stay within their workflow; unrelated intents create fresh commands. Existing E3 protected-action safety, ambient/wake rejection, independent verification, Worker/Supervisor persistence, and transcript Copy/Export remain preserved.

Automated RC gate: **1,059/1,059 PASS**. BUILD 7 structural regression validator: **222/222 PASS**. Live Windows/audio acceptance remains the final closure gate.

## v0.9.5 Final E2 Command Continuity + Evidence Fix

Status: **BUILD 7 IMPLEMENTATION: FINAL RUNTIME CANDIDATE — runtime acceptance pending**

v0.9.5 preserves the v0.9.4 typed E2 resolver and fixes the long-session lifecycle failure observed on Windows: a bare wake phrase no longer creates a fresh command, and subsequent E2 clarifications stay on the same commandId even after the command is READY. This prevents delayed provider tool calls from colliding with newly-created E2 commands. The model prompt is also constrained not to ask redundant yes/no confirmation once B148/C12/EMPTY are already explicit; if the authoritative stock check is stale, it must refresh `check_inventory` under the same command. Evidence capture is hardened with 500 transcript entries, 100 tool entries, 200 reliability events, Copy transcript, and Export transcript JSON. E1/E3 safety and protected recovery code paths are otherwise unchanged.

Version: **0.9.5**

# VoiceStrike BUILD 7 — Reliability

## v0.9.4 Final E2 Typed-Entity Fix

Live v0.9.3 runtime acceptance passed E1 Wrong Component and E3 Mistaken Scan/Recovery, including the required `Inspect → Reverse → Inspect` verified path. E2 Missing Inventory exposed one remaining P0 blocker: the generic technical-ID resolver treated `B148` and `C12` as two candidates of the same lexical kind and emitted `entity_ambiguous B148, C12`; clarification then split into a new commandId and the old discrepancy tool call failed safely with `COMMAND_MISMATCH`.

v0.9.4 introduces a narrow typed E2 resolver. It resolves component and location by semantic role, requires explicit EMPTY evidence, keeps incomplete E2 commands `COLLECTING`, and preserves the same commandId across typed clarification. Mutation authority is not weakened: the workflow and server still require a recent positive `check_inventory` for the exact current-job component/location before `report_inventory_discrepancy` may reach the endpoint, and post-mutation verification remains mandatory. E1/E3 code paths are otherwise unchanged.


Status: **BUILD 7 IMPLEMENTATION: FINAL CANDIDATE — BUILD 7 RUNTIME ACCEPTANCE: PENDING**  
Version: **0.9.4**

BUILD 7 is **not** CLOSED. Implementation of the reliability work is complete and every
automated gate passes; real Windows, microphone, accent, TV/noise and timing acceptance
(R16–R29) is still owned by the human team.



## v0.9.3 Protected Reply-Lifecycle / Deferred Confirmation TTL Fix

Live v0.9.2 telemetry proved that the new ProtectedSpeechWindow correctly accepted
`REVERSE_PREPARE`, but AssemblyAI can order later events as `reply.done -> reply.started ->
delayed tool.call`. `ReplyAuthorityRegistry.finishReply()` closed the accepted turn at the first
reply boundary because no tool work had been observed yet. The next reply was therefore suppressed
as `NO_ACCEPTED_TURN`; only afterwards did `reverse_last_scan` arrive and create PREPARED state.
The REVERSE_CONFIRM window remained `AWAITING_PROMPT_DONE`, so the confirmation prompt could not
open it. The old 20 s confirmation TTL also started at PREPARED time and could expire while the
provider was still trying to deliver the prompt. Safety held throughout: endpoint mutation was not
performed without trusted confirmation.

v0.9.3 adds a narrow protected tool-call lease in `reliability/replyAuthority.ts`. An already
accepted REVERSE_PREPARE or REVERSE_CONFIRM turn may preserve its causal turn identity across the
observed provider boundary until the exact `reverse_last_scan` tool request arrives. While held,
intervening replies remain ORPHAN and inaudible; rejected TV/ambient speech cannot create, claim,
or consume the lease. The tool result then authorises exactly one `TOOL_CONTINUATION` reply.
Cancellation, expiry, reset, a new accepted turn, or lease timeout terminate the held identity.
TurnAuthority remains the actual operational authority.

The confirmation clock is also corrected: PREPARED no longer consumes the worker's 20 s budget.
The gate starts that TTL only after the authorised confirmation prompt has completed estimated
audible PCM playback, the 550 ms protected quiet gap has elapsed, and REVERSE_CONFIRM actually
becomes possible. A separate 30 s provider-prompt deadline prevents an undeliverable prompt from
leaving PREPARED state indefinitely.

Automated evidence: structural **203/203 PASS**; deterministic reliability core **387/387 PASS**.
The new integrated R-F5 regression reproduces the exact live ordering through PREPARE, suppressed
intervening provider reply, delayed tool.call, confirmation-prompt continuation, opened
REVERSE_CONFIRM window, and accepted delayed confirmation. Production build and real microphone /
AssemblyAI timing remain Windows acceptance gates before BUILD 7 can be CLOSED.


## v0.9.2 Protected Speech Timing / Audible-TTS Boundary Fix

Live Windows testing of v0.9.1 proved cancellation safety and fresh inspection, but exposed a
remaining timing race in protected recovery speech. The browser could successfully inspect B184
and instruct the worker to say `VoiceStrike, reverse scan B184`, yet reject that exact legitimate
phrase as `CRITICAL_SPEECH_NOT_TRUSTED`. The old trust gate measured a fixed 1.5 s quiet period
from provider `reply.done`; this clock is neither the same as actual local PCM playback completion
nor a command-specific expectation. Natural workers could answer inside the fixed gap, while queued
TTS/TV timing could overwrite the single global speech-start holder. Safety held (endpoint not
called, mutation 0), but the recovery conversation could stall.

v0.9.2 adds `reliability/protectedSpeech.ts`: an explicit command/action/component-bound
`ProtectedSpeechWindowRegistry`. A verified recovery inspection arms `REVERSE_PREPARE`; a
prepared reversal arms `REVERSE_CONFIRM`. The matching post-tool continuation opens the window
only after estimated *audible* AudioContext playback completion plus a 550 ms quiet gap. Rejected
TV/ambient/echo speech cannot consume the window; only a fully accepted protected worker turn can.
The legacy 1.5 s trust rule remains as a fallback outside a valid protected window, so no general
critical-speech gate was weakened. Cancellation, expiry, session reset, ineligible inspection and
verified reversal clear the window.

Provider `reply.done` is also translated to an estimated audible completion timestamp using the
queued PCM horizon, closing the provider-clock/browser-audio-clock gap for critical echo handling.
Expiry wording now explicitly requires restarting with a fresh mistaken-scan report/inspection; it
no longer instructs the worker to say `reverse scan` before fresh authority exists.

Automated evidence for this package: structural **194/194 PASS**; deterministic reliability core
**361/361 PASS**; changed TypeScript reliability/voice files typecheck PASS. Full production build
and real microphone/TV timing acceptance remain Windows gates before BUILD 7 can be CLOSED.


## v0.9.1 Final Runtime Blocker Fix

Live Windows acceptance of v0.9.0 confirmed that wake handling, read-only bootstrap and tool
execution worked, but exposed a reply-causality boundary: `get_current_job` completed with
`attempted=true`, then the provider's result reply was suppressed as `NO_ACCEPTED_TURN`. The
accepted turn was being closed after `tool.result` handoff and before the post-tool reply began.

v0.9.1 adds an explicit `TOOL_CONTINUATION` lifecycle. Tool-result handoff keeps the accepted
turn alive; the provider's next reply is bound to the same `turnId + commandId`; the turn closes
only after that continuation finishes. Rejected ambient speech still cannot create or revoke reply
authority.

The previously identified tombstone edge case is also closed: terminal protected-action
tombstones are scoped to the exact command. Old CANCELLED/EXPIRED/CONSUMED confirmations remain
refusable, while a fresh authoritative inspection can create a fresh command and prepare the same
action. A stale `confirm reverse ...` phrase cannot itself bootstrap that fresh command.

Automated evidence for the changed reliability layer: structural **187/187 PASS**; deterministic
reliability core **352/352 PASS**. Full `npm run build` and live AssemblyAI runtime acceptance are
still required on Windows before BUILD 7 may be CLOSED.

## v0.9.0 Final Reliability Consolidation

v0.9.0 is not a set of micro-patches. The eight runtime-confirmed defects of v0.8.11 were traced
to two architectural causes — no single owner of the conversation lifecycle, and authority to act
and to claim not being derived from evidence — and resolved structurally:

- **SessionEpoch** (`reliability/session.ts`) — one generation for the whole conversation
  lifecycle. A full demo reset clears every browser-side holder and drops stale-epoch async
  events, without disconnecting the live voice session.
- **WorkflowPolicy** (`reliability/workflow.ts`) — deterministic E1/E2 mutation sequencing
  enforced in code before any endpoint call. An out-of-order request is `PRECONDITION_REQUIRED`:
  no endpoint call, no consumed mutation opportunity, prerequisite named.
- **ClaimEvidence / claim grounding** (`reliability/claims.ts`) — an append-only stage list per
  tool call and one derivation of what may be said. `claim_grounding` travels with every tool
  result. A failure claim needs an attempted call that returned failure; a state-change claim
  needs independent authoritative verification.
- **Tool classification** (`reliability/toolPolicy.ts`) — `CONTEXT_READ` / `ENTITY_READ` /
  `AUTHORITATIVE_READ` / `MUTATION`. Read-only context tools may bootstrap an accepted turn;
  mutation gates are unchanged; read bootstrap grants no mutation authority.
- **Reply causality** (`reliability/replyAuthority.ts`) — each reply is immutably bound to the
  accepted turn that caused it. A reply from rejected speech is an orphan: never audible, never
  an authoritative turn, no self-reply cascade.
- **Protected action lifecycle** (`reliability/confirmation.ts` + `reliability/cancellation.ts`)
  — `PREPARED → CONSUMED | CANCELLED | EXPIRED` with tombstones and a deterministic sweep.
  Cancellation and expiry share one invalidation mechanism and both close the owning command.
- **Unambiguous telemetry** — `tool_requested / tool_authorisation_checked / tool_blocked_local /
  tool_attempted / tool_result`, full correlation identifiers, 100-event DEV history, Copy
  diagnostics JSON, and `GET /api/reliability/metrics` derived from recorded events only.

Automated evidence: structural **187/187**, reliability core **341/341**, production build
**PASS**. See `evidence/build7/v0.9.0_ROOT_CAUSE_AND_CONSOLIDATION.md`,
`v0.9.0_AUTOMATED_RESULTS.md` and `v0.9.0_RUNTIME_ACCEPTANCE_PLAN.md`.



## v0.8.10 Persistent Worker voice session across Supervisor view

Runtime testing found that switching `Worker → Supervisor → Worker` unmounted `WorkerView`, which unmounted `VoicePanel`. Its cleanup correctly disconnected `VoiceAgentClient`, but the UI navigation therefore destroyed the live voice session, transcript and in-memory turn authority even though the user had only changed dashboard view.

v0.8.10 keeps both Worker and Supervisor view trees mounted after operational state loads and uses the standard `hidden` attribute only for presentation. `VoicePanel` therefore remains the same React instance while Supervisor is visible; no reconnect, new sessionId or transcript reset is caused by view switching. No changes were made to TurnAuthority, CommandRegistry, tool gates, SafeActionExecutor or server reliability logic.

Automated structural validation asserts persistent mounting and a single VoicePanel owner. Windows runtime R18 must confirm: active voice session → Worker → Supervisor → Worker → same sessionId, transcript preserved, no `connection_lost`, no new `Start VoiceStrike` prompt.

## v0.8.9 Sequential Workflow Isolation (E1 after recovery)

Windows stress testing after the successful v0.8.8 R16-A recovery exposed command-lifecycle contamination in a long-lived Worker voice session: a completed `REVERSE_SCAN` command could absorb a later unrelated `WRONG_COMPONENT` intent. The following `B184` then started as a component-only command and remained `COLLECTING`, so `get_current_job` / `check_component` were safely blocked before endpoint call.

Root cause: `CommandRegistry.shouldMergeClarification()` merged any later operational intent into any READY command that already contained a component.

Fix: READY-command merging is now allow-listed only for the intended recovery progression `SCAN_CONTEXT -> MISTAKEN_SCAN -> REVERSE_SCAN -> REVERSE_SCAN(confirm)`. Unrelated later intents start a fresh commandId. No readiness, mutation, wake, entity, verification, or tool-reporting gate was relaxed.

Automated v0.8.9 evidence: structural **159/159 PASS**, reliability core **200/200 PASS**. The exact long-lived-session sequence is now a deterministic regression. Windows runtime R17 remains required before this fix is accepted.


## v0.8.8 Turn-Bound Authority (final protected confirmation fix)

Root cause (proven in code, not assumed): every `tool.call` was gated on `lastInputAuthorised`, a single mutable session flag. All three rejected-speech branches in `transcript.user` (duplex/echo block, untrusted critical speech, ambient/wake refusal) set it to `false`. When any such transcript arrived between the accepted `VoiceStrike, confirm reverse scan B184` turn and the delayed `tool.call`, the confirmation was revoked and the mutation was blocked with `AMBIENT_SPEECH_IGNORED` — exactly the observed telemetry (`tool_call_attempted=false`, "latest speech was not wake-authorised"). The system failed safe, but the valid confirmation was lost.

Fix:

- `client/src/reliability/authority.ts` — immutable `TurnAuthority` granted once per accepted turn, bound to `sessionId + turnId + commandId + transcript + wakeAuthorised + criticalSpeechTrusted`. Rejected speech has no path to it. It expires with command invalidation, reconnect, a 60 s TTL, or after the mutation it authorised was attempted (single attempt per mutation tool per turn).
- `voiceAgent.ts` — `handleToolCall` resolves the authority for the tool's command; turn id, transcript, wake header and the two-step confirmation input all derive from it. `lastFinalTurnId` is bound only after acceptance.
- `commands.ts` — tool calls remain attributed to the command that owned their reply; correction/barge-in/supersede make them `STALE_COMMAND` instead of re-binding them to the corrected command.
- Worker UI never shows a green `COMPLETED` tool state for an unverified outcome.
- Unchanged: two-stage protected confirmation, 20 s prepared TTL, fresh-VAD/post-TTS quiet gates, server-side prepared-authority headers, independent post-mutation verification, no blind retry.

Automated evidence (this build): structural **158/158**, reliability core **195/195** (A1–A9 authority regressions + M1–M5 metrics), production build **PASS**.

Runtime acceptance: `evidence/build7/BUILD7_TEST_PLAN.md` § R16.



## v0.8.7 Natural Turn Handling + Command-Bound Recovery Authority

v0.8.7 is a narrow reliability build over v0.8.6 based on Windows runtime evidence. It does not reopen the already validated ambient/false-mutation protections.

- Removed explicit `min_silence: 700` / `max_silence: 2200` overrides from the AssemblyAI Voice Agent session so adaptive/neural endpointing remains active. `vad_threshold: 0.6` and interruption support remain. This targets natural pauses inside phrases such as `VoiceStrike ... reverse scan ... B184` instead of forcing the worker to speak unnaturally fast.
- A successful `inspect_last_action` now binds recovery speech authority to the exact `commandId + actionId + componentId`, not just an unscoped browser variable.
- The server audit stores the `commandId` on every authoritative last-action inspection.
- If the browser-local recovery context is missing when a protected prepare phrase arrives, v0.8.7 may restore it only from a real recent server audit record for the exact same command/component. The restore endpoint is read-only: it neither performs a fresh inspection nor mutates state.
- If no matching inspection actually happened, `RECOVERY_CONTEXT_REQUIRED` remains the correct outcome. No conversational claim can manufacture recovery authority.
- The agent prompt now explicitly forbids saying that a component was the last scan unless `inspect_last_action` actually returned that fact.
- Existing two-stage reversal confirmation, fresh-VAD requirement, post-TTS quiet gap, no-blind-retry rule and independent post-mutation verification remain unchanged.

Internal v0.8.7 validation: **141/141 structural PASS**, **131/131 reliability core PASS**, client voice/reliability strict TypeScript **PASS**, server transpile/syntax probe **PASS**. Full installed production build remains the Windows launcher gate because the CLEAN source package does not vendor npm dependencies.

Primary runtime regression:

`VoiceStrike, yes, I scanned B184 by mistake.` → authoritative `inspect_last_action` → natural-speed `VoiceStrike, reverse scan B184.`

Expected: inspected recovery context is command-bound and remains available for the protected prepare phrase; first reverse phrase prepares only and still causes **mutation = 0**.


## v0.8.6 Entity Confirmation Continuity + Truthful Tool Reporting

v0.8.6 is a clean incremental hardening build over v0.8.5. It fixes the two runtime defects found after the `I scanned → B1 → 84 → B184` path without reopening the already validated ambient/echo work.

- A technical component reconstructed across fragmented turns now creates an explicit deterministic `entity_confirmation` state and remains `COLLECTING` until the worker repeats the complete reconstructed ID.
- The matching repeated ID confirms the entity on the **same `commandId`**. The command can become `READY` only after that confirmation; therefore `inspect_last_action` cannot run early.
- If the repeated complete ID differs from the reconstructed candidate, the old candidate is **SUPERSEDED** and a clean replacement command is created. The two IDs are never combined into an ambiguous authority context.
- Reliability telemetry now records `reliability.entity_confirmation` with `PENDING`, `CONFIRMED`, or `SUPERSEDED` detail.
- Tool reporting now distinguishes reliability/readiness outcomes from actual operational tool failures. `NEEDS_CLARIFICATION`, `STALE_COMMAND`, `REJECTED`, `CONNECTION_LOST`, `VERIFY_FAILED`, and `UNKNOWN_ACTION_STATE` retain their true semantics.
- `TOOL_FAILED` is allowed only when an operational tool call was actually attempted and returned a failed tool result. A pre-call reliability gate cannot manufacture a tool failure claim.
- The v0.8.5 Critical Speech Trust Gate, Duplex/Echo Guard, wake authority, two-stage reversal confirmation, and independent post-mutation verification remain unchanged.

Automated v0.8.6 evidence: **structural 135/135 PASS**, **reliability core 126/126 PASS**, and strict TypeScript gate for the changed voice/reliability modules **PASS**. The full installed Vite/Express production build remains the Windows environment gate because this clean source package does not vendor npm dependencies.

Primary runtime regression after automated PASS:

`VoiceStrike, I scanned.` → `VoiceStrike, B one.` → `VoiceStrike, eight four.` → `VoiceStrike, B184.`

Expected: one `commandId`, B184 confirmed, `inspect_last_action` called only after READY, no mutation yet, then the existing protected recovery flow.


## v0.8.5 Critical Speech Trust Gate

Windows runtime validation of v0.8.4 showed a false final transcript, `VoiceStrike confirm reverse scan B184`, while the worker was silent. The deterministic mutation gate prevented the reversal, proving the core safety invariant, but BUILD 7 now suppresses this class of false critical speech earlier.

Permanent rule: **False transcript may happen. False mutation must not.**

- New `CriticalSpeechTrustGate` runs before `CommandRegistry.acceptFinalTranscript` for protected reverse/confirm phrases.
- Protected speech requires the exact wake phrase, a fresh AssemblyAI `input.speech.started` event, no active agent audio, and a 1.5 s quiet gap after TTS.
- A first-stage `reverse scan` requires an already established mistaken-scan/recovery context.
- A second-stage `confirm reverse scan` is rejected unless a deterministic prepared confirmation already exists and the component matches exactly.
- Rejected critical speech is silent: it is not accepted into command context, does not create confirmation authority, cannot call a mutation, and its agent reply audio is suppressed.
- Full dangerous action phrases were removed from AssemblyAI keyterms. Keyterms retain wake words and technical IDs only, so speech biasing cannot intentionally favour an entire mutation command.
- A local Reliability DEV panel shows trust/rejection reasons and scores separately from the operational audit trail.
- The live Voice Agent WebSocket transcript event does not expose a per-turn confidence field; v0.8.5 therefore does not invent one. The internal trust score reflects deterministic observable signals only.


## v0.8.4 false-critical-command / duplex hardening

Windows runtime validation with a television in the room produced a false worker transcript matching a protected recovery command while the user was silent. No mutation executed, but BUILD 7 treats the false command itself as a critical reliability finding. v0.8.4 adds layered protection without changing the P0 architecture or business workflows.

- Wake/clarification window shortened from 30 seconds to **15 seconds**.
- New deterministic **DuplexEchoGuard** tracks when VoiceStrike is speaking and the start time of worker speech. A protected reversal phrase requires a fresh VAD speech-start event; if it begins during VoiceStrike audio (or its immediate playback tail), it is dropped and cannot become command authority. Echo-like transcripts with high overlap to VoiceStrike TTS are also suppressed inside that audio window. Non-echo corrections/barge-in remain available.
- New deterministic **CriticalConfirmationGate** makes reversal a two-turn protected action. `VoiceStrike, reverse scan B184` prepares only; it cannot mutate. A separate later worker turn must say `VoiceStrike, confirm reverse scan B184`.
- The second confirmation is bound to the same `commandId`, exact `action_id`, exact component, and a different worker `turnId`, with a 20-second expiry.
- The server independently requires browser-only prepared-authority headers plus the exact second-stage phrase before `/tools/reverse-last-scan` may mutate. LLM tool arguments cannot create those headers.
- Self-echo/background false-command regression is now explicit in the automated reliability suite and runtime test plan.
- Existing independent authoritative post-mutation verification remains mandatory.

The remaining limitation is unchanged: without speaker identity, a nearby person who deliberately waits for a valid listening period and intentionally speaks both protected phrases may still be indistinguishable from the worker at the STT layer.


## v0.8.3 ambient-speech + context-retention hardening

Windows runtime testing with nearby television speech exposed two additional reliability gaps. v0.8.3 adds a deterministic wake/ambient gate and bidirectional clarification retention.

- The worker says **VoiceStrike** to wake a 30-second operational clarification window.
- Speech before wake is not operational authority; unrelated TV/background speech is suppressed and cannot call tools.
- Only accepted operational/clarification speech extends the wake window.
- Browser microphone constraints keep echo cancellation + noise suppression on, disable AGC so distant TV is not boosted, request `voiceIsolation` when supported, and add a conservative local RMS noise gate.
- `B1 + 84`, `B1 + 8-4`, and `B one + 84` can resolve `B184` only inside an existing incomplete technical-ID command.
- Clarification context is retained in both directions: **intent → entity** and **entity → intent**. Example: resolved `B184` followed by `It was a mistake` remains the same command and retains `B184`.
- Mutation endpoints require an active wake-authority header. The critical reversal confirmation must be spoken in the latest worker turn as **“VoiceStrike, reverse scan B184”** (with the exact inspected component).

This reduces ambient contamination but still does **not** claim speaker authentication: a nearby person who deliberately says the wake phrase and a complete valid command can still be indistinguishable at the STT layer.

## v0.8.2 runtime-STT continuation fix

Windows runtime validation showed that AssemblyAI may transcribe spoken "eight four" as compact `84` in a separate turn. v0.8.2 accepts a digits-only continuation only while a technical identifier is already COLLECTING, resolves `B1 + 84` and `B one + 84` to `B184`, and adds explicit agent guidance for this case.

## v0.8.1 clean-rebuild fixes

This package supersedes v0.8.0 and includes the runtime findings discovered during Windows validation directly in the main source tree:

- production TypeScript config no longer uses the incompatible `allowImportingTsExtensions` flag;
- reliability test runner is ESM-safe (`.mts`);
- read-only operational tools are blocked while a command is `COLLECTING`;
- compact partial technical IDs such as `B1` remain `COLLECTING`;
- turn-boundary hybrid input such as `B1` + `eight four` resolves to `B184` only after the full entity is available;
- incomplete speech cannot pull `B184` from `inspect_last_action` and present it as though the worker supplied it.

## Goal

Harden VoiceStrike against imperfect speech and uncertain execution state without changing the P0 architecture or adding new business workflows.

BUILD 7 covers:

- strong/variable UK accents;
- technical IDs;
- noise;
- fragmented speech;
- corrections and barge-in;
- short-utterance ambiguity;
- uncertain/foreign transcript drift;
- ambient speech contamination;
- tool/network failures;
- post-mutation verification;
- connection recovery without blind mutation replay.

## Reliability contract

**Speech is input, not authority.**  
**Speech content alone never proves speaker authority.**  
**LLM interprets. Code authorises.**

VoiceStrike must never:

1. guess a critical technical entity;
2. mutate from an incomplete, stale, or unreliable command;
3. treat a mutation response as verified success;
4. retry an uncertain mutation blindly;
5. claim success without a separate authoritative verification.

## New reliability components

### Critical entity resolver
`client/src/reliability/entities.ts`

Normalises spoken technical IDs such as:

- `B one eight four` → `B184`
- `Bee one eight four` → `B184`
- `Job four eight two` → `JOB-482`
- `Station three zero four zero` → `3040`
- `C one two` → `C12`

Unknown IDs are not mapped to the nearest known ID.

### Transcript sanity gate
`client/src/reliability/transcript.ts` and `server/src/reliability/transcript.ts`

Rejects mutation authority from:

- empty input;
- bare short approvals such as `yes`, `yeah`, `ok`, `done`, `da`;
- unexpected non-Latin transcript drift;
- input with no meaningful content;
- irrelevant Latin-script drift with no operational signal when a mutation is being authorised.

This is intentionally conservative. It does not claim speaker authentication.

### Command registry
`client/src/reliability/commands.ts`

Each worker command receives a `commandId`. A reply/tool call tied to an interrupted or corrected command becomes stale and cannot authorise a mutation.

Fragmented speech remains in `COLLECTING` state until sufficient context exists; `COLLECTING` commands are rejected before mutation. Explicit cancellation, ambiguous critical IDs, and transcript/tool-ID mismatches are also rejected centrally before mutation.

### Safe Action Executor
`client/src/reliability/safeAction.ts`

All current mutation tools use one reliability path:

`AUTHORISE → MUTATE → INDEPENDENT AUTHORITATIVE VERIFY → RESPOND`

Covered mutations:

- `report_exception`
- `update_job_status`
- `report_inventory_discrepancy`
- `reverse_last_scan`

A mutation success response never self-verifies.

### Recovery-first reconnect
If the voice connection drops while a mutation is in-flight or a verified mutation result has not been safely handed off, VoiceStrike blocks further mutations and refreshes authoritative state before continuing.

No mutation is replayed automatically.

### Reliability telemetry
In-memory reliability evidence is available at:

- `GET /api/reliability/telemetry`
- `POST /api/reliability/telemetry`
- `DELETE /api/reliability/telemetry`

Operational audit and reliability telemetry remain separate. Timestamped reliability events include speech end, final transcript, tool call/result, verification, and response start so latency stages can be derived without recording raw audio.

### Failure injection
Disabled by default.

Enable only in a non-production test session with:

`VOICESTRIKE_ENABLE_RELIABILITY_FAULTS=true`

Then configure through:

- `GET /api/reliability/fault`
- `POST /api/reliability/fault`
- `DELETE /api/reliability/fault`

Critical test point: `REVERSE_AFTER_MUTATION` simulates a reversal that commits successfully but loses the trusted response. Expected behaviour is **no blind retry + forced authoritative inspection**.

## Keyterms A/B evidence

Normal run uses job-specific keyterms.

Open the same app with:

`http://localhost:5173/?keyterms=off`

to run the baseline without keyterms. Use the same utterances/audio for both conditions.

## Known limitation — ambient speaker identity

VoiceStrike can reject short ambiguous speech and irrelevant/uncertain transcripts, but content alone cannot prove who physically spoke a perfectly valid command. Without speaker identification/authentication, a nearby person who clearly says the complete protected phrase can be indistinguishable from the worker at the STT layer.

This limitation must be documented; it must not be hidden behind a universal accent/speaker claim.

## Acceptance targets

- Unsafe Action Rate: **0%**
- False Success Rate: **0%**
- Critical Entity Safe Resolution: **100%**
- Correction handling on controlled corpus: **100%**
- BUILD 0–6 regression: **PASS**
- Controlled corpus: **30 utterances/cases**

See `evidence/build7/BUILD7_TEST_PLAN.md` and `tests/reliability/reliability-corpus.json`.

## v0.8.9 runtime regression fix — E1 session isolation

After R16-A passed on Windows, conversational stress testing found a command-lifecycle regression when a new WRONG_COMPONENT workflow followed a completed recovery in the same Worker voice session. v0.8.9 prevents READY recovery commands from absorbing unrelated later intents while preserving the intended SCAN_CONTEXT → MISTAKEN_SCAN → REVERSE_SCAN → confirmation continuity. No safety/readiness gate was relaxed. See `evidence/build7/v0.8.9_e1_session_isolation.md`.


## v0.8.11 — Solicited Clarification Continuity

Runtime regression fixed: when VoiceStrike explicitly asks for missing information on a COLLECTING command, the worker may answer that solicited clarification naturally without repeating the wake phrase, even if the ordinary 15 s wake window expired while VoiceStrike was speaking/waiting. The clarification window is 30 s, one-shot, command-bound, and accepts only clarification-like continuations. Protected reverse/confirm-reverse speech remains unchanged and still requires explicit VoiceStrike wake authority through CriticalSpeechTrustGate.

The E1 sequence `VoiceStrike, I think I've got the wrong part.` → agent asks component → `B184.` now remains on the same commandId, becomes `WRONG_COMPONENT + B184 + READY`, and allows authoritative read tools. Pre-tool gate wording was also grounded so it cannot claim an operational tool failed or ask for system-known job/station IDs when no tool call occurred.

BUILD 7 remains open until Windows runtime regression and remaining real-audio evidence pass.
