import { extractTechnicalIds, normalizeTechnicalId } from './entities.js';
import type { CriticalEntityResolution } from './types.js';

export type InventoryDiscrepancyEntities = {
  component: CriticalEntityResolution;
  location: CriticalEntityResolution;
  observedEmpty: boolean;
};

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function resolution(kind: 'component_id' | 'location_id', raw: string, candidates: string[]): CriticalEntityResolution {
  const values = unique(candidates.map((value) => normalizeTechnicalId(value, kind)));
  if (!values.length) return { kind, rawValues: [raw], status: 'MISSING', source: 'CURRENT_UTTERANCE', candidates: [] };
  if (values.length > 1) return { kind, rawValues: [raw], status: 'AMBIGUOUS', source: 'CURRENT_UTTERANCE', candidates: values };
  return { kind, rawValues: [raw], canonicalValue: values[0], status: 'RESOLVED', source: 'CURRENT_UTTERANCE', candidates: values };
}

function firstIds(fragment: string, kind: 'component_id' | 'location_id'): string[] {
  return extractTechnicalIds(fragment, kind);
}

function orderedDirectCodes(text: string): string[] {
  const found: Array<{ index: number; value: string }> = [];
  const direct = /\b[A-D][\s-]*\d{2,6}\b/gi;
  for (const match of text.matchAll(direct)) {
    const normalized = normalizeTechnicalId(match[0], 'component_id');
    if (normalized) found.push({ index: match.index ?? 0, value: normalized });
  }
  if (found.length) return unique(found.sort((a, b) => a.index - b.index).map((item) => item.value));
  return unique(extractTechnicalIds(text, 'component_id'));
}

export function isExplicitEmptyObservation(text: string): boolean {
  const normalized = String(text ?? '').toLowerCase().replace(/[’]/g, "'");
  return /\b(?:empty|nothing\s+(?:is\s+)?there|nothing\s+there|no\s+stock|zero\s+stock|out\s+of\s+stock|not\s+there|isn't\s+there|isnt\s+there|missing\s+from\s+(?:the\s+)?location|location\s+is\s+empty)\b/i.test(normalized);
}

/**
 * Resolve the two typed critical entities used by E2 (Missing Inventory).
 *
 * Component IDs and location IDs intentionally share the same lexical shape (e.g. B148, C12),
 * so the generic technical-ID resolver cannot safely distinguish them when both occur in one
 * utterance. This resolver uses linguistic role cues first, then a narrow ordered-pair fallback
 * only when the command already contains an explicit EMPTY observation.
 */
export function resolveInventoryDiscrepancyEntities(text: string): InventoryDiscrepancyEntities {
  const raw = String(text ?? '');
  const componentCandidates: string[] = [];
  const locationCandidates: string[] = [];

  // "location for/of B148" names the component whose location is being discussed.
  // It must not be interpreted as a location ID merely because component/location IDs
  // share the same lexical shape.
  const locationForComponentCue = /\blocation\s+(?:for|of)\s+([^,.!?;]{1,36})/gi;
  for (const match of raw.matchAll(locationForComponentCue)) {
    componentCandidates.push(...firstIds(match[1] ?? '', 'component_id'));
  }

  // Explicit location roles: "at C12", "location C12", "location is C12", "bin C12".
  // Exclude "location for/of <component>" because that phrase describes the component role.
  const locationCue = /\b(?:at|location(?!\s+(?:for|of)\b)(?:\s+(?:is|was))?|bin|slot)\s+([^,.!?;]{1,36})/gi;
  for (const match of raw.matchAll(locationCue)) {
    locationCandidates.push(...firstIds(match[1] ?? '', 'location_id'));
  }

  // Explicit component roles: "component B148", "part B148".
  const componentCue = /\b(?:component|part)(?:\s+(?:id|number))?\s*(?:is|was|=|:)?\s+([^,.!?;]{1,36})/gi;
  for (const match of raw.matchAll(componentCue)) {
    componentCandidates.push(...firstIds(match[1] ?? '', 'component_id'));
  }

  // Natural E2 subject form: "B148 isn't at C12", "B148 at C12 is empty".
  const subjectAtLocation = /([^,.!?;]{1,28}?)\s+(?:isn['’]?t\s+|is\s+not\s+|wasn['’]?t\s+|was\s+not\s+|not\s+)?at\s+([^,.!?;]{1,28})/gi;
  for (const match of raw.matchAll(subjectAtLocation)) {
    componentCandidates.push(...firstIds(match[1] ?? '', 'component_id'));
    locationCandidates.push(...firstIds(match[2] ?? '', 'location_id'));
  }

  const ordered = orderedDirectCodes(raw);
  const explicitEmpty = isExplicitEmptyObservation(raw);
  let components = unique(componentCandidates);
  let locations = unique(locationCandidates);

  // If one role is explicit, the single remaining technical ID can safely fill the other role.
  if (!components.length && locations.length === 1) {
    const remaining = ordered.filter((value) => value !== locations[0]);
    if (remaining.length === 1) components = remaining;
  }
  if (!locations.length && components.length === 1) {
    const remaining = ordered.filter((value) => value !== components[0]);
    if (remaining.length === 1) locations = remaining;
  }

  // Narrow clarification fallback. "B148, C12" is interpreted as component then location only
  // inside an already explicit EMPTY command context. Without EMPTY evidence it remains unresolved.
  if (explicitEmpty && !components.length && !locations.length && ordered.length === 2) {
    components = [ordered[0]];
    locations = [ordered[1]];
  }

  return {
    component: resolution('component_id', raw, components),
    location: resolution('location_id', raw, locations),
    observedEmpty: explicitEmpty,
  };
}

export function inventoryDiscrepancyReady(text: string): boolean {
  const entities = resolveInventoryDiscrepancyEntities(text);
  return entities.observedEmpty
    && (entities.component.status === 'RESOLVED' || entities.component.status === 'CORRECTED')
    && (entities.location.status === 'RESOLVED' || entities.location.status === 'CORRECTED');
}
