import { extractTechnicalIds } from './entities.js';

export type TranscriptSanityStatus =
  | 'RELIABLE'
  | 'EMPTY'
  | 'SHORT_AMBIGUOUS'
  | 'UNEXPECTED_SCRIPT'
  | 'NO_MEANINGFUL_CONTENT'
  | 'NO_OPERATIONAL_SIGNAL';

export type TranscriptSanity = {
  reliable: boolean;
  status: TranscriptSanityStatus;
  normalized: string;
};

export type TranscriptSanityOptions = {
  requireOperationalSignal?: boolean;
};

export type OperationalIntent =
  | 'SCAN_CONTEXT'
  | 'MISTAKEN_SCAN'
  | 'REVERSE_SCAN'
  | 'WRONG_COMPONENT'
  | 'MISSING_INVENTORY';

const SHORT_AMBIGUOUS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'ok', 'okay', 'done', 'confirm',
  'do it', 'thats it', "that's it", 'da', 'nu', 'gata', 'asta e',
]);

export function normalizedPhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
}

function containsUnexpectedScript(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return false;
  return letters.some((letter) => !/\p{Script=Latin}/u.test(letter));
}

export function isShortAmbiguousUtterance(text: string): boolean {
  return SHORT_AMBIGUOUS.has(normalizedPhrase(String(text ?? '')));
}

export function stripWakePhrase(text: string): string {
  return String(text ?? '').replace(/\bvoice\s*strike\b/ig, ' ').replace(/\s+/g, ' ').trim();
}

/** A bare wake phrase is a control event, not an operational command. */
export function isWakeControlUtterance(text: string): boolean {
  return normalizedPhrase(stripWakePhrase(text)) === '';
}

/** Short yes/no/okay after an explicit wake phrase, used only for command-bound clarification continuity. */
export function isWakeQualifiedShortResponse(text: string): boolean {
  const stripped = stripWakePhrase(text);
  return Boolean(stripped) && isShortAmbiguousUtterance(stripped);
}

export function assessTranscriptSanity(text: string, options: TranscriptSanityOptions = {}): TranscriptSanity {
  const normalized = normalizedPhrase(String(text ?? ''));
  if (!normalized) return { reliable: false, status: 'EMPTY', normalized };
  if (containsUnexpectedScript(text)) return { reliable: false, status: 'UNEXPECTED_SCRIPT', normalized };
  if (SHORT_AMBIGUOUS.has(normalized)) return { reliable: false, status: 'SHORT_AMBIGUOUS', normalized };
  if (!/[\p{L}\p{N}]/u.test(normalized)) return { reliable: false, status: 'NO_MEANINGFUL_CONTENT', normalized };
  if (options.requireOperationalSignal && !hasOperationalSignal(text)) {
    return { reliable: false, status: 'NO_OPERATIONAL_SIGNAL', normalized };
  }
  return { reliable: true, status: 'RELIABLE', normalized };
}

export function containsAnyTechnicalId(text: string): boolean {
  return (
    extractTechnicalIds(text, 'component_id').length > 0 ||
    extractTechnicalIds(text, 'job_id').length > 0 ||
    extractTechnicalIds(text, 'station_id').length > 0 ||
    extractTechnicalIds(text, 'location_id').length > 0
  );
}

export function detectOperationalIntent(text: string): OperationalIntent | null {
  const normalized = normalizedPhrase(text);
  if (!normalized) return null;

  if (/\b(?:reverse|undo)\b.*\bscan\b|\bscan\b.*\b(?:reverse|undo)\b/i.test(normalized)) {
    return 'REVERSE_SCAN';
  }

  if (
    /\b(?:mistake|mistaken|accident|accidental|accidentally|scan error|wrong scan)\b/i.test(normalized) ||
    /\bscan(?:ned)?\b.*\bwrong\b|\bwrong\b.*\bscan(?:ned)?\b/i.test(normalized)
  ) {
    return 'MISTAKEN_SCAN';
  }

  if (/\bwrong\b.*\b(?:part|component)\b|\b(?:part|component)\b.*\bwrong\b/i.test(normalized)) {
    return 'WRONG_COMPONENT';
  }

  if (
    /\b(?:empty|missing|unavailable|out of stock|no stock)\b/i.test(normalized) &&
    /\b(?:inventory|location|stock|component|part|there|it)\b/i.test(normalized)
  ) {
    return 'MISSING_INVENTORY';
  }

  if (/\bscan(?:ned)?\b/i.test(normalized)) return 'SCAN_CONTEXT';
  return null;
}

