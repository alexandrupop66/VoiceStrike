/**
 * BUILD 7 v0.10.0 RC4 — Reply causality ledger.
 *
 * RC4 replaces the RC2/RC3 ownership heuristics (onset revocation, stale tail, open-turn
 * rehydration) with explicit rules. Diagnosis: evidence/build7/v0.10.0_RC4_LIFECYCLE_DIAGNOSIS.md.
 *
 *  1. Every final user transcript is a fence. ACCEPTED opens a new turn and detaches the reply in
 *     progress. REJECTED never opens, closes or re-binds anything, but it ends any post-reply
 *     tool-ownership linger, because the provider will answer the rejected transcript next.
 *  2. An accepted turn owns exactly one initial reply, plus one TOOL_CONTINUATION per tool-result
 *     handoff. Any other reply while the turn is open is an orphan (inaudible, owns no tools).
 *     This is what stops a provider reply to a locally rejected transcript from being bound to a
 *     previous accepted turn (RC3 failure L2: reverse_last_scan -> CRITICAL_SPEECH_NOT_TRUSTED).
 *  3. A speech onset does NOT revoke the reply in progress. VAD fires on TV and on the worker's
 *     early start; revoking made the reply.done that delivers a protected prompt invisible, so the
 *     protected speech window never opened (RC3 failure L1). The provider signals a real barge-in
 *     with reply.done status=interrupted; that is handled by the caller.
 *  4. Tool calls are registered by call_id at ADMISSION. A turn with an in-flight call cannot close
 *     (RC3 failure L3: the continuation of a tool still running at reply.done became an orphan).
 *  5. Tool ownership: protected lease > reply in progress (orphan reply => no owner) > open turn
 *     after its initial reply > short post-reply linger of the SAME turn. There is no stale tail
 *     and no rehydration of an older command over a newer accepted turn (RC3 failure L4).
 *     Ambiguity resolves to "no owner", which the caller refuses before any endpoint call.
 *
 * None of this grants tool or mutation authority. TurnAuthority, workflow preconditions,
 * protected confirmation and post-mutation verification remain the only authority.
 */
export type TurnVerdict = 'ACCEPTED' | 'REJECTED';

export type ReplyAuthorityReason =
  | 'BOUND_TO_ACCEPTED_TURN'
  | 'TOOL_CONTINUATION'
  /** RC5: one reply requested by code (reply.create) to report a code-owned protected action. */
  | 'CODE_CONTINUATION'
  | 'SESSION_GREETING'
  | 'PROTECTED_TOOL_LEASE_PENDING'
  | 'TURN_REPLY_ALREADY_USED'
  | 'NO_ACCEPTED_TURN'
  | 'SESSION_EPOCH_CHANGED'
  /** RC5: provider correlation says this reply answers a locally rejected transcript. */
  | 'PROVIDER_ITEM_REJECTED';

export type ReplyBinding = {
  readonly replyId: string;
  readonly epoch: number;
  readonly turnId: string | null;
  readonly commandId: string | null;
  readonly authorised: boolean;
  readonly reason: ReplyAuthorityReason;
};

export type FinishedReply = ReplyBinding & {
  /** Wall-clock of the first speech onset observed while this reply was in progress, if any. */
  readonly onsetDuringReplyAt: number | null;
};

type ProtectedToolLease = {
  turnId: string;
  commandId: string;
  expectedTool: string;
  expiresAt: number;
  toolSeen: boolean;
};

type OpenTurn = {
  turnId: string;
  commandId: string | null;
  initialReplyStarted: boolean;
  initialReplyDone: boolean;
  inFlightCalls: Set<string>;
  /** Completed tool results not yet handed to the provider. */
  pendingResults: number;
  awaitingToolContinuation: boolean;
  /** RC5: a code-requested reply (reply.create) is owed for a code-owned protected action. */
  awaitingCodeReply: boolean;
  protectedToolLease: ProtectedToolLease | null;
  /** Set once for accepted PREPARE/CONFIRM turns: outside a reply, only this tool is attributable. */
  protectedTool: string | null;
};

type LingeringOwner = { turnId: string; commandId: string; expiresAt: number };
type CallOwner = { turnId: string; commandId: string; replyId: string | null };

