# VoiceStrike — BUILD 7 Reliability

Current runtime candidate: **v0.10.0 RC3 — Command Context Closure / Runtime Ownership & Latency**. The operational source of truth is now command-scoped typed workflow state rather than accumulated transcript text. Existing E1/E2/E3 safety, protected E3 recovery, Worker/Supervisor persistence, and transcript Copy/Export are preserved. Deterministic acceptance is complete; BUILD 7 remains open only for the final live Windows/microphone/audio acceptance run.

VoiceStrike is a frontline exception copilot for warehouse/manufacturing work. BUILD 7 preserves the complete BUILD 0–6 workflows and adds reliability hardening for imperfect speech, stale commands, failures, independent verification, and recovery.

> **Speech is input, not authority. LLM interprets. Code authorises.**

## Current verified capability

A worker can report a wrong component by voice while a supervisor screen receives authoritative operational changes as they happen. The backend pushes SQLite state over Server-Sent Events (SSE), so the dashboard can show the mismatch, exception, blocked job and correct inventory location without manual refresh.

### Live path

`Voice → AssemblyAI → deterministic tools → SQLite → SSE push → Supervisor dashboard`

The live channel is backed by a snapshot fallback if the SSE connection temporarily drops.

### Seed demo

- Job: `JOB-482`
- Station: `3040`
- Expected: `B148`
- Wrong observed component: `B184`
- Correct inventory: `B148` at `C12`, stock `7`

## BUILD 5 additions

- `/api/events` SSE stream for authoritative state pushes.
- Supervisor **LIVE LINK** connection indicator.
- Immediate production-exception banner when the job becomes `BLOCKED`.
- Current mismatch, correct component and inventory location shown prominently.
- Live event metadata and highlighted latest audit item.
- Fallback snapshot refresh only while the SSE stream is reconnecting.
- Runtime fix: the SQLite data directory is created automatically even when the ZIP contains no empty `server/data` folder.
- Correct server console label: `VoiceStrike Build 4 API`.

## Run locally

