import { normalizeTechnicalId } from './entities.js';
import { containsWakePhrase } from './ambient.js';
import { normalizedPhrase } from './transcript.js';

/**
 * BUILD 7 v0.9.0 — Pending protected action lifecycle.
 *
 * v0.8.4 introduced the two-stage reversal. v0.9.0 gives the prepared action an explicit,
 * observable lifecycle because cancellation (defect 5.5) and expiry (defect 5.6) were two
 * unrelated holes in the same mechanism:
 *
 *   PREPARED --confirm--> CONSUMED
 *      |  |--cancel-----> CANCELLED
 *      |  \--ttl--------> EXPIRED
 *
 * Reaching any terminal state writes a command-scoped tombstone. The tombstone makes replay on
 * the old command fail as CANCELLED / EXPIRED / ALREADY_CONSUMED, while a fresh command created
 * after a fresh authoritative inspection may prepare the same physical action again. A bare stale
 * "confirm reverse ..." phrase can never bootstrap that fresh preparation.
 *
 * Safety of the terminal states does not depend on the TTL: cancellation invalidates
 * immediately, and expiry is swept deterministically on every speech and reply boundary.
 */
export type ProtectedActionState = 'PREPARED' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'CONSUMED';

export type CriticalConfirmationDecision =
  | {
      status: 'PREPARED';
      code: 'SECOND_CONFIRMATION_REQUIRED';
      message: string;
      preparedCommandId: string;
      preparedTurnId: string;
      actionId: string;
      componentId: string;
    }
  | {
      status: 'CONFIRMED';
      preparedCommandId: string;
      preparedTurnId: string;
      actionId: string;
      componentId: string;
    }
  | {
      status: 'REJECTED';
      code:
        | 'EXPLICIT_CONFIRMATION_REQUIRED'
        | 'SECOND_CONFIRMATION_MUST_BE_NEW_TURN'
        | 'CONFIRMATION_PROMPT_NOT_READY'
        | 'CONFIRMATION_CONTEXT_MISMATCH'
        | 'CONFIRMATION_EXPIRED'
        | 'CONFIRMATION_CANCELLED'
        | 'CONFIRMATION_ALREADY_CONSUMED';
      message: string;
    };

export type CriticalConfirmationInput = {
  commandId: string;
  turnId: string;
  transcript: string;
  actionId: unknown;
  componentId: unknown;
  now?: number;
};

export type PreparedConfirmation = {
  preparedCommandId: string;
  preparedTurnId: string;
  actionId: string;
  componentId: string;
  /** Confirmation TTL starts only after the audible confirmation prompt has finished. */
  expiresAt: number | null;
  /** Safety cap if the provider never delivers/finishes the confirmation prompt. */
  promptDeadlineAt: number;
};

export type ProtectedActionTombstone = {
  state: Extract<ProtectedActionState, 'CANCELLED' | 'EXPIRED' | 'CONSUMED'>;
  commandId: string;
  actionId: string;
  componentId: string;
  at: number;
};

export const CONFIRMATION_TTL_MS = 20_000;
/** Provider handoff must produce an audible confirmation prompt within this bound. */
export const CONFIRMATION_PROMPT_DEADLINE_MS = 30_000;
/** A terminal protected action stays refusable well beyond its own TTL. */
export const TOMBSTONE_TTL_MS = 10 * 60_000;

function words(text: string): Set<string> {
  return new Set(normalizedPhrase(text).toUpperCase().split(/\s+/).filter(Boolean));
}

function hasFirstStagePhrase(text: string, componentId: string): boolean {
  const tokenSet = words(text);
  // A stale second-stage phrase must never bootstrap a new protected action merely because the
  // old command was cancelled/expired and a new commandId was allocated. Fresh preparation is
  // explicitly "reverse scan <component>" without CONFIRM.
  return containsWakePhrase(text)
    && tokenSet.has('REVERSE')
    && tokenSet.has('SCAN')
    && tokenSet.has(componentId)
    && !tokenSet.has('CONFIRM');
}