export function hasOperationalSignal(text: string): boolean {
  if (containsAnyTechnicalId(text)) return true;
  if (detectOperationalIntent(text)) return true;
  return /\b(?:component|part|scan|scanned|reverse|reversal|wrong|mistake|mistaken|empty|missing|inventory|location|job|station|block|blocked|discrepancy|exception)\b/i.test(text);
}

export function isIncompleteTechnicalFragment(text: string): boolean {
  const normalized = normalizedPhrase(text);
  if (!normalized) return false;

  const digitWord = '(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine|\\d)';
  const spokenLetter = '(?:a|ay|b|bee|c|see|d|dee)';

  return (
    new RegExp(`(?:^|\\s)${spokenLetter}(?:\\s+${digitWord})?$`, 'i').test(normalized) ||
    /(?:^|\s)[a-d]\d$/i.test(normalized) ||
    new RegExp(`(?:^|\\s)job(?:\\s+${digitWord})?$`, 'i').test(normalized) ||
    /(?:^|\s)job\d$/i.test(normalized) ||
    new RegExp(`(?:^|\\s)station(?:\\s+${digitWord}(?:\\s+${digitWord})?)?$`, 'i').test(normalized) ||
    /(?:^|\s)station\s*\d{1,2}$/i.test(normalized)
  );
}

export function isLikelyFragment(text: string): boolean {
  const normalized = normalizedPhrase(text);
  if (!normalized) return true;
  if (/(?:\.\.\.|…)$/.test(text.trim())) return true;
  if (isIncompleteTechnicalFragment(text)) return true;
  if (/\b(?:a|ay|b|bee|c|see|d|dee|job|station|location|component|part|scan|scanned|reverse|one|two|three|four|five|six|seven|eight|nine|zero|oh)$/i.test(normalized)) {
    return !containsAnyTechnicalId(text);
  }
  return false;
}

export function isCorrectionUtterance(text: string): boolean {
  return /\b(?:actually|sorry|i mean|correction|no\s*,?\s*wait|no\s*,?\s*i mean)\b/i.test(text);
}

export function isExplicitCancellation(text: string): boolean {
  const correctionCue = /\b(?:no\s*,?\s*wait|sorry|i mean|correction)\b/i.exec(text);
  if (correctionCue) {
    const replacement = text.slice((correctionCue.index ?? 0) + correctionCue[0].length);
    if (containsAnyTechnicalId(replacement)) return false;
  }
  const normalized = normalizedPhrase(text);
  return /\b(?:cancel|stop|dont|don't|do not|never mind|nevermind|wait)\b/i.test(normalized);
}

export function isOperationalContinuation(text: string): boolean {
  const normalized = normalizedPhrase(text);
  const digitWordsOnly = /^(?:(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\s*)+$/i.test(normalized);
  // STT may collapse or punctuate spoken digit sequences between turns: "84", "8-4", or "8 4".
  // Numeric-only continuation is accepted ONLY when CommandRegistry already has a COLLECTING command.
  const numericDigitsOnly = /^(?:\d{1,8}\s*)+$/.test(normalized);
  return (
    containsAnyTechnicalId(text) ||
    isIncompleteTechnicalFragment(text) ||
    digitWordsOnly ||
    numericDigitsOnly ||
    detectOperationalIntent(text) !== null ||
    /\b(?:scan|scanned|component|part|job|station|location|reverse|empty|missing|wrong|mistake)\b/i.test(text)
  );
}

export function isClarificationContinuation(text: string): boolean {
  if (isOperationalContinuation(text)) return true;
  // v0.9.0 (defect 5.4 / regression R-G): a bare approval such as "yes" or "okay" is never
  // operational authority, so it must not be able to hold, extend or transfer an operational
  // window either. A television saying "yes" during an open wake window is now ignored; a
  // worker's real clarification always carries operational content or the identifier itself.
  const normalized = normalizedPhrase(text);
  if (isShortAmbiguousUtterance(text)) return false;
  return /\b(?:it|that|this|there)\b.*\b(?:mistake|wrong|empty|missing)\b/i.test(normalized);
}
