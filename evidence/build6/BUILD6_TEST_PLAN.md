# BUILD 6 Runtime Test Plan

## Primary recovery
1. Reset demo state.
2. Start VoiceStrike.
3. Say: `I scanned B184 by mistake.`
4. Confirm VoiceStrike inspects the last action and asks for action-specific confirmation.
5. Say: `Reverse scan B184.`
6. Confirm spoken success only after re-inspection.
7. In Supervisor confirm live `RECOVERY VERIFIED` and `B184 scan → REVERSED`.
8. In `/api/state`, confirm action `ACT-SCAN-B184` has `reversed: 1` and audit contains inspect → reverse → inspect.

## Negative confirmation gate
1. Reset demo state.
2. Say: `I scanned B184 by mistake.`
3. When asked to confirm, say only: `Yes.`
4. Reversal must not occur. Action remains `reversed: 0`.

## Wrong component confirmation
1. Reset demo state.
2. Trigger mistaken-scan recovery.
3. Say: `Reverse scan B148.`
4. Server must reject; latest action is B184.

## Double reversal
1. Complete a successful reversal.
2. Attempt recovery again.
3. System must not perform a second mutation; the action is already reversed.
