import { normalizeTechnicalId } from './entities.js';
import { resolveInventoryDiscrepancyEntities } from './inventoryEntities.js';
import { assessTranscriptSanity, isExplicitCancellation } from './transcript.js';
import { emitReliabilityTelemetry } from './telemetry.js';
import type { CommandSlots, ReliableActionResult } from './types.js';

export type MutationToolName =
  | 'report_exception'
  | 'update_job_status'
  | 'report_inventory_discrepancy'
  | 'reverse_last_scan';

export const MUTATION_TOOLS = new Set<MutationToolName>([
  'report_exception',
  'update_job_status',
  'report_inventory_discrepancy',
  'reverse_last_scan',
]);

type VerificationResult = {
  ok: boolean;
  data: unknown;
  error?: string;
};

type ExecuteOptions = {
  commandId: string;
  toolName: MutationToolName;
  transcriptContext: string;
  /** Trusted typed slots owned by this exact CommandContext. */
  commandSlots?: CommandSlots;
  args: Record<string, unknown>;
  request: () => Promise<Response>;
  isCommandCurrent: () => boolean;
  isCommandReady: () => boolean;
  sessionId?: string | null;
  turnId?: string | null;
};

function record(options: ExecuteOptions, event: Parameters<typeof emitReliabilityTelemetry>[0]['event'], detail?: string, outcome?: string) {
  emitReliabilityTelemetry({
    event,
    sessionId: options.sessionId,
    turnId: options.turnId,
    commandId: options.commandId,
    stage: options.toolName,
    detail,
    outcome,
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({
    ok: false,
    error: `HTTP_${response.status}`,
    message: 'Endpoint returned a non-JSON response.',
  })) as Promise<Record<string, unknown>>;
}

async function fetchState(): Promise<Record<string, unknown>> {
  const response = await fetch('/api/state', {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-VoiceStrike-Verification': 'post-mutation' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`STATE_VERIFY_HTTP_${response.status}`);
  return readJson(response);
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

async function verifyMutation(
  toolName: MutationToolName,
  mutationPayload: Record<string, unknown> | null,
  args: Record<string, unknown>,
  commandId: string,
): Promise<VerificationResult> {
  try {
    if (toolName === 'reverse_last_scan') {
      const response = await fetch('/api/tools/inspect-last-action', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-VoiceStrike-Verification': 'post-mutation',
          'X-VoiceStrike-Command-Id': commandId,
        },
        cache: 'no-store',
      });
      const payload = await readJson(response);
      const action = (payload.action ?? {}) as Record<string, unknown>;
      const mutationAction = ((mutationPayload?.action ?? {}) as Record<string, unknown>);
      const expectedId = String(mutationAction.id ?? args.action_id ?? '');
      const expectedComponent = String(mutationAction.component ?? args.component_id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const actualComponent = String(action.component ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const reversed = action.reversed === true || action.reversed === 1;
      const ok = response.ok && String(action.id ?? '') === expectedId && actualComponent === expectedComponent && reversed;
      return { ok, data: payload, ...(ok ? {} : { error: 'POST_REVERSAL_VERIFICATION_FAILED' }) };
    }

    const state = await fetchState();
    const exceptions = asArray(state.exceptions);
    const inventory = asArray(state.inventory);
    const job = (state.job ?? {}) as Record<string, unknown>;

    if (toolName === 'report_exception') {
      const exception = (mutationPayload?.exception ?? {}) as Record<string, unknown>;
      const id = String(exception.id ?? '');
      const ok = id
        ? exceptions.some((item) => String(item.id ?? '') === id && String(item.status ?? '') === 'OPEN')
        : exceptions.some((item) => String(item.type ?? '') === 'WRONG_COMPONENT' && String(item.status ?? '') === 'OPEN');
      return { ok, data: state, ...(ok ? {} : { error: 'POST_EXCEPTION_VERIFICATION_FAILED' }) };
    }

    if (toolName === 'update_job_status') {
      const expected = String(args.status ?? '').toUpperCase();
      const ok = String(job.status ?? '').toUpperCase() === expected;
      return { ok, data: state, ...(ok ? {} : { error: 'POST_STATUS_VERIFICATION_FAILED' }) };
    }

    const component = String(args.component_id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const location = String(args.location ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const inventoryVerified = inventory.some((item) =>
      String(item.component ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === component &&
      String(item.location ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === location &&
      Number(item.quantity ?? -1) === 0,
    );
    const exceptionVerified = exceptions.some((item) =>
      String(item.type ?? '') === 'INVENTORY_DISCREPANCY' && String(item.status ?? '') === 'OPEN',
    );
    const ok = inventoryVerified && exceptionVerified;
    return { ok, data: state, ...(ok ? {} : { error: 'POST_DISCREPANCY_VERIFICATION_FAILED' }) };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : 'VERIFICATION_FAILED',
    };
  }
}

function criticalEntityGate(options: ExecuteOptions): { ok: true } | { ok: false; code: string; detail: string } {
  const slots = options.commandSlots ?? {};
  if (options.toolName === 'report_exception') {
    const trusted = normalizeTechnicalId(slots.observedComponent, 'component_id');
    const arg = normalizeTechnicalId(options.args.observed_component, 'component_id');
    if (!trusted) return { ok: false, code: 'CRITICAL_ENTITY_REQUIRED', detail: 'The E1 command does not own a trusted observedComponent slot.' };
    if (!arg || arg !== trusted) return { ok: false, code: 'ENTITY_ARGUMENT_MISMATCH', detail: `Command slot observedComponent=${trusted}; tool requested ${arg ?? 'invalid'}.` };
  }
  if (options.toolName === 'report_inventory_discrepancy') {
    const trustedComponent = normalizeTechnicalId(slots.component, 'component_id');
    const trustedLocation = normalizeTechnicalId(slots.reportedLocation, 'location_id');
    const componentArg = normalizeTechnicalId(options.args.component_id, 'component_id');
    const locationArg = normalizeTechnicalId(options.args.location, 'location_id');
    if (slots.observedEmpty !== true) return { ok: false, code: 'INVENTORY_EMPTY_OBSERVATION_REQUIRED', detail: 'The E2 command does not own an explicit observedEmpty=true slot.' };
    if (!trustedComponent || !trustedLocation) return { ok: false, code: 'INVENTORY_TYPED_ENTITIES_REQUIRED', detail: 'The E2 command must own both component and reportedLocation typed slots.' };
    if (componentArg !== trustedComponent) return { ok: false, code: 'ENTITY_ARGUMENT_MISMATCH', detail: `Command slot component=${trustedComponent}; tool requested ${componentArg ?? 'invalid'}.` };
    if (locationArg !== trustedLocation) return { ok: false, code: 'ENTITY_ARGUMENT_MISMATCH', detail: `Command slot reportedLocation=${trustedLocation}; tool requested ${locationArg ?? 'invalid'}.` };
  }
  if (options.toolName === 'reverse_last_scan') {
    const trustedComponent = normalizeTechnicalId(slots.component, 'component_id');
    const trustedAction = String(slots.actionId ?? '').trim();
    const componentArg = normalizeTechnicalId(options.args.component_id, 'component_id');
    const actionArg = String(options.args.action_id ?? '').trim();
    if (trustedComponent && componentArg !== trustedComponent) return { ok: false, code: 'ENTITY_ARGUMENT_MISMATCH', detail: `E3 command slot component=${trustedComponent}; tool requested ${componentArg ?? 'invalid'}.` };
    if (trustedAction && actionArg !== trustedAction) return { ok: false, code: 'ACTION_ARGUMENT_MISMATCH', detail: `E3 command slot actionId=${trustedAction}; tool requested ${actionArg || 'invalid'}.` };
  }
  return { ok: true };
}

export function canClaimSuccess(result: ReliableActionResult): boolean {
  return result.outcome === 'VERIFIED_SUCCESS' && result.verified === true;
}

export async function executeVerifiedAction(options: ExecuteOptions): Promise<ReliableActionResult<Record<string, unknown>>> {
  if (isExplicitCancellation(options.transcriptContext)) {
    record(options, 'reliability.action_rejected', 'Explicit cancellation in current worker command.', 'REJECTED');
    return {
      outcome: 'REJECTED',
      commandId: options.commandId,
      mutationAttempted: false,
      mutationReportedSuccess: false,
      verificationAttempted: false,
      verified: false,
      error: { stage: 'AUTHORISE', code: 'EXPLICIT_CANCELLATION', retryable: false },
    };
  }

  // Transcript text is evidence, not the operational command object. Typed CommandContext slots,
  // workflow prerequisites and immutable TurnAuthority authorise the mutation.
  const sanity = assessTranscriptSanity(options.transcriptContext, { requireOperationalSignal: false });
  if (!sanity.reliable) {
    record(options, 'reliability.transcript_unreliable', sanity.status, 'NEEDS_CLARIFICATION');
    return {
      outcome: 'NEEDS_CLARIFICATION',
      commandId: options.commandId,
      mutationAttempted: false,
      mutationReportedSuccess: false,
      verificationAttempted: false,
      verified: false,
      error: { stage: 'TRANSCRIPT_SANITY', code: sanity.status, retryable: false },
    };
  }

  if (!options.isCommandCurrent()) {
    record(options, 'reliability.command_invalidated', 'Command was stale before mutation.', 'STALE_COMMAND');
    return {
      outcome: 'STALE_COMMAND',
      commandId: options.commandId,
      mutationAttempted: false,
      mutationReportedSuccess: false,
      verificationAttempted: false,
      verified: false,
      error: { stage: 'AUTHORISE', code: 'STALE_COMMAND', retryable: false },
    };
  }

  if (!options.isCommandReady()) {
    record(options, 'reliability.command_pending', 'Command is still semantically incomplete.', 'NEEDS_CLARIFICATION');
    return {
      outcome: 'NEEDS_CLARIFICATION',
      commandId: options.commandId,
      mutationAttempted: false,
      mutationReportedSuccess: false,
      verificationAttempted: false,
      verified: false,
      error: { stage: 'SEMANTIC_COMPLETENESS', code: 'INCOMPLETE_COMMAND', retryable: false },
    };
  }

  const entityGate = criticalEntityGate(options);
  if (entityGate.ok === false) {
    record(options, 'reliability.entity_ambiguous', entityGate.detail, 'NEEDS_CLARIFICATION');
    return {
      outcome: 'NEEDS_CLARIFICATION',
      commandId: options.commandId,
      mutationAttempted: false,
      mutationReportedSuccess: false,
      verificationAttempted: false,
      verified: false,
      error: { stage: 'CRITICAL_ENTITY_RESOLUTION', code: entityGate.code, retryable: false, message: entityGate.detail },
    };
  }

  record(options, 'reliability.action_authorised');
  record(options, 'reliability.mutation_started');

  let payload: Record<string, unknown> | null = null;
  let response: Response | null = null;
  let requestError: unknown = null;

  try {
    response = await options.request();
    payload = await readJson(response);
  } catch (error) {
    requestError = error;
  }

  const mutationReportedSuccess = Boolean(response?.ok && payload?.ok !== false);
  if (mutationReportedSuccess) record(options, 'reliability.mutation_completed');

  if (response && !response.ok && payload?.unknown_action_state !== true) {
    const rejected = response.status >= 400 && response.status < 500;
    record(options, 'reliability.action_rejected', String(payload?.error ?? response.status), rejected ? 'REJECTED' : 'TOOL_FAILED');
    return {
      outcome: rejected ? 'REJECTED' : 'TOOL_FAILED',
      commandId: options.commandId,
      mutationAttempted: true,
      mutationReportedSuccess: false,
      verificationAttempted: false,
      verified: false,
      data: payload ?? undefined,
      error: {
        stage: 'MUTATE',
        code: String(payload?.error ?? `HTTP_${response.status}`),
        retryable: false,
        message: String(payload?.message ?? ''),
      },
    };
  }

  // A mutation request that succeeded, failed after a possible commit, or lost its
  // response is never blindly retried. Resolve the authoritative state first.
  record(options, 'reliability.verification_started');
  const verification = await verifyMutation(options.toolName, payload, options.args, options.commandId);

  if (verification.ok) {
    record(options, 'reliability.verification_passed', requestError ? 'Recovered after uncertain mutation response.' : undefined, 'VERIFIED_SUCCESS');
    return {
      outcome: 'VERIFIED_SUCCESS',
      commandId: options.commandId,
      mutationAttempted: true,
      mutationReportedSuccess,
      verificationAttempted: true,
      verified: true,
      data: payload ?? { ok: true, recovered_from_unknown_state: true },
      verification: verification.data,
      staleAfterMutation: !options.isCommandCurrent(),
    };
  }

  record(options, 'reliability.verification_failed', verification.error, requestError || payload?.unknown_action_state === true ? 'UNKNOWN_ACTION_STATE' : 'VERIFY_FAILED');
  return {
    outcome: requestError || payload?.unknown_action_state === true ? 'UNKNOWN_ACTION_STATE' : 'VERIFY_FAILED',
    commandId: options.commandId,
    mutationAttempted: true,
    mutationReportedSuccess,
    verificationAttempted: true,
    verified: false,
    data: payload ?? undefined,
    verification: verification.data,
    error: {
      stage: 'VERIFY',
      code: verification.error ?? 'VERIFY_FAILED',
      retryable: false,
      message: requestError instanceof Error ? requestError.message : undefined,
    },
  };
}
