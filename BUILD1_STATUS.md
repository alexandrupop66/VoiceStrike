# VoiceStrike BUILD 1 — Voice Vertical Slice

## Goal
Speak → AssemblyAI Voice Agent API → spoken reply.

No operational tools are enabled in Build 1. The agent is explicitly instructed not to claim it changed jobs, inventory, scans, or other operational state.

## Implemented
- Server-side temporary token endpoint: `GET /api/voice-token`
- API key remains server-side in `.env`
- Browser microphone capture with echo cancellation, noise suppression and auto gain
- AudioWorklet conversion to PCM16
- 24 kHz mono input/output path
- AssemblyAI Voice Agent WebSocket
- `session.update` with short VoiceStrike prompt and greeting
- Live user transcript (partial + final)
- Live agent transcript
- PCM reply playback
- Barge-in playback flush
- Clean `session.end` on disconnect
- Session ID logging into the existing audit log
- Build 1 status UI

## Local setup
1. Copy `.env.example` to `.env`.
2. Add the AssemblyAI key:
   `ASSEMBLYAI_API_KEY=...`
3. From the project root run:
   `npm install`
4. Run:
   `npm run dev`
5. Open `http://localhost:5173/` in Chrome/Edge.
6. Click **Start VoiceStrike**, allow microphone access, wait for **Ready**, then speak.

## Exit test
Build 1 is complete only when all are true:
- `GET http://localhost:3001/api/health` returns `build: 1` and `assemblyaiConfigured: true`.
- The browser asks for microphone permission.
- VoiceStrike speaks its greeting.
- User speech appears in the live transcript.
- VoiceStrike's spoken response is audible.
- Agent transcript appears in the UI.
- A `VOICE_SESSION_STARTED` entry appears in the Supervisor audit trail.

## Important
For Android testing later, `http://192.168.x.x:5173` is not a secure browser origin for microphone access. `http://localhost` is allowed on the laptop. Cross-device microphone testing will need HTTPS/tunnelling in a later step.