/** This only bridges provider event re-ordering; it is not user action authority. */
export const PROTECTED_TOOL_LEASE_TTL_MS = 30_000;
/** Same-turn tool.call arriving shortly after its reply.done (documented provider ordering). */
export const TURN_TOOL_LINGER_TTL_MS = 5_000;
/** @deprecated RC3 name kept for evidence/validator continuity; now the same-turn linger only. */
export const DELAYED_TOOL_OWNER_TTL_MS = TURN_TOOL_LINGER_TTL_MS;

export class ReplyAuthorityRegistry {
  private openTurn: OpenTurn | null = null;
  private binding: ReplyBinding | null = null;
  private onsetDuringReplyAt: number | null = null;
  private lingering: LingeringOwner | null = null;
  private readonly callOwners = new Map<string, CallOwner>();
  private greetingUsed = false;
  private epoch = 1;
  private rejectedTurns = 0;
  private suppressedReplies = 0;

  reset(epoch: number): void {
    this.openTurn = null;
    this.binding = null;
    this.onsetDuringReplyAt = null;
    this.lingering = null;
    this.callOwners.clear();
    this.greetingUsed = false;
    this.epoch = epoch;
    this.rejectedTurns = 0;
    this.suppressedReplies = 0;
  }

  /** Every final user transcript is recorded here with the verdict the local gates produced. */
  noteTurn(turnId: string, verdict: TurnVerdict, commandId: string | null = null, _now = Date.now()): void {
    // Any final transcript ends the same-turn linger: the provider's next action may answer it.
    this.lingering = null;
    if (verdict === 'REJECTED') {
      this.rejectedTurns += 1;
      return;
    }
    // ACCEPTED is a hard causal boundary. The reply still in progress (if any) is detached: it is
    // no longer audible and cannot own tool calls. Its in-flight calls keep their recorded owner.
    this.binding = null;
    this.onsetDuringReplyAt = null;
    this.openTurn = {
      turnId,
      commandId,
      initialReplyStarted: false,
      initialReplyDone: false,
      inFlightCalls: new Set(),
      pendingResults: 0,
      awaitingToolContinuation: false,
      awaitingCodeReply: false,
      protectedToolLease: null,
      protectedTool: null,
    };
  }

  /**
   * Records a speech onset during the reply in progress. Deliberately non-revoking: VAD also fires
   * on TV/ambient audio. A real barge-in arrives from the provider as reply.done(interrupted).
   */
  interruptCurrentReply(now = Date.now()): void {
    if (this.binding && this.onsetDuringReplyAt == null) this.onsetDuringReplyAt = now;
  }

  /**
   * Arm only for an already ACCEPTED protected speech turn. This does not authorise a tool call;
   * TurnAuthority remains the mutation authority. It keeps the causal turn identity alive across
   * the provider's observed reply.done -> reply.started -> delayed tool.call ordering.
   */
  armProtectedToolLease(input: { turnId: string; commandId: string; expectedTool: string; now?: number }): boolean {
    const now = input.now ?? Date.now();
    this.sweepProtectedLease(now);
    if (!this.openTurn) return false;
    if (this.openTurn.turnId !== input.turnId || this.openTurn.commandId !== input.commandId) return false;
    this.openTurn.protectedToolLease = {
      turnId: input.turnId,
      commandId: input.commandId,
      expectedTool: input.expectedTool,
      expiresAt: now + PROTECTED_TOOL_LEASE_TTL_MS,
      toolSeen: false,
    };
    this.openTurn.protectedTool = input.expectedTool;
    return true;
  }

  /** Resolve a provider tool.call to its exact causal command, or null when not attributable. */
  commandIdForToolRequest(toolName: string, now = Date.now()): string | null {
    this.sweepProtectedLease(now);
    const turn = this.openTurn;
    const lease = turn?.protectedToolLease;
    if (lease && lease.expectedTool === toolName && !lease.toolSeen) return lease.commandId;

    // A reply is in progress: it owns the tools it emits. An orphan reply owns nothing.
    if (this.binding) return this.binding.authorised ? this.binding.commandId : null;

    if (turn) {
      // Accepted but its reply has not started yet: the call could belong to the detached old
      // reply or to the new turn. Refuse rather than guess.
      if (!turn.initialReplyStarted) return null;
      // A protected turn attributes only its expected protected tool outside a reply.
      if (turn.protectedTool && turn.protectedTool !== toolName) return null;
      return turn.commandId;
    }

    const linger = this.lingering;
    if (linger && now <= linger.expiresAt) return linger.commandId;
    if (linger) this.lingering = null;
    return null;
  }

