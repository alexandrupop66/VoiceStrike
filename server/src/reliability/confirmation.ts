export type PreparedReversalAuthorityInput = {
  currentCommandId: string;
  currentTurnId: string;
  preparedCommandId: string;
  preparedTurnId: string;
  preparedActionId: string;
  preparedComponent: string;
  actualActionId: string;
  actualComponent: string;
  confirmationText: string;
};

export type PreparedReversalAuthorityResult =
  | { ok: true }
  | { ok: false; code: 'SECOND_CONFIRMATION_REQUIRED' | 'EXPLICIT_CONFIRMATION_REQUIRED' };

export function normalizeConfirmation(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function validatePreparedReversalAuthority(input: PreparedReversalAuthorityInput): PreparedReversalAuthorityResult {
  const hasPreparedAuthority = Boolean(
    input.currentCommandId &&
    input.currentTurnId &&
    input.preparedCommandId === input.currentCommandId &&
    input.preparedTurnId &&
    input.preparedTurnId !== input.currentTurnId &&
    input.preparedActionId === input.actualActionId &&
    input.preparedComponent === input.actualComponent
  );

  if (!hasPreparedAuthority) return { ok: false, code: 'SECOND_CONFIRMATION_REQUIRED' };

  const confirmationWords = normalizeConfirmation(input.confirmationText).split(/\s+/).filter(Boolean);
  const requiredWords = ['CONFIRM', 'REVERSE', 'SCAN', input.actualComponent];
  const hasWakePhrase = confirmationWords.includes('VOICESTRIKE') || (confirmationWords.includes('VOICE') && confirmationWords.includes('STRIKE'));
  const hasActionSpecificConfirmation = hasWakePhrase && requiredWords.every((word) => confirmationWords.includes(word));
  if (!hasActionSpecificConfirmation) return { ok: false, code: 'EXPLICIT_CONFIRMATION_REQUIRED' };

  return { ok: true };
}
