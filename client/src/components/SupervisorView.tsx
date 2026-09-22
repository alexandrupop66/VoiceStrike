import { useMemo, useState } from 'react';
import type { AuditRecord, DashboardState } from '../types';
import { resetDemo } from '../services/api';
import { DEMO_RESET_EVENT_DOM } from '../reliability/session';
import StatusPill from './StatusPill';

type LiveStatus = 'connecting' | 'live' | 'reconnecting';

type Props = {
  state: DashboardState;
  liveStatus: LiveStatus;
  lastLiveUpdate: string | null;
  lastLiveReason: string;
};

function parseAfterState(item: AuditRecord | undefined): Record<string, unknown> | null {
  if (!item?.after_state) return null;
  try {
    return JSON.parse(item.after_state) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseActionPayload(payload: string | null): Record<string, unknown> {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function humanEvent(event: string): string {
  return event
    .replace(/^TOOL_/, '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

export default function SupervisorView({ state, liveStatus, lastLiveUpdate, lastLiveReason }: Props) {
  const [resetting, setResetting] = useState(false);
  const openExceptions = state.exceptions.filter(e => e.status !== 'RESOLVED');
  const wrongComponent = openExceptions.find(e => e.type === 'WRONG_COMPONENT');
  const inventoryDiscrepancy = openExceptions.find(e => e.type === 'INVENTORY_DISCREPANCY');

  const mismatch = useMemo(() => {
    const item = state.audit.find(a => a.event === 'TOOL_CHECK_COMPONENT');
    return parseAfterState(item);
  }, [state.audit]);

  const expected = state.inventory.find(item => item.component === state.job.expected_component);
  const alternative = state.alternatives?.find(item => item.component === state.job.expected_component && item.quantity > 0);
  const observed = typeof mismatch?.observed_component === 'string' ? mismatch.observed_component : null;
  const latestAudit = state.audit[0];
  const latestAction = state.actions?.[0];
  const latestActionPayload = parseActionPayload(latestAction?.payload ?? null);
  const latestActionComponent = typeof latestActionPayload.component === 'string' ? latestActionPayload.component : '—';
  const reverseAuditIndex = state.audit.findIndex(
    item => item.event === 'TOOL_REVERSE_LAST_SCAN'
  );

  const postReverseInspection = state.audit.find((item, index) => {
    if (
      reverseAuditIndex < 0 ||
      index >= reverseAuditIndex ||
      item.event !== 'TOOL_INSPECT_LAST_ACTION'
    ) {
      return false;
    }

    const inspected = parseAfterState(item);

    return (
      inspected?.id === latestAction?.id &&
      inspected?.component === latestActionComponent &&
      (inspected?.reversed === true || inspected?.reversed === 1)
    );
  });

  const recoveryVerified =
    latestAction?.type === 'SCAN_COMPONENT' &&
    latestAction.reversed === 1 &&
    Boolean(postReverseInspection);

  const reset = async () => {
    setResetting(true);
    try {
      await resetDemo();
      // v0.9.0 (defect 5.7): a demo reset is not only a backend reseed. Tell the Worker voice
      // panel to start a new session epoch so no command, authority, prepared confirmation,
      // clarification window or accumulated protected transcript survives into the next run.
      window.dispatchEvent(new CustomEvent(DEMO_RESET_EVENT_DOM, { detail: { at: Date.now() } }));
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="panel supervisor-panel">
      <div className="eyebrow">SUPERVISOR DASHBOARD</div>
      <div className="panel-header">
        <div>
          <h2>Live Operations</h2>
          <p>Authoritative state pushed from VoiceStrike</p>
        </div>
        <div className={`live-link live-link-${liveStatus}`}>
          <span className="live-pulse" />
          {liveStatus === 'live' ? 'LIVE LINK' : liveStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
        </div>
      </div>

      {recoveryVerified ? (
        <div className="critical-banner recovery-banner" aria-live="polite">
          <div>
            <span className="critical-kicker">RECOVERY VERIFIED</span>
            <strong>{latestActionComponent} scan → REVERSED</strong>
            <p>VoiceStrike verified the last action was reversible, required action-specific confirmation, executed the reversal, and re-checked the authoritative action state.</p>
          </div>
          <div className="critical-action">
            <span>Job</span><strong>{state.job.id}</strong>
            <span>Action</span><strong>{latestAction?.id ?? '—'}</strong>
            <span>State</span><strong>REVERSED</strong>
          </div>
        </div>
      ) : wrongComponent && state.job.status === 'BLOCKED' ? (
        <div className="critical-banner" aria-live="polite">
          <div>
            <span className="critical-kicker">PRODUCTION EXCEPTION ACTIVE</span>
            <strong>{observed ?? 'Observed component'} ≠ {state.job.expected_component}</strong>
            <p>{wrongComponent.description}</p>
          </div>
          <div className="critical-action">
            <span>Job</span><strong>{state.job.id}</strong>
            <span>Correct part</span><strong>{state.job.expected_component}</strong>
            <span>Location</span><strong>{expected?.location ?? '—'}</strong>
          </div>
        </div>
      ) : inventoryDiscrepancy ? (
        <div className="critical-banner inventory-banner" aria-live="polite">
          <div>
            <span className="critical-kicker">INVENTORY DISCREPANCY ACTIVE</span>
            <strong>{state.job.expected_component} @ {expected?.location ?? '—'} → REPORTED EMPTY</strong>
            <p>{inventoryDiscrepancy.description}</p>
          </div>
          <div className="critical-action">
            <span>Job</span><strong>{state.job.id}</strong>
            <span>Alternative</span><strong>{alternative?.location ?? 'NONE'}</strong>
            <span>Alt. qty</span><strong>{alternative?.quantity ?? 0}</strong>
          </div>
        </div>
      ) : (
        <div className="operations-clear">
          <span className="ready-dot" />
          <strong>No active production exception</strong>
          <span>{state.job.id} is {state.job.status.toLowerCase().replaceAll('_', ' ')}.</span>
        </div>
      )}

      <div className="metrics-grid">
        <div className="metric"><span>Active job</span><strong>{state.job.id}</strong></div>
        <div className="metric"><span>Station</span><strong>{state.job.station}</strong></div>
        <div className="metric"><span>Open exceptions</span><strong>{openExceptions.length}</strong></div>
        <div className="metric"><span>Status</span><StatusPill status={state.job.status} /></div>
      </div>

      <div className="live-strip">
        <div><span>Last pushed event</span><strong>{humanEvent(lastLiveReason)}</strong></div>
        <div><span>Server update</span><strong>{lastLiveUpdate ? new Date(lastLiveUpdate).toLocaleTimeString() : 'Waiting…'}</strong></div>
        <div><span>Latest audit</span><strong>{latestAudit ? humanEvent(latestAudit.event) : 'None'}</strong></div>
      </div>

      <h3>Current job</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Job</th><th>Worker</th><th>Station</th><th>Expected</th><th>Status</th></tr></thead>
          <tbody><tr><td>{state.job.id}</td><td>{state.job.worker_id}</td><td>{state.job.station}</td><td>{state.job.expected_component}</td><td><StatusPill status={state.job.status} /></td></tr></tbody>
        </table>
      </div>

      <h3>Recent operational action</h3>
      {latestAction ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Type</th><th>Component</th><th>Reversible</th><th>State</th></tr></thead>
            <tbody><tr>
              <td>{latestAction.id}</td>
              <td>{latestAction.type}</td>
              <td>{latestActionComponent}</td>
              <td>{latestAction.reversible === 1 ? 'YES' : 'NO'}</td>
              <td className={latestAction.reversed === 1 ? 'recovery-state' : ''}>{latestAction.reversed === 1 ? 'REVERSED' : 'ACTIVE'}</td>
            </tr></tbody>
          </table>
        </div>
      ) : <p className="transcript-empty">No recent operational action.</p>}

      <h3>Open exceptions</h3>
      {!openExceptions.length ? (
        <p className="transcript-empty">No open exceptions.</p>
      ) : (
        <div className="audit-list">
          {openExceptions.map(item => (
            <div className="audit-item exception-live" key={item.id}>
              <span>{new Date(item.created_at).toLocaleTimeString()}</span>
              <strong>{item.type}</strong>
              <small>{item.description}</small>
            </div>
          ))}
        </div>
      )}

      <h3>Inventory</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Component</th><th>Location</th><th>Qty</th><th>Availability</th></tr></thead>
          <tbody>{state.inventory.map(item => (
            <tr key={item.component} className={item.component === state.job.expected_component ? 'inventory-required' : ''}>
              <td>{item.component}</td><td>{item.location}</td><td>{item.quantity}</td><td>{item.quantity > 0 ? 'AVAILABLE' : 'EMPTY'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h3>Alternative stock</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Component</th><th>Location</th><th>Qty</th><th>Availability</th></tr></thead>
          <tbody>{(state.alternatives ?? []).map(item => (
            <tr key={`${item.component}-${item.location}`} className={item.component === state.job.expected_component ? 'inventory-required' : ''}>
              <td>{item.component}</td><td>{item.location}</td><td>{item.quantity}</td><td>{item.quantity > 0 ? 'AVAILABLE' : 'EMPTY'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h3>Live audit trail</h3>
      <div className="audit-list">
        {state.audit.map((item, index) => (
          <div className={`audit-item ${index === 0 ? 'audit-latest' : ''}`} key={item.id}>
            <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
            <strong>{humanEvent(item.event)}</strong>
            <small>{item.actor}</small>
          </div>
        ))}
      </div>

      <button className="voice-button" onClick={reset} disabled={resetting}>
        {resetting ? 'Resetting…' : 'Reset demo state'}
      </button>
    </section>
  );
}
