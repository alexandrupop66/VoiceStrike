# VoiceStrike BUILD 1 — Validation Findings

Status: **PASS / COMPLETE**

Validated on 2026-09-12 using the browser microphone and AssemblyAI Voice Agent API.

## Confirmed working
- Browser microphone capture.
- Temporary server-minted AssemblyAI token.
- Live user transcription.
- Spoken agent reply.
- Live agent transcript.
- Operational identifier recognition test with `B184`.

## Reliability findings carried forward

### 1. Ambient Speech Contamination
A nearby second speaker can be captured and treated as user input. In a warehouse or manufacturing environment, speech heard by the microphone must not automatically become operational authority.

### 2. Uncertain / Foreign Transcript Drift
Unclear nearby speech produced severely incorrect transcripts, including unrelated Devanagari-script text. Low-quality or contextually implausible speech must be treated as uncertain rather than trusted for operational actions.

### 3. Short-Utterance Ambiguity
Very short utterances can be normalized or misheard. Observed examples included Romanian `da` being rendered as `Done`, and `asta e` being rendered as `That's it`.

## Architectural consequence
**Speech is input, not authority.**

**LLM interprets. Code authorises.**

Critical actions must eventually require deterministic validation, explicit action-specific confirmation, execution evidence, and post-action verification. A bare `yes`, `da`, or `ok` must never be sufficient on its own for a critical irreversible action.
