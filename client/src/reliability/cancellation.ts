import { normalizeTechnicalId } from './entities.js';
import { normalizedPhrase } from './transcript.js';

/**
 * BUILD 7 v0.9.0 — Natural cancellation of a pending protected action.
 *
 * Root cause fixed here (defect 5.5): "VoiceStrike, actually don't reverse it." was accepted as
 * speech and then handled by the *correction* branch of CommandRegistry (it contains
 * "actually"), which built a replacement command carrying the previous reversal context
 * forward. Nothing ever touched CriticalConfirmationGate, whose prepared action lived in an
 * unrelated mutable holder with only a 20 s TTL — so VoiceStrike kept standing by for the
 * confirmation phrase it had just been told to abandon. No mutation occurred, but cancellation
 * failed, and safety depended on a timer rather than on the worker's instruction.
 *
 * Detection is deliberately contextual and conservative:
 *
 *   - it runs only when a compatible protected action is actually pending;
 *   - an unrelated "stop", "wait" or "don't" with no pending action is not a cancellation;
 *   - a phrase naming a different component than the pending action does not cancel it;
 *   - a second-stage confirmation phrase is never read as a cancellation.
 */
export type CancellationReason =
  | 'EXPLICIT_CANCEL_PHRASE'
  | 'NEGATED_PENDING_ACTION';

export type PendingActionContext = {
  actionId?: string | null;
  componentId?: string | null;
  commandId?: string | null;
};

export type CancellationAssessment =
  | { cancel: false }
  | { cancel: true; reason: CancellationReason; actionId: string | null; componentId: string | null; commandId: string | null };

// "cancel that", "stop", "never mind", "forget it", "don't do it", "abort that".
const EXPLICIT_CANCEL = /\b(?:cancel|abort|never\s*mind|nevermind|forget\s+it|scrap\s+that|call\s+it\s+off)\b/i;
const BARE_STOP = /(?:^|\s)(?:stop|halt)(?:\s+(?:it|that|there|now))?\s*$/i;
const NEGATED_DO = /\b(?:do\s*n'?t|do\s+not|dont)\b\s*(?:.{0,24}?)\b(?:do\s+it|reverse|reversal|proceed|continue|go\s+ahead|execute|run\s+it)\b/i;
const NEGATED_TRAILING = /\b(?:do\s*n'?t|do\s+not|dont)\b\s*(?:it|that|this)?\s*$/i;
const CONFIRMATION_PHRASE = /\bconfirm\b/i;

function mentionedComponents(text: string): string[] {
  const matches = normalizedPhrase(text).toUpperCase().match(/\b[A-Z]\s*-?\s*\d{2,6}\b/g) ?? [];
  return Array.from(new Set(matches.map((value) => normalizeTechnicalId(value, 'component_id')).filter(Boolean) as string[]));
}

export function assessCancellationIntent(text: string, pending: PendingActionContext | null | undefined): CancellationAssessment {
  // No compatible pending protected action: unrelated uses of stop/don't/wait are not cancellations.
  if (!pending?.actionId) return { cancel: false };

  const raw = String(text ?? '');
  const normalized = normalizedPhrase(raw);
  if (!normalized) return { cancel: false };

  // An explicit second-stage confirmation is the opposite instruction; never read it as cancellation.
  if (CONFIRMATION_PHRASE.test(normalized)) return { cancel: false };

  // Cancellation must be bound to the exact pending context. Naming a different component
  // is a new/other subject, not a cancellation of this action.
  const pendingComponent = normalizeTechnicalId(pending.componentId, 'component_id');
  const mentioned = mentionedComponents(raw);
  if (mentioned.length && pendingComponent && !mentioned.includes(pendingComponent)) return { cancel: false };
  if (mentioned.length > 1) return { cancel: false };

  if (EXPLICIT_CANCEL.test(normalized) || BARE_STOP.test(normalized)) {
    return {
      cancel: true,
      reason: 'EXPLICIT_CANCEL_PHRASE',
      actionId: pending.actionId ?? null,
      componentId: pendingComponent ?? null,
      commandId: pending.commandId ?? null,
    };
  }

  if (NEGATED_DO.test(normalized) || NEGATED_TRAILING.test(normalized)) {
    return {
      cancel: true,
      reason: 'NEGATED_PENDING_ACTION',
      actionId: pending.actionId ?? null,
      componentId: pendingComponent ?? null,
      commandId: pending.commandId ?? null,
    };
  }

  return { cancel: false };
}
