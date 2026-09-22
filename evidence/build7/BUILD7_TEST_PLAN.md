## v0.9.5 long-session E2 continuity gate (run first)

Use one session without reset after the initial seed reset. Verify: `VoiceStrike, where can I find B148?` → C12/7; a bare `VoiceStrike.` does not create a new operational command; `B148 isn't at C12. The location is empty.` retains the same E2 commandId; redundant clarifications do not create command churn; discrepancy reaches VERIFIED_SUCCESS only after a matching authoritative `check_inventory`; read-after-write returns D05/4; then transition to an unrelated E3 request and confirm a new commandId is created. Capture the full session with Copy transcript or Export transcript JSON.

# BUILD 7 — Reliability Runtime Test Plan

## v0.9.4 E2 typed-entity final gate (run first)

Run `v0.9.4_RUNTIME_ACCEPTANCE_PLAN.md` before the longer R-series. The decisive P0 gate is the natural two-turn E2 flow: authoritative `check_inventory(B148)` must establish C12/7, then `VoiceStrike, B148 isn't at C12. The location is empty.` must resolve typed `component_id=B148` and `location_id=C12`, record exactly one verified discrepancy, and read alternative stock. Wrong/ambiguous locations remain mutation 0.

## v0.9.3 reply-lifecycle gate (run before prior R-series)

Run `v0.9.3_RUNTIME_ACCEPTANCE_PLAN.md` R30–R34 first. The decisive gate is R30: the confirmation
prompt must survive the live provider reply boundary and the 20 s confirmation TTL must begin only
after that prompt becomes audibly available.

## Gate 0 — Baseline / regression

Before reliability tests:

1. `npm run validate:build7`
2. `npm run build`
3. Reset demo state.
4. Confirm BUILD 3 Wrong Component still completes safely.
5. Confirm BUILD 5 Missing Inventory still completes safely.
6. Confirm BUILD 6 Recovery still produces final audit order: **Inspect → Reverse → Inspect**.
7. Confirm `RECOVERY VERIFIED` is not shown until the post-reversal inspection exists.

## v0.9.2 protected-speech timing gate (run before R1)

This gate reproduces the final live v0.9.1 blocker and must pass before the longer corpus.

1. Fresh reset/session. TV may be on at normal volume.
2. `VoiceStrike, I scanned B184 by mistake.` -> authoritative inspect identifies B184.
3. After VoiceStrike audibly finishes the instruction, answer naturally (do not deliberately wait
   1.5 seconds): `VoiceStrike, reverse scan B184.`
4. PREPARE must be trusted and locally produce `SECOND_CONFIRMATION_REQUIRED`, mutation 0.
5. After the confirmation prompt audibly finishes, answer naturally:
   `VoiceStrike, confirm reverse scan B184.`
6. Exactly one reversal must occur, followed by independent verification.

Required telemetry includes protected window arm/open/consume for PREPARE and CONFIRM. A legitimate
protected turn must not fail as `CRITICAL_SPEECH_NOT_TRUSTED` merely because it began inside the old
provider `reply.done + 1500ms` interval. Speech that begins while VoiceStrike is still audibly
speaking, inside the 550 ms protected quiet gap, from the wrong component, stale command, TV/echo,
or without the wake phrase must remain non-authoritative and mutation 0.

Then repeat after both terminal boundaries:

- PREPARE -> CANCEL -> fresh mistaken-scan report -> fresh inspect -> fresh PREPARE -> fresh CONFIRM.
- PREPARE -> wait >20 s -> EXPIRE -> fresh mistaken-scan report -> fresh inspect -> fresh PREPARE -> fresh CONFIRM.

The old command/confirmation must stay dead, while the fresh command for the same physical
`ACT-SCAN-B184 / B184` can complete exactly once.


## R1 — Clean technical IDs

Run the deterministic technical-ID cases from `tests/reliability/reliability-corpus.json`.

Required examples:

- `B one eight four` → `B184`
- `B one four eight` → `B148`
- `Job four eight two` → `JOB-482`
- `Station three zero four zero` → `3040`
- `C one two` → `C12`

Unknown IDs must not be auto-corrected to a known ID.

