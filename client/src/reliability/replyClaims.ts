import type { PendingCommand, ReliabilityOutcome } from './types.js';
import { normalizeTechnicalId } from './entities.js';
import { maskTechnicalIds, normalizeSpokenTechnicalIds } from './spokenIds.js';

export type ReplyClaimDecision = {
  allowed: boolean;
  code?: 'UNVERIFIED_MUTATION_CLAIM' | 'UNVERIFIED_FAILURE_CLAIM' | 'CONTRADICTS_VERIFIED_RESULT' | 'UNAUTHORISED_LOCATION_CLAIM' | 'UNAUTHORISED_QUANTITY_CLAIM';
  detail?: string;
};

export type ReversalSpeechAuthority = {
  state: 'PENDING' | 'FINAL';
  outcome?: ReliabilityOutcome;
  verified?: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function canonicalLocation(value: unknown): string | null {
  return normalizeTechnicalId(value, 'location_id');
}

function allowedInventoryLocations(command: PendingCommand): Set<string> {
  const allowed = new Set<string>();
  const primary = record(command.evidence.inventoryCheck);
  const alternative = record(command.evidence.alternativeInventory);
  const primaryLocation = canonicalLocation(primary?.location);
  const alternativeLocation = canonicalLocation(alternative?.location);
  if (primaryLocation) allowed.add(primaryLocation);
  if (alternativeLocation && alternative?.found !== false && Number(alternative?.quantity ?? 0) > 0) allowed.add(alternativeLocation);
  return allowed;
}

function claimedLocations(text: string): string[] {
  const found = new Set<string>();
  // RC5: the text is already spoken-ID normalised, so "location D nine nine" is checked as D99.
  const patterns = [
    /\blocations?\s+([A-D]\d{2,6})\b/gi,
    /\b(?:at|from|in|to)\s+(?:location\s+)?([A-D]\d{2,6})\b/gi,
    /\b([A-D]\d{2,6})\s+(?:has|holds|contains|shows)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const normalized = canonicalLocation(match[1]);
      if (normalized) found.add(normalized);
    }
  }
  return [...found];
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function claimedAvailabilityQuantities(text: string): number[] {
  const values = new Set<number>();
  const normalized = text.toLowerCase();
  const pattern = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d{1,3})\b(?=[^.!?]{0,45}\b(?:available|in stock|units?)\b)/g;
  for (const match of normalized.matchAll(pattern)) {
    const raw = match[1];
    const value = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (Number.isFinite(value)) values.add(value);
  }
  return [...values];
}

function allowedQuantities(command: PendingCommand): Set<number> {
  const allowed = new Set<number>();
  for (const candidate of [command.evidence.inventoryCheck, command.evidence.alternativeInventory]) {
    const item = record(candidate);
    const quantity = Number(item?.quantity ?? NaN);
    if (Number.isFinite(quantity)) allowed.add(quantity);
  }
  return allowed;
}

function claimsReversalSuccess(text: string): boolean {
  return /\b(?:reversed|reversal (?:was|has been) (?:completed|verified)|recovery was verified)\b/i.test(text);
}

function claimsReversalFailure(text: string): boolean {
  return /\b(?:(?:could not|couldn't|cannot|can't|did not|didn't|failed to|was unable to)\s+(?:complete\s+)?(?:the\s+)?(?:reversal|reverse(?:\s+(?:the\s+)?scan)?)|(?:reversal|reverse(?:\s+scan)?)\s+(?:failed|was not completed|wasn't completed|did not complete))\b/i.test(text);
}

function claimsGenericOperationalFailure(text: string): boolean {
  return /\b(?:could not|couldn't|cannot|can't|failed to|unable to|was unable to)\s+(?:complete|verify|process|finish)(?:\s+(?:that|the|this))?\s*(?:request|operation|result|workflow)?\b/i.test(text);
}

/**
 * Final, deterministic speech claim gate.
 *
 * The model may phrase authorised facts, but it may not create operational facts. This gate is
 * evaluated before buffered PCM for E1/E2/E3 is released to the speakers.
 */