1. Copy the previous build `.env` into this project root, or create `.env` with `ASSEMBLYAI_API_KEY`.
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:5173/`

For the strongest demo, open the app in **two browser tabs or two devices**:

- Tab/device 1: Worker
- Tab/device 2: Supervisor

On Worker, start VoiceStrike and say:

> “VoiceStrike, I think they’ve given me the wrong part.”
>
> “B one eight four.”

Expected Supervisor result without manual refresh:

- live link stays connected;
- `JOB-482` changes to `BLOCKED`;
- `WRONG_COMPONENT` appears;
- mismatch shows `B184 ≠ B148`;
- correct part `B148` at `C12` is visible;
- live audit trail advances as tools execute.

Use **Reset demo state** on Supervisor between repeat tests.

## Build validation

`npm run validate:build4`

See `BUILD4_STATUS.md` and `evidence/build4/BUILD4_TEST_PLAN.md` for acceptance criteria.


## BUILD 5 — Missing Inventory

The second production exception is now implemented: a worker can report that the system location for the current required component is physically empty. VoiceStrike first verifies the authoritative system record, then a deterministic backend gate records the discrepancy and marks that primary location operationally unavailable. It then finds seeded alternative stock (`B148` → `D05`, qty `4`) and pushes the complete state to Supervisor over SSE.

Recommended demo utterance: **"VoiceStrike, the B148 location C12 is empty."**

The system intentionally describes this as a **worker-reported inventory discrepancy**, not an independently verified physical count.

---

## BUILD 6 — Mistaken Scan / Recovery

BUILD 6 adds the first explicit **recovery / rollback** workflow. The demo is seeded with a reversible `B184` component scan. VoiceStrike inspects the authoritative last action, requires a two-turn wake-protected confirmation (`VoiceStrike, reverse scan B184` prepares; `VoiceStrike, confirm reverse scan B184` executes), reverses only that exact action, and then re-inspects the action before claiming success.

The confirmation gate is intentionally split across layers: AssemblyAI/LLM interprets intent, the browser forwards the **actual latest final worker transcript**, and server code checks the exact action/component/reversibility/recent-inspection/confirmation conditions. This preserves the project rule: **LLM interprets. Code authorises.**

See `BUILD6_STATUS.md` and `evidence/build6/BUILD6_TEST_PLAN.md`.

---

## BUILD 7 — Reliability

### v0.8.8 turn-bound authority

Tool calls are authorised by the immutable authority of the accepted worker turn that owns the command, not by live session speech state. Later echo/ambient/rejected transcripts cannot revoke a valid protected confirmation; authority never transfers to another command, session, or a stale command; one accepted turn authorises at most one attempt per mutation tool. See `BUILD7_STATUS.md` and `evidence/build7/v0.8.8_root_cause_and_audit.md`.

### v0.8.7 runtime hardening

- Voice Agent turn detection now leaves AssemblyAI adaptive/neural endpointing active instead of forcing 700/2200 ms fixed silence timers.
- Recovery preparation authority is bound to the exact command and can be restored only from a recent real `TOOL_INSPECT_LAST_ACTION` audit record for the same component.
- `RECOVERY_CONTEXT_REQUIRED` therefore means no command-bound authoritative inspection exists; it cannot be bypassed by conversational wording.

BUILD 7 hardens the existing three workflows rather than adding another business scenario.

New safety/reliability layers:

- critical technical-ID normalisation;
- Transcript Sanity Gate;
- **VoiceStrike wake phrase + Ambient Speech Gate**: before wake, nearby speech/TV is not operational authority and agent replies are suppressed;
- a 15-second clarification window that only accepted operational speech can extend;
- stronger browser microphone constraints: echo cancellation + noise suppression, AGC disabled, optional browser voice isolation, and a conservative local RMS noise gate;
- bidirectional clarification retention: intent → entity and entity → intent;
- fragmented-command state, including `B1 + 84` and `B1 + 8-4` → `B184` only inside an incomplete command;
- stale-command invalidation for corrections/barge-in;
- one verified-action executor for all current mutations;
- independent authoritative verification before success;
- no blind mutation retry when outcome is unknown;
- recovery-first reconnect;
- in-memory reliability telemetry;
- DEV/TEST-only failure injection;
- 30-case reliability corpus;
- keyterms A/B mode via `/?keyterms=off`.

Ambient contamination is now materially reduced by the wake phrase, suppression gates and microphone hardening. The remaining limitation remains explicit: **speech content alone cannot prove speaker identity**. A nearby person who deliberately says “VoiceStrike” and a complete valid protected command can still be indistinguishable without speaker authentication.

Run structural validation with:

`npm run validate:build7`

After dependencies are installed, run the deterministic reliability-core tests with:

`npm run test:reliability-core`

For the v0.10.0 closure candidate, run the complete automated gate:

`npm run validate:v0.10.0`

This includes BUILD 7 structural validation, reliability core, the repeated command-context A→Q scenario, provider ordering, and the exact live-session regression from 20/09/2026.

See `BUILD7_STATUS.md` and `evidence/build7/BUILD7_TEST_PLAN.md`.

## BUILD 7 v0.8.6 — Entity Confirmation Continuity + Truthful Tool Reporting

v0.8.6 preserves the v0.8.5 trust/echo protections and fixes two targeted runtime defects. Fragmented reconstruction such as `I scanned → B1 → 84` now waits for an explicit repeat of `B184` on the same command before `inspect_last_action` is allowed. Reliability-gate outcomes are also reported truthfully: a blocked or incomplete command is not labelled `TOOL_FAILED` unless an operational tool actually returned failure.

## BUILD 7 v0.8.5 — Critical Speech Trust

Permanent safety invariant: **False transcript may happen. False mutation must not.**

Protected reversal speech now passes a deterministic trust gate before it can enter command context. The gate requires wake authority, a fresh speech-start event, a post-TTS quiet interval, and valid recovery/prepared-confirmation context. Full mutation phrases are deliberately excluded from AssemblyAI keyterms. A collapsed Reliability DEV panel shows the last trust decisions without changing the operational audit trail.


### v0.8.11 persistent Worker/Supervisor navigation

`Worker → Supervisor → Worker` no longer destroys the live voice session. Both view trees remain mounted and navigation only changes visibility, so the same `VoicePanel` / `VoiceAgentClient` instance, sessionId, transcript and in-memory reliability authority survive dashboard inspection. This is a UI lifecycle fix only; reliability gates and mutation authority are unchanged. See R18 in `evidence/build7/BUILD7_TEST_PLAN.md`.

### v0.8.9 sequential workflow isolation

After v0.8.8 R16-A passed on Windows, conversational stress testing exposed cross-workflow command contamination in a long-lived Worker session. v0.8.9 narrows READY-command continuation to the intentional recovery progression only. A later unrelated `WRONG_COMPONENT` or other workflow starts a fresh commandId; no safety/readiness gate is relaxed. See `evidence/build7/v0.8.9_e1_session_isolation.md` and R17 in `BUILD7_TEST_PLAN.md`.