## R2 — Corrections

Required:

- `It's B148, sorry, B184.` → final entity `B184`
- `I scanned B184, no wait, B148.` → final entity `B148`
- `Reverse that... actually don't.` → zero mutation
- `Yes... no, wait.` → zero mutation

## R3 — Fragmented speech

Test:

- `I scanned...` / `B one...` / `eight four.`
- `I scanned.` / `B1.` / `eight four.`
- `I scanned.` / `B1.` / `84.`
- `I scanned.` / `B1.` / `8-4.` (punctuated STT boundary case observed during Windows runtime testing)
- `It's B one...` / `four...` / `eight.`
- `Job...` / `four eight...` / `two.`

Before the final fragment, the command must remain `COLLECTING`. **No mutation and no operational read such as `inspect_last_action` may run while the critical entity is incomplete.** In particular, `B1` must not be completed from authoritative last-action state.

## R4 — Interruption / barge-in

Start a command, interrupt VoiceStrike while it is replying, then correct the entity.

Expected:

- old `commandId` becomes stale;
- stale tool call is discarded/rejected;
- old command cannot mutate;
- new command is re-evaluated from current input.

## R5 — Accent

Use the same controlled utterances with at least:

- strong West Midlands accent;
- strong Northern English accent;
- normal/fast UK speech.

PASS is either:

- correct critical entity; or
- safe clarification before mutation.

Do not require perfect transcript wording.

## R6 — Moderate noise

Replay/speak technical-ID cases with moderate background speech or machinery noise.

Expected:

- correct entity OR clarification;
- unsafe mutation count = 0.

## R7 — Difficult noise / transcript drift

Use sufficiently difficult noise to cause recognition uncertainty.

Also verify a non-Latin drift case such as Devanagari text is classified `TRANSCRIPT_UNRELIABLE` for mutation authority.

Expected:

- no mutation from uncertain transcript;
- no invented technical ID;
- concise clarification request.

## R8 — Ambient speech contamination / wake phrase

### A. Sleeping with TV/background speech
Start VoiceStrike but do **not** say the wake phrase. Let nearby TV/conversation continue.

Expected: background speech is not added as operational authority, operational tools remain blocked, and VoiceStrike does not audibly answer unrelated TV speech.

### B. Wake phrase
Say `VoiceStrike, I scanned...`.

Expected: wake window activates and the operational command enters clarification flow.

### C. Background speech during wake window
While the wake window is active, allow an unrelated TV sentence.

Expected: unrelated speech is ignored and does not extend the wake window.

### D. Fragmented technical ID + retained intent/entity
Say: `VoiceStrike, I scanned...` / `B1` / `8-4` / `It was a mistake.`

Expected: B184 is retained across turns; the last turn supplies intent rather than causing the component to be asked again. `inspect_last_action` may run only after the command is semantically ready.

### E. Protected reversal — deterministic two-turn authority
After inspection:

1. say `VoiceStrike, reverse scan B184`;
2. wait for VoiceStrike to finish its preparation response;
3. say `VoiceStrike, confirm reverse scan B184` in a separate worker turn.

Expected:

- turn 1 prepares only; mutation count remains zero;
- bare `yes`, same-turn retry, wrong component, expired confirmation, or confirmation without the wake phrase is rejected;
- turn 2 must remain bound to the same `commandId`, exact inspected action, exact component, and a different `turnId`;
- only the valid second turn may reach mutation, followed by independent authoritative verification.

### F. Self-echo / false critical-command regression
With TV/background audio present, let VoiceStrike speak its protected recovery prompt. Do not speak during that prompt.

The observed Windows regression was a false worker transcript equivalent to `VoiceStrike, reverse scan B184` while the user was silent.

Expected:

- any protected reversal phrase whose speech-start event begins while VoiceStrike is speaking (or in the immediate playback tail) is classified as duplex/echo contamination;
- it is not accepted into command authority and cannot prepare or execute a reversal;
- an echo-like transcript with high overlap to the current VoiceStrike TTS is silently suppressed inside the agent-audio window;
- a real correction that is not echo-like may still barge in;
- even if a false first-stage phrase escapes acoustic filtering, the two-turn confirmation gate still prevents mutation from one false transcript.

