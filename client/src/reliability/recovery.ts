import { normalizeTechnicalId } from './entities.js';

export const RECOVERY_CONTEXT_TTL_MS = 120_000;

export type RecoverySpeechContext = {
  commandId: string;
  actionId: string;
  componentId: string;
  observedAt: number;
  source: 'TOOL_RESULT' | 'SERVER_AUDIT';
};

export function makeRecoverySpeechContext(input: {
  commandId: string;
  actionId: string;
  componentId: string;
  observedAt?: number;
  source: RecoverySpeechContext['source'];
}): RecoverySpeechContext | null {
  const commandId = String(input.commandId ?? '').trim();
  const actionId = String(input.actionId ?? '').trim();
  const componentId = normalizeTechnicalId(input.componentId, 'component_id');
  if (!commandId || !actionId || !componentId) return null;
  return {
    commandId,
    actionId,
    componentId,
    observedAt: input.observedAt ?? Date.now(),
    source: input.source,
  };
}

export function isRecoverySpeechContextFresh(
  context: RecoverySpeechContext | null | undefined,
  commandId: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!context) return false;
  const expectedCommandId = String(commandId ?? '').trim();
  if (!expectedCommandId || context.commandId !== expectedCommandId) return false;
  if (context.observedAt > now) return false;
  return now - context.observedAt <= RECOVERY_CONTEXT_TTL_MS;
}
