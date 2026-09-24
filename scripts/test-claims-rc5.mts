/**
 * VoiceStrike v0.10.0 RC5 — spoken technical-ID normalisation in the claim gate.
 * Fixes the live E2 false failure ("B one four eight" read as quantities 1/4/8) and the
 * false negative where a spelled location ("D nine nine") bypassed the location check.
 */
import { CommandRegistry } from '../client/src/reliability/commands.js';
import { assessAgentReplyClaims } from '../client/src/reliability/replyClaims.js';
import { findTechnicalIds, maskTechnicalIds, normalizeSpokenTechnicalIds } from '../client/src/reliability/spokenIds.js';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}  got=${JSON.stringify(got)}`); }
};

const cases: Array<[string, string]> = [
  ['B one four eight', 'B148'], ['bee one eight four', 'B184'], ['B 148', 'B148'], ['B148', 'B148'], ['B one forty eight', 'B148'],
  ['D zero five', 'D05'], ['D oh five', 'D05'], ['C twelve', 'C12'], ['C one two', 'C12'], ['location D nine nine', 'location D99'],
];
for (const [input, expected] of cases) {
  const out = normalizeSpokenTechnicalIds(input);
  check(`normalise "${input}" -> ${expected}`, out === expected, out);
}
check('an article with one digit word is not an ID ("a one-time check")', findTechnicalIds('a one-time check').length === 0);
check('a count after a spelled location stays a quantity ("D zero five four units")', normalizeSpokenTechnicalIds('D zero five four units available') === 'D05 four units available');
check('a numeric count after a compact location stays a quantity ("D05 4 units")', normalizeSpokenTechnicalIds('at D05 4 units') === 'at D05 4 units');
check('job/station identifiers are untouched', normalizeSpokenTechnicalIds('JOB-482 at station 3040') === 'JOB-482 at station 3040');
check('masking removes every ID digit', maskTechnicalIds('four units of B one four eight at D zero five') === 'four units of IDREF at IDREF');

const registry = new CommandRegistry();
const e2 = registry.acceptFinalTranscript("VoiceStrike, B148 isn't at C12. The location is empty.");
registry.noteToolResult(e2.id, 'check_inventory', { ok: true, inventory: { component: 'B148', location: 'C12', quantity: 7 } });
registry.noteToolResult(e2.id, 'report_inventory_discrepancy', { ok: true }, true);
registry.noteToolResult(e2.id, 'find_alternative_inventory', { ok: true, alternative: { found: true, component: 'B148', location: 'D05', quantity: 4 } });
const cmd = registry.get(e2.id);
const claim = (text: string) => assessAgentReplyClaims(text, cmd);

check('LIVE E2 sentence with spelled component is allowed (quantity = 4 only)', claim('You can find four units of component B one four eight available at location D05.').allowed);
check('spelled component and spelled location are allowed', claim('Four units of B one four eight are available at location D zero five.').allowed);
check('logged claim with spelled location allowed', claim('I have logged that C twelve is empty.').allowed);
check('wrong quantity with spelled location is rejected', claim('You can find nine units of B148 available at location D zero five.').code === 'UNAUTHORISED_QUANTITY_CLAIM');
check('spelled unauthorised location is rejected (former false negative)', claim('You can find four units available at location D nine nine.').code === 'UNAUTHORISED_LOCATION_CLAIM');
check('compact unauthorised location still rejected', claim('B148 is available at D99.').code === 'UNAUTHORISED_LOCATION_CLAIM');
check('no discrepancy evidence => logged claim rejected', assessAgentReplyClaims('I have logged the discrepancy at C12.', new CommandRegistry().acceptFinalTranscript("VoiceStrike, B148 isn't at C12. The location is empty.")).code === 'UNVERIFIED_MUTATION_CLAIM');



// VS-001: E3 CONFIRM outcome claims are bidirectional. The model may not narrate failure before
// the deterministic result exists, nor contradict a final VERIFIED_SUCCESS result.
const e3Registry = new CommandRegistry();
const e3 = e3Registry.acceptFinalTranscript('VoiceStrike, I scanned B184 by mistake.');
const e3Command = e3Registry.get(e3.id);
check('VS-001 pending CONFIRM blocks failure narration', assessAgentReplyClaims('I could not complete the reversal.', e3Command, { state: 'PENDING' }).code === 'UNVERIFIED_FAILURE_CLAIM');
check('VS-001 VERIFIED_SUCCESS blocks contradictory failure narration', assessAgentReplyClaims('I could not complete the reversal.', e3Command, { state: 'FINAL', outcome: 'VERIFIED_SUCCESS', verified: true }).code === 'CONTRADICTS_VERIFIED_RESULT');
check('VS-001 failed authoritative outcome permits truthful failure narration', assessAgentReplyClaims('I could not complete the reversal.', e3Command, { state: 'FINAL', outcome: 'VERIFY_FAILED', verified: false }).allowed);
check('VS-001 failed authoritative outcome still blocks success narration', assessAgentReplyClaims('The reversal has been completed.', e3Command, { state: 'FINAL', outcome: 'VERIFY_FAILED', verified: false }).code === 'UNVERIFIED_MUTATION_CLAIM');

console.log(`\nVoiceStrike RC5 claim gate: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`RC5 claim regressions failed: ${failed}`);