### G. Remaining limitation
A nearby person deliberately waits for VoiceStrike to finish speaking and intentionally supplies both valid protected phrases in separate turns.

This remains a **documented limitation test**, not a speaker-authentication claim. Without speaker identity, a deliberate nearby speaker can still be indistinguishable from the worker at the STT layer.

## R9 — Failure injection

Run the server with:

`VOICESTRIKE_ENABLE_RELIABILITY_FAULTS=true`

Configure one fault at a time with `POST /api/reliability/fault`.

Test at least:

- `GET_CURRENT_JOB_BEFORE`
- `CHECK_COMPONENT_BEFORE`
- `REPORT_EXCEPTION_BEFORE`
- `UPDATE_JOB_STATUS_BEFORE`
- `REPORT_INVENTORY_DISCREPANCY_BEFORE`
- `REVERSE_BEFORE`
- `VERIFY_BEFORE`
- `VERIFY_TIMEOUT`

No injected failure may become a false success claim.

## R10 — Post-mutation unknown state

Configure:

`REVERSE_AFTER_MUTATION`

Then execute the normal recovery flow.

The server commits the reversal but intentionally fails the trusted response.

Required result:

1. no success is claimed from the mutation response;
2. no second reversal is attempted;
3. client performs authoritative `inspect_last_action`;
4. if inspection confirms the exact action/component and `reversed: true`, result may become `VERIFIED_SUCCESS`;
5. audit still contains only one reversal mutation.

## R11 — Connection loss / reconnect

Interrupt the voice connection while a mutation result may be unresolved.

Expected after reconnect:

- state enters recovery-required path;
- authoritative `/api/state` + last-action inspection occurs before new mutation;
- no mutation replay;
- only after successful recovery read are mutations unblocked.

## R12 — Keyterms A/B

Use identical utterances/audio:

A. Normal URL — keyterms enabled.  
B. `/?keyterms=off` — baseline.

Measure Critical Entity Accuracy. Do not claim an improvement unless measured.

## Metrics to capture

- Critical Entity Accuracy
- Critical Entity Safe Resolution
- Unsafe Mutation Rate
- False Success Rate
- Correction Handling
- speech end → transcript latency
- transcript → tool latency
- tool → verification latency
- verification → response latency
- total interaction latency

## Final BUILD 7 gate

BUILD 7 can close only when:

- structural validation PASS;
- production build PASS on Windows;
- BUILD 0–6 regression PASS;
- 30-case controlled corpus executed;
- Unsafe Action Rate = 0%;
- False Success Rate = 0%;
- Critical Entity Safe Resolution = 100%;
- post-mutation unknown-state test proves no blind retry;
- ambient-speaker limitation is documented honestly.


## R13 — v0.8.5 False critical transcript suppression

This is the exact Windows regression observed in v0.8.4: the worker said only `VoiceStrike`, VoiceStrike replied, then while the worker remained silent a final worker transcript appeared as `VoiceStrike confirm reverse scan B184`. The server did **not** reverse the scan; `ACT-SCAN-B184` remained `ACTIVE`.

### Test A — no prepared confirmation

1. Reset demo state.
2. Start a fresh voice session with TV/background audio present.
3. Say only `VoiceStrike`.
4. After VoiceStrike replies, remain silent for at least 30 seconds.

Required result:

- any false protected `reverse/confirm reverse scan` transcript is rejected by `CriticalSpeechTrustGate` **before** `CommandRegistry.acceptFinalTranscript`;
- the rejected final transcript is not retained as a `You` message; any previously surfaced partial for that turn is removed;
- reply audio generated from the rejected critical speech is suppressed;
- Reliability DEV panel records `critical_speech_rejected` with an exact reason such as `NO_PREPARED_CONFIRMATION`, `AGENT_AUDIO_ACTIVE`, `POST_TTS_QUIET_GAP_REQUIRED`, or `NO_FRESH_VAD`;
- no mutation tool may execute;
- Supervisor still shows `ACT-SCAN-B184` state `ACTIVE`.

### Test B — legitimate prepared confirmation

