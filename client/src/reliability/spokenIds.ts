/**
 * BUILD 7 v0.10.0 RC5 — spoken technical-ID normalisation for agent speech.
 *
 * The agent's final transcript may spell identifiers the way TTS reads them
 * ("B one four eight", "D zero five", "C twelve"). Without normalisation the claim gate
 *   - read the ID digits as quantities ("four units of B one four eight available" -> 4, 1, 8), and
 *   - missed spelled locations entirely ("location D nine nine" was never checked).
 * This module rewrites every spoken/compact ID to its canonical form and can mask IDs so that
 * quantity parsing only ever sees real quantities.
 */
const LETTERS: Record<string, string> = {
  a: 'A', ay: 'A', b: 'B', bee: 'B', c: 'C', see: 'C', sea: 'C', cee: 'C', d: 'D', dee: 'D',
};
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
const TEENS: Record<string, string> = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
};
const TENS: Record<string, string> = {
  twenty: '2', thirty: '3', forty: '4', fifty: '5', sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};
/** A number word immediately followed by a count noun is a quantity, never part of an ID. */
const QUANTITY_CUE = /^(?:units?|pieces?|pcs|items?|boxes|x)$/i;

type Token = { text: string; start: number; end: number };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(/[A-Za-z]+|\d+/g)) {
    out.push({ text: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return out;
}

/** Only whitespace or a hyphen may separate the parts of one identifier. */
function joinable(text: string, a: Token, b: Token): boolean {
  return /^[\s-]*$/.test(text.slice(a.end, b.start)) && text.slice(a.end, b.start).length <= 3;
}

export type SpokenIdMatch = { start: number; end: number; canonical: string };

export function findTechnicalIds(text: string): SpokenIdMatch[] {
  const tokens = tokenize(text);
  const matches: SpokenIdMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    const head = tokens[i];
    const compact = /^([A-Da-d])(\d{2,6})$/.exec(head.text);
    // Compact "B148" is tokenised as "B" + "148"; handled below. A fused letter+digits token cannot occur.
    const letter = compact ? null : LETTERS[head.text.toLowerCase()];
    if (!letter) { i += 1; continue; }

    let digits = '';
    let j = i + 1;
    let mode: 'none' | 'numeric' | 'words' = 'none';
    while (j < tokens.length && joinable(text, tokens[j - 1], tokens[j]) && digits.length < 6) {
      const token = tokens[j];
      const lower = token.text.toLowerCase();
      const next = tokens[j + 1];
      const nextIsCue = Boolean(next && joinable(text, token, next) && QUANTITY_CUE.test(next.text));
      if (/^\d+$/.test(token.text)) {
        if (mode !== 'none') break;          // "D05 4 units": a second digit group is a quantity
        mode = 'numeric';
        digits += token.text;
        j += 1;
        break;                               // compact digit group is complete
      }
      if (nextIsCue && digits.length >= 2) break; // "D zero five four units": "four" is the quantity
      if (DIGIT_WORDS[lower] !== undefined) {
        mode = 'words'; digits += DIGIT_WORDS[lower]; j += 1; continue;
      }
      if (TEENS[lower]) { mode = 'words'; digits += TEENS[lower]; j += 1; continue; }
      if (TENS[lower]) {
        mode = 'words';
        const unit = tokens[j + 1];
        const unitDigit = unit && joinable(text, token, unit) ? DIGIT_WORDS[unit.text.toLowerCase()] : undefined;
        if (unitDigit && unitDigit !== '0') { digits += TENS[lower] + unitDigit; j += 2; }
        else { digits += `${TENS[lower]}0`; j += 1; }
        continue;
      }
      break;
    }
    if (digits.length >= 2 && digits.length <= 6) {
      matches.push({ start: head.start, end: tokens[j - 1].end, canonical: `${letter}${digits}` });
      i = j;
    } else {
      i += 1;
    }
  }
  return matches;
}

function rewrite(text: string, replacer: (m: SpokenIdMatch) => string): string {
  let out = '';
  let cursor = 0;
  for (const match of findTechnicalIds(text)) {
    out += text.slice(cursor, match.start) + replacer(match);
    cursor = match.end;
  }
  return out + text.slice(cursor);
}

/** "four units of B one four eight at location D zero five" -> "four units of B148 at location D05". */
export function normalizeSpokenTechnicalIds(text: string): string {
  return rewrite(text, (m) => m.canonical);
}

/** Replaces every identifier with a non-numeric placeholder so quantity parsing cannot see ID digits. */
export function maskTechnicalIds(text: string): string {
  return rewrite(text, () => 'IDREF');
}
