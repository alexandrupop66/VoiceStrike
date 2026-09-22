## 0.10.0 RC5 — CODE-OWNED PROTECTED ACTIONS + SENTENCE CLAIM GATE

- E2 claim gate: spoken/compact technical IDs normalised (`spokenIds.ts`); quantities parsed with IDs masked. Fixes the live false failure on "four units of component B one four eight available" and the false negative on spelled locations ("D nine nine").
- E3: trusted, accepted, window-bound PREPARE/CONFIRM are executed by code through the same gated tool path. The provider no longer has to emit `reverse_last_scan`; if it does, it joins the code execution and gets the same verified result (late duplicates no longer return AUTHORITY_ALREADY_CONSUMED). Outcomes not requested by the provider are delivered via `conversation.message` + `reply.create` (`CODE_CONTINUATION`).
- Latency: E1/E2/E3 PCM released per validated sentence from `transcript.agent.delta` word timing; full-buffer fallback without timing. `reply_audio_released` records time-to-first-audio.
- Provider correlation: `item_id` of a rejected transcript can only downgrade a reply; `reply.done(interrupted, fc-<call_id>)` discards that call. Rejected protected utterances produce a system context note.
- Automated: structural 245/245, reliability core 410/410, command-context 1,068/1,068, live regression 26/26, lifecycle 35/35, claims 22/22, event pipeline 54/54 (RC4 on the same harness: 38/52 before the two robustness checks were added), production build PASS.

## 0.10.0 RC4 — BUILD 7 RUNTIME LIFECYCLE LEDGER

- Root cause proven end to end: the same harness reproduces the live RC3 symptoms on RC3 (9/27) and passes on RC4 (27/27). See `evidence/build7/v0.10.0_RC4_LIFECYCLE_DIAGNOSIS.md`.
- Provider events are processed through one ordered queue; tool I/O runs off the queue and its completion re-enters it. Speech onset uses receipt time.
- `ReplyAuthorityRegistry` rewritten as a reply-causality ledger: one initial reply + owed continuations per accepted turn; onset no longer revokes the reply in progress; calls registered by `call_id` at admission; no stale tail or rehydration over a newer turn; unattributable calls have no owner and are refused before any endpoint.
- `tool.result` handoff follows AssemblyAI's documented reply.started / input.speech.started / reply.done rule; interrupted-reply results are dropped, recorded and release their turn hold.
- Tools reverted to documented `execution_mode: 'interactive'`.
- Lifecycle instrumentation: ordered provider trace, handoff dwell, discard, window-not-opened reason, owner/authority detail, rejected claim text. Server telemetry ring 3000.
- `VOICESTRIKE_DB_PATH` optional override (test isolation only).
- Automated: structural 236/236, reliability core 410/410, command-context 1,068/1,068, live regression 26/26, lifecycle 23/23, event pipeline 27/27, production build PASS.

## 0.10.0 RC3 — BUILD 7 RUNTIME OWNERSHIP & LATENCY CLOSURE

- Rehydrates the exact causal turn when an ordinary delayed `tool.call` arrives after `reply.done` closed `openTurn`; its `tool.result` can now produce one correctly bound continuation instead of an orphan/false-failure reply.
- Protected E3 `reverse_last_scan` leases now outrank stale generic reply bindings, closing the live `COMMAND_MISMATCH` loop seen after a fresh mistaken-scan inspection.
- An accepted worker turn now detaches any still-open previous reply binding into stale-tail ownership before creating the new open turn.
- All nine operational AssemblyAI function tools use `execution_mode: hold` to remove transition-reply chatter and reduce tool/reply interleaving during fast local operations.
- Worker VAD sensitivity changed from `0.6` to `0.45`; wake/ambient and critical mutation authority remain deterministic in code.
- Exact live regression expanded from 19 to 26 assertions, including delayed-tool rehydration and protected-lease precedence.
- Automated gates: structural 230/230, command-context 1,068/1,068, reliability core 410/410, live regression 26/26.

## 0.10.0 RC2 — BUILD 7 COMMAND CONTEXT CLOSURE

- Fixed the connection-greeting reply-ownership race: fresh speech interrupts the current reply and stale delayed tools retain only their old causal owner.
- Server mutation authority now requires typed workflow + command readiness; transcript is sanity evidence only, not a semantic mutation gate.
- Complete E2 EMPTY reports now continue deterministically in code: check -> discrepancy -> verify -> alternative read.
- Added a hard final reply-claim gate. E1/E2/E3 PCM is buffered and unsupported operational claims are dropped before playback.
- Added exact 20/09/2026 live-session regression coverage for first-command ownership, E1 `B184.` clarification, single-utterance E2, and D05/4 evidence.
- Automated results: 230/230 structural, 1,068/1,068 command-context, 410/410 reliability core, 19/19 live regression.

## 0.10.0 — BUILD 7 COMMAND CONTEXT REFACTOR

