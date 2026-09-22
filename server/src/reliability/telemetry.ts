import type { ReliabilityEvent } from './types.js';

// RC4: provider-event tracing needs a deeper buffer to hold a full E1/E2/E3 run.
const MAX_EVENTS = 3000;
const events: ReliabilityEvent[] = [];
let nextId = 1;

export function recordReliabilityEvent(input: Omit<ReliabilityEvent, 'id' | 'timestamp'> & { timestamp?: string }): ReliabilityEvent {
  const event: ReliabilityEvent = {
    ...input,
    id: nextId++,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return event;
}

export function listReliabilityEvents(): ReliabilityEvent[] {
  return [...events];
}

export function clearReliabilityEvents(): void {
  events.length = 0;
}
