import { useEffect, useRef, useState } from 'react';
import { VoiceAgentClient, type ToolEvent, type TranscriptEntry, type VoiceStatus } from '../voice/voiceAgent';
import { RELIABILITY_EVENT_DOM } from '../reliability/telemetry';
import { DEMO_RESET_EVENT_DOM } from '../reliability/session';
import type { ReliabilityTelemetryEvent } from '../reliability/types';

// v0.9.0 (defect 5.8): 12 events lost causal evidence within seconds under TV/noise.
const RELIABILITY_HISTORY = 200;
// v0.9.5: preserve long stress-test evidence for the whole practical session. Reset clears it.
const TRANSCRIPT_HISTORY = 500;
const TOOL_HISTORY = 100;

function statusLabel(status: VoiceStatus): string {
  switch (status) {
    case 'connecting': return 'Connecting';
    case 'ready': return 'Ready';
    case 'listening': return 'Listening';
    case 'speaking': return 'Speaking';
    case 'error': return 'Error';
    default: return 'Disconnected';
  }
}

export default function VoicePanel() {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [detail, setDetail] = useState('AssemblyAI voice is ready to connect.');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reliabilityEvents, setReliabilityEvents] = useState<ReliabilityTelemetryEvent[]>([]);
  const [copyState, setCopyState] = useState<string | null>(null);
  const clientRef = useRef<VoiceAgentClient | null>(null);

  useEffect(() => {
    const onReliability = (event: Event) => {
      const detail = (event as CustomEvent<ReliabilityTelemetryEvent>).detail;
      if (!detail?.event) return;
      setReliabilityEvents((current) => [...current, detail].slice(-RELIABILITY_HISTORY));
    };
    window.addEventListener(RELIABILITY_EVENT_DOM, onReliability);

    const client = new VoiceAgentClient({
      onStatus: (next, nextDetail) => {
        setStatus(next);
        if (nextDetail) setDetail(nextDetail);
      },
      onTranscript: (entry) => {
        setTranscripts((current) => {
          const index = current.findIndex((item) => item.id === entry.id);
          if (index === -1) return [...current, entry].slice(-TRANSCRIPT_HISTORY);
          const copy = [...current];
          copy[index] = entry;
          return copy;
        });
      },
      onTranscriptRemove: (id) => {
        setTranscripts((current) => current.filter((item) => item.id !== id));
      },
      onToolEvent: (entry) => {
        setToolEvents((current) => {
          const index = current.findIndex((item) => item.id === entry.id);
          if (index === -1) return [...current, entry].slice(-TOOL_HISTORY);
          const copy = [...current];
          copy[index] = entry;
          return copy;
        });
      },
      onSessionId: setSessionId,
      onError: (message) => setError(message),
    });
    clientRef.current = client;

    // v0.9.0 (defect 5.7): an explicit "Reset demo state" is a FULL demo reset. It clears the
    // conversation lifecycle under a new session epoch and clears this panel, without
    // disconnecting the live voice session (Worker/Supervisor persistence is unchanged).
    const onDemoReset = () => {
      clientRef.current?.resetSession('DEMO_RESET');
      setTranscripts([]);
      setToolEvents([]);
      setReliabilityEvents([]);
      setError(null);
    };
    window.addEventListener(DEMO_RESET_EVENT_DOM, onDemoReset);

    return () => {
      window.removeEventListener(RELIABILITY_EVENT_DOM, onReliability);
      window.removeEventListener(DEMO_RESET_EVENT_DOM, onDemoReset);
      void client.disconnect();
      clientRef.current = null;
    };
  }, []);

  const copyDiagnostics = async () => {
    // Correlation identifiers only. No API keys, tokens or raw audio are ever exported.
    const diagnostics = {
      exportedAt: new Date().toISOString(),
      sessionId,
      epoch: clientRef.current?.currentEpoch() ?? null,
      events: reliabilityEvents.map((event) => ({
        timestamp: event.timestamp,
        epoch: event.epoch ?? null,
        event: event.event,
        turnId: event.turnId ?? null,
        commandId: event.commandId ?? null,
        actionId: event.actionId ?? null,
        componentId: event.componentId ?? event.entityValue ?? null,
        authorityId: event.authorityId ?? null,
        intent: event.intent ?? null,
        tool: event.tool ?? event.stage ?? null,
        attempted: event.attempted ?? null,
        outcome: event.outcome ?? null,
        resultClass: event.resultClass ?? null,
        latencyMs: event.latencyMs ?? null,
        detail: event.detail ?? null,
      })),
    };
    const text = JSON.stringify(diagnostics, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('Diagnostics copied');
    } catch {
      setCopyState('Clipboard unavailable — see console');
      console.log(text);
    }
    window.setTimeout(() => setCopyState(null), 4000);
  };

  const transcriptText = () => transcripts
    .filter((entry) => entry.final)
    .map((entry) => `${entry.role === 'worker' ? 'You' : 'VoiceStrike'}\n${entry.text}${entry.interrupted ? ' [interrupted]' : ''}`)
    .join('\n\n');

  const copyTranscript = async () => {
    const text = transcriptText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('Transcript copied');
    } catch {
      setCopyState('Clipboard unavailable — see console');
      console.log(text);
    }
    window.setTimeout(() => setCopyState(null), 4000);
  };

  const exportTranscript = () => {
    if (!transcripts.length) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      sessionId,
      epoch: clientRef.current?.currentEpoch() ?? null,
      transcript: transcripts.filter((entry) => entry.final).map((entry) => ({
        role: entry.role,
        text: entry.text,
        interrupted: Boolean(entry.interrupted),
      })),
      tools: toolEvents.map((event) => ({ name: event.name, status: event.status, detail: event.detail })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `voicestrike-transcript-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setCopyState('Transcript exported');
    window.setTimeout(() => setCopyState(null), 4000);
  };

  const connected = status !== 'idle' && status !== 'error';
  const busy = status === 'connecting';

  const connect = async () => {
    setError(null);
    setTranscripts([]);
    setToolEvents([]);
    setSessionId(null);
    setReliabilityEvents([]);
    try {
      await clientRef.current?.connect();
    } catch {
      // Error already surfaced through callbacks.
    }
  };

  const disconnect = async () => {
    await clientRef.current?.disconnect();
  };

  return (
    <div className="voice-stack">
      <div className={`voice-console voice-${status}`}>
        <div className="voice-console-head">
          <div>
            <span className="muted">AssemblyAI Voice Agent</span>
            <strong>{statusLabel(status)}</strong>
          </div>
          <span className={`voice-dot dot-${status}`} aria-hidden="true" />
        </div>

        <p className="voice-detail">{detail}</p>

        {!connected ? (
          <button className="voice-button voice-button-live" onClick={connect} disabled={busy}>
            <span className="mic">●</span>
            {busy ? 'Connecting…' : 'Start VoiceStrike'}
          </button>
        ) : (
          <button className="voice-button voice-button-stop" onClick={disconnect}>
            Disconnect voice
          </button>
        )}

        {sessionId && <small className="session-id">Session: {sessionId}</small>}
        {error && <div className="voice-error">{error}</div>}
      </div>

      <div className="tool-card">
        <div className="conversation-row">
          <span className="label">Operational tools</span>
          <strong>Wrong-component workflow</strong>
        </div>
        {!toolEvents.length ? (
          <p className="transcript-empty">Say “I think I have the wrong part” and provide the component ID to trigger the Build 4 workflow.</p>
        ) : (
          <div className="tool-event-list">
            {toolEvents.map((event) => (
              <div className={`tool-event tool-${event.status}`} key={event.id}>
                <strong>{event.name}</strong>
                <span>{event.status.toUpperCase()}</span>
                <small>{event.detail}</small>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="conversation-card voice-transcript-card">
        <div className="conversation-row">
          <span className="label">Live transcript</span>
          <span className="ready-dot" />
          <strong>{transcripts.length ? 'Conversation active' : 'Waiting for speech'}</strong>
          <div className="transcript-actions">
            <button className="voice-button" type="button" onClick={copyTranscript} disabled={!transcripts.length}>Copy transcript</button>
            <button className="voice-button" type="button" onClick={exportTranscript} disabled={!transcripts.length}>Export transcript JSON</button>
          </div>
        </div>
        {copyState && <small className="transcript-copy-state">{copyState}</small>}

        <div className="transcript-list" aria-live="polite">
          {!transcripts.length && (
            <p className="transcript-empty">Connect, allow microphone access, then say “VoiceStrike” to begin. Background speech is ignored while sleeping.</p>
          )}
          {transcripts.map((entry) => (
            <div className={`transcript-line transcript-${entry.role} ${entry.final ? '' : 'partial'}`} key={entry.id}>
              <span>{entry.role === 'worker' ? 'You' : 'VoiceStrike'}</span>
              <p>{entry.text}{entry.interrupted ? ' [interrupted]' : ''}</p>
            </div>
          ))}
        </div>
      </div>

      <details className="reliability-dev-card">
        <summary>Reliability DEV panel · last {reliabilityEvents.length}/{RELIABILITY_HISTORY} signals</summary>
        <div className="conversation-row">
          <button className="voice-button" onClick={copyDiagnostics} disabled={!reliabilityEvents.length}>
            Copy diagnostics JSON
          </button>
        </div>
        {!reliabilityEvents.length ? (
          <p className="transcript-empty">No reliability decisions yet.</p>
        ) : (
          <div className="reliability-event-list">
            {[...reliabilityEvents].reverse().map((event, index) => (
              <div className="reliability-event" key={`${event.timestamp ?? 'event'}-${index}`}>
                <strong>{event.event.replace('reliability.', '')}</strong>
                <span>{event.resultClass ?? event.outcome ?? 'INFO'}</span>
                <small>
                  {[
                    event.tool ?? event.stage,
                    event.attempted == null ? null : `attempted=${event.attempted}`,
                    event.commandId,
                    event.componentId ?? event.entityValue,
                  ].filter(Boolean).join(' · ') || '—'}
                </small>
                <small>{event.detail ?? '—'}</small>
              </div>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}
