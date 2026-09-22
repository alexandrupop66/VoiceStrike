import { useEffect, useState } from 'react';
import WorkerView from './components/WorkerView';
import SupervisorView from './components/SupervisorView';
import { getDashboardState } from './services/api';
import type { DashboardState } from './types';

type View = 'worker' | 'supervisor';
type LiveStatus = 'connecting' | 'live' | 'reconnecting';

type LiveEnvelope = {
  type: 'state';
  reason: string;
  eventId: number | null;
  serverTime: string;
  state: DashboardState;
};

export default function App() {
  const [view, setView] = useState<View>('worker');
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [lastLiveUpdate, setLastLiveUpdate] = useState<string | null>(null);
  const [lastLiveReason, setLastLiveReason] = useState('STARTING');

  useEffect(() => {
    let active = true;

    const loadSnapshot = async () => {
      try {
        const next = await getDashboardState();
        if (active) {
          setState(next);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    void loadSnapshot();

    const events = new EventSource('/api/events');
    events.onopen = () => {
      if (!active) return;
      setLiveStatus('live');
      setError(null);
    };
    events.onmessage = (message) => {
      if (!active) return;
      try {
        const envelope = JSON.parse(message.data) as LiveEnvelope;
        if (envelope.type !== 'state' || !envelope.state?.job) return;
        setState(envelope.state);
        setLastLiveUpdate(envelope.serverTime);
        setLastLiveReason(envelope.reason);
        setLiveStatus('live');
        setError(null);
      } catch {
        // Ignore malformed event data; EventSource will keep the live channel open.
      }
    };
    events.onerror = () => {
      if (!active) return;
      setLiveStatus('reconnecting');
      // EventSource automatically reconnects. A snapshot gives us a resilient fallback.
      void loadSnapshot();
    };

    // Safety net only. The primary path is server-pushed SSE, not polling.
    const fallbackTimer = window.setInterval(() => {
      if (events.readyState !== EventSource.OPEN) void loadSnapshot();
    }, 5000);

    return () => {
      active = false;
      events.close();
      window.clearInterval(fallbackTimer);
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">V</div>
          <div>
            <h1>VoiceStrike</h1>
            <p>Frontline Exception Copilot</p>
          </div>
        </div>
        <div className="build-tag">BUILD 7</div>
      </header>

      <nav className="view-switcher" aria-label="Select interface">
        <button className={view === 'worker' ? 'active' : ''} onClick={() => setView('worker')}>Worker</button>
        <button className={view === 'supervisor' ? 'active' : ''} onClick={() => setView('supervisor')}>Supervisor</button>
      </nav>

      {error && <div className="error-banner">API error: {error}</div>}
      {!state && !error && <div className="loading">Loading operational state…</div>}
      {state && (
        <>
          {/* Keep both views mounted. VoicePanel owns the live AssemblyAI session and
              must not disconnect merely because the operator inspects Supervisor. */}
          <div className="view-stage" data-view="worker" hidden={view !== 'worker'}>
            <WorkerView state={state} />
          </div>
          <div className="view-stage" data-view="supervisor" hidden={view !== 'supervisor'}>
            <SupervisorView
              state={state}
              liveStatus={liveStatus}
              lastLiveUpdate={lastLiveUpdate}
              lastLiveReason={lastLiveReason}
            />
          </div>
        </>
      )}

      <footer>
        <span>LLM interprets. Code authorises.</span>
        <span>Supervisor live state: SSE</span>
      </footer>
    </main>
  );
}
