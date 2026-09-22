const SHORT_AMBIGUOUS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'ok', 'okay', 'done', 'confirm',
  'do it', 'thats it', "that's it", 'da', 'nu', 'gata', 'asta e',
]);

export type TranscriptSanityStatus = 'RELIABLE' | 'EMPTY' | 'SHORT_AMBIGUOUS' | 'UNEXPECTED_SCRIPT' | 'NO_MEANINGFUL_CONTENT' | 'NO_OPERATIONAL_SIGNAL';

export function assessTranscriptSanity(value: unknown, options: { requireOperationalSignal?: boolean } = {}): { reliable: boolean; status: TranscriptSanityStatus; normalized: string } {
  const raw = String(value ?? '');
  const normalized = raw
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();
  if (!normalized) return { reliable: false, status: 'EMPTY', normalized };
  const letters = raw.match(/\p{L}/gu) ?? [];
  if (letters.some((letter) => !/\p{Script=Latin}/u.test(letter))) {
    return { reliable: false, status: 'UNEXPECTED_SCRIPT', normalized };
  }
  if (SHORT_AMBIGUOUS.has(normalized)) return { reliable: false, status: 'SHORT_AMBIGUOUS', normalized };
  if (!/[\p{L}\p{N}]/u.test(normalized)) return { reliable: false, status: 'NO_MEANINGFUL_CONTENT', normalized };
  if (options.requireOperationalSignal && !hasOperationalSignal(raw)) {
    return { reliable: false, status: 'NO_OPERATIONAL_SIGNAL', normalized };
  }
  return { reliable: true, status: 'RELIABLE', normalized };
}

export function normalizeTechnicalId(value: unknown): string {
  const raw = String(value ?? '').trim();
  const direct = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]\d{2,6}$/.test(direct)) return direct;

  const digits: Record<string, string> = {
    zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9',
  };
  const letters: Record<string, string> = { a: 'A', ay: 'A', b: 'B', bee: 'B', c: 'C', see: 'C', d: 'D', dee: 'D' };
  const parts = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (digits[part]) out.push(digits[part]);
    else if (letters[part]) out.push(letters[part]);
    else if (/^\d+$/.test(part)) out.push(part);
    else if (/^[a-z]\d+$/i.test(part)) out.push(part.toUpperCase());
  }
  const compact = out.join('');
  return /^[A-Z]\d{2,6}$/.test(compact) ? compact : direct;
}


export function hasOperationalSignal(value: unknown): boolean {
  const raw = String(value ?? '');
  const technical = normalizeTechnicalId(raw);
  if (/^[A-Z]\d{2,6}$/.test(technical)) return true;
  return /\b(?:component|part|scan|scanned|reverse|reversal|wrong|mistake|mistaken|empty|missing|inventory|location|job|station|block|blocked|discrepancy|exception)\b/i.test(raw);
}
