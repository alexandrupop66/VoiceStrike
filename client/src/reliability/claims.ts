/**
 * BUILD 7 v0.9.0 — Operational claim grounding.
 *
 * Root cause fixed here (defect 5.2): "did a tool fail?" and "did operational state change?"
 * were answered from whichever local variable happened to be in scope. A read tool blocked by
 * a local readiness gate (`tool_call_attempted=false`, `tool_returned_failure=false`) was
 * verbalised as "I cannot retrieve your current job information", and an E1 answer claimed
 * "the job is now blocked" in a run where the blocking mutation never verified.
 *
 * Every tool call now accumulates an ordered, append-only stage list, and exactly one function
 * derives what may be said from it. The derived grounding is attached to the tool result the
 * model receives, so the permission to make an operational claim travels with the evidence for
 * it instead of being inferred from prose.
 *
 * The rules are asymmetric on purpose: a claim is permitted only by the presence of positive
 * evidence, never by the absence of negative evidence.
 */
export type OperationalStage =
  | 'TOOL_REQUESTED'
  | 'TOOL_AUTHORISATION_CHECKED'
  | 'TOOL_BLOCKED_LOCAL'
  | 'TOOL_ATTEMPTED'
  | 'TOOL_RETURNED_FAILURE'
  | 'MUTATION_STARTED'
  | 'MUTATION_COMPLETED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_FAILED'
  | 'VERIFICATION_PASSED'
  | 'VERIFIED_SUCCESS';

export type AuthorisedOperationalFact = {
  kind: 'CURRENT_JOB' | 'COMPONENT_CHECK' | 'INVENTORY' | 'ALTERNATIVE_INVENTORY' | 'LAST_ACTION';
  values: Record<string, string | number | boolean | null>;
};

export type ClaimGrounding = {
  tool: string;
  stages: OperationalStage[];
  authorised_facts: AuthorisedOperationalFact[];
  tool_call_attempted: boolean;
  blocked_locally: boolean;
  may_claim_tool_failure: boolean;
  may_claim_retrieval_failure: boolean;
  may_claim_state_changed: boolean;
  may_claim_success: boolean;
  forbidden_claims: string[];
  statement_rule: string;
};

export type ClaimEvidenceInput = {
  tool: string;
  stages: OperationalStage[];
  /** Exact facts supported by a completed authoritative read. */
  authorisedFacts?: AuthorisedOperationalFact[];
  /** Local block reason, when the request never reached an endpoint. */
  blockedReason?: string;
};

const FORBIDDEN_WHEN_NOT_ATTEMPTED = [
  'I cannot retrieve …',
  'the tool failed …',
  'the system is unavailable …',
];

const FORBIDDEN_WHEN_UNVERIFIED = [
  'I blocked …',
  'I reversed …',
  'I updated …',
  'I logged …',
  'the job is now blocked …',
];

/**
 * Append-only record of what actually happened to one tool call.
 * Stages can only be added; nothing can retract evidence once recorded.
 */
export class ClaimEvidence {
  private readonly stages: OperationalStage[] = [];

  constructor(readonly tool: string) {}

  record(stage: OperationalStage): void {
    this.stages.push(stage);
  }

  has(stage: OperationalStage): boolean {
    return this.stages.includes(stage);
  }

  list(): OperationalStage[] {
    return [...this.stages];
  }

  ground(blockedReason?: string): ClaimGrounding {
    return groundClaims({ tool: this.tool, stages: this.list(), blockedReason });
  }
}

export function groundClaims(input: ClaimEvidenceInput): ClaimGrounding {
  const stages = [...input.stages];
  const has = (stage: OperationalStage) => stages.includes(stage);

  const attempted = has('TOOL_ATTEMPTED');
  const blockedLocally = has('TOOL_BLOCKED_LOCAL') && !attempted;
  // A failure claim requires a real operational call that really returned failure.
  const toolFailure = attempted && has('TOOL_RETURNED_FAILURE');
  // A state-change claim requires independent authoritative post-action verification.
  const verified = has('VERIFIED_SUCCESS') && has('VERIFICATION_PASSED');

  const forbidden: string[] = [];
  if (!toolFailure) forbidden.push(...FORBIDDEN_WHEN_NOT_ATTEMPTED);
  if (!verified) forbidden.push(...FORBIDDEN_WHEN_UNVERIFIED);

  const statement_rule = blockedLocally
    ? 'A local precondition or readiness gate stopped this request before any operational endpoint was called. Report the missing information; never describe this as a provider, backend or tool failure.'
    : toolFailure
      ? 'The operational tool was called and returned a failure. Reporting a tool failure is truthful here.'
      : verified
        ? 'The mutation completed and was confirmed by an independent authoritative verification. A success claim is permitted for exactly what was verified.'
        : 'No verified state change exists for this call. Do not claim that operational state changed.';

  return {
    tool: input.tool,
    stages,
    authorised_facts: input.authorisedFacts ?? [],
    tool_call_attempted: attempted,
    blocked_locally: blockedLocally,
    may_claim_tool_failure: toolFailure,
    may_claim_retrieval_failure: toolFailure,
    may_claim_state_changed: verified,
    may_claim_success: verified,
    forbidden_claims: forbidden,
    statement_rule: input.blockedReason ? `${statement_rule} Missing prerequisite: ${input.blockedReason}.` : statement_rule,
  };
}


/** v0.10.0 fact-level claim authority. */
export function authoritativeFactsForResult(tool: string, payload: Record<string, unknown>): AuthorisedOperationalFact[] {
  if (payload.ok !== true) return [];
  if (tool === 'get_current_job') { const job = payload.job && typeof payload.job === 'object' ? payload.job as Record<string, unknown> : {}; return [{ kind: 'CURRENT_JOB', values: { job_id: String(job.id ?? ''), station: String(job.station ?? ''), expected_component: String(job.expected_component ?? ''), status: String(job.status ?? '') } }]; }
  if (tool === 'check_component') return [{ kind: 'COMPONENT_CHECK', values: { job_id: String(payload.job_id ?? ''), observed_component: String(payload.observed_component ?? ''), expected_component: String(payload.expected_component ?? ''), verdict: String(payload.verdict ?? '') } }];
  if (tool === 'check_inventory') { const inventory = payload.inventory && typeof payload.inventory === 'object' ? payload.inventory as Record<string, unknown> : {}; return [{ kind: 'INVENTORY', values: { component: String(inventory.component ?? ''), location: String(inventory.location ?? ''), quantity: Number(inventory.quantity ?? 0), available: inventory.available === true } }]; }
  if (tool === 'find_alternative_inventory') { const alternative = payload.alternative && typeof payload.alternative === 'object' ? payload.alternative as Record<string, unknown> : {}; if (alternative.found !== true) return []; return [{ kind: 'ALTERNATIVE_INVENTORY', values: { component: String(alternative.component ?? ''), location: String(alternative.location ?? ''), quantity: Number(alternative.quantity ?? 0), available: alternative.available === true } }]; }
  if (tool === 'inspect_last_action') { const action = payload.action && typeof payload.action === 'object' ? payload.action as Record<string, unknown> : {}; return [{ kind: 'LAST_ACTION', values: { action_id: String(action.id ?? ''), component: String(action.component ?? ''), reversed: action.reversed === true || action.reversed === 1, recovery_eligible: action.recovery_eligible === true } }]; }
  return [];
}