- Explicit command-scoped workflow context and typed slots replace transcript accumulation as operational authority.
- Clarifications fill bounded slots on the same command; unrelated intents create new commandIds.
- Tool ownership is causal and never falls back to the globally active command.
- Workflow evidence is command-scoped in client and server.
- Fact-level claim grounding authorises exact operational read facts only after completed authoritative reads.
- D05 removed from static keyterms; alternatives require authoritative lookup.
- Repeated no-reset A→Q acceptance and provider event-order coverage added.

## 0.9.5 — BUILD 7 FINAL E2 COMMAND CONTINUITY + EVIDENCE FIX

- Bare `VoiceStrike` is now a wake/control turn only; it does not create or invalidate an operational command and does not mint tool/mutation authority.
- Missing-inventory clarifications remain bound to the same E2 commandId after the command reaches READY; unrelated intents still create a fresh command.
- E2 prompt policy forbids redundant yes/no re-confirmation once component + location + EMPTY are already explicit, and instructs automatic `check_inventory` refresh when the workflow precondition is stale.
- Live transcript history increased from 24 to 500 entries; tool history increased from 12 to 100; reliability history increased from 100 to 200.
- Added `Copy transcript` and `Export transcript JSON` controls for long runtime evidence capture.
- Added E2 command-continuity regressions for wake-only control, redundant clarification, long-session same-command retention, and unrelated-intent isolation.

## 0.9.4 — BUILD 7 FINAL E2 TYPED-ENTITY FIX

- Added `reliability/inventoryEntities.ts`, a typed E2 resolver that distinguishes component and location roles even though both use letter+digits identifiers.
- Natural `B148 isn't at C12. The location is empty.` now resolves `component_id=B148`, `location_id=C12`, `observed_state=EMPTY` instead of generic ambiguity.
- Missing-inventory commands remain `COLLECTING` until both typed fields and explicit EMPTY evidence are present; clarification replies merge into the same commandId.
- `report_inventory_discrepancy` validates both typed transcript entities against tool arguments; authoritative workflow/server gates still require the exact recently checked current-job component/location.
- E1/E3 protected recovery, wake/echo, reply lifecycle and mutation verification are unchanged.
- Added E2-T1…E2-T14 regressions for natural reports, command continuity, typed clarification, ambiguity, no-EMPTY safety and exact authoritative pair enforcement.

# VoiceStrike — Changelog

## 0.9.3 — BUILD 7 FINAL REPLY-LIFECYCLE RUNTIME CANDIDATE

Narrow structural fix over v0.9.2 based on the exact Windows telemetry ordering.

### Fixed
- Added a protected tool-call lease to `ReplyAuthorityRegistry` for accepted
  `REVERSE_PREPARE` / `REVERSE_CONFIRM` turns. The causal turn can survive the provider's
  `reply.done -> reply.started -> delayed reverse_last_scan tool.call` ordering.
- Intervening replies while the protected lease is waiting remain suppressed as ORPHAN; the
  lease does not make ambient/TV replies audible and does not itself grant mutation authority.
- The exact delayed `reverse_last_scan` request is correlated to the held command, after which
  the tool result can authorise one `TOOL_CONTINUATION` reply.
- Cancellation and expiry explicitly terminate the matching protected reply lease.
- PREPARED no longer starts the worker's 20 s confirmation TTL. The TTL begins only after the
  confirmation prompt has finished estimated audible playback and the REVERSE_CONFIRM protected
  speech window opens.
- Added a 30 s provider prompt-delivery deadline so an undelivered confirmation prompt cannot
  leave PREPARED state indefinitely.

### Regression evidence added
- R-F3 reproduces the live provider boundary before delayed tool.call while ensuring intervening
  replies remain inaudible.
- R-F4 proves the 20 s confirmation TTL is deferred until the audible confirmation window opens.
- R-F5 integrates the exact PREPARE -> delayed tool.call -> confirmation prompt -> CONFIRM
  lifecycle observed on Windows.

Automated deterministic reliability suite: **387 passed, 0 failed**.
Structural validator: **203/203 PASS**. Production build remains a Windows acceptance gate for
this CLEAN artifact.


## 0.9.2 — BUILD 7 FINAL PROTECTED-SPEECH RUNTIME CANDIDATE

Narrow structural fix over v0.9.1 based on live Windows evidence.

### Fixed
- Added command-bound `ProtectedSpeechWindowRegistry` for `REVERSE_PREPARE` and
  `REVERSE_CONFIRM`; protected speech is now tied to exact session epoch + command + action +
  component + expected critical kind.
- Window opening is based on estimated audible PCM completion, not raw provider `reply.done`.
- A real 550 ms post-audio quiet gap replaces the fragile 1.5 s provider-clock wait when a valid
  protected window exists. The legacy 1.5 s gate remains for non-window fallback paths.
- TV/ambient/echo or too-early protected speech does not consume the window. Only a fully accepted
  worker turn consumes it.
- Cancellation, expiry, session reset, ineligible inspect and verified reversal clear protected
  speech state; fresh inspection can arm the same action/component again.
- Expiry wording now requires a fresh mistaken-scan report/inspection before a new preparation.