export function assessAgentReplyClaims(
  rawText: string,
  command: PendingCommand | null,
  reversalAuthority: ReversalSpeechAuthority | null = null,
  e2Authority: ReversalSpeechAuthority | null = null,
): ReplyClaimDecision {
  if (!command) return { allowed: true };
  // RC5: normalise spoken identifiers first; quantities are parsed only with identifiers masked.
  const text = normalizeSpokenTechnicalIds(rawText);
  const quantityText = maskTechnicalIds(rawText);
  const lower = quantityText.toLowerCase();

  const reversalSuccess = claimsReversalSuccess(text);
  const reversalFailure = claimsReversalFailure(text);
  const operationalFailure = claimsGenericOperationalFailure(text);

  if (command.workflow === 'E2_MISSING_INVENTORY' && e2Authority) {
    if (operationalFailure && e2Authority.state === 'PENDING') {
      return { allowed: false, code: 'UNVERIFIED_FAILURE_CLAIM', detail: 'E2 failure was spoken while the authoritative code-owned inventory workflow was still pending.' };
    }
    if (operationalFailure && e2Authority.state === 'FINAL' && e2Authority.outcome === 'VERIFIED_SUCCESS' && e2Authority.verified === true) {
      return { allowed: false, code: 'CONTRADICTS_VERIFIED_RESULT', detail: 'E2 failure contradicts the completed verified inventory workflow.' };
    }
  }

  if (command.workflow === 'E3_MISTAKEN_SCAN' && reversalAuthority) {
    if (reversalSuccess && (reversalAuthority.state !== 'FINAL' || reversalAuthority.outcome !== 'VERIFIED_SUCCESS' || reversalAuthority.verified !== true)) {
      return { allowed: false, code: 'UNVERIFIED_MUTATION_CLAIM', detail: `Reversal success contradicts authoritative speech state ${reversalAuthority.state}/${reversalAuthority.outcome ?? 'PENDING'}.` };
    }
    if (reversalFailure && reversalAuthority.state === 'PENDING') {
      return { allowed: false, code: 'UNVERIFIED_FAILURE_CLAIM', detail: 'Reversal failure was spoken while the authoritative CONFIRM result was still pending.' };
    }
    if (reversalFailure && reversalAuthority.state === 'FINAL' && reversalAuthority.outcome === 'VERIFIED_SUCCESS' && reversalAuthority.verified === true) {
      return { allowed: false, code: 'CONTRADICTS_VERIFIED_RESULT', detail: 'Reversal failure contradicts VERIFIED_SUCCESS from independent authoritative verification.' };
    }
  }

  if (reversalSuccess && !command.evidence.reversal) {
    return { allowed: false, code: 'UNVERIFIED_MUTATION_CLAIM', detail: 'Reversal success was spoken without verified reversal evidence on this command.' };
  }

  if (/\b(?:job (?:is|was|has been) blocked|blocked the (?:job|step))\b/i.test(text) && !command.evidence.jobStatus) {
    return { allowed: false, code: 'UNVERIFIED_MUTATION_CLAIM', detail: 'Job-blocked state was spoken without verified job-status evidence on this command.' };
  }

  const loggedClaim = /\b(?:logged|recorded|marked (?:as )?(?:operationally )?unavailable)\b/i.test(text);
  if (loggedClaim) {
    const supported = command.workflow === 'E2_MISSING_INVENTORY'
      ? Boolean(command.evidence.discrepancy)
      : command.workflow === 'E1_WRONG_COMPONENT'
        ? Boolean(command.evidence.exception)
        : true;
    if (!supported) return { allowed: false, code: 'UNVERIFIED_MUTATION_CLAIM', detail: 'Mutation/logging claim was spoken without verified mutation evidence on this command.' };
  }

  if (command.workflow === 'E2_MISSING_INVENTORY' || command.workflow === 'INVENTORY_LOOKUP') {
    const locations = claimedLocations(text);
    if (locations.length) {
      const allowed = allowedInventoryLocations(command);
      const unauthorised = locations.find((location) => !allowed.has(location));
      if (unauthorised) {
        return { allowed: false, code: 'UNAUTHORISED_LOCATION_CLAIM', detail: `Location ${unauthorised} is not supported by authoritative inventory evidence on this command.` };
      }
    }

    const quantities = claimedAvailabilityQuantities(quantityText);
    if (quantities.length && /\b(?:available|in stock|units?)\b/i.test(lower)) {
      const allowed = allowedQuantities(command);
      const unauthorised = quantities.find((quantity) => !allowed.has(quantity));
      if (unauthorised != null) {
        return { allowed: false, code: 'UNAUTHORISED_QUANTITY_CLAIM', detail: `Quantity ${unauthorised} is not supported by authoritative inventory evidence on this command.` };
      }
    }
  }

  return { allowed: true };
}