1. Establish a real mistaken-scan context and inspect the authoritative last action.
2. Say `VoiceStrike, reverse scan B184`.
3. Wait for VoiceStrike to finish speaking and leave at least the protected quiet interval.
4. In a separate worker turn say `VoiceStrike, confirm reverse scan B184`.

Required result:

- first protected phrase has established recovery context;
- second protected phrase has a deterministic prepared confirmation for exactly `B184`;
- Reliability DEV panel records `critical_speech_trusted`;
- only then may the reversal mutation execute;
- post-mutation `inspect_last_action` independently verifies `reversed: true` before success is spoken.

### Test C — keyterm safety

Inspect the session configuration or structural validator. AssemblyAI keyterms may include wake words and technical IDs, but **must not include a complete critical mutation phrase** such as `VoiceStrike confirm reverse scan B184`. This prevents keyterm bias from intentionally favouring a full dangerous command.


## R14 — v0.8.6 Entity confirmation continuity + truthful tool reporting

Run only after automated structural/core/build PASS.

Worker sequence:

1. `VoiceStrike, I scanned.`
2. `VoiceStrike, B one.`
3. `VoiceStrike, eight four.`
4. `VoiceStrike, B184.`

Required evidence:

- the same `commandId` persists from step 1 through step 4;
- after step 3, B184 is reconstructed but command remains `COLLECTING` with `entity_confirmation=PENDING`;
- `inspect_last_action` cannot run before step 4;
- step 4 produces `entity_confirmation=CONFIRMED` for B184 on the same command;
- command becomes `READY` and `inspect_last_action` is then called;
- no mutation occurs during this sequence;
- if any tool request is blocked before endpoint execution, its outcome remains `NEEDS_CLARIFICATION`/`REJECTED`/other real gate state and is **not** surfaced as `TOOL_FAILED`.

Do not rerun TV/self-echo/B1+84 discovery tests before this targeted regression; those findings are already incorporated from v0.8.3–v0.8.5.

## R15 — v0.8.7 natural speech + recovery-context persistence

1. Say `VoiceStrike, I scanned B184 by mistake.` and confirm that `inspect_last_action` executes.
2. After the spoken response finishes, say `VoiceStrike, reverse scan B184.` at a normal conversational pace with natural micro-pauses. Do not rush the phrase.
3. Expected: no clipped wake-only transcript caused by local fixed silence timers; protected prepare phrase is trusted only when the exact command-bound inspection exists.
4. First protected phrase must prepare only: mutation count remains 0 and VoiceStrike asks for the separate protected confirmation phrase.
5. Negative control: without a prior matching inspection, the same protected prepare phrase must return `RECOVERY_CONTEXT_REQUIRED`.

## R16 — v0.8.8 turn-bound authority: final protected confirmation (runtime acceptance)

Automated proof already exists (`npm run test:reliability-core`, cases A1–A9). Run these only for the parts that cannot be automated: real STT timing, real TTS echo, real LLM tool-call delay.

Reset demo state first. Keep the Reliability DEV panel open.

### R16-A — the previously failing path must now complete

1. `VoiceStrike, I scanned B184 by mistake.` → confirm `inspect_last_action` ran and `recovery_speech_context_ready` appears.
2. After the spoken reply finishes: `VoiceStrike, reverse scan B184.` → expect `second_confirmation_required`, Supervisor still `ACT-SCAN-B184 = ACTIVE`.
3. After the spoken reply finishes: `VoiceStrike, confirm reverse scan B184.` (within 20 s of step 2 — the prepared-confirmation TTL is unchanged).
4. Do **not** stay silent on purpose: let the TTS play through the speaker and, if a TV/second person is available, let it talk while VoiceStrike responds.

Required evidence:

- DEV panel may show `echo_suppressed` / `ambient_ignored` / `critical_speech_rejected` events **after** the accepted confirmation — this is expected and must not matter;
- `tool_called reverse_last_scan` carries `turn_authority=<confirmation turn id>` (not `NONE`);
- `second_confirmation_accepted` → `mutation_started` → `mutation_completed` → `verification_started` → `verification_passed` → `tool_result VERIFIED_SUCCESS`, each exactly once;
- Supervisor shows `ACT-SCAN-B184 = REVERSED` and `RECOVERY VERIFIED`; audit shows Inspect → Reverse → Inspect;
- VoiceStrike claims success only after the second `inspect_last_action`.

