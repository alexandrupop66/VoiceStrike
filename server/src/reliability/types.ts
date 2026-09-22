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

export type ReliabilityEvent = {
  id?: number;
  timestamp: string;
  sessionId?: string | null;
  /** v0.9.0: conversation generation; a full demo reset starts a new epoch. */
  epoch?: number | null;
  turnId?: string | null;
  commandId?: string | null;
  actionId?: string | null;
  componentId?: string | null;
  authorityId?: string | null;
  tool?: string;
  attempted?: boolean;
  resultClass?: string;
  event: string;
  intent?: string;
  entityKind?: string;
  entityValue?: string;
  jobId?: string;
  stage?: string;
  outcome?: string;
  latencyMs?: number;
  detail?: string;
};
