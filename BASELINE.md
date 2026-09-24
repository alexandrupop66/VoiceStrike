# VoiceStrike Forensic Baseline

Date: 22/09/2026  
Candidate: `VoiceStrike_BUILD7_FINAL_RUNTIME_v0_10_0_RC5_CODE_OWNED_CLEAN`  
Uploaded archive: `VoiceStrike_BUILD7_FINAL_RUNTIME_v0.10.0_CLEAN.zip`

## 1. Source identity and Git baseline

| Requirement | Status | Evidence |
|---|---|---|
| Uploaded archive integrity | PASS | SHA-256 = `d4eb757ff7c3370a6a2d8df1992cebdd463f3d1b7ecd856760dc206d0f292dbb`, exactly matching the supplied hash file. |
| Existing candidate snapshotted without source edits | PASS | Local Git commit `750e5897d1eff9b601b2e41b6db49e0940d13e2b`. |
| Baseline tag | PASS | `baseline-original` -> `750e5897d1eff9b601b2e41b6db49e0940d13e2b`. |
| Baseline branch | PASS | `main`. |
| Tracked candidate files | PASS | 176 files in the exact uploaded candidate. |
| CI merge gate | NOT IMPLEMENTED | No `.github/workflows` CI configuration exists in the candidate. |
| Reproducible dependency lock | NOT IMPLEMENTED | No `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, or `yarn.lock` exists. |
| Full automated suite rerun in forensic environment | NOT TESTED | Archive contains historical automated-results evidence, but dependencies are not bundled and the dependency install attempt did not complete in the forensic environment. Under the new rules that historical text is not promoted to a fresh PASS. |
| Production build rerun in forensic environment | NOT TESTED | Same dependency constraint as above. |

External immutable file-hash manifest: `voicestrike-baseline-filehashes.sha256`.

## 2. Contract baseline

Architectural invariant: **LLM interprets. Code authorises.**

Golden path under test:

`voice input -> interpretation -> validation -> deterministic authority -> action -> independent verify -> truthful response -> supervisor/audit update`

The blueprint requires a recovery flow of inspect -> determine reversibility -> reverse -> verify resulting state, and explicitly forbids a success claim before tool confirmation. BUILD 7 strengthens this to independent authoritative verification before success is spoken.

## 3. Runtime acceptance matrix from 22/09/2026 evidence

| Requirement | Status | Evidence |
|---|---|---|
| E1 Wrong Component | PASS | Live transcript shows ambiguity clarification B148/B184, B184 selection, mismatch logged, job blocked, and verified B148/C12 guidance. |
| E2 Missing Inventory | PASS | Live transcript shows C12 reported empty -> discrepancy logged -> D05 / 4 returned on the first workflow. |
| E3 PREPARE | PASS | Live transcript reaches prepared reversal and requests the exact second-stage confirmation. |
| E3 CANCEL | PASS | Live transcript states preparation cancelled and nothing changed. |
| Fresh E3 after cancel -> PREPARE again | PASS | A new mistaken-scan cycle reaches PREPARE again. |
| E3 authoritative CONFIRM mutation/verification | PASS | Live tool evidence records `reverse_last_scan` as `completed` under the fresh E3 command. The forensic reproducer independently reaches `VERIFIED_SUCCESS`, reversed state = true, mutation count = 1. |
| E3 truthful spoken result | FAIL | Live transcript says twice: `I apologize, but I could not complete the reversal.` despite the authoritative reversal completing. Forensic reproducer produces the same contradiction and releases both audio chunks. |
| E3 end-to-end Golden Path | FAIL | The truthful-response stage contradicts the verified authoritative state. |

## 4. Bug

**ID:** `VS-001`  
**Title:** Verified E3 reversal can be narrated and played as failure  
**Status:** FAIL

### Required regression scenario

1. Fresh E3 mistaken-scan context.
2. `inspect_last_action` establishes exact reversible action/component.
3. `PREPARE` succeeds without mutation.
4. Worker says exact protected `CONFIRM` phrase.
5. Code-owned E3 executes the authoritative mutation.
6. Provider is allowed to emit its own `reverse_last_scan`; it joins the same code-owned execution.
7. Total reversal mutation count must remain exactly 1.
8. Independent verification returns `VERIFIED_SUCCESS` / reversed state.
9. Provider attempts: `I apologize, but I could not complete the reversal.`
10. That narration must not reach transcript/audio.

External regression reproducer: `VS-001-reproducer.mjs`.

### Baseline reproducer result

- PREPARE: `SECOND_CONFIRMATION_REQUIRED` — PASS.
- CONFIRM result: `VERIFIED_SUCCESS`, `verified=true` — PASS.
- Reversal mutation count: `1` — PASS.
- Provider call joins code-owned CONFIRM — PASS.
- False failure narration rejected — **FAIL**.
- False failure audio withheld — **FAIL**.
- Observed false failure narration count: `2`.
- Observed rejected-failure-claim count: `0`.
- Audio released for the two false replies: `480` samples in the harness.

The test therefore exits non-zero on the current candidate, as required for a bug reproducer.

## 5. Exact E3 CONFIRM path

### A. Worker confirmation -> code-owned execution

`client/src/voice/voiceAgent.ts:929-933`

A trusted, accepted, protected `REVERSE_CONFIRM` turn calls `startCodeOwnedProtectedAction(...)`.

`client/src/voice/voiceAgent.ts:1995-2058`

The code-owned action obtains `actionId` and `componentId` from deterministic protected-action state and invokes the same `reverse_last_scan` pipeline through a synthetic call.

### B. Mutation -> independent verification

`client/src/voice/voiceAgent.ts:1532-1644`

`CriticalConfirmationGate` validates PREPARE/CONFIRM authority.

`client/src/voice/voiceAgent.ts:1647-1743`

`executeVerifiedAction(...)` executes the mutation. A result is marked successful only through `canClaimSuccess(...)` after verification.

`client/src/reliability/safeAction.ts:81-100`

For `reverse_last_scan`, verification is a separate `inspect-last-action` read and requires exact action ID, component ID, and `reversed=true`.

`client/src/reliability/safeAction.ts:288-300`

Only a successful independent verification returns `outcome='VERIFIED_SUCCESS'` and `verified=true`.

`client/src/voice/voiceAgent.ts:1690-1710, 2451-2465`

Verified reversal evidence is written back into the command (`command.evidence.reversal`).

### C. Provider coexistence / result handoff

`client/src/voice/voiceAgent.ts:1327-1350`

If the provider emits `reverse_last_scan` for the same command, it **joins** the code-owned execution. It does not perform a second reversal.

`client/src/voice/voiceAgent.ts:2061-2079`

The shared code-owned result resolves provider waiters.

`client/src/voice/voiceAgent.ts:2240-2253, 2813-2845`

The verified result is queued and sent back as `tool.result`, which creates a provider tool-result continuation lifecycle.

### D. Reply generation -> claim gate -> audio

`client/src/voice/voiceAgent.ts:990-1022`

For an authorised E3 reply, speech enters `BUFFER` claim-gate mode.

`client/src/voice/voiceAgent.ts:1054-1067, 1095-1124`

Audio is buffered, the final agent text is checked by `assessAgentReplyClaims(...)`, and if `allowed`, audio is released and the transcript is surfaced.

`client/src/reliability/replyClaims.ts:81-126`

This is the defect boundary. The gate rejects **unsupported positive mutation claims** such as `reversed` when `command.evidence.reversal` is absent, but it has no rule that rejects a **failure claim that contradicts verified success**. A sentence such as `I could not complete the reversal` falls through to `return { allowed: true }`.

## 6. Root cause evidence

`VS-001` is **not** a mutation bug and **not** an independent-verification bug.

The regression harness establishes the following event order on the current code:

1. code-owned `CONFIRM` starts;
2. second-stage confirmation is accepted;
3. mutation request is sent;
4. provider's initial CONFIRM reply is authorised and its false failure audio is released;
5. provider `reverse_last_scan` joins code-owned CONFIRM;
6. independent verification records `VERIFIED_SUCCESS`;
7. code-owned result completes with `verified=true`;
8. verified `tool.result` is sent to provider;
9. a `TOOL_CONTINUATION` reply is authorised;
10. the provider repeats the same false failure narration;
11. the claim gate again releases its audio.

Therefore the exact root cause is:

> **Speech authority is one-directional. VoiceStrike prevents unsupported success claims, but does not enforce outcome consistency in both directions. The reply lifecycle permits both a pre-result bound reply and a post-result tool continuation; neither path rejects failure narration that conflicts with the authoritative E3 outcome.**

This explains both observed live failure sentences without requiring a second mutation.

## 7. Minimal structural change proposed — NOT IMPLEMENTED

No application code has been changed.

The smallest structural repair should remain entirely in the **reply/outcome authority layer**:

1. Give E3 CONFIRM an explicit authoritative speech outcome state: `PENDING`, then the final `ReliabilityOutcome` from the code-owned action.
2. While E3 CONFIRM is `PENDING`, no completion/failure narration may be released. Neutral progress language may be permitted, but outcome language must wait.
3. After the result exists, make the speech gate bidirectional:
   - `VERIFIED_SUCCESS` permits verified-success wording and rejects failure/"could not complete" wording;
   - non-success/unknown outcomes reject success wording.
4. A rejected contradiction must not fall back to the current generic `I could not verify...` message when verified success actually exists. The repair path must use the authoritative outcome, or suppress the wrong reply and request a grounded correction.
5. Keep provider `reverse_last_scan` as a **joiner only**. It must never become separate mutation authority.
6. Add `VS-001` permanently to the event-pipeline regression suite and assert both transcript and released audio, not merely mutation count/tool result.

This is a proposal only. Implementation requires Alex's approval and must occur on a separate branch such as `fix/VS-001-e3-spoken-outcome-authority`.

## 8. Protected zones — must remain unchanged for VS-001

To protect the demonstrated E1/E2 behaviour, the VS-001 branch should not alter:

- `client/src/reliability/commands.ts` entity resolution / command construction;
- E1 wrong-component workflow sequencing;
- E2 deterministic `continueDeterministicE2(...)` orchestration;
- E2 inventory/location/quantity claim rules except shared interfaces strictly required by the speech-outcome gate;
- `client/src/reliability/confirmation.ts` PREPARE/CANCEL/two-turn confirmation semantics;
- `client/src/reliability/protectedSpeech.ts` protected speech windows;
- `client/src/reliability/authority.ts` turn mutation authority;
- `client/src/reliability/safeAction.ts` mutation + independent verification semantics;
- `server/src/routes/api.ts` reverse endpoint and E1/E2 operational endpoints;
- database schema/seed state.

Expected implementation surface: primarily `replyClaims.ts`, the reply-gate wiring in `voiceAgent.ts`, and regression tests. Any proposed change outside this surface requires separate root-cause evidence.

## 9. CI gate required before merge — NOT IMPLEMENTED

Before any VS-001 fix can be merged into `main`, the repository needs a reproducible CI gate. Proposed requirements after approval:

- commit a deterministic npm lockfile without dependency upgrades;
- GitHub Actions on pull requests and pushes to `main`;
- dependency install from lockfile;
- full existing validation suite;
- permanent `VS-001` regression;
- production build;
- integration/event-pipeline smoke tests;
- merge blocked on any failure.

Runtime proof remains required after CI PASS because this defect is specifically a voice reply lifecycle defect.

## 10. Forensic stop point

Current decision state:

- root cause evidence: PASS;
- failing regression reproducer: PASS as a reproducer (the product assertions intentionally FAIL);
- application fix: NOT IMPLEMENTED;
- fix branch: NOT IMPLEMENTED;
- CI merge gate: NOT IMPLEMENTED;
- post-fix regression: NOT TESTED;
- post-fix runtime proof: NOT TESTED;
- merge: NOT IMPLEMENTED.

**STOP. Await Alex approval before creating the fix branch or modifying application code.**