### R16-B — negative controls (each must end with mutation 0 and `ACT-SCAN-B184 = ACTIVE`)

| Control | Action | Expected DEV panel |
| --- | --- | --- |
| no wake | steps 1–2, then `confirm reverse scan B184` without the wake word | `critical_speech_rejected WAKE_PHRASE_REQUIRED`; no tool call executes |
| wrong component | steps 1–2, then `VoiceStrike, confirm reverse scan B148` | `critical_speech_rejected PREPARED_COMPONENT_MISMATCH` |
| cancelled | steps 1–2, then `VoiceStrike, reverse it... actually don't` | `action_rejected EXPLICIT_CANCELLATION` or `PREPARED` refused; no mutation |
| stale / barge-in | steps 1–3, then immediately interrupt VoiceStrike with `No wait, B148` before it finishes | `command_invalidated` / `tool_result STALE_COMMAND` for any tool call from the interrupted reply |
| reconnect | steps 1–3, then press Stop and reconnect before the tool call completes | after reconnect `TURN_AUTHORITY_REQUIRED` for any replayed call; recovery inspection first |
| expired | steps 1–2, wait > 20 s, then step 3 | `CONFIRMATION_EXPIRED`; no mutation |

### R16-C — repeat guard

After a verified reversal in R16-A, say `VoiceStrike, confirm reverse scan B184` again. Expected: no second mutation (`NO_PREPARED_CONFIRMATION` / `AUTHORITY_ALREADY_CONSUMED` / server `ALREADY_REVERSED` with `changed: false`), and no new success claim.

### R16-D — BUILD 3 / 5 / 6 regression after the authority change

- E1: `VoiceStrike, I think they've given me the wrong part.` → `B one eight four.` → job BLOCKED, WRONG_COMPONENT, mismatch B184 ≠ B148, correct part at C12 (two mutations `report_exception` + `update_job_status` in one worker turn must both execute — per-tool consumption does not block the second).
- E2: `VoiceStrike, the B148 location C12 is empty.` → discrepancy logged, C12 unavailable, alternative D05 qty 4.
- E3: R16-A.

## R17 — v0.8.9 sequential workflow isolation (Windows runtime)

Purpose: prove that a completed recovery command cannot contaminate the next unrelated workflow in the same long-lived Worker voice session.

Do **not** reconnect Worker between R16-A and this test. Server demo state may be reset from the separate Supervisor tab.

1. Complete R16-A successfully so the Worker session has a completed recovery conversation.
2. In Supervisor, use **Reset demo state**. Keep the Worker voice connection open.
3. Worker says: `VoiceStrike, I think I've got the wrong part.`
4. VoiceStrike should ask for the component identifier.
5. Worker says: `B184.`
6. Expected:
   - a **new commandId** is used for the wrong-component workflow;
   - command intent = `WRONG_COMPONENT`;
   - B184 remains on that same new commandId;
   - command becomes READY;
   - `get_current_job` and `check_component(B184)` are actually called (not blocked as `command still incomplete`);
   - if mismatch is confirmed, the existing E1 deterministic workflow may continue;
   - no stale `reverse scan` text/authority is reused by the new command.

FAIL if DEV telemetry shows `command_pending ... Read tool get_current_job/check_component blocked because the command is still incomplete` after B184, or if the new E1 command reuses the prior recovery commandId.


## R18 — v0.8.10 Worker/Supervisor session persistence (Windows runtime)

Purpose: prove that dashboard navigation does not create a voice reconnect or destroy reliability state.

1. Reset demo state and open Worker.
2. Start VoiceStrike and note the displayed `Session:` identifier.
3. Say `VoiceStrike, I think I've got the wrong part.` and wait for the component clarification.
4. Switch to Supervisor **in the same browser tab**, wait at least 3 seconds, then switch back to Worker.
5. PASS requirements after returning to Worker:
   - the same session identifier is still displayed;
   - `Start VoiceStrike` is **not** shown;
   - prior transcript remains visible;
   - DEV telemetry contains no `reliability.connection_lost` caused by the view switch.
