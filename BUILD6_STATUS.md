# VoiceStrike BUILD 6 — Mistaken Scan / Recovery

Status: **READY FOR WINDOWS RUNTIME VALIDATION**
Version: **0.7.0**

## Goal

Demonstrate a safe recovery workflow for a mistaken component scan:

**worker report → inspect authoritative last action → verify reversibility → require action-specific confirmation → reverse exact scan → verify post-action state → live supervisor evidence**

## Demo seed

The demo starts with a reversible last action:

- Action: `ACT-SCAN-B184`
- Job: `JOB-482`
- Type: `SCAN_COMPONENT`
- Component: `B184`
- Reversible: `true`
- Reversed: `false`

`Reset demo state` restores this exact recovery scenario.

## New tools

### `inspect_last_action()`
Read-only. Returns the authoritative latest action, component, reversibility, reversed state, and `recovery_eligible`.

### `reverse_last_scan(action_id, component_id)`
Mutation with deterministic authority gates. The browser also supplies the **latest final user transcript** to the server; the model cannot supply or invent this field.

The server refuses reversal unless all are true:

1. latest action exists;
2. it is `SCAN_COMPONENT`;
3. it is marked reversible;
4. it is not already reversed;
5. action ID matches the exact current latest action;
6. component matches the exact scanned component;
7. that exact action was inspected as recovery-eligible within the last two minutes;
8. latest final worker transcript contains the action-specific words `reverse`, `scan`, and the exact component (`B184`).

Bare `yes`, `yeah`, `okay`, `do it`, `done`, etc. cannot satisfy the deterministic confirmation gate.

## Recovery conversation target

Worker:
> I scanned B184 by mistake.

VoiceStrike inspects the last action and should ask for explicit action-specific confirmation, for example:
> The last action was a reversible scan of B184. Say “reverse scan B184” to confirm.

Worker:
> Reverse scan B184.

VoiceStrike calls `reverse_last_scan`, then **must call `inspect_last_action` again** and only claim success when the authoritative action returns `reversed: true`.

Expected final answer, semantically:
> The B184 scan has been reversed and the recovery is verified.

## Supervisor live evidence

After successful recovery, Supervisor should update without refresh and show:

- `RECOVERY VERIFIED`
- `B184 scan → REVERSED`
- action `ACT-SCAN-B184`
- current action state `REVERSED`
- audit events including `TOOL_INSPECT_LAST_ACTION`, `TOOL_REVERSE_LAST_SCAN`, and a second `TOOL_INSPECT_LAST_ACTION`.

## Safety principle

**Speech is input, not authority. LLM interprets. Code authorises.**

BUILD 6 specifically demonstrates that a generic verbal approval is insufficient for a critical recovery mutation.
