# VoiceStrike BUILD 2 — First Tool

## Goal
Voice → AssemblyAI → `get_current_job()` → deterministic local data → spoken answer.

BUILD 2 proves that VoiceStrike is an agent, not only a voice chatbot. The LLM may decide when to request operational context, but application code performs the lookup and supplies the authoritative result.

## P0 tool enabled
### `get_current_job()`
Read-only tool. No arguments.

Returns the current demo job from SQLite:
- job ID
- worker ID
- station
- expected component
- status

The tool is executed by VoiceStrike application code through the local backend. AssemblyAI never receives the API key for the local application and cannot directly mutate operational state in this build.

## Expected demo
Worker asks:
> What job am I working on?

Expected path:
1. AssemblyAI identifies that current operational state is required.
2. It emits `tool.call` for `get_current_job`.
3. Browser calls `GET /api/tools/get-current-job`.
4. Backend queries SQLite and records `TOOL_GET_CURRENT_JOB` in the audit log.
5. Browser returns `tool.result` after `reply.done` is the latest Voice Agent event.
6. Agent answers from the returned data, e.g. `JOB-482`, station `3040`, expected component `B148`.

## Safety boundary
- The tool is read-only.
- The LLM cannot invent or modify job state.
- Unknown tools are rejected by code.
- Tool failures are returned explicitly to the agent.
- Interrupted tool-call turns discard stale pending results.

## Exit criteria
BUILD 2 passes only when:
- `/api/health` returns `build: 2`.
- Voice loop from BUILD 1 still works.
- Asking for the current job causes a visible `get_current_job` tool call.
- Spoken answer contains authoritative values returned by SQLite.
- Supervisor audit shows `TOOL_GET_CURRENT_JOB`.
- A normal conversational question does not call the tool unnecessarily.