6. Continue the same pending command with `B184`.
7. Expected: the existing command continues normally; no new wake/session handshake is required solely because Supervisor was viewed.
8. Repeat `Worker → Supervisor → Worker` once while idle/listening. Session identifier must remain unchanged.

Safety note: this test does not relax reconnect invalidation. A real WebSocket/network disconnect must still reset/recover authority according to BUILD 7.7. Only UI navigation is required to be non-destructive.

## R19 — v0.8.11 solicited clarification continuity (Windows runtime)

Purpose: prove that a worker can answer a VoiceStrike-requested clarification naturally without repeating the wake phrase, while unrelated ambient speech and protected mutation speech remain blocked.

1. Reset demo state. Keep Worker voice connected.
2. Say: `VoiceStrike, I think I've got the wrong part.`
3. Wait until VoiceStrike finishes asking for the component identifier. Do not rush; allow the ordinary 15 s wake window to expire if needed.
4. Reply only: `B184.` — **do not** say VoiceStrike again.
5. PASS requirements:
   - transcript `B184` is accepted under `CLARIFICATION_WINDOW`, not `WAKE_REQUIRED`;
   - same commandId is retained from the wrong-part intent;
   - intent remains `WRONG_COMPONENT` and command becomes READY;
   - `get_current_job` and `check_component(B184)` are actually called;
   - VoiceStrike does not ask the worker for a job/station identifier that the system can retrieve;
   - no mutation occurs until the existing E1 deterministic workflow authorises it.
6. Negative ambient control: repeat steps 1–3, then play/say unrelated TV-like speech. It must be ignored and must not consume the clarification window. Then answer `B184.` and it must still be accepted if within 30 s.
7. Command-binding control: a clarification window opened for one command must not authorise speech for a different/new command.
8. Expiry control: after VoiceStrike asks for clarification, wait >30 s, then say `B184.` without wake. Expected `WAKE_REQUIRED` and mutation 0.
9. Protected-speech control: even during a clarification window, `reverse scan B184` without `VoiceStrike` must still be rejected by CriticalSpeechTrustGate (`WAKE_PHRASE_REQUIRED`).


---

## R20 – R29 — v0.9.0 BUILD 7 Final Candidate runtime acceptance

The full v0.9.0 runtime campaign is specified in
`evidence/build7/v0.9.0_RUNTIME_ACCEPTANCE_PLAN.md`:

| Test | Covers |
|---|---|
| R20 | E1 deterministic mutation sequencing + premature-block negative control |
| R21 | truthful claim grounding after a locally blocked tool |
| R22 | read-only context bootstrap (`where can I find B148?`) |
| R23 | idle TV/ambient must produce no autonomous reply; clarification window preserved |
| R24 | natural cancellation of a pending protected action + negative controls |
| R25 | confirmation expiry as a hard lifecycle boundary, no transcript concatenation |
| R26 | full demo reset vs. Worker/Supervisor persistence |
| R27 | telemetry vocabulary and Copy diagnostics JSON |
| R28 | controlled audio corpus, keyterms A/B |
| R29 | E1 / E2 / E3 regression over live audio |

### Controlled corpus (spec §9)

`tests/reliability/reliability-corpus.json` contains 41 controlled cases covering: ordinary
English (`baseline`), strong/realistic UK accent variants (`accent`), technical IDs
(`technical_id`), fragmented IDs (`fragmented`), corrections (`correction`), interruptions
(`interruption`), TV/background speech (`ambient`), technical ID under noise (`noise`),
wake/no-wake controls (`wake_control`), protected confirmation stages
(`protected_confirmation`), cancellation (`cancellation`), and transcript-sanity/ambiguity
controls (`sanity`, `ambiguity`).

The keyterms A/B switch is unchanged: the same corpus is run once normally and once with
`http://localhost:5173/?keyterms=off`, same speaker, same utterances. Record both conditions.

**No accent, noise or keyterms metric may be reported unless it was measured on real audio.**
