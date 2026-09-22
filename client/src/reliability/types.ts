export type ReliabilityOutcome =
  | 'VERIFIED_SUCCESS'
  | 'REJECTED'
  | 'NEEDS_CLARIFICATION'
  | 'STALE_COMMAND'
  | 'TOOL_FAILED'
  | 'VERIFY_FAILED'
  | 'TIMEOUT'
  | 'CONNECTION_LOST'
  | 'UNKNOWN_ACTION_STATE';

export type CriticalEntityKind =
  | 'component_id'
  | 'job_id'
  | 'station_id'
  | 'location_id'
  | 'confirmation'
  | 'action_intent';

export type CriticalEntityResolution = {
  kind: CriticalEntityKind;
  rawValues: string[];
  canonicalValue?: string;
  status: 'RESOLVED' | 'MISSING' | 'AMBIGUOUS' | 'CORRECTED' | 'REJECTED';
  source: 'CURRENT_UTTERANCE' | 'CLARIFICATION' | 'PENDING_COMMAND';
  candidates?: string[];
};


export type WorkflowKind =
  | 'READ_JOB'
  | 'INVENTORY_LOOKUP'
  | 'E1_WRONG_COMPONENT'
  | 'E2_MISSING_INVENTORY'
  | 'E3_MISTAKEN_SCAN'
  | 'CANCEL_ACTION'
  | 'UNKNOWN';

export type CommandPhase =
  | 'INTERPRET' | 'CLARIFY' | 'VERIFY' | 'REPORT' | 'BLOCK' | 'LOCATE'
  | 'PREPARE' | 'CONFIRM' | 'ACT' | 'COMPLETE';

export type CommandSlots = {
  expectedComponent?: string;
  observedComponent?: string;
  component?: string;
  reportedLocation?: string;
  observedEmpty?: boolean;
  actionId?: string;
};

export type PendingClarification = {
  workflow: WorkflowKind;
  field: keyof CommandSlots;
  allowedType: CriticalEntityKind | 'boolean';
};

export type CommandEvidence = {
  currentJob?: Record<string, unknown>;
  componentCheck?: Record<string, unknown>;
  inventoryCheck?: Record<string, unknown>;
  exception?: Record<string, unknown>;
  jobStatus?: Record<string, unknown>;
  discrepancy?: Record<string, unknown>;
  alternativeInventory?: Record<string, unknown>;
  lastAction?: Record<string, unknown>;
  reversal?: Record<string, unknown>;
};

export type EntityConfirmationState = {
  kind: 'component_id';
  expectedValue: string;
  status: 'PENDING' | 'CONFIRMED';
  requestedAt: number;
  confirmedAt?: number;
};

export type CommandRegistryEvent = {
  type: 'entity_confirmation';
  status: 'PENDING' | 'CONFIRMED' | 'SUPERSEDED';
  commandId: string;
  entityKind: 'component_id';
  expectedValue: string;
  receivedValue?: string;
  replacementCommandId?: string;
};

export type PendingCommand = {
  id: string;
  intent?: string;
  workflow: WorkflowKind;
  phase: CommandPhase;
  slots: CommandSlots;
  evidence: CommandEvidence;
  pendingClarification?: PendingClarification;
  entities: CriticalEntityResolution[];
  status: 'COLLECTING' | 'READY' | 'COMPLETE' | 'FAILED' | 'INVALIDATED' | 'CANCELLED';
  fragments: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  entityConfirmation?: EntityConfirmationState;
};

