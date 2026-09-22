import type { CriticalSpeechKind } from './criticalSpeech.js';
import { CONFIRMATION_TTL_MS } from './confirmation.js';
import { normalizeTechnicalId } from './entities.js';

/**
 * BUILD 7 v0.9.3 — command-bound protected speech windows.
 *
 * A protected reversal phrase is not trusted merely because it arrived some arbitrary amount of
 * time after the provider emitted `reply.done`. Provider completion and audible browser playback
 * are different clocks: PCM may still be queued locally after `reply.done`, while a worker may
 * naturally answer well before the old 1.5 s global quiet timer expires.
 *
 * The window is armed only by authoritative recovery state:
 *   INSPECT verified -> arm REVERSE_PREPARE (waiting for the instruction reply to finish)
 *   PREPARED        -> arm REVERSE_CONFIRM (waiting for the confirmation prompt to finish)
 *
 * The matching post-tool continuation reply opens the window only after the estimated local PCM
 * playback end plus a short real quiet gap. Rejected TV/ambient/echo speech never consumes the
 * window. Only a fully accepted protected turn consumes it.
 */
export type ProtectedSpeechExpectedKind = Extract<CriticalSpeechKind, 'REVERSE_PREPARE' | 'REVERSE_CONFIRM'>;
export type ProtectedSpeechWindowState = 'AWAITING_PROMPT_DONE' | 'OPEN';

export type ProtectedSpeechWindow = {
  id: string;
  epoch: number;
  commandId: string;
  actionId: string;
  componentId: string;
  expectedKind: ProtectedSpeechExpectedKind;
  state: ProtectedSpeechWindowState;
  armedAt: number;
  promptAudioDoneAt: number | null;
  opensAt: number | null;
  expiresAt: number | null;
  hardExpiresAt: number | null;
};

export type ProtectedSpeechWindowDecision =
  | { trusted: true; window: ProtectedSpeechWindow }
  | {
      trusted: false;
      reason:
        | 'PROTECTED_WINDOW_REQUIRED'
        | 'PROTECTED_WINDOW_EPOCH_MISMATCH'
        | 'PROTECTED_WINDOW_COMMAND_MISMATCH'
        | 'PROTECTED_WINDOW_KIND_MISMATCH'
        | 'PROTECTED_WINDOW_COMPONENT_MISMATCH'
        | 'PROTECTED_PROMPT_NOT_FINISHED'
        | 'PROTECTED_POST_TTS_QUIET_GAP_REQUIRED'
        | 'PROTECTED_WINDOW_EXPIRED'
        | 'PROTECTED_FRESH_SPEECH_REQUIRED';
      window: ProtectedSpeechWindow | null;
    };

/** Quiet time begins after estimated *audible* PCM playback, not provider reply.done. */
export const PROTECTED_POST_TTS_QUIET_MS = 550;
/** Preparation windows can wait for a natural worker response without keeping authority forever. */
export const PROTECTED_SPEECH_WINDOW_TTL_MS = 45_000;
const MAX_PROTECTED_VAD_AGE_MS = 12_000;

function copyWindow(window: ProtectedSpeechWindow): ProtectedSpeechWindow {
  return { ...window };
}

export class ProtectedSpeechWindowRegistry {
  private window: ProtectedSpeechWindow | null = null;
  private seq = 0;

  reset(): void {
    this.window = null;
  }

  current(): ProtectedSpeechWindow | null {
    return this.window ? copyWindow(this.window) : null;
  }

  arm(input: {
    epoch: number;
    commandId: string;
    actionId: string;
    componentId: string;
    expectedKind: ProtectedSpeechExpectedKind;
    hardExpiresAt?: number | null;
    now?: number;
  }): ProtectedSpeechWindow | null {
    const now = input.now ?? Date.now();
    const commandId = String(input.commandId ?? '').trim();
    const actionId = String(input.actionId ?? '').trim();
    const componentId = normalizeTechnicalId(input.componentId, 'component_id');
    if (!commandId || !actionId || !componentId) return null;
    this.seq += 1;
    this.window = {
      id: `protected-window-${this.seq}`,
      epoch: input.epoch,
      commandId,
      actionId,
      componentId,
      expectedKind: input.expectedKind,
      state: 'AWAITING_PROMPT_DONE',
      armedAt: now,
      promptAudioDoneAt: null,
      opensAt: null,
      expiresAt: null,
      hardExpiresAt: input.hardExpiresAt ?? null,
    };
    return copyWindow(this.window);
  }

