import type { DashboardState } from '../types';
import StatusPill from './StatusPill';
import VoicePanel from './VoicePanel';

export default function WorkerView({ state }: { state: DashboardState }) {
  const expected = state.inventory.find(i => i.component === state.job.expected_component);

  return (
    <section className="panel worker-panel">
      <div className="eyebrow">FRONTLINE WORKER</div>
      <div className="panel-header">
        <div>
          <h2>{state.job.id}</h2>
          <p>Station {state.job.station}</p>
        </div>
        <StatusPill status={state.job.status} />
      </div>

      <div className="hero-card">
        <span className="muted">Expected component</span>
        <strong>{state.job.expected_component}</strong>
        <small>{expected ? `Location ${expected.location} · Stock ${expected.quantity}` : 'Inventory unavailable'}</small>
      </div>

      <VoicePanel />

      <div className="mobile-note">Build 7 reliability: say “VoiceStrike” to wake → clarify critical IDs safely → deterministic action → independent verification.</div>
    </section>
  );
}
