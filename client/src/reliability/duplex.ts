import { normalizedPhrase } from './transcript.js';

export type DuplexGuardDecision = {
  blocked: boolean;
  reason: 'CRITICAL_WITHOUT_FRESH_SPEECH_START' | 'CRITICAL_DURING_AGENT_AUDIO' | 'ECHO_LIKE_DURING_AGENT_AUDIO' | 'CLEAR';
  similarity: number;
};

export type DuplexAssessOptions = {
  speechStartedAt?: number | null;
  now?: number;
};

const START_TAIL_MS = 550;
const RECENT_AGENT_TEXT_MS = 12_000;

function words(text: string): Set<string> {
  return new Set(
    normalizedPhrase(text)
      .split(/\s+/)
      .filter((word) => word.length > 1),
  );
}

function overlapScore(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap += 1;
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

export function isProtectedCriticalPhrase(text: string): boolean {
  const normalized = normalizedPhrase(text);
  return (
    /\breverse\b.*\bscan\b|\bscan\b.*\breverse\b/.test(normalized) ||
    /\bconfirm\b.*\breverse\b|\breverse\b.*\bconfirm\b/.test(normalized)
  );
}

export class DuplexEchoGuard {
  private agentReplyActive = false;
  private replyStartedAt = 0;
  private replyDoneAt = 0;
  private recentAgentText = '';
  private recentAgentTextAt = 0;

  reset(): void {
    this.agentReplyActive = false;
    this.replyStartedAt = 0;
    this.replyDoneAt = 0;
    this.recentAgentText = '';
    this.recentAgentTextAt = 0;
  }

  markReplyStarted(now = Date.now()): void {
    this.agentReplyActive = true;
    this.replyStartedAt = now;
  }

  noteAgentText(text: string, now = Date.now()): void {
    if (!text.trim()) return;
    this.recentAgentText = text;
    this.recentAgentTextAt = now;
  }

  markReplyDone(now = Date.now()): void {
    this.agentReplyActive = false;
    this.replyDoneAt = now;
  }

  isAgentReplyActive(): boolean {
    return this.agentReplyActive;
  }

  lastReplyDoneAt(): number {
    return this.replyDoneAt;
  }

  assessUserTranscript(text: string, options: DuplexAssessOptions = {}): DuplexGuardDecision {
    const now = options.now ?? Date.now();
    const speechStartedAt = options.speechStartedAt ?? null;
    const recentText = now - this.recentAgentTextAt <= RECENT_AGENT_TEXT_MS ? this.recentAgentText : '';
    const similarity = recentText ? overlapScore(text, recentText) : 0;
    const critical = isProtectedCriticalPhrase(text);

    if (critical && speechStartedAt == null) {
      return { blocked: true, reason: 'CRITICAL_WITHOUT_FRESH_SPEECH_START', similarity };
    }

    const startedAt = speechStartedAt ?? now;
    const beganDuringReply = this.agentReplyActive
      ? startedAt >= Math.max(0, this.replyStartedAt - 150)
      : this.replyStartedAt > 0 && startedAt >= this.replyStartedAt && startedAt <= this.replyDoneAt;
    const beganInPlaybackTail = this.replyDoneAt > 0 && startedAt > this.replyDoneAt && startedAt <= this.replyDoneAt + START_TAIL_MS;
    const beganInsideAgentAudioWindow = beganDuringReply || beganInPlaybackTail;

    // A critical recovery phrase that begins while VoiceStrike is speaking is never
    // accepted as worker authority. This prevents TTS/self-echo from turning the
    // agent's own prompt into a reversal command. The worker can repeat it after
    // VoiceStrike has finished.
    if (critical && beganInsideAgentAudioWindow) {
      return { blocked: true, reason: 'CRITICAL_DURING_AGENT_AUDIO', similarity };
    }

    // Non-critical barge-in/corrections stay available, but a transcript that strongly
    // resembles VoiceStrike's current/recent TTS and began inside that audio window is
    // treated as echo rather than worker speech.
    if (beganInsideAgentAudioWindow && similarity >= 0.72) {
      return { blocked: true, reason: 'ECHO_LIKE_DURING_AGENT_AUDIO', similarity };
    }

    return { blocked: false, reason: 'CLEAR', similarity };
  }
}
