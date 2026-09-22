# VoiceStrike BUILD 3 — Wrong Component

Status: READY FOR LOCAL VALIDATION
Version: 0.4.0

## Target

Demonstrate the first complete frontline exception workflow:

worker reports observed component B184 → authoritative comparison with JOB-482 expected B148 → WRONG_COMPONENT exception → deterministic BLOCKED transition → inventory lookup for B148 → concise spoken response → Supervisor dashboard update.

## New operational tools

- `check_component(component_id)` — read-only deterministic comparison against the current job.
- `report_exception(type, observed_component, details)` — mutation allowed only for `WRONG_COMPONENT`, with mismatch re-validation in code.
- `update_job_status(status)` — only `BLOCKED`, and only when an open WRONG_COMPONENT exception exists.
- `check_inventory(component_id)` — read-only authoritative inventory lookup.
- Existing `get_current_job()` remains available.

## Authority model

**Speech is input, not authority. LLM interprets. Code authorises.**

The agent cannot create a wrong-component exception when the observed component matches the expected component. It cannot block a job unless an open WRONG_COMPONENT exception already exists. Unsupported mutation requests are rejected by backend code and audited.

## Demo state

- Job: `JOB-482`
- Station: `3040`
- Expected component: `B148`
- Observed wrong component for demo: `B184`
- B148 inventory: location `C12`, quantity `7`

## Primary voice test

1. Start VoiceStrike.
2. Say: `I think they have given me the wrong part.`
3. When asked, say: `B one eight four.`
4. Expected final state:
   - JOB-482 → `BLOCKED`
   - one open `WRONG_COMPONENT` exception
   - B184 recorded as mismatch against B148
   - B148 inventory returned as C12 / 7
   - spoken response explains required component, block, logged mismatch, and correct location.
5. Supervisor dashboard should update within polling interval.

## Negative authority tests

- Reporting B148 must return MATCH and must not create an exception.
- Direct `update_job_status(BLOCKED)` without an open WRONG_COMPONENT exception must be rejected.
- Exception type other than WRONG_COMPONENT must be rejected.

## Reset

Use the Supervisor `Reset demo state` button or `POST /api/demo/reset` between repeat tests.
