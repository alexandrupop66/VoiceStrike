import { containsWakePhrase } from './ambient.js';
import { normalizeTechnicalId } from './entities.js';
import { normalizedPhrase } from './transcript.js';

export type CriticalSpeechKind = 'NONE' | 'REVERSE_PREPARE' | 'REVERSE_CONFIRM';

export type CriticalSpeechRejectReason =
  | 'WAKE_PHRASE_REQUIRED'
  | 'NO_FRESH_VAD'
  | 'AGENT_AUDIO_ACTIVE'
  | 'POST_TTS_QUIET_GAP_REQUIRED'
  | 'RECOVERY_CONTEXT_REQUIRED'
  | 'RECOVERY_COMPONENT_MISMATCH'
  | 'NO_PREPARED_CONFIRMATION'
  | 'PREPARED_COMPONENT_MISMATCH'
  | 'CRITICAL_COMPONENT_REQUIRED';

export type CriticalSpeechDecision = {
  critical: boolean;
  kind: CriticalSpeechKind;
  trusted: boolean;
  score: number;
  componentId?: string;
  reason?: CriticalSpeechRejectReason;
};

export type CriticalSpeechTrustInput = {
  transcript: string;
  speechStartedAt?: number | null;
  now?: number;
  agentReplyActive: boolean;
  agentReplyDoneAt?: number | null;
  hasRecoveryContext: boolean;
  recoveryComponentId?: string | null;
  preparedComponentId?: string | null;
  /** v0.9.2: a command-bound ProtectedSpeechWindow already proved the real post-TTS timing. */
  protectedWindowTrusted?: boolean;
};

// Protected speech must begin after a real post-TTS quiet gap. This leaves
// non-critical barge-in/correction behavior untouched while making a mutation
// confirmation deliberately harder to source from speaker echo or TV bleed.
export const CRITICAL_POST_TTS_QUIET_MS = 1_500;
const MAX_VAD_AGE_MS = 12_000;

function tokenSet(text: string): Set<string> {
  return new Set(normalizedPhrase(text).toUpperCase().split(/\s+/).filter(Boolean));
}

export function classifyCriticalSpeech(text: string): CriticalSpeechKind {
  const tokens = tokenSet(text);
  const reverseScan = tokens.has('REVERSE') && tokens.has('SCAN');
  if (!reverseScan) return 'NONE';
  if (tokens.has('CONFIRM')) return 'REVERSE_CONFIRM';
  return 'REVERSE_PREPARE';
}

export function criticalSpeechComponent(text: string): string | null {
  // Keep this deterministic and conservative: a protected phrase must carry one
  // explicit component token such as B184. Fragment assembly remains the job of
  // the normal command resolver before the protected confirmation stage.
  const matches = normalizedPhrase(text).toUpperCase().match(/\b[A-Z]\s*-?\s*\d{2,6}\b/g) ?? [];
  const canonical = Array.from(new Set(matches.map((value) => normalizeTechnicalId(value, 'component_id')).filter(Boolean))) as string[];
  return canonical.length === 1 ? canonical[0] : null;
}

export class CriticalSpeechTrustGate {
  assess(input: CriticalSpeechTrustInput): CriticalSpeechDecision {
    const now = input.now ?? Date.now();
    const kind = classifyCriticalSpeech(input.transcript);
    if (kind === 'NONE') return { critical: false, kind, trusted: true, score: 1 };

    const componentId = criticalSpeechComponent(input.transcript);
    let score = 0;

    if (!containsWakePhrase(input.transcript)) {
      return { critical: true, kind, trusted: false, score, componentId: componentId ?? undefined, reason: 'WAKE_PHRASE_REQUIRED' };
    }
    score += 0.25;

    const speechStartedAt = input.speechStartedAt ?? null;
    if (speechStartedAt == null || speechStartedAt > now || now - speechStartedAt > MAX_VAD_AGE_MS) {
      return { critical: true, kind, trusted: false, score, componentId: componentId ?? undefined, reason: 'NO_FRESH_VAD' };
    }
    score += 0.25;

    if (input.agentReplyActive) {
      return { critical: true, kind, trusted: false, score, componentId: componentId ?? undefined, reason: 'AGENT_AUDIO_ACTIVE' };
    }

    const replyDoneAt = input.agentReplyDoneAt ?? 0;
    if (!input.protectedWindowTrusted && replyDoneAt > 0 && speechStartedAt - replyDoneAt < CRITICAL_POST_TTS_QUIET_MS) {
      return { critical: true, kind, trusted: false, score, componentId: componentId ?? undefined, reason: 'POST_TTS_QUIET_GAP_REQUIRED' };
    }
    score += 0.25;

    if (!componentId) {
      return { critical: true, kind, trusted: false, score, reason: 'CRITICAL_COMPONENT_REQUIRED' };
    }

    if (kind === 'REVERSE_CONFIRM') {
      const prepared = normalizeTechnicalId(input.preparedComponentId, 'component_id');
      if (!prepared) {
        return { critical: true, kind, trusted: false, score, componentId, reason: 'NO_PREPARED_CONFIRMATION' };
      }
      if (prepared !== componentId) {
        return { critical: true, kind, trusted: false, score, componentId, reason: 'PREPARED_COMPONENT_MISMATCH' };
      }
    } else if (!input.hasRecoveryContext) {
      return { critical: true, kind, trusted: false, score, componentId, reason: 'RECOVERY_CONTEXT_REQUIRED' };
    } else {
      const inspected = normalizeTechnicalId(input.recoveryComponentId, 'component_id');
      if (!inspected) {
        return { critical: true, kind, trusted: false, score, componentId, reason: 'RECOVERY_CONTEXT_REQUIRED' };
      }
      if (inspected !== componentId) {
        return { critical: true, kind, trusted: false, score, componentId, reason: 'RECOVERY_COMPONENT_MISMATCH' };
      }
    }

    score += 0.25;
    return { critical: true, kind, trusted: true, score, componentId };
  }
}