  /**
   * Registers an admitted tool call under the turn that owns it. Returns true when the call is
   * attributed to the open (or same-turn lingering) turn and will keep that turn open.
   */
  noteToolRequest(commandId: string, toolName: string, now = Date.now(), callId?: string): boolean {
    this.sweepProtectedLease(now);
    if (!commandId) return false;
    const turn = this.openTurn;
    const lease = turn?.protectedToolLease;

    if (turn && lease && !lease.toolSeen) {
      if (lease.commandId !== commandId || lease.expectedTool !== toolName) {
        // Only an in-progress authorised reply may attribute other tools to a lease-holding turn.
        if (!(this.binding?.authorised && this.binding.commandId === commandId && turn.commandId === commandId)) return false;
      } else {
        lease.toolSeen = true;
      }
      this.registerCall(turn, callId);
      return true;
    }

    if (turn && turn.commandId === commandId) {
      const replyBound = Boolean(this.binding?.authorised && this.binding.commandId === commandId);
      if (turn.protectedTool && turn.protectedTool !== toolName && !replyBound) return false;
      this.registerCall(turn, callId);
      return true;
    }

    const linger = this.lingering;
    if (!turn && linger && linger.commandId === commandId && now <= linger.expiresAt) {
      // Same turn, no newer fence since its reply ended: reopen it for this tool round-trip.
      this.openTurn = {
        turnId: linger.turnId,
        commandId: linger.commandId,
        initialReplyStarted: true,
        initialReplyDone: true,
        inFlightCalls: new Set(),
        pendingResults: 0,
        awaitingToolContinuation: false,
        awaitingCodeReply: false,
        protectedToolLease: null,
        protectedTool: null,
      };
      this.lingering = null;
      this.registerCall(this.openTurn, callId);
      return true;
    }
    return false;
  }

  /** Explicit command lifecycle termination (cancel/expiry) must also terminate its reply lease. */
  cancelProtectedToolLease(commandId: string): void {
    if (!this.openTurn || this.openTurn.commandId !== commandId) return;
    this.openTurn.protectedToolLease = null;
    if (this.openTurn.initialReplyDone && !this.binding) this.closeIfIdle(Date.now(), false);
  }

  /** A tool call has produced its result (not yet sent). */
  markPendingWork(callId?: string): void {
    const turn = this.openTurn;
    if (!turn) return;
    if (callId !== undefined) {
      if (!turn.inFlightCalls.delete(callId)) return; // belongs to an older/detached turn
    }
    turn.pendingResults += 1;
  }

  /**
   * Called only when a queued tool.result is actually sent back to the provider. The owning turn
   * remains open because the provider's next reply is the continuation that speaks the result.
   */
  markToolResultSent(callId?: string): void {
    const turn = this.openTurn;
    if (!turn) return;
    if (callId !== undefined) {
      const owner = this.callOwners.get(callId);
      this.callOwners.delete(callId);
      if (!owner || owner.turnId !== turn.turnId) return;
    }
    if (turn.pendingResults > 0) turn.pendingResults -= 1;
    turn.awaitingToolContinuation = true;
  }

  /** A tool result that will never be sent (interrupted reply, epoch change) releases its turn hold. */
  releaseToolResult(callId: string, wasCompleted: boolean, now = Date.now()): void {
    const owner = this.callOwners.get(callId);
    this.callOwners.delete(callId);
    const turn = this.openTurn;
    if (!turn || !owner || owner.turnId !== turn.turnId) return;
    if (wasCompleted) { if (turn.pendingResults > 0) turn.pendingResults -= 1; }
    else turn.inFlightCalls.delete(callId);
    if (!this.binding && turn.initialReplyDone) this.closeIfIdle(now, false);
  }