### Regression evidence added
- Prompt-not-finished protected speech is rejected.
- Too-early post-TTS speech is rejected without consuming the window.
- Wrong component cannot use the window.
- Normal response after audible TTS + quiet gap is accepted even inside the old 1.5 s global wait.
- Cancelled/expired old window cannot poison a fresh command for the same action/component.

Automated deterministic reliability suite: **361 passed, 0 failed**.
Structural validator: **194/194 PASS**. Changed critical reliability/voice TypeScript: **PASS**.
Production build remains a Windows acceptance gate for this CLEAN artifact.

## 0.9.1 — BUILD 7 FINAL RUNTIME CANDIDATE

Narrow consolidation over v0.9.0 based on live Windows acceptance evidence.

### Fixed
- Post-tool reply causality: a successful tool result no longer closes the accepted worker turn
  before AssemblyAI can speak the result. `ReplyAuthorityRegistry` now models an explicit
  `TOOL_CONTINUATION`; the turn closes only after that continuation reply completes.
- Tool-result handoff no longer calls the semantically misleading `clearPendingWork()` before the
  post-tool response; it calls `markToolResultSent()` and preserves continuation authority.
- Protected-action tombstones are command-scoped. CANCELLED/EXPIRED/CONSUMED state still blocks
  replay on the terminal command, but no longer blacklists the same physical action/component for
  ten minutes after a fresh authoritative inspection creates a new command.
- A confirmation-only phrase (`confirm reverse ...`) cannot bootstrap a fresh preparation after a
  tombstone boundary. Fresh preparation must again be `reverse scan <component>`.

### Regression evidence added
- Post-tool continuation: accepted turn -> tool result -> authorised continuation on the same
  turn/command -> close only after continuation -> later unbound reply remains orphan.
- Rejected TV/ambient speech during the tool round-trip cannot revoke that continuation.
- Cancellation and expiry both permit a fresh inspected command for the same action while stale
  confirmation replay remains blocked.
- Consumed confirmation remains single-use and confirmation-only replay cannot bootstrap a new
  command.

Automated deterministic reliability suite in this package: **352 passed, 0 failed**.
Structural validator: **187/187 PASS**. Full pinned-dependency production build remains a Windows
acceptance gate for this v0.9.1 artifact.

## 0.9.0 — BUILD 7 FINAL CANDIDATE (implementation complete, runtime acceptance pending)

Final reliability consolidation over v0.8.11. Eight runtime-confirmed defects resolved
structurally rather than by micro-patch; full analysis in
`evidence/build7/v0.9.0_ROOT_CAUSE_AND_CONSOLIDATION.md`.

### Added
- `client/src/reliability/session.ts` — `SessionEpoch`; full demo reset without destroying the
  live voice session; stale-epoch async events are dropped.
- `client/src/reliability/workflow.ts` — deterministic E1/E2 mutation sequencing
  (`PRECONDITION_REQUIRED` refuses locally, consumes no mutation opportunity).
- `client/src/reliability/claims.ts` — operational stage evidence and derived `claim_grounding`
  attached to every tool result.
- `client/src/reliability/toolPolicy.ts` — central tool classification and read-only bootstrap.
- `client/src/reliability/replyAuthority.ts` — immutable reply-to-turn causality binding.
- `client/src/reliability/cancellation.ts` — conservative contextual cancellation detection.
- `GET /api/reliability/metrics` — counters derived from recorded telemetry only.
- Regressions R-A … R-R plus claim-grounding and tool-policy unit invariants.
- Corpus extended to 41 controlled cases covering wake/no-wake controls, protected confirmation,
  cancellation and interruption.

### Changed
- `CriticalConfirmationGate` is now a protected-action lifecycle with `CANCELLED` / `EXPIRED` /
  `CONSUMED` tombstones and a deterministic sweep; expiry and cancellation both close the owning
  command.
- `CommandRegistry` gained a terminal `CANCELLED` status; cancelled and invalidated commands are
  treated identically for merging and authority.
- Reply suppression replaced by per-reply immutable bindings; the mutable `suppressAmbientReply`
  session flag is removed.
- Read readiness is decided per tool class; mutation readiness and every mutation gate unchanged.
- Solicited clarification window accepts only real operational continuations; a bare approval is
  no longer a clarification continuation anywhere.
- Telemetry lifecycle split into `tool_requested` / `tool_authorisation_checked` /
  `tool_blocked_local` / `tool_attempted` / `tool_result` (+ `verified_success`), with
  `epoch`, `actionId`, `componentId`, `authorityId`, `tool`, `attempted`, `resultClass`.
- Reliability DEV panel keeps 100 signals and exports diagnostics JSON (no secrets).
- Agent prompt: claim-grounding rules, read bootstrap, code-enforced sequencing, cancellation
  and expiry handling.

### Removed
- Ambiguous `reliability.tool_called` event (was emitted even when `tool_call_attempted=false`).

### Unchanged
- BUILD 0–6 business workflows; two-stage protected reversal; wake/trust gates; independent
  post-mutation verification; no blind mutation retry; v0.8.10 Worker/Supervisor session
  persistence; the documented speaker-identity limitation.

## 0.8.11 — Solicited clarification continuity
See `BUILD7_STATUS.md`.
