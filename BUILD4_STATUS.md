# VoiceStrike BUILD 4 — Supervisor Live State

Status: READY FOR LOCAL VALIDATION
Version: 0.5.0

## Target

Make operational consequences of the voice workflow visible to a supervisor immediately and convincingly:

worker reports B184 → deterministic wrong-component workflow runs → SQLite state changes → server pushes authoritative state → supervisor sees BLOCKED / WRONG_COMPONENT / B148 at C12 without refreshing.

## New capability

### Server-Sent Events

`GET /api/events` keeps a lightweight one-way live channel open from the Node backend to every connected UI. Every audited operational event schedules a fresh authoritative state snapshot for connected clients.

The browser uses `EventSource` and automatically reconnects. While disconnected, a five-second snapshot fallback prevents the dashboard from becoming stale.

## Supervisor demo surface

The Supervisor view now shows:

- live-link connection state;
- production exception banner;
- observed vs expected component;
- job/status/station/open-exception metrics;
- correct-part location;
- last pushed event and server timestamp;
- latest audit entry highlighted;
- authoritative inventory table;
- reset control.

## Reliability fix carried into BUILD 4

BUILD 3 local validation exposed that ZIP archives can omit an empty `server/data` directory. BUILD 4 creates the directory in code before opening SQLite, so a fresh extraction must not crash with `Cannot open database because the directory does not exist`.

## Preserved BUILD 3 authority gates

- `check_component` determines MATCH/MISMATCH.
- `report_exception` is allowed only after a recent verified mismatch.
- only `WRONG_COMPONENT` is supported in this build.
- `BLOCKED` requires an open WRONG_COMPONENT exception.
- inventory values come from SQLite.
- speech does not directly mutate operational state.

## Exit criteria

BUILD 4 passes only after local runtime proves:

1. `/api/health` reports `build: 4`.
2. Fresh extraction starts without manually creating `server/data`.
3. Supervisor shows `LIVE LINK`.
4. Worker and Supervisor can be open at the same time in separate tabs/devices.
5. Wrong Component workflow still reaches the same deterministic final state as BUILD 3.
6. Supervisor changes to BLOCKED and shows the exception without manual refresh.
7. Live audit advances during the tool sequence.
8. Reset returns the job to IN_PROGRESS and clears exceptions live.
