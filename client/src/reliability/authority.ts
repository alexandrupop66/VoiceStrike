import type { CriticalSpeechKind } from './criticalSpeech.js';

/**
 * BUILD 7 v0.8.8 — Turn-bound authority.
 *
 * Root cause fixed here: until v0.8.7 the accepted-speech authority consulted by a
 * delayed `tool.call` was a single mutable session flag (`lastInputAuthorised`) that
 * every later rejected transcript (echo, ambient, untrusted critical speech) reset to
 * false. A valid protected confirmation could therefore be revoked by unrelated speech
 * that arrived between the accepted turn and the tool call.
 *
 * A TurnAuthority is created once, when a worker turn is ACCEPTED, and is immutable.
 * It can only be:
 *   - replaced by a later ACCEPTED turn (new authority for that turn),
 *   - cleared on reconnect/disconnect,
 *   - made unusable because its command is no longer current (correction, barge-in,
 *     cancellation, supersede), or because it expired, or because the mutation it
 *     authorised was already attempted.
 *
 * There is intentionally NO API that lets rejected speech revoke an authority.
 * There is also NO API that lets an authority be re-bound to another command.
 */
export type TurnAuthority = {
  readonly sessionId: string | null;
  readonly turnId: string;
  readonly commandId: string;
  readonly transcript: string;
  readonly wakeAuthorised: boolean;
  readonly criticalSpeechTrusted: boolean;
  readonly criticalKind: CriticalSpeechKind;
  readonly intent?: string;
  readonly componentId?: string;
  readonly createdAt: number;
  readonly expiresAt: number;
};

export type AuthorityRejectReason =
  | 'NO_ACCEPTED_TURN'
  | 'SESSION_MISMATCH'
  | 'COMMAND_MISMATCH'
  | 'COMMAND_NOT_CURRENT'
  | 'AUTHORITY_EXPIRED'
  | 'WAKE_NOT_AUTHORISED'
  | 'CRITICAL_SPEECH_NOT_TRUSTED'
  | 'MUTATION_ALREADY_CONSUMED';

export type AuthorityResolution =
  | { ok: true; authority: TurnAuthority }
  | { ok: false; reason: AuthorityRejectReason; authority: TurnAuthority | null };

export type GrantTurnAuthorityInput = {
  sessionId: string | null;
  turnId: string;
  commandId: string;
  transcript: string;
  wakeAuthorised: boolean;
  criticalSpeechTrusted: boolean;
  criticalKind: CriticalSpeechKind;
  intent?: string;
  componentId?: string | null;
  now?: number;
};

export type ResolveTurnAuthorityInput = {
  commandId: string;
  sessionId: string | null;
  isCommandCurrent: boolean;
  now?: number;
  /** Set for critical mutations (reverse_last_scan): the accepted turn must itself be trusted protected speech (prepare or confirm stage). */
  requireCriticalTrust?: boolean;
  /** Set for mutation tools: the same authority may attempt a given mutation tool only once. */
  mutationToolName?: string;
};

// Conservative upper bound between an accepted worker turn and the tool call it
// authorises. It is not a semantic timeout; command invalidation and the 20 s
// protected-confirmation TTL remain the primary staleness controls.
export const TURN_AUTHORITY_TTL_MS = 60_000;

function authorityKey(authority: TurnAuthority): string {
  return `${authority.sessionId ?? ''}|${authority.turnId}|${authority.commandId}`;
}

export function resolveTurnAuthority(authority: TurnAuthority | null, input: ResolveTurnAuthorityInput, consumed: ReadonlySet<string>): AuthorityResolution {
  const now = input.now ?? Date.now();
  if (!authority) return { ok: false, reason: 'NO_ACCEPTED_TURN', authority: null };
  if ((authority.sessionId ?? null) !== (input.sessionId ?? null)) return { ok: false, reason: 'SESSION_MISMATCH', authority };
  if (authority.commandId !== input.commandId) return { ok: false, reason: 'COMMAND_MISMATCH', authority };
  if (!input.isCommandCurrent) return { ok: false, reason: 'COMMAND_NOT_CURRENT', authority };
  if (now < authority.createdAt || now > authority.expiresAt) return { ok: false, reason: 'AUTHORITY_EXPIRED', authority };
  if (!authority.wakeAuthorised) return { ok: false, reason: 'WAKE_NOT_AUTHORISED', authority };
  if (input.requireCriticalTrust && (authority.criticalKind === 'NONE' || !authority.criticalSpeechTrusted)) {
    return { ok: false, reason: 'CRITICAL_SPEECH_NOT_TRUSTED', authority };
  }
  if (input.mutationToolName && consumed.has(`${authorityKey(authority)}|${input.mutationToolName}`)) {
    return { ok: false, reason: 'MUTATION_ALREADY_CONSUMED', authority };
  }
  return { ok: true, authority };
}

export class TurnAuthorityRegistry {
  private accepted: TurnAuthority | null = null;
  private readonly consumedMutations = new Set<string>();

  /** Called exactly once per ACCEPTED worker turn. Rejected speech never reaches this. */
  grant(input: GrantTurnAuthorityInput): TurnAuthority {
    const now = input.now ?? Date.now();
    const authority: TurnAuthority = Object.freeze({
      sessionId: input.sessionId ?? null,
      turnId: input.turnId,
      commandId: input.commandId,
      transcript: input.transcript,
      wakeAuthorised: input.wakeAuthorised,
      criticalSpeechTrusted: input.criticalSpeechTrusted,
      criticalKind: input.criticalKind,
      intent: input.intent,
      componentId: input.componentId ?? undefined,
      createdAt: now,
      expiresAt: now + TURN_AUTHORITY_TTL_MS,
    });
    this.accepted = authority;
    return authority;
  }

  current(): TurnAuthority | null {
    return this.accepted;
  }

  /** Wake/control-only speech is not operational authority. Preserve consumed mutation history. */
  clearCurrent(): void {
    this.accepted = null;
  }

  resolve(input: ResolveTurnAuthorityInput): AuthorityResolution {
    return resolveTurnAuthority(this.accepted, input, this.consumedMutations);
  }

  /** Records that a mutation request was actually sent under this authority; a repeat is refused. */
  consumeMutation(authority: TurnAuthority, mutationToolName: string): void {
    this.consumedMutations.add(`${authorityKey(authority)}|${mutationToolName}`);
  }

  hasConsumedMutation(authority: TurnAuthority, mutationToolName: string): boolean {
    return this.consumedMutations.has(`${authorityKey(authority)}|${mutationToolName}`);
  }

  /** Reconnect / disconnect: no authority survives a session boundary. */
  reset(): void {
    this.accepted = null;
    this.consumedMutations.clear();
  }
}
