/**
 * BUILD 7 v0.9.0 — Session epoch.
 *
 * Root cause fixed here (defect 5.7): "Reset demo state" reseeded the backend but left the
 * browser conversation lifecycle alive (command registry, turn authorities, prepared
 * confirmations, clarification windows, accumulated protected transcript, in-flight tool
 * results). Old conversational state therefore contaminated later isolated runtime tests,
 * and asynchronous events from the pre-reset conversation could still repopulate new state.
 *
 * A SessionEpoch is a monotonic counter for one *conversation* lifecycle. It is bumped by an
 * explicit full demo reset and by a transport reconnect. Every asynchronous artefact that can
 * outlive its cause (pending tool results, in-flight mutation bookkeeping, reply bindings,
 * telemetry) carries the epoch it was created in; anything stamped with a superseded epoch is
 * dropped instead of applied.
 *
 * The epoch is deliberately NOT the AssemblyAI sessionId: a full demo reset must clear browser
 * conversation state without destroying the live voice session (v0.8.10 Worker/Supervisor
 * persistence must not regress).
 */
export const DEMO_RESET_EVENT_DOM = 'voicestrike:demo-reset';

export type SessionEpochReason = 'INITIAL' | 'DEMO_RESET' | 'RECONNECT' | 'DISCONNECT';

export type SessionEpochChange = {
  epoch: number;
  previousEpoch: number;
  reason: SessionEpochReason;
  at: number;
};

export class SessionEpochRegistry {
  private epoch = 1;
  private lastChange: SessionEpochChange;

  constructor(now = Date.now()) {
    this.lastChange = { epoch: 1, previousEpoch: 0, reason: 'INITIAL', at: now };
  }

  current(): number {
    return this.epoch;
  }

  /** Bumps the epoch. Every later `isCurrent()` check for the old epoch fails. */
  next(reason: SessionEpochReason, now = Date.now()): SessionEpochChange {
    const previousEpoch = this.epoch;
    this.epoch += 1;
    this.lastChange = { epoch: this.epoch, previousEpoch, reason, at: now };
    return this.lastChange;
  }

  isCurrent(epoch: number | null | undefined): boolean {
    return epoch === this.epoch;
  }

  change(): SessionEpochChange {
    return { ...this.lastChange };
  }
}
