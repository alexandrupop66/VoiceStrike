import type { ReliabilityTelemetryEvent } from './types.js';

export const RELIABILITY_EVENT_DOM = 'voicestrike:reliability';

// v0.9.0: every reliability event carries the conversation generation it belongs to, so a
// diagnostics export can prove that post-reset evidence is not mixed with pre-reset evidence.
let currentEpoch = 1;

export function setTelemetryEpoch(epoch: number): void {
  currentEpoch = epoch;
}

export function telemetryEpoch(): number {
  return currentEpoch;
}

export function emitReliabilityTelemetry(event: ReliabilityTelemetryEvent): void {
  const payload = {
    ...event,
    epoch: event.epoch ?? currentEpoch,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  // Local DEV observability is intentionally separate from operational audit.
  // It shows why speech was trusted/rejected without granting that speech authority.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RELIABILITY_EVENT_DOM, { detail: payload }));
  }

  void fetch('/api/reliability/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}
