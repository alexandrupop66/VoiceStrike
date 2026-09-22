# BUILD 4 Test Plan — Supervisor Live State

## A. Startup

- Freshly extract BUILD 4.
- Copy `.env` only; do not create `server/data` manually.
- `npm install`
- `npm run dev`
- PASS: server starts and prints `VoiceStrike Build 4 API running at http://localhost:3001`.
- PASS: `/api/health` returns `build: 4` and `assemblyaiConfigured: true`.

## B. Live channel

- Open `http://localhost:5173/`.
- Switch to Supervisor.
- PASS: connection badge becomes `LIVE LINK`.
- PASS: Last pushed event initially shows the SSE connection state.

## C. Two-screen primary demo

Use two tabs or devices on the same running app.

1. Supervisor screen remains visible.
2. Worker screen starts VoiceStrike.
3. Say: `I think they have given me the wrong part.`
4. When asked, say: `B one eight four.`
5. Do not manually refresh Supervisor.

PASS when Supervisor visibly progresses to:

- job `JOB-482` → `BLOCKED`;
- open exception count → `1`;
- production exception banner appears;
- `B184 ≠ B148` is shown;
- `B148` location `C12` is shown;
- latest audit moves through the operational tool events.

## D. Authoritative final state

`GET /api/state` must contain:

- job status `BLOCKED`;
- one open `WRONG_COMPONENT` exception;
- audit evidence for `TOOL_CHECK_COMPONENT`;
- `TOOL_REPORT_EXCEPTION`;
- `TOOL_UPDATE_JOB_STATUS`;
- `TOOL_CHECK_INVENTORY`.

## E. Live reset

- Press `Reset demo state` on Supervisor.
- Do not refresh.
- PASS: job returns to `IN_PROGRESS` and open exceptions returns to `0` through the live channel.

## F. Reconnection resilience

- If the SSE stream is temporarily interrupted, UI should show `RECONNECTING` rather than presenting stale state as live.
- EventSource should reconnect automatically.
- Snapshot fallback is allowed only while the live stream is unavailable.