  /**
   * RC5: code-owned protected work holds the causal turn open without touching the protected
   * lease, so the provider's own reverse_last_scan tool.call (if any) is still attributable.
   */
  holdCodeWork(commandId: string, key: string): boolean {
    const turn = this.openTurn;
    if (!turn || turn.commandId !== commandId) return false;
    turn.inFlightCalls.add(key);
    return true;
  }

  releaseCodeWork(key: string, now = Date.now()): void {
    const turn = this.openTurn;
    if (!turn || !turn.inFlightCalls.delete(key)) return;
    if (!this.binding && turn.initialReplyDone) this.closeIfIdle(now, true);
  }

  /** RC5: true when a code-requested reply would not collide with any provider-owed reply. */
  canRequestCodeReply(commandId: string, codeKey: string): boolean {
    const turn = this.openTurn;
    if (!turn || turn.commandId !== commandId || this.binding) return false;
    if (!turn.initialReplyDone || turn.awaitingToolContinuation || turn.awaitingCodeReply || turn.pendingResults > 0) return false;
    for (const key of turn.inFlightCalls) if (key !== codeKey) return false;
    return true;
  }

  /** RC5: the next reply.started is the one reply requested by code for this command. */
  expectCodeReply(commandId: string): boolean {
    const turn = this.openTurn;
    if (!turn || turn.commandId !== commandId) return false;
    turn.awaitingCodeReply = true;
    return true;
  }

  /**
   * RC5: provider correlation (reply item_id == a locally rejected transcript item_id) can only
   * DOWNGRADE a binding. It never grants audibility or tool ownership.
   */
  demoteCurrentReply(reason: ReplyAuthorityReason = 'PROVIDER_ITEM_REJECTED'): ReplyBinding | null {
    const current = this.binding;
    if (!current || !current.authorised) return current;
    const turn = this.openTurn;
    if (turn && current.turnId === turn.turnId) {
      if (current.reason === 'TOOL_CONTINUATION') turn.awaitingToolContinuation = true;
      else if (current.reason === 'CODE_CONTINUATION') turn.awaitingCodeReply = true;
    }
    this.suppressedReplies += 1;
    this.binding = Object.freeze({ ...current, authorised: false, reason });
    return this.binding;
  }

  /** Reply id that owns a tool call, if it was emitted inside a reply in progress. */
  replyIdForCall(callId: string): string | null {
    return this.callOwners.get(callId)?.replyId ?? null;
  }

  beginReply(replyId: string, epoch: number, now = Date.now()): ReplyBinding {
    this.sweepProtectedLease(now);
    this.onsetDuringReplyAt = null;

    if (epoch !== this.epoch) {
      return this.orphan(replyId, epoch, null, null, 'SESSION_EPOCH_CHANGED');
    }

    const turn = this.openTurn;
    if (turn) {
      if (turn.awaitingToolContinuation) {
        // Consume exactly one expected post-tool continuation.
        turn.awaitingToolContinuation = false;
        return this.bind(replyId, epoch, turn, 'TOOL_CONTINUATION');
      }
      if (turn.awaitingCodeReply) {
        turn.awaitingCodeReply = false;
        return this.bind(replyId, epoch, turn, 'CODE_CONTINUATION');
      }
      if (!turn.initialReplyStarted) {
        turn.initialReplyStarted = true;
        this.lingering = null;
        return this.bind(replyId, epoch, turn, 'BOUND_TO_ACCEPTED_TURN');
      }
      // The turn already had its reply and no tool result is owed: this reply answers something
      // else (typically a locally rejected transcript). Never audible, never a tool owner.
      return this.orphan(replyId, epoch, turn.turnId, turn.commandId,
        turn.protectedToolLease && !turn.protectedToolLease.toolSeen ? 'PROTECTED_TOOL_LEASE_PENDING' : 'TURN_REPLY_ALREADY_USED');
    }

    if (!this.greetingUsed) {
      this.greetingUsed = true;
      this.binding = Object.freeze({ replyId, epoch, turnId: null, commandId: null, authorised: true, reason: 'SESSION_GREETING' as const });
      return this.binding;
    }

    return this.orphan(replyId, epoch, null, null, 'NO_ACCEPTED_TURN');
  }

  current(): ReplyBinding | null {
    return this.binding;
  }

  /** True only while an authorised reply is in progress. Orphan replies are never audible. */
  isCurrentReplyAuthorised(): boolean {
    return Boolean(this.binding?.authorised);
  }

