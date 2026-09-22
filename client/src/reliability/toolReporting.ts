export type ToolReportingInput = {
  toolCallAttempted: boolean;
  toolReturnedFailure: boolean;
  pipelineOutcome?: string;
};

export type ToolReportingDecision = {
  isError: boolean;
  outcome?: string;
  truthfulToolFailure: boolean;
};

/**
 * TOOL_FAILED is a factual claim about an operational tool result.
 * A readiness/safety gate refusal, stale command, missing wake authority,
 * verification problem, or connection loss must keep its own outcome.
 */
export function classifyToolReporting(input: ToolReportingInput): ToolReportingDecision {
  const truthfulToolFailure = input.toolCallAttempted && input.toolReturnedFailure;

  if (truthfulToolFailure) {
    return { isError: true, outcome: 'TOOL_FAILED', truthfulToolFailure: true };
  }

  // Defensive downgrade: no caller may manufacture TOOL_FAILED without a returned failed tool call.
  const outcome = input.pipelineOutcome === 'TOOL_FAILED' ? 'REJECTED' : input.pipelineOutcome;
  return { isError: false, outcome, truthfulToolFailure: false };
}