function hasSecondStagePhrase(text: string, componentId: string): boolean {
  const tokenSet = words(text);
  return containsWakePhrase(text)
    && tokenSet.has('REVERSE')
    && tokenSet.has('SCAN')
    && tokenSet.has(componentId)
    && tokenSet.has('CONFIRM');
}

export class CriticalConfirmationGate {
  private prepared: PreparedConfirmation | null = null;
  private tombstone: ProtectedActionTombstone | null = null;

  reset(): void {
    this.prepared = null;
    this.tombstone = null;
  }

  pending(): PreparedConfirmation | null {
    return this.prepared ? { ...this.prepared } : null;
  }

  lastTerminalState(): ProtectedActionTombstone | null {
    return this.tombstone ? { ...this.tombstone } : null;
  }

  /**
   * Deterministic expiry sweep. Called on every user transcript and reply boundary so expiry is
   * a real lifecycle event with a tombstone, not something discovered lazily by the next
   * mutation attempt. Returns the action that expired so the caller can invalidate its command.
   */
  sweep(now = Date.now()): PreparedConfirmation | null {
    this.forgetStaleTombstone(now);
    if (!this.prepared) return null;
    const deadline = this.prepared.expiresAt ?? this.prepared.promptDeadlineAt;
    if (now <= deadline) return null;
    const expired = { ...this.prepared };
    this.prepared = null;
    this.tombstone = {
      state: 'EXPIRED',
      commandId: expired.preparedCommandId,
      actionId: expired.actionId,
      componentId: expired.componentId,
      at: now,
    };
    return expired;
  }

  /**
   * Worker-instructed cancellation of the pending protected action. Safety is immediate and
   * does not wait for the TTL: the prepared authority is destroyed and the tombstone refuses
   * any later replay of the same confirmation.
   */
  cancel(now = Date.now()): PreparedConfirmation | null {
    if (!this.prepared) return null;
    const cancelled = { ...this.prepared };
    this.prepared = null;
    this.tombstone = {
      state: 'CANCELLED',
      commandId: cancelled.preparedCommandId,
      actionId: cancelled.actionId,
      componentId: cancelled.componentId,
      at: now,
    };
    return cancelled;
  }

  /**
   * Start the worker-visible confirmation TTL only after the authorised confirmation prompt
   * has finished audible playback and its post-TTS quiet gap has elapsed.
   */
  activateConfirmationWindow(input: {
    commandId: string;
    actionId: string;
    componentId: string;
    expiresAt: number;
  }): PreparedConfirmation | null {
    if (!this.prepared) return null;
    const componentId = normalizeTechnicalId(input.componentId, 'component_id') ?? '';
    if (
      this.prepared.preparedCommandId !== input.commandId ||
      this.prepared.actionId !== input.actionId ||
      this.prepared.componentId !== componentId ||
      !Number.isFinite(input.expiresAt)
    ) return null;
    this.prepared = { ...this.prepared, expiresAt: input.expiresAt };
    return { ...this.prepared };
  }