  finishReply(now = Date.now()): FinishedReply | null {
    this.sweepProtectedLease(now);
    const finished = this.binding;
    const onset = this.onsetDuringReplyAt;
    this.binding = null;
    this.onsetDuringReplyAt = null;
    if (!finished) return null;
    const result: FinishedReply = Object.freeze({ ...finished, onsetDuringReplyAt: onset });

    const turn = this.openTurn;
    if (!finished.authorised || !turn || finished.turnId !== turn.turnId) return result;
    if (finished.reason === 'BOUND_TO_ACCEPTED_TURN') turn.initialReplyDone = true;
    if (finished.reason === 'BOUND_TO_ACCEPTED_TURN' || finished.reason === 'TOOL_CONTINUATION' || finished.reason === 'CODE_CONTINUATION') {
      this.closeIfIdle(now, true);
    }
    return result;
  }

  hasOpenTurn(): boolean {
    return this.openTurn !== null;
  }

  hasProtectedToolLease(commandId?: string): boolean {
    if (!this.openTurn?.protectedToolLease) return false;
    return commandId ? this.openTurn.protectedToolLease.commandId === commandId : true;
  }

  /** Diagnostic snapshot for telemetry only. */
  snapshot(): Record<string, unknown> {
    const t = this.openTurn;
    return {
      openTurn: t ? {
        turnId: t.turnId, commandId: t.commandId, initialReplyStarted: t.initialReplyStarted, initialReplyDone: t.initialReplyDone,
        inFlight: t.inFlightCalls.size, pendingResults: t.pendingResults, awaitingContinuation: t.awaitingToolContinuation,
        lease: t.protectedToolLease ? `${t.protectedToolLease.expectedTool}${t.protectedToolLease.toolSeen ? ':seen' : ''}` : null,
      } : null,
      binding: this.binding ? `${this.binding.replyId}:${this.binding.reason}:${this.binding.commandId ?? '-'}` : null,
      lingering: this.lingering ? `${this.lingering.commandId}@${this.lingering.expiresAt}` : null,
    };
  }

  counters(): { rejectedTurns: number; suppressedReplies: number } {
    return { rejectedTurns: this.rejectedTurns, suppressedReplies: this.suppressedReplies };
  }

  private bind(replyId: string, epoch: number, turn: OpenTurn, reason: ReplyAuthorityReason): ReplyBinding {
    this.binding = Object.freeze({ replyId, epoch, turnId: turn.turnId, commandId: turn.commandId, authorised: true, reason });
    return this.binding;
  }

  private orphan(replyId: string, epoch: number, turnId: string | null, commandId: string | null, reason: ReplyAuthorityReason): ReplyBinding {
    // Tools emitted after an orphan reply belong to whatever it answered: end any linger.
    this.lingering = null;
    this.suppressedReplies += 1;
    this.binding = Object.freeze({ replyId, epoch, turnId, commandId, authorised: false, reason });
    return this.binding;
  }

  private registerCall(turn: OpenTurn, callId: string | undefined): void {
    if (callId === undefined) return;
    turn.inFlightCalls.add(callId);
    this.callOwners.set(callId, { turnId: turn.turnId, commandId: turn.commandId ?? '', replyId: this.binding?.replyId ?? null });
  }

  private closeIfIdle(now: number, linger: boolean): void {
    const turn = this.openTurn;
    if (!turn) return;
    if (turn.protectedToolLease && !turn.protectedToolLease.toolSeen) return;
    if (turn.inFlightCalls.size > 0 || turn.pendingResults > 0 || turn.awaitingToolContinuation || turn.awaitingCodeReply) return;
    this.lingering = linger && turn.commandId
      ? { turnId: turn.turnId, commandId: turn.commandId, expiresAt: now + TURN_TOOL_LINGER_TTL_MS }
      : null;
    this.openTurn = null;
  }

  private sweepProtectedLease(now: number): void {
    const lease = this.openTurn?.protectedToolLease;
    if (!this.openTurn || !lease || now <= lease.expiresAt) return;
    this.openTurn.protectedToolLease = null;
    if (this.openTurn.initialReplyDone && !this.binding) this.closeIfIdle(now, false);
  }
}