  /**
   * Opens only for the authorised post-tool continuation that delivers the protected prompt.
   * `audibleDoneAt` is a wall-clock estimate including PCM already queued in AudioContext.
   */
  markPromptDone(input: { epoch: number; commandId: string | null; audibleDoneAt: number; now?: number }): ProtectedSpeechWindow | null {
    if (!this.window || this.window.state !== 'AWAITING_PROMPT_DONE') return null;
    const now = input.now ?? Date.now();
    if (input.epoch !== this.window.epoch) return null;
    if (!input.commandId || input.commandId !== this.window.commandId) return null;
    const audibleDoneAt = Math.max(now, input.audibleDoneAt);
    const opensAt = audibleDoneAt + PROTECTED_POST_TTS_QUIET_MS;
    const naturalExpiry = opensAt + (this.window.expectedKind === 'REVERSE_CONFIRM'
      ? CONFIRMATION_TTL_MS
      : PROTECTED_SPEECH_WINDOW_TTL_MS);
    const expiresAt = this.window.hardExpiresAt == null
      ? naturalExpiry
      : Math.min(naturalExpiry, this.window.hardExpiresAt);
    this.window = {
      ...this.window,
      state: 'OPEN',
      promptAudioDoneAt: audibleDoneAt,
      opensAt,
      expiresAt,
    };
    return copyWindow(this.window);
  }

  assess(input: {
    epoch: number;
    commandId: string | null;
    kind: CriticalSpeechKind;
    componentId: string | null;
    speechStartedAt: number | null;
    now?: number;
  }): ProtectedSpeechWindowDecision {
    const now = input.now ?? Date.now();
    const window = this.window;
    if (!window) return { trusted: false, reason: 'PROTECTED_WINDOW_REQUIRED', window: null };
    if (input.epoch !== window.epoch) return { trusted: false, reason: 'PROTECTED_WINDOW_EPOCH_MISMATCH', window: copyWindow(window) };
    if (!input.commandId || input.commandId !== window.commandId) return { trusted: false, reason: 'PROTECTED_WINDOW_COMMAND_MISMATCH', window: copyWindow(window) };
    if (input.kind !== window.expectedKind) return { trusted: false, reason: 'PROTECTED_WINDOW_KIND_MISMATCH', window: copyWindow(window) };
    const componentId = normalizeTechnicalId(input.componentId, 'component_id');
    if (!componentId || componentId !== window.componentId) return { trusted: false, reason: 'PROTECTED_WINDOW_COMPONENT_MISMATCH', window: copyWindow(window) };
    if (window.state !== 'OPEN' || window.opensAt == null || window.expiresAt == null) {
      return { trusted: false, reason: 'PROTECTED_PROMPT_NOT_FINISHED', window: copyWindow(window) };
    }
    if (now > window.expiresAt) return { trusted: false, reason: 'PROTECTED_WINDOW_EXPIRED', window: copyWindow(window) };
    const startedAt = input.speechStartedAt;
    if (startedAt == null || startedAt > now || now - startedAt > MAX_PROTECTED_VAD_AGE_MS) {
      return { trusted: false, reason: 'PROTECTED_FRESH_SPEECH_REQUIRED', window: copyWindow(window) };
    }
    if (startedAt < window.opensAt) {
      return { trusted: false, reason: 'PROTECTED_POST_TTS_QUIET_GAP_REQUIRED', window: copyWindow(window) };
    }
    return { trusted: true, window: copyWindow(window) };
  }

  /** Only a fully accepted matching worker turn consumes the window. Rejected speech never does. */
  consume(windowId: string): ProtectedSpeechWindow | null {
    if (!this.window || this.window.id !== windowId) return null;
    const consumed = copyWindow(this.window);
    this.window = null;
    return consumed;
  }
}