  assessReverse(input: CriticalConfirmationInput): CriticalConfirmationDecision {
    const now = input.now ?? Date.now();
    const actionId = String(input.actionId ?? '').trim();
    const componentId = normalizeTechnicalId(input.componentId, 'component_id') ?? '';

    if (!actionId || !componentId) {
      return {
        status: 'REJECTED',
        code: 'CONFIRMATION_CONTEXT_MISMATCH',
        message: 'The protected reversal is missing its exact action or component context.',
      };
    }

    this.sweep(now);

    const tombstone = this.tombstoneFor(input.commandId, actionId, componentId, now);
    if (tombstone) {
      if (tombstone.state === 'CANCELLED') {
        return {
          status: 'REJECTED',
          code: 'CONFIRMATION_CANCELLED',
          message: `The worker cancelled the prepared reversal of ${componentId}. Nothing was changed. A new reversal requires a fresh inspection and a fresh preparation phrase.`,
        };
      }
      if (tombstone.state === 'EXPIRED') {
        return {
          status: 'REJECTED',
          code: 'CONFIRMATION_EXPIRED',
          message: `The protected reversal confirmation for ${componentId} expired and its command is closed. Start again by saying \"VoiceStrike, I scanned ${componentId} by mistake\" so the current action can be inspected before any new preparation.`,
        };
      }
      return {
        status: 'REJECTED',
        code: 'CONFIRMATION_ALREADY_CONSUMED',
        message: `The prepared reversal of ${componentId} was already confirmed and executed once. Inspect authoritative state instead of repeating the confirmation.`,
      };
    }

    if (!this.prepared) {
      if (!hasFirstStagePhrase(input.transcript, componentId)) {
        return {
          status: 'REJECTED',
          code: 'EXPLICIT_CONFIRMATION_REQUIRED',
          message: `Say "VoiceStrike, reverse scan ${componentId}" to prepare this recovery action.`,
        };
      }

      this.prepared = {
        preparedCommandId: input.commandId,
        preparedTurnId: input.turnId,
        actionId,
        componentId,
        // v0.9.3: the worker's 20 s confirmation budget begins only after the confirmation
        // prompt is actually audible and the protected window opens. Until then only the short
        // provider handoff deadline applies.
        expiresAt: null,
        promptDeadlineAt: now + CONFIRMATION_PROMPT_DEADLINE_MS,
      };
      return {
        status: 'PREPARED',
        code: 'SECOND_CONFIRMATION_REQUIRED',
        message: `Reversal prepared but not executed. In a new turn say "VoiceStrike, confirm reverse scan ${componentId}".`,
        preparedCommandId: input.commandId,
        preparedTurnId: input.turnId,
        actionId,
        componentId,
      };
    }

    if (this.prepared.preparedCommandId !== input.commandId || this.prepared.actionId !== actionId || this.prepared.componentId !== componentId) {
      return {
        status: 'REJECTED',
        code: 'CONFIRMATION_CONTEXT_MISMATCH',
        message: 'The requested reversal no longer matches the prepared action. Inspect authoritative state again.',
      };
    }

    if (this.prepared.preparedTurnId === input.turnId) {
      return {
        status: 'REJECTED',
        code: 'SECOND_CONFIRMATION_MUST_BE_NEW_TURN',
        message: 'The second confirmation must come from a separate worker turn after the preparation response.',
      };
    }

    if (this.prepared.expiresAt == null && hasSecondStagePhrase(input.transcript, componentId)) {
      return {
        status: 'REJECTED',
        code: 'CONFIRMATION_PROMPT_NOT_READY',
        message: 'The confirmation prompt has not finished yet. Wait for VoiceStrike to finish the prompt, then confirm in a new turn.',
      };
    }

    if (!hasSecondStagePhrase(input.transcript, componentId)) {
      return {
        status: 'REJECTED',
        code: 'EXPLICIT_CONFIRMATION_REQUIRED',
        message: `Say "VoiceStrike, confirm reverse scan ${componentId}" in a new turn to execute the prepared recovery.`,
      };
    }

    const prepared = this.prepared;
    this.prepared = null;
    this.tombstone = {
      state: 'CONSUMED',
      commandId: prepared.preparedCommandId,
      actionId: prepared.actionId,
      componentId: prepared.componentId,
      at: now,
    };
    return {
      status: 'CONFIRMED',
      preparedCommandId: prepared.preparedCommandId,
      preparedTurnId: prepared.preparedTurnId,
      actionId,
      componentId,
    };
  }

  private tombstoneFor(commandId: string, actionId: string, componentId: string, now: number): ProtectedActionTombstone | null {
    this.forgetStaleTombstone(now);
    if (!this.tombstone) return null;
    // Tombstones close the exact protected command that reached a terminal state. They must not
    // blacklist the physical action/component for ten minutes: a fresh authoritative inspection
    // may legitimately create a new command for the same action after cancellation or expiry.
    if (this.tombstone.commandId !== commandId) return null;
    if (this.tombstone.actionId !== actionId || this.tombstone.componentId !== componentId) return null;
    return this.tombstone;
  }

  private forgetStaleTombstone(now: number): void {
    if (this.tombstone && now - this.tombstone.at > TOMBSTONE_TTL_MS) this.tombstone = null;
  }
}