export type ReliabilityEventName =
  | 'reliability.speech_end'
  | 'reliability.transcript_final'
  | 'reliability.response_started'
  // v0.9.0: tool intent, authorisation, local refusal and real execution are separate events.
  // The old ambiguous single "called" event (emitted even when tool_call_attempted=false)
  // is deliberately gone.
  | 'reliability.tool_requested'
  | 'reliability.tool_authorisation_checked'
  | 'reliability.tool_blocked_local'
  | 'reliability.tool_attempted'
  | 'reliability.tool_result'
  // RC4 lifecycle instrumentation.
  | 'reliability.tool_result_sent'
  | 'reliability.tool_result_discarded'
  | 'reliability.provider_event'
  | 'reliability.protected_speech_window_not_opened'
  // RC5 code-owned protected actions, streaming claim gate, provider correlation.
  | 'reliability.code_owned_action_started'
  | 'reliability.code_owned_action_skipped'
  | 'reliability.code_owned_action_completed'
  | 'reliability.code_owned_action_joined'
  | 'reliability.code_owned_action_delivered'
  | 'reliability.provider_context_note'
  | 'reliability.provider_correlation'
  | 'reliability.reply_audio_released'
  | 'reliability.verified_success'
  | 'reliability.workflow_phase'
  | 'reliability.workflow_precondition_required'
  | 'reliability.reply_requested'
  | 'reliability.reply_bound_to_turn'
  | 'reliability.orphan_reply_suppressed'
  | 'reliability.reply_claim_rejected'
  | 'reliability.ambient_turn_rejected'
  | 'reliability.protected_action_prepared'
  | 'reliability.protected_action_cancelled'
  | 'reliability.protected_action_expired'
  | 'reliability.protected_speech_window_armed'
  | 'reliability.protected_speech_window_opened'
  | 'reliability.protected_speech_window_rejected'
  | 'reliability.protected_speech_window_consumed'
  | 'reliability.session_epoch_changed'
  | 'reliability.input_received'
  | 'reliability.wake_accepted'
  | 'reliability.wake_required'
  | 'reliability.ambient_ignored'
  | 'reliability.echo_suppressed'
  | 'reliability.critical_speech_trusted'
  | 'reliability.critical_speech_rejected'
  | 'reliability.second_confirmation_required'
  | 'reliability.second_confirmation_accepted'
  | 'reliability.transcript_unreliable'
  | 'reliability.entity_resolved'
  | 'reliability.entity_ambiguous'
  | 'reliability.entity_confirmation'
  | 'reliability.command_pending'
  | 'reliability.command_ready'
  | 'reliability.command_invalidated'
  | 'reliability.action_authorised'
  | 'reliability.action_rejected'
  | 'reliability.mutation_started'
  | 'reliability.mutation_completed'
  | 'reliability.verification_started'
  | 'reliability.verification_passed'
  | 'reliability.verification_failed'
  | 'reliability.connection_lost'
  | 'reliability.recovery_started'
  | 'reliability.recovery_speech_context_ready'
  | 'reliability.recovery_verified';

export type ReliabilityTelemetryEvent = {
  timestamp?: string;
  sessionId?: string | null;
  /** Conversation lifecycle generation; changes on full demo reset and reconnect. */
  epoch?: number | null;
  turnId?: string | null;
  commandId?: string | null;
  actionId?: string | null;
  componentId?: string | null;
  /** Identifier of the immutable accepted-turn authority that permitted this event, if any. */
  authorityId?: string | null;
  /** Operational tool name for tool-lifecycle events. */
  tool?: string;
  /** True only when a real operational endpoint call left the browser. */
  attempted?: boolean;
  /** Coarse result class for correlation: BLOCKED_LOCAL / REJECTED / VERIFIED_SUCCESS / ... */
  resultClass?: string;
  event: ReliabilityEventName;
  intent?: string;
  entityKind?: CriticalEntityKind;
  entityValue?: string;
  jobId?: string;
  stage?: string;
  outcome?: ReliabilityOutcome | string;
  latencyMs?: number;
  detail?: string;
};

export type ReliableActionResult<T = unknown> = {
  outcome: ReliabilityOutcome;
  commandId: string;
  mutationAttempted: boolean;
  mutationReportedSuccess: boolean;
  verificationAttempted: boolean;
  verified: boolean;
  data?: T;
  verification?: unknown;
  staleAfterMutation?: boolean;
  error?: {
    stage: string;
    code: string;
    retryable: boolean;
    message?: string;
  };
};
