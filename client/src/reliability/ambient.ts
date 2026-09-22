import { hasOperationalSignal, isClarificationContinuation, isOperationalContinuation } from './transcript.js';

export type AmbientGateStatus =
  | 'WAKE_ACCEPTED'
  | 'ACTIVE_WINDOW'
  | 'CLARIFICATION_WINDOW'
  | 'WAKE_REQUIRED'
  | 'AMBIENT_IGNORED';

export type AmbientGateDecision = {
  accepted: boolean;
  status: AmbientGateStatus;
  wakeActive: boolean;
  activeUntil: number;
};

export type AmbientGateOptions = {
  hasActiveCommand?: boolean;
  awaitingClarification?: boolean;
  activeCommandId?: string | null;
  now?: number;
};

const WAKE_WINDOW_MS = 15_000;
export const CLARIFICATION_WINDOW_MS = 30_000;
const WAKE_PATTERN = /\bvoice\s*strike\b/i;

export function containsWakePhrase(text: string): boolean {
  return WAKE_PATTERN.test(String(text ?? ''));
}

/**
 * Ambient/wake authority for normal worker speech.
 *
 * BUILD 7 v0.8.11 adds a narrow solicited-clarification window: once VoiceStrike
 * has finished asking for missing information on a COLLECTING command, the worker
 * may answer that specific clarification without repeating the wake phrase. The
 * window is command-bound, expires independently, accepts only clarification-like
 * continuations, and is consumed on the first accepted reply.
 *
 * Protected mutation speech is NOT relaxed here. CriticalSpeechTrustGate runs
 * before this gate and still requires an explicit VoiceStrike wake phrase for
 * reverse/confirm-reverse commands.
 */
export class AmbientSpeechGate {
  private activeUntil = 0;
  private clarificationUntil = 0;
  private clarificationCommandId: string | null = null;

  reset(): void {
    this.activeUntil = 0;
    this.clearClarificationWindow();
  }

  isActive(now = Date.now()): boolean {
    return now <= this.activeUntil;
  }

  expiresAt(): number {
    return this.activeUntil;
  }

  openClarificationWindow(commandId: string, now = Date.now()): void {
    if (!commandId) {
      this.clearClarificationWindow();
      return;
    }
    this.clarificationCommandId = commandId;
    this.clarificationUntil = now + CLARIFICATION_WINDOW_MS;
  }

  clearClarificationWindow(): void {
    this.clarificationCommandId = null;
    this.clarificationUntil = 0;
  }

  clarificationExpiresAt(commandId?: string | null): number {
    if (commandId && commandId !== this.clarificationCommandId) return 0;
    return this.clarificationUntil;
  }

  isClarificationActive(commandId: string | null | undefined, now = Date.now()): boolean {
    return Boolean(
      commandId &&
      this.clarificationCommandId === commandId &&
      now <= this.clarificationUntil,
    );
  }

  assess(text: string, options: AmbientGateOptions = {}): AmbientGateDecision {
    const now = options.now ?? Date.now();

    if (containsWakePhrase(text)) {
      this.activeUntil = now + WAKE_WINDOW_MS;
      this.clearClarificationWindow();
      return { accepted: true, status: 'WAKE_ACCEPTED', wakeActive: true, activeUntil: this.activeUntil };
    }

    // A direct answer to an agent-requested clarification is conversationally authorised
    // even if the ordinary wake window expired while VoiceStrike was speaking/waiting.
    // The accepted clarification gets a fresh normal wake window so the read-only context
    // tools requested by the same reply can resolve immutable turn authority.
    //
    // v0.9.0 (defect 5.4 / regression R-G): the solicited window accepts only a real
    // operational continuation — a technical identifier, an identifier fragment, or explicit
    // operational content. A bare "yes"/"okay" from a television can no longer steal or
    // transfer a command-bound clarification window, and a bare approval was never authority
    // for anything in the first place.
    const solicitedClarification = Boolean(options.awaitingClarification) &&
      Boolean(options.hasActiveCommand) &&
      this.isClarificationActive(options.activeCommandId, now) &&
      isOperationalContinuation(text);

    if (solicitedClarification) {
      this.activeUntil = now + WAKE_WINDOW_MS;
      this.clearClarificationWindow();
      return { accepted: true, status: 'CLARIFICATION_WINDOW', wakeActive: true, activeUntil: this.activeUntil };
    }

    if (!this.isActive(now)) {
      return { accepted: false, status: 'WAKE_REQUIRED', wakeActive: false, activeUntil: this.activeUntil };
    }

    const clarification = Boolean(options.hasActiveCommand) && isClarificationContinuation(text);
    const operational = hasOperationalSignal(text);
    if (!operational && !clarification) {
      return { accepted: false, status: 'AMBIENT_IGNORED', wakeActive: true, activeUntil: this.activeUntil };
    }

    // Only accepted worker speech extends the wake window. Unrelated TV/background speech does not.
    this.activeUntil = now + WAKE_WINDOW_MS;
    return { accepted: true, status: 'ACTIVE_WINDOW', wakeActive: true, activeUntil: this.activeUntil };
  }
}
