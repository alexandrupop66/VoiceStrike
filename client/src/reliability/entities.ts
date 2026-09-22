import type { CriticalEntityKind, CriticalEntityResolution } from './types.js';

const DIGITS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
};

const LETTERS: Record<string, string> = {
  a: 'A', ay: 'A', b: 'B', bee: 'B', c: 'C', see: 'C', d: 'D', dee: 'D',
};

function tokens(value: unknown): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function spokenCompact(value: unknown): string {
  const rawTokens = tokens(value);
  const out: string[] = [];
  for (const token of rawTokens) {
    if (DIGITS[token]) out.push(DIGITS[token]);
    else if (LETTERS[token]) out.push(LETTERS[token]);
    else if (/^[a-z]$/i.test(token)) out.push(token.toUpperCase());
    else if (/^\d+$/.test(token)) out.push(token);
    else if (/^[a-z]\d+$/i.test(token)) out.push(token.toUpperCase());
  }
  return out.join('');
}

export function normalizeTechnicalId(value: unknown, kind: CriticalEntityKind): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const compact = spokenCompact(raw);

  if (kind === 'component_id' || kind === 'location_id') {
    for (const candidate of [upper, compact]) {
      const cleaned = candidate.replace(/-/g, '');
      if (/^[A-Z]\d{2,6}$/.test(cleaned)) return cleaned;
    }
    return null;
  }

  if (kind === 'job_id') {
    for (const candidate of [upper, compact]) {
      const cleaned = candidate.replace(/^JOB-?/, '').replace(/-/g, '');
      if (/^\d{2,8}$/.test(cleaned)) return `JOB-${cleaned}`;
    }
    return null;
  }

  if (kind === 'station_id') {
    for (const candidate of [upper, compact]) {
      const cleaned = candidate.replace(/^STATION-?/, '').replace(/-/g, '');
      if (/^\d{2,8}$/.test(cleaned)) return cleaned;
    }
    return null;
  }

  return upper || null;
}

export function extractTechnicalIds(text: string, kind: CriticalEntityKind): string[] {
  const candidates = new Set<string>();
  const raw = String(text ?? '');
  const scanText = raw.replace(/(?<=\d)-(?=\d)/g, ' ').replace(/[^A-Za-z0-9-]+/g, ' ');

  const directPatterns = kind === 'job_id'
    ? [/\bJOB[\s-]*\d{2,8}\b/gi, /\bJOB(?:\s+(?:ZERO|OH|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE)){2,8}\b/gi]
    : kind === 'station_id'
      ? [/\b(?:STATION\s*)?\d{3,6}\b/gi, /\bSTATION(?:\s+(?:ZERO|OH|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE)){3,6}\b/gi]
      : [/\b[A-D][\s-]*\d{2,6}\b/gi, /\b(?:A|AY|B|BEE|C|SEE|D|DEE)(?:\s+(?:ZERO|OH|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|\d{1,8})){2,6}\b/gi];

  for (const pattern of directPatterns) {
    for (const match of scanText.matchAll(pattern)) {
      const normalized = normalizeTechnicalId(match[0], kind);
      if (normalized) candidates.add(normalized);
    }
  }

  // Hybrid compact/spoken forms can occur across STT turn boundaries.
  // Examples: "B1" + "eight four" -> B184, and real STT "B1" + "84" -> B184.
  // The incomplete "B1" alone still remains unresolved because a component/location ID requires 2+ digits.
  const hybridDigit = '(?:ZERO|OH|O|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|\\d{1,8})';
  const hybridPatterns = kind === 'job_id'
    ? [new RegExp(`\\bJOB[\\s-]*\\d{1,7}(?:\\s+${hybridDigit}){1,7}\\b`, 'gi')]
    : kind === 'station_id'
      ? [new RegExp(`\\bSTATION\\s*\\d{1,5}(?:\\s+${hybridDigit}){1,5}\\b`, 'gi')]
      : [new RegExp(`\\b[A-D]\\d{1,5}(?:\\s+${hybridDigit}){1,5}\\b`, 'gi')];

  for (const pattern of hybridPatterns) {
    for (const match of scanText.matchAll(pattern)) {
      const normalized = normalizeTechnicalId(match[0], kind);
      if (normalized) candidates.add(normalized);
    }
  }

  return [...candidates];
}

export function resolveTechnicalEntity(
  kind: CriticalEntityKind,
  rawValues: string[],
  source: CriticalEntityResolution['source'] = 'CURRENT_UTTERANCE',
): CriticalEntityResolution {
  const candidates = new Set<string>();
  for (const value of rawValues) {
    const direct = normalizeTechnicalId(value, kind);
    if (direct) candidates.add(direct);
    for (const extracted of extractTechnicalIds(value, kind)) candidates.add(extracted);
  }

  const list = [...candidates];
  if (!list.length) return { kind, rawValues, status: 'MISSING', source, candidates: [] };
  if (list.length > 1) return { kind, rawValues, status: 'AMBIGUOUS', source, candidates: list };
  return { kind, rawValues, canonicalValue: list[0], status: 'RESOLVED', source, candidates: list };
}

export function resolveCorrectedTechnicalEntity(
  kind: CriticalEntityKind,
  text: string,
): CriticalEntityResolution {
  const correction = /\b(?:sorry|actually|i mean|correction|no[, ]+wait|no[, ]+i mean)\b/i;
  const parts = text.split(correction).filter(Boolean);
  if (parts.length > 1) {
    const finalPart = parts.at(-1) ?? '';
    const finalCandidates = extractTechnicalIds(finalPart, kind);
    if (finalCandidates.length === 1) {
      return {
        kind,
        rawValues: [text],
        canonicalValue: finalCandidates[0],
        status: 'CORRECTED',
        source: 'CURRENT_UTTERANCE',
        candidates: finalCandidates,
      };
    }
  }
  return resolveTechnicalEntity(kind, [text]);
}
