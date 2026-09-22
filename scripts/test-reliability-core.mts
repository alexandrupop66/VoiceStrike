import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CommandRegistry } from '../client/src/reliability/commands.js';
import { AmbientSpeechGate, containsWakePhrase, CLARIFICATION_WINDOW_MS } from '../client/src/reliability/ambient.js';
import { CriticalConfirmationGate } from '../client/src/reliability/confirmation.js';
import { CriticalSpeechTrustGate, classifyCriticalSpeech, criticalSpeechComponent, CRITICAL_POST_TTS_QUIET_MS } from '../client/src/reliability/criticalSpeech.js';
import { DuplexEchoGuard, isProtectedCriticalPhrase } from '../client/src/reliability/duplex.js';
import { normalizeTechnicalId, resolveCorrectedTechnicalEntity, resolveTechnicalEntity } from '../client/src/reliability/entities.js';
import { assessTranscriptSanity, detectOperationalIntent, isExplicitCancellation, isOperationalContinuation, isWakeControlUtterance, isWakeQualifiedShortResponse } from '../client/src/reliability/transcript.js';
import { canClaimSuccess, executeVerifiedAction } from '../client/src/reliability/safeAction.js';
import { validatePreparedReversalAuthority } from '../server/src/reliability/confirmation.js';
import { classifyToolReporting } from '../client/src/reliability/toolReporting.js';
import { RECOVERY_CONTEXT_TTL_MS, isRecoverySpeechContextFresh, makeRecoverySpeechContext } from '../client/src/reliability/recovery.js';
import { TURN_AUTHORITY_TTL_MS, TurnAuthorityRegistry, resolveTurnAuthority, type TurnAuthority } from '../client/src/reliability/authority.js';
import { ClaimEvidence, groundClaims, type OperationalStage } from '../client/src/reliability/claims.js';
import { assessCancellationIntent } from '../client/src/reliability/cancellation.js';
import { PROTECTED_TOOL_LEASE_TTL_MS, ReplyAuthorityRegistry } from '../client/src/reliability/replyAuthority.js';
import { SessionEpochRegistry } from '../client/src/reliability/session.js';
import { assessReadReadiness, isMutationToolName, isReadOnlyTool, toolClass } from '../client/src/reliability/toolPolicy.js';
import { WorkflowPolicy } from '../client/src/reliability/workflow.js';
import { CONFIRMATION_TTL_MS } from '../client/src/reliability/confirmation.js';
import { PROTECTED_POST_TTS_QUIET_MS, ProtectedSpeechWindowRegistry } from '../client/src/reliability/protectedSpeech.js';
import { inventoryDiscrepancyReady, resolveInventoryDiscrepancyEntities } from '../client/src/reliability/inventoryEntities.js';

const root = resolve(import.meta.dirname, '..');
const corpus = JSON.parse(readFileSync(resolve(root, 'tests/reliability/reliability-corpus.json'), 'utf8')) as Array<Record<string, unknown>>;
let passed = 0;
let failed = 0;

// BUILD 7 spec §36 metrics, computed from the deterministic Layer-A suite.
const metrics = {
  entityTotal: 0, entityCorrect: 0, entitySafe: 0,          // M1 / M2
  unsafeInputs: 0, unsafeMutations: 0,                       // M3
  actionsTested: 0, falseSuccessClaims: 0,                   // M4
  correctionTotal: 0, correctionCorrect: 0,                  // M5
};

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`);
  }
}

check('Controlled corpus contains at least 30 cases', corpus.length >= 30);
check('Controlled corpus covers every BUILD 7.8 audio category', ['baseline', 'technical_id', 'correction', 'fragmented', 'sanity', 'ambiguity', 'ambient', 'accent', 'noise', 'wake_control', 'protected_confirmation', 'cancellation', 'interruption'].every((category) => corpus.some((item) => item.category === category)));
check('Unknown component remains B185, not nearest-known B184', normalizeTechnicalId('B185', 'component_id') === 'B185');
check('Incomplete B one does not become a technical ID', normalizeTechnicalId('B one', 'component_id') === null);
check('Bare yes is SHORT_AMBIGUOUS', assessTranscriptSanity('Yes.').status === 'SHORT_AMBIGUOUS');
check('Devanagari drift is UNEXPECTED_SCRIPT', assessTranscriptSanity('\u0939\u094b \u0917\u092f\u093e').status === 'UNEXPECTED_SCRIPT');
check('Irrelevant Latin drift cannot authorise mutation', assessTranscriptSanity('bonjour mon ami', { requireOperationalSignal: true }).status === 'NO_OPERATIONAL_SIGNAL');
check('Technical ID alone is an operational signal', assessTranscriptSanity('B one eight four', { requireOperationalSignal: true }).status === 'RELIABLE');
check('Explicit cancellation is detected', isExplicitCancellation("Reverse that... actually don't."));
check('Correction with replacement ID is not cancellation', !isExplicitCancellation('I scanned B184, no wait, B148.'));

// v0.9.4 — E2 typed entity resolution. Component IDs and location IDs share the same lexical
// shape, so the missing-inventory workflow must resolve them by semantic role instead of feeding
// both through the generic component/location resolver.
{
  const natural = resolveInventoryDiscrepancyEntities("VoiceStrike, B148 isn't at C12. The location is empty.");
  check('E2-T1 natural empty-location report resolves component B148', natural.component.canonicalValue === 'B148' && natural.component.status === 'RESOLVED');
  check('E2-T2 natural empty-location report resolves location C12', natural.location.canonicalValue === 'C12' && natural.location.status === 'RESOLVED');
  check('E2-T3 natural empty-location report preserves explicit EMPTY observation', natural.observedEmpty);
  check('E2-T4 natural empty-location report is mutation-ready at typed entity layer', inventoryDiscrepancyReady("VoiceStrike, B148 isn't at C12. The location is empty."));

  const lookupThenReport = new CommandRegistry();
  const lookup = lookupThenReport.acceptFinalTranscript('VoiceStrike, where can I find B148?');
  const report = lookupThenReport.acceptFinalTranscript("VoiceStrike, B148 isn't at C12. The location is empty.");
  check('E2-T5 lookup then natural report creates a fresh E2 commandId', lookup.id !== report.id && report.workflow === 'E2_MISSING_INVENTORY');
  check('E2-T6 lookup then natural report becomes READY', report.status === 'READY' && report.intent === 'MISSING_INVENTORY');
  check('E2-T7 command carries separate typed component/location entities', report.entities.some((e) => e.kind === 'component_id' && e.canonicalValue === 'B148') && report.entities.some((e) => e.kind === 'location_id' && e.canonicalValue === 'C12'));

  const clarification = new CommandRegistry();
  const incomplete = clarification.acceptFinalTranscript('VoiceStrike, B148 location is empty.');
  check('E2-T8 missing location remains COLLECTING', incomplete.status === 'COLLECTING' && incomplete.intent === 'MISSING_INVENTORY');
  const clarified = clarification.acceptFinalTranscript('B148, C12.');
  check('E2-T9 typed clarification keeps the same commandId', clarified.id === incomplete.id);
  check('E2-T10 typed clarification resolves pair and becomes READY', clarified.status === 'READY' && clarified.entities.some((e) => e.kind === 'component_id' && e.canonicalValue === 'B148') && clarified.entities.some((e) => e.kind === 'location_id' && e.canonicalValue === 'C12'));

  const ambiguousLocation = resolveInventoryDiscrepancyEntities("VoiceStrike, B148 isn't at C12 or C13. The location is empty.");
  check('E2-T11 multiple locations remain ambiguous', ambiguousLocation.location.status === 'AMBIGUOUS');

  const noEmpty = resolveInventoryDiscrepancyEntities('VoiceStrike, B148, C12.');
  check('E2-T12 bare pair without EMPTY evidence is not mutation-ready', !noEmpty.observedEmpty && !inventoryDiscrepancyReady('VoiceStrike, B148, C12.'));

  const workflowE2 = new WorkflowPolicy();
  workflowE2.noteInventoryCheck({ component: 'B148', location: 'C12', quantity: 7 }, 500_000);
  check('E2-T13 exact authoritative checked pair satisfies discrepancy precondition', workflowE2.assess('report_inventory_discrepancy', { component_id: 'B148', location: 'C12', observed_state: 'EMPTY' }, 500_100).ok);
  check('E2-T14 wrong location remains blocked despite valid component', !workflowE2.assess('report_inventory_discrepancy', { component_id: 'B148', location: 'C13', observed_state: 'EMPTY' }, 500_100).ok);

  // v0.9.5 — command continuity after the live long-session failure. A bare wake phrase is
  // control only; E2 clarifications retain one commandId even after READY; a different intent
  // still creates a fresh command so workflow state cannot leak across scenarios.
  check('E2-C1 bare VoiceStrike is classified as wake control', isWakeControlUtterance('VoiceStrike.'));
  check('E2-C2 wake plus real request is not wake-control-only', !isWakeControlUtterance('VoiceStrike, B148 at C12 is empty.'));
  check('E2-C3 explicit wake-qualified yes is recognised only as short contextual response', isWakeQualifiedShortResponse('VoiceStrike, yes.'));

  const longE2 = new CommandRegistry();
  const e2Lookup = longE2.acceptFinalTranscript('VoiceStrike, where can I find B148?');
  const e2Report = longE2.acceptFinalTranscript("VoiceStrike, B148 isn't at C12. The location is empty.");
  const e2Yes = longE2.acceptFinalTranscript('VoiceStrike, yes.');
  const e2Restate = longE2.acceptFinalTranscript("I check C12, it's empty.");
  check('E2-C4 report/yes/restate preserve one E2 commandId distinct from lookup', e2Report.id !== e2Lookup.id && [e2Yes, e2Restate].every((item) => item.id === e2Report.id));
  check('E2-C5 E2 remains READY after redundant clarification turns', e2Restate.status === 'READY' && e2Restate.intent === 'MISSING_INVENTORY');
  check('E2-C6 accumulated E2 context still resolves B148/C12/EMPTY', inventoryDiscrepancyReady(e2Restate.fragments.join(' ')));
  const e3AfterE2 = longE2.acceptFinalTranscript('VoiceStrike, I scanned B184 by mistake.');
  check('E2-C7 unrelated mistaken-scan after E2 gets a new commandId', e3AfterE2.id !== e2Report.id && e3AfterE2.intent === 'MISTAKEN_SCAN');

  const wakeAuthority = new TurnAuthorityRegistry();
  const beforeWake = wakeAuthority.grant({
    sessionId: 'S-E2', turnId: 'T-E2', commandId: e2Report.id, transcript: "B148 at C12 is empty",
    wakeAuthorised: true, criticalSpeechTrusted: false, criticalKind: 'NONE', intent: 'MISSING_INVENTORY', componentId: 'B148', now: 700_000,
  });
  wakeAuthority.consumeMutation(beforeWake, 'report_inventory_discrepancy');
  wakeAuthority.clearCurrent();
  check('E2-C8 wake-control clearing removes current tool authority', !wakeAuthority.resolve({ commandId: e2Report.id, sessionId: 'S-E2', isCommandCurrent: true, now: 700_100 }).ok);
  wakeAuthority.grant({
    sessionId: 'S-E2', turnId: 'T-E2', commandId: e2Report.id, transcript: "B148 at C12 is empty",
    wakeAuthorised: true, criticalSpeechTrusted: false, criticalKind: 'NONE', intent: 'MISSING_INVENTORY', componentId: 'B148', now: 700_200,
  });
  const replayAfterWake = wakeAuthority.resolve({ commandId: e2Report.id, sessionId: 'S-E2', isCommandCurrent: true, mutationToolName: 'report_inventory_discrepancy', now: 700_250 });
  check('E2-C9 wake-control clearing preserves consumed-mutation history', !replayAfterWake.ok && replayAfterWake.reason === 'MUTATION_ALREADY_CONSUMED');
}


for (const item of corpus) {
  const id = String(item.id ?? 'unknown');
  const kind = item.entityKind as 'component_id' | 'job_id' | 'station_id' | 'location_id' | undefined;
  const expected = typeof item.expectedEntity === 'string' && !item.expectedEntity.endsWith('_OR_CLARIFY')
    ? item.expectedEntity
    : undefined;

  if (typeof item.expectedSanity === 'string' && typeof item.input === 'string') {
    check(`${id} sanity ${item.expectedSanity}`, assessTranscriptSanity(item.input).status === item.expectedSanity);
  }

  if (item.expectedCancellation === true && typeof item.input === 'string') {
    if (item.category === 'correction') { metrics.correctionTotal += 1; if (isExplicitCancellation(item.input)) metrics.correctionCorrect += 1; }
    check(`${id} cancellation`, isExplicitCancellation(item.input));
  }

  if (kind && expected && typeof item.input === 'string') {
    const result = item.expectedResolution === 'CORRECTED'
      ? resolveCorrectedTechnicalEntity(kind, item.input)
      : resolveTechnicalEntity(kind, [item.input]);
    metrics.entityTotal += 1;
    if (result.canonicalValue === expected) { metrics.entityCorrect += 1; metrics.entitySafe += 1; }
    else if (result.status === 'AMBIGUOUS' || result.status === 'MISSING') metrics.entitySafe += 1;
    if (item.category === 'correction') { metrics.correctionTotal += 1; if (result.canonicalValue === expected && result.status === 'CORRECTED') metrics.correctionCorrect += 1; }
    check(`${id} resolves ${expected}`, result.canonicalValue === expected);
    if (typeof item.expectedResolution === 'string') {
      check(`${id} resolution ${item.expectedResolution}`, result.status === item.expectedResolution);
    }
  }

  if (kind && item.expectedResolution === 'AMBIGUOUS' && typeof item.input === 'string') {
    const result = resolveTechnicalEntity(kind, [item.input]);
    metrics.entityTotal += 1;
    if (result.status === 'AMBIGUOUS') metrics.entitySafe += 1; // safely clarified, never guessed
    check(`${id} is ambiguous`, result.status === 'AMBIGUOUS');
  }

  if (Array.isArray(item.fragments) && kind && expected) {
    const registry = new CommandRegistry();
    let commandId = '';
    for (const fragment of item.fragments) {
      commandId = registry.acceptFinalTranscript(String(fragment)).id;
    }
    const context = registry.contextFor(commandId);
    const result = resolveTechnicalEntity(kind, [context], 'PENDING_COMMAND');
    metrics.entityTotal += 1;
    if (result.canonicalValue === expected) { metrics.entityCorrect += 1; metrics.entitySafe += 1; }
    check(`${id} fragmented context resolves ${expected}`, result.canonicalValue === expected);
  }
}

const stale = new CommandRegistry();
stale.acceptFinalTranscript('I have B184.');
const oldReply = stale.beginReply();
stale.acceptFinalTranscript('Actually B148.');
check('Interrupted/corrected old reply becomes stale', Boolean(oldReply) && !stale.isCurrent(String(oldReply)));

// v0.8.9 regression: a completed recovery command must not contaminate the next workflow
// in the same long-lived Worker voice session. This exact sequence reproduced the runtime E1 bug.
const sequentialWorkflow = new CommandRegistry();
const sw1 = sequentialWorkflow.acceptFinalTranscript('VoiceStrike, I scanned B184 by mistake.');
const sw2 = sequentialWorkflow.acceptFinalTranscript('VoiceStrike, reverse scan B184.');
const sw3 = sequentialWorkflow.acceptFinalTranscript('VoiceStrike, confirm reverse scan B184.');
check('Sequential recovery keeps one command through protected confirmation', sw1.id === sw2.id && sw2.id === sw3.id && sw3.intent === 'REVERSE_SCAN');
const sw4 = sequentialWorkflow.acceptFinalTranscript("VoiceStrike, I think I've got the wrong part.");
check('New wrong-component intent after recovery starts a fresh commandId', sw4.id !== sw3.id && sw4.intent === 'WRONG_COMPONENT' && sw4.status === 'COLLECTING');
const sw5 = sequentialWorkflow.acceptFinalTranscript('B184.');
check('Wrong-component B184 clarification stays on the fresh command', sw5.id === sw4.id && sw5.intent === 'WRONG_COMPONENT');
check('Wrong-component intent + B184 becomes READY after prior recovery workflow', sw5.status === 'READY' && sequentialWorkflow.isReady(sw5.id));
check('Fresh wrong-component context does not contain stale reverse intent', !sequentialWorkflow.contextFor(sw5.id).toLowerCase().includes('reverse scan'));

const fragmented = new CommandRegistry();
const f1 = fragmented.acceptFinalTranscript('B one...');
const f2 = fragmented.acceptFinalTranscript('eight four.');
check('Fragmented technical ID retains one command ID', f1.id === f2.id);
check('Technical ID-only B one / eight four remains COLLECTING until intent exists', f2.status === 'COLLECTING');

const compactFragmented = new CommandRegistry();
const cf1 = compactFragmented.acceptFinalTranscript('I scanned.');
const cf2 = compactFragmented.acceptFinalTranscript('B1.');
check('Compact B1 fragment stays on the same command', cf1.id === cf2.id);
check('Compact B1 fragment remains COLLECTING', cf2.status === 'COLLECTING');
check('Compact B1 fragment is not ready for operational reads', !compactFragmented.isReady(cf2.id));
const cf3 = compactFragmented.acceptFinalTranscript('eight four.');
const cfPendingEvent = compactFragmented.takeLastEvent();
check('Compact B1 / eight four keeps one command ID', cf1.id === cf3.id);
check('Reconstructed B184 remains COLLECTING until explicit entity confirmation', cf3.status === 'COLLECTING');
check('Reconstructed B184 creates entity_confirmation PENDING event', cfPendingEvent?.type === 'entity_confirmation' && cfPendingEvent.status === 'PENDING' && cfPendingEvent.expectedValue === 'B184');
check('Hybrid B1 eight four resolves B184', resolveTechnicalEntity('component_id', [compactFragmented.contextFor(cf3.id)], 'PENDING_COMMAND').canonicalValue === 'B184');
check('inspect_last_action remains blocked before entity confirmation', !compactFragmented.isReady(cf3.id));
const cf4 = compactFragmented.acceptFinalTranscript('B184.');
const cfConfirmedEvent = compactFragmented.takeLastEvent();
check('Entity confirmation keeps the original command ID', cf4.id === cf1.id && cf4.id === cf2.id && cf4.id === cf3.id);
check('Matching B184 produces entity_confirmation CONFIRMED event', cfConfirmedEvent?.type === 'entity_confirmation' && cfConfirmedEvent.status === 'CONFIRMED' && cfConfirmedEvent.commandId === cf1.id && cfConfirmedEvent.receivedValue === 'B184');
check('Confirmed B184 makes the scan command READY', cf4.status === 'READY' && compactFragmented.isReady(cf4.id));

const numericCompactFragmented = new CommandRegistry();
const nf1 = numericCompactFragmented.acceptFinalTranscript('I scanned.');
const nf2 = numericCompactFragmented.acceptFinalTranscript('B1.');
const nf3 = numericCompactFragmented.acceptFinalTranscript('84.');
check('Numeric STT continuation B1 / 84 keeps one command ID', nf1.id === nf3.id && nf2.id === nf3.id);
check('Numeric STT continuation B1 / 84 waits for entity confirmation', nf3.status === 'COLLECTING' && numericCompactFragmented.pendingEntityConfirmation(nf3.id)?.expectedValue === 'B184');
check('Numeric STT continuation B1 / 84 resolves B184', resolveTechnicalEntity('component_id', [numericCompactFragmented.contextFor(nf3.id)], 'PENDING_COMMAND').canonicalValue === 'B184');
const nf4 = numericCompactFragmented.acceptFinalTranscript('B184.');
check('Numeric fragmented entity confirmation preserves command ID and reaches READY', nf4.id === nf1.id && nf4.status === 'READY');

const spokenNumericFragmented = new CommandRegistry();
const sn1 = spokenNumericFragmented.acceptFinalTranscript('B one...');
const sn2 = spokenNumericFragmented.acceptFinalTranscript('84.');
check('Mixed spoken/numeric B one / 84 keeps one command ID', sn1.id === sn2.id);
check('Technical ID-only B one / 84 remains COLLECTING until intent exists', sn2.status === 'COLLECTING');
check('Mixed spoken/numeric B one / 84 resolves B184', resolveTechnicalEntity('component_id', [spokenNumericFragmented.contextFor(sn2.id)], 'PENDING_COMMAND').canonicalValue === 'B184');

const compactOnly = new CommandRegistry();
const b1Only = compactOnly.acceptFinalTranscript('B1.');
check('Standalone B1 remains COLLECTING', b1Only.status === 'COLLECTING');
check('Standalone B1 cannot resolve a complete component ID', resolveTechnicalEntity('component_id', [compactOnly.contextFor(b1Only.id)]).status === 'MISSING');

const hyphenatedNumeric = new CommandRegistry();
const hn1 = hyphenatedNumeric.acceptFinalTranscript('I scanned.');
const hn2 = hyphenatedNumeric.acceptFinalTranscript('B1.');
const hn3 = hyphenatedNumeric.acceptFinalTranscript('8-4.');
check('Hyphenated STT continuation 8-4 is accepted operational continuation', isOperationalContinuation('8-4.'));
check('Hyphenated STT B1 / 8-4 keeps one command ID', hn1.id === hn2.id && hn2.id === hn3.id);
check('Hyphenated STT B1 / 8-4 resolves B184', resolveTechnicalEntity('component_id', [hyphenatedNumeric.contextFor(hn3.id)], 'PENDING_COMMAND').canonicalValue === 'B184');

const entityFirst = new CommandRegistry();
const ef1 = entityFirst.acceptFinalTranscript('I scanned.');
const ef2 = entityFirst.acceptFinalTranscript('B1.');
const ef3 = entityFirst.acceptFinalTranscript('8-4.');
const ef4 = entityFirst.acceptFinalTranscript('It was a mistake.');
check('Entity-first clarification retains one command ID', ef1.id === ef4.id && ef2.id === ef4.id && ef3.id === ef4.id);
check('Entity-first clarification retains B184', resolveTechnicalEntity('component_id', [entityFirst.contextFor(ef4.id)], 'PENDING_COMMAND').canonicalValue === 'B184');
check('Entity-first clarification upgrades intent to MISTAKEN_SCAN', ef4.intent === 'MISTAKEN_SCAN');
check('Fragment-reconstructed B184 still requires explicit confirmation after intent arrives', ef4.status === 'COLLECTING' && entityFirst.pendingEntityConfirmation(ef4.id)?.expectedValue === 'B184');
const ef5 = entityFirst.acceptFinalTranscript('B184.');
check('Entity-first explicit B184 confirmation preserves command and reaches READY', ef5.id === ef1.id && ef5.status === 'READY');

const intentFirst = new CommandRegistry();
const if1 = intentFirst.acceptFinalTranscript('I scanned by mistake.');
check('Intent-first command waits for component', if1.status === 'COLLECTING' && if1.intent === 'MISTAKEN_SCAN');
const if2 = intentFirst.acceptFinalTranscript('B184.');
check('Intent-first clarification retains one command ID', if1.id === if2.id);
check('Intent-first clarification retains MISTAKEN_SCAN intent', if2.intent === 'MISTAKEN_SCAN');
check('Intent-first clarification resolves B184', resolveTechnicalEntity('component_id', [intentFirst.contextFor(if2.id)], 'PENDING_COMMAND').canonicalValue === 'B184');
check('Intent-first clarification becomes READY', if2.status === 'READY');
check('Intent detector recognises pronoun-only recovery clarification', detectOperationalIntent('It was a mistake.') === 'MISTAKEN_SCAN');

const mismatchedEntityConfirmation = new CommandRegistry();
const mec1 = mismatchedEntityConfirmation.acceptFinalTranscript('I scanned.');
mismatchedEntityConfirmation.acceptFinalTranscript('B1.');
const mec3 = mismatchedEntityConfirmation.acceptFinalTranscript('84.');
check('Mismatched-confirmation fixture has pending B184', mismatchedEntityConfirmation.pendingEntityConfirmation(mec3.id)?.expectedValue === 'B184');
const mec4 = mismatchedEntityConfirmation.acceptFinalTranscript('B148.');
const mecEvent = mismatchedEntityConfirmation.takeLastEvent();
check('Different confirmed component supersedes instead of combining IDs', mec4.id !== mec1.id && mecEvent?.status === 'SUPERSEDED' && mecEvent.expectedValue === 'B184' && mecEvent.receivedValue === 'B148');
check('Superseding component starts clean context without B184 ambiguity', resolveTechnicalEntity('component_id', [mismatchedEntityConfirmation.contextFor(mec4.id)], 'PENDING_COMMAND').canonicalValue === 'B148' && !mismatchedEntityConfirmation.contextFor(mec4.id).includes('B184'));

const gateBlockedReporting = classifyToolReporting({
  toolCallAttempted: false,
  toolReturnedFailure: false,
  pipelineOutcome: 'NEEDS_CLARIFICATION',
});
check('Gate-blocked tool request is not reported as TOOL_FAILED', !gateBlockedReporting.isError && gateBlockedReporting.outcome === 'NEEDS_CLARIFICATION');
const fabricatedToolFailure = classifyToolReporting({
  toolCallAttempted: false,
  toolReturnedFailure: true,
  pipelineOutcome: 'TOOL_FAILED',
});
check('TOOL_FAILED cannot be fabricated before a tool call', !fabricatedToolFailure.isError && fabricatedToolFailure.outcome === 'REJECTED');
const realToolFailure = classifyToolReporting({
  toolCallAttempted: true,
  toolReturnedFailure: true,
  pipelineOutcome: 'TOOL_FAILED',
});
check('Returned operational tool failure may be reported as TOOL_FAILED', realToolFailure.isError && realToolFailure.outcome === 'TOOL_FAILED');
const connectionLossReporting = classifyToolReporting({
  toolCallAttempted: true,
  toolReturnedFailure: false,
  pipelineOutcome: 'CONNECTION_LOST',
});
check('Tool call without returned result stays CONNECTION_LOST, not TOOL_FAILED', !connectionLossReporting.isError && connectionLossReporting.outcome === 'CONNECTION_LOST');

const unrelatedAfterReady = new CommandRegistry();
const ur1 = unrelatedAfterReady.acceptFinalTranscript('I scanned B184.');
const ur2 = unrelatedAfterReady.acceptFinalTranscript("What's my current job?");
check('Unrelated new operational request gets a new command ID', ur1.id !== ur2.id);

const wakeGate = new AmbientSpeechGate();
check('Wake phrase detector accepts VoiceStrike spelling', containsWakePhrase('VoiceStrike, I scanned B184.'));
let wakeDecision = wakeGate.assess('The football match is starting now.', { now: 1_000 });
check('Cold ambient TV speech is rejected until wake phrase', !wakeDecision.accepted && wakeDecision.status === 'WAKE_REQUIRED');
wakeDecision = wakeGate.assess('VoiceStrike, I scanned.', { now: 2_000 });
check('VoiceStrike wake phrase activates operational window', wakeDecision.accepted && wakeDecision.status === 'WAKE_ACCEPTED' && wakeDecision.wakeActive);
wakeDecision = wakeGate.assess('B1.', { now: 3_000, hasActiveCommand: true, awaitingClarification: true });
check('Wake window accepts technical clarification fragment', wakeDecision.accepted);
wakeDecision = wakeGate.assess('The weather is nice tonight.', { now: 4_000, hasActiveCommand: true });
check('Wake window ignores unrelated TV speech', !wakeDecision.accepted && wakeDecision.status === 'AMBIENT_IGNORED');
wakeDecision = wakeGate.assess('I scanned B184.', { now: 40_000, hasActiveCommand: true });
check('Expired wake window requires VoiceStrike again', !wakeDecision.accepted && wakeDecision.status === 'WAKE_REQUIRED');
check('Wake window is shortened to 15 seconds', wakeGate.expiresAt() < 40_000);

// v0.8.11 — an agent-solicited clarification is command-bound and may outlive the normal wake window.
const clarificationGate = new AmbientSpeechGate();
clarificationGate.assess('VoiceStrike, I think I have the wrong part.', { now: 1_000 });
clarificationGate.openClarificationWindow('CMD-E1', 20_000);
let clarificationDecision = clarificationGate.assess('B184.', {
  now: 21_000,
  hasActiveCommand: true,
  awaitingClarification: true,
  activeCommandId: 'CMD-E1',
});
check('Solicited clarification may be answered without repeating wake phrase', clarificationDecision.accepted && clarificationDecision.status === 'CLARIFICATION_WINDOW');
check('Accepted solicited clarification creates usable conversational authority', clarificationDecision.wakeActive === true);
check('Clarification window is consumed by the accepted reply', clarificationGate.clarificationExpiresAt('CMD-E1') === 0);

const wrongCommandClarificationGate = new AmbientSpeechGate();
wrongCommandClarificationGate.openClarificationWindow('CMD-E1', 20_000);
clarificationDecision = wrongCommandClarificationGate.assess('B184.', {
  now: 21_000,
  hasActiveCommand: true,
  awaitingClarification: true,
  activeCommandId: 'CMD-OTHER',
});
check('Clarification authority cannot transfer to another command', !clarificationDecision.accepted && clarificationDecision.status === 'WAKE_REQUIRED');

const expiredClarificationGate = new AmbientSpeechGate();
expiredClarificationGate.openClarificationWindow('CMD-E1', 20_000);
clarificationDecision = expiredClarificationGate.assess('B184.', {
  now: 20_000 + CLARIFICATION_WINDOW_MS + 1,
  hasActiveCommand: true,
  awaitingClarification: true,
  activeCommandId: 'CMD-E1',
});
check('Expired clarification window requires VoiceStrike again', !clarificationDecision.accepted && clarificationDecision.status === 'WAKE_REQUIRED');

const unrelatedClarificationGate = new AmbientSpeechGate();
unrelatedClarificationGate.openClarificationWindow('CMD-E1', 20_000);
clarificationDecision = unrelatedClarificationGate.assess('The football match is starting.', {
  now: 21_000,
  hasActiveCommand: true,
  awaitingClarification: true,
  activeCommandId: 'CMD-E1',
});
check('Solicited clarification window does not accept unrelated TV speech', !clarificationDecision.accepted);
check('Rejected TV speech does not consume the clarification window', unrelatedClarificationGate.isClarificationActive('CMD-E1', 21_500));

const e1ClarificationRegistry = new CommandRegistry();
const e1Initial = e1ClarificationRegistry.acceptFinalTranscript("VoiceStrike, I think I've got the wrong part.");
check('E1 initial wrong-component command is COLLECTING before component ID', e1Initial.status === 'COLLECTING' && e1Initial.intent === 'WRONG_COMPONENT');
const e1ClarificationGate = new AmbientSpeechGate();
e1ClarificationGate.openClarificationWindow(e1Initial.id, 20_000);
const e1ClarificationSpeech = e1ClarificationGate.assess('B184.', {
  now: 21_000,
  hasActiveCommand: true,
  awaitingClarification: true,
  activeCommandId: e1Initial.id,
});
const e1Resolved = e1ClarificationRegistry.acceptFinalTranscript('B184.');
check('E1 solicited B184 stays on the same commandId', e1Resolved.id === e1Initial.id);
check('E1 solicited B184 makes WRONG_COMPONENT command READY', e1Resolved.status === 'READY' && e1Resolved.intent === 'WRONG_COMPONENT');
const e1Authority = new TurnAuthorityRegistry();
e1Authority.grant({
  sessionId: 'sess-e1', turnId: 'turn-e1-b184', commandId: e1Resolved.id, transcript: 'B184.',
  wakeAuthorised: e1ClarificationSpeech.accepted && e1ClarificationSpeech.wakeActive,
  criticalSpeechTrusted: false, criticalKind: 'NONE', intent: e1Resolved.intent, componentId: 'B184', now: 21_000,
});
check('E1 read tools may resolve turn authority after solicited clarification', e1Authority.resolve({
  commandId: e1Resolved.id, sessionId: 'sess-e1', isCommandCurrent: e1ClarificationRegistry.isCurrent(e1Resolved.id), now: 21_100,
}).ok);

const duplex = new DuplexEchoGuard();
duplex.markReplyStarted(10_000);
duplex.noteAgentText('Please say VoiceStrike, reverse scan B184 to prepare the recovery.', 10_050);
let duplexDecision = duplex.assessUserTranscript('VoiceStrike, reverse scan B184.', { speechStartedAt: 10_300, now: 11_000 });
check('Critical reversal phrase beginning during VoiceStrike TTS is suppressed', duplexDecision.blocked && duplexDecision.reason === 'CRITICAL_DURING_AGENT_AUDIO');
check('Protected critical phrase detector recognises reversal', isProtectedCriticalPhrase('VoiceStrike, reverse scan B184.'));
duplexDecision = duplex.assessUserTranscript('VoiceStrike, reverse scan B184.', { speechStartedAt: null, now: 11_050 });
check('Critical reversal phrase without a fresh speech-start event is suppressed', duplexDecision.blocked && duplexDecision.reason === 'CRITICAL_WITHOUT_FRESH_SPEECH_START');
duplexDecision = duplex.assessUserTranscript('Actually B148.', { speechStartedAt: 10_400, now: 11_100 });
check('Non-echo correction can still barge in during VoiceStrike reply', !duplexDecision.blocked);
duplex.markReplyDone(12_000);
duplexDecision = duplex.assessUserTranscript('VoiceStrike, reverse scan B184.', { speechStartedAt: 12_700, now: 14_000 });
check('Worker may repeat protected phrase after agent audio tail', !duplexDecision.blocked);

const confirmationGate = new CriticalConfirmationGate();
let confirmationDecision = confirmationGate.assessReverse({
  commandId: 'CMD-REV-1', turnId: 'TURN-1', transcript: 'VoiceStrike, reverse scan B184.',
  actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 20_000,
});
check('First protected reversal turn prepares only', confirmationDecision.status === 'PREPARED');
check('First protected reversal requires a second confirmation', confirmationDecision.status === 'PREPARED' && confirmationDecision.code === 'SECOND_CONFIRMATION_REQUIRED');
confirmationGate.activateConfirmationWindow({
  commandId: 'CMD-REV-1', actionId: 'ACT-SCAN-B184', componentId: 'B184', expiresAt: 40_000,
});
confirmationDecision = confirmationGate.assessReverse({
  commandId: 'CMD-REV-1', turnId: 'TURN-1', transcript: 'VoiceStrike, confirm reverse scan B184.',
  actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 20_500,
});
check('Second confirmation cannot execute in the same worker turn', confirmationDecision.status === 'REJECTED' && confirmationDecision.code === 'SECOND_CONFIRMATION_MUST_BE_NEW_TURN');
confirmationDecision = confirmationGate.assessReverse({
  commandId: 'CMD-REV-1', turnId: 'TURN-2', transcript: 'Yes.',
  actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 21_000,
});
check('Bare yes cannot satisfy prepared critical action', confirmationDecision.status === 'REJECTED');
confirmationDecision = confirmationGate.assessReverse({
  commandId: 'CMD-REV-1', turnId: 'TURN-2', transcript: 'VoiceStrike, confirm reverse scan B184.',
  actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 21_500,
});
check('Separate action-specific second confirmation is accepted', confirmationDecision.status === 'CONFIRMED');

const confirmationMismatch = new CriticalConfirmationGate();
confirmationMismatch.assessReverse({
  commandId: 'CMD-REV-2', turnId: 'TURN-A', transcript: 'VoiceStrike, reverse scan B184.',
  actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 30_000,
});
confirmationMismatch.activateConfirmationWindow({
  commandId: 'CMD-REV-2', actionId: 'ACT-SCAN-B184', componentId: 'B184', expiresAt: 50_000,
});
confirmationDecision = confirmationMismatch.assessReverse({
  commandId: 'CMD-REV-2', turnId: 'TURN-B', transcript: 'VoiceStrike, confirm reverse scan B148.',
  actionId: 'ACT-SCAN-B184', componentId: 'B148', now: 31_000,
});
check('Prepared reversal cannot switch critical component', confirmationDecision.status === 'REJECTED' && confirmationDecision.code === 'CONFIRMATION_CONTEXT_MISMATCH');

const confirmationExpired = new CriticalConfirmationGate();
confirmationExpired.assessReverse({
  commandId: 'CMD-REV-3', turnId: 'TURN-X', transcript: 'VoiceStrike, reverse scan B184.',
  actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 40_000,
});
confirmationExpired.activateConfirmationWindow({
  commandId: 'CMD-REV-3', actionId: 'ACT-SCAN-B184', componentId: 'B184', expiresAt: 60_000,
});
confirmationDecision = confirmationExpired.assessReverse({
  commandId: 'CMD-REV-3', turnId: 'TURN-Y', transcript: 'VoiceStrike, confirm reverse scan B184.',
  actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 61_000,
});
check('Prepared reversal confirmation expires instead of lingering', confirmationDecision.status === 'REJECTED' && confirmationDecision.code === 'CONFIRMATION_EXPIRED');

const twoTurnRegistry = new CommandRegistry();
const prepCommand = twoTurnRegistry.acceptFinalTranscript('VoiceStrike, reverse scan B184.');
const confirmCommand = twoTurnRegistry.acceptFinalTranscript('VoiceStrike, confirm reverse scan B184.');
check('Two-step confirmation remains linked to one commandId across separate turns', prepCommand.id === confirmCommand.id);

let serverAuthority = validatePreparedReversalAuthority({
  currentCommandId: 'CMD-SRV-1', currentTurnId: 'TURN-2', preparedCommandId: 'CMD-SRV-1', preparedTurnId: 'TURN-1',
  preparedActionId: 'ACT-SCAN-B184', preparedComponent: 'B184', actualActionId: 'ACT-SCAN-B184', actualComponent: 'B184',
  confirmationText: 'VoiceStrike, confirm reverse scan B184.',
});
check('Server two-step authority accepts exact separate-turn confirmation', serverAuthority.ok);
serverAuthority = validatePreparedReversalAuthority({
  currentCommandId: 'CMD-SRV-1', currentTurnId: 'TURN-1', preparedCommandId: 'CMD-SRV-1', preparedTurnId: 'TURN-1',
  preparedActionId: 'ACT-SCAN-B184', preparedComponent: 'B184', actualActionId: 'ACT-SCAN-B184', actualComponent: 'B184',
  confirmationText: 'VoiceStrike, confirm reverse scan B184.',
});
check('Server two-step authority rejects same-turn confirmation', !serverAuthority.ok && serverAuthority.code === 'SECOND_CONFIRMATION_REQUIRED');
serverAuthority = validatePreparedReversalAuthority({
  currentCommandId: 'CMD-SRV-1', currentTurnId: 'TURN-2', preparedCommandId: 'CMD-SRV-1', preparedTurnId: 'TURN-1',
  preparedActionId: 'ACT-SCAN-B184', preparedComponent: 'B184', actualActionId: 'ACT-SCAN-B184', actualComponent: 'B184',
  confirmationText: 'VoiceStrike, reverse scan B184.',
});
check('Server two-step authority rejects missing CONFIRM token', !serverAuthority.ok && serverAuthority.code === 'EXPLICIT_CONFIRMATION_REQUIRED');
serverAuthority = validatePreparedReversalAuthority({
  currentCommandId: 'CMD-SRV-1', currentTurnId: 'TURN-2', preparedCommandId: 'CMD-SRV-1', preparedTurnId: 'TURN-1',
  preparedActionId: 'ACT-SCAN-B184', preparedComponent: 'B184', actualActionId: 'ACT-SCAN-B184', actualComponent: 'B184',
  confirmationText: 'VoiceStrike, confirm reverse scan B148.',
});
check('Server two-step authority rejects wrong confirmed component', !serverAuthority.ok && serverAuthority.code === 'EXPLICIT_CONFIRMATION_REQUIRED');


const criticalTrust = new CriticalSpeechTrustGate();
const baseNow = 100_000;
check('Critical speech classifier detects protected confirmation', classifyCriticalSpeech('VoiceStrike confirm reverse scan B184') === 'REVERSE_CONFIRM');
check('Critical speech parser extracts B184', criticalSpeechComponent('VoiceStrike confirm reverse scan B184') === 'B184');
let criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike confirm reverse scan B184', speechStartedAt: baseNow - 1000, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: true, preparedComponentId: null,
});
check('False confirm without prepared context is rejected before command authority', criticalDecision.critical && !criticalDecision.trusted && criticalDecision.reason === 'NO_PREPARED_CONFIRMATION');
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike confirm reverse scan B184', speechStartedAt: baseNow - 1000, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: true, preparedComponentId: 'B184',
});
check('Prepared exact critical confirmation is trusted', criticalDecision.trusted && criticalDecision.score === 1);
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike confirm reverse scan B148', speechStartedAt: baseNow - 1000, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: true, preparedComponentId: 'B184',
});
check('Prepared confirmation rejects wrong component', !criticalDecision.trusted && criticalDecision.reason === 'PREPARED_COMPONENT_MISMATCH');
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike reverse scan B184', speechStartedAt: baseNow - 1000, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: false, preparedComponentId: null,
});
check('Cold critical reverse without recovery context is rejected', !criticalDecision.trusted && criticalDecision.reason === 'RECOVERY_CONTEXT_REQUIRED');
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike reverse scan B184', speechStartedAt: baseNow - 1000, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: true, recoveryComponentId: 'B184', preparedComponentId: null,
});
check('Critical reverse with established inspected recovery context is trusted', criticalDecision.trusted);
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike reverse scan B148', speechStartedAt: baseNow - 1000, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: true, recoveryComponentId: 'B184', preparedComponentId: null,
});
check('Critical reverse rejects component different from inspected recovery context', !criticalDecision.trusted && criticalDecision.reason === 'RECOVERY_COMPONENT_MISMATCH');
criticalDecision = criticalTrust.assess({
  transcript: 'confirm reverse scan B184', speechStartedAt: baseNow - 1000, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: true, preparedComponentId: 'B184',
});
check('Critical confirmation requires explicit wake phrase', !criticalDecision.trusted && criticalDecision.reason === 'WAKE_PHRASE_REQUIRED');
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike confirm reverse scan B184', speechStartedAt: null, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 5000, hasRecoveryContext: true, preparedComponentId: 'B184',
});
check('Critical confirmation requires fresh VAD start', !criticalDecision.trusted && criticalDecision.reason === 'NO_FRESH_VAD');
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike confirm reverse scan B184', speechStartedAt: baseNow - 100, now: baseNow,
  agentReplyActive: true, agentReplyDoneAt: null, hasRecoveryContext: true, preparedComponentId: 'B184',
});
check('Critical confirmation is rejected during agent audio', !criticalDecision.trusted && criticalDecision.reason === 'AGENT_AUDIO_ACTIVE');
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike confirm reverse scan B184', speechStartedAt: baseNow - 500, now: baseNow,
  agentReplyActive: false, agentReplyDoneAt: baseNow - 500 - (CRITICAL_POST_TTS_QUIET_MS - 200), hasRecoveryContext: true, preparedComponentId: 'B184',
});
check('Critical confirmation requires post-TTS quiet gap', !criticalDecision.trusted && criticalDecision.reason === 'POST_TTS_QUIET_GAP_REQUIRED');
criticalDecision = criticalTrust.assess({
  transcript: 'VoiceStrike, I scanned B184 by mistake', speechStartedAt: null, now: baseNow,
  agentReplyActive: true, agentReplyDoneAt: baseNow, hasRecoveryContext: false, preparedComponentId: null,
});
check('Non-critical recovery speech stays outside protected critical gate', !criticalDecision.critical && criticalDecision.trusted);


// v0.9.2 — protected speech timing is bound to the exact command/action/component and to
// estimated audible TTS completion rather than a global 1.5 s reply.done guess.
{
  const windows = new ProtectedSpeechWindowRegistry();
  const armed = windows.arm({
    epoch: 7,
    commandId: 'CMD-PSW-1',
    actionId: 'ACT-SCAN-B184',
    componentId: 'B184',
    expectedKind: 'REVERSE_PREPARE',
    now: 200_000,
  });
  check('PSW-1 authoritative inspect arms PREPARE window before prompt completion', armed?.state === 'AWAITING_PROMPT_DONE');
  let decision = windows.assess({ epoch: 7, commandId: 'CMD-PSW-1', kind: 'REVERSE_PREPARE', componentId: 'B184', speechStartedAt: 200_100, now: 200_200 });
  check('PSW-2 protected speech cannot run before its instruction reply finishes', !decision.trusted && decision.reason === 'PROTECTED_PROMPT_NOT_FINISHED');

  const opened = windows.markPromptDone({ epoch: 7, commandId: 'CMD-PSW-1', audibleDoneAt: 202_000, now: 201_700 });
  check('PSW-3 window opens from estimated audible PCM completion', opened?.opensAt === 202_000 + PROTECTED_POST_TTS_QUIET_MS);
  decision = windows.assess({ epoch: 7, commandId: 'CMD-PSW-1', kind: 'REVERSE_PREPARE', componentId: 'B184', speechStartedAt: 202_200, now: 202_300 });
  check('PSW-4 too-early protected speech is rejected without consuming the window', !decision.trusted && decision.reason === 'PROTECTED_POST_TTS_QUIET_GAP_REQUIRED' && windows.current()?.id === opened?.id);
  decision = windows.assess({ epoch: 7, commandId: 'CMD-PSW-1', kind: 'REVERSE_PREPARE', componentId: 'B148', speechStartedAt: 202_800, now: 202_900 });
  check('PSW-5 wrong component cannot use the protected window', !decision.trusted && decision.reason === 'PROTECTED_WINDOW_COMPONENT_MISMATCH');
  decision = windows.assess({ epoch: 7, commandId: 'CMD-PSW-1', kind: 'REVERSE_PREPARE', componentId: 'B184', speechStartedAt: 202_700, now: 202_900 });
  check('PSW-6 normal human response after audible TTS gap is accepted', decision.trusted);
  const consumed = decision.trusted ? windows.consume(decision.window.id) : null;
  check('PSW-7 only an accepted protected turn consumes its window', consumed?.expectedKind === 'REVERSE_PREPARE' && windows.current() === null);

  const legacyReplyDoneAt = 300_000;
  const speechStartedAt = legacyReplyDoneAt + PROTECTED_POST_TTS_QUIET_MS + 50;
  const trustWithWindow = criticalTrust.assess({
    transcript: 'VoiceStrike reverse scan B184',
    speechStartedAt,
    now: speechStartedAt + 100,
    agentReplyActive: false,
    agentReplyDoneAt: legacyReplyDoneAt,
    hasRecoveryContext: true,
    recoveryComponentId: 'B184',
    preparedComponentId: null,
    protectedWindowTrusted: true,
  });
  check('PSW-8 trusted command-bound window replaces the fragile global 1.5 s wait', trustWithWindow.trusted);
}

{
  // Cancel/expiry must kill only the old protected window. A fresh authoritative inspect can arm
  // the same physical action/component under a new command without tombstone poisoning.
  const windows = new ProtectedSpeechWindowRegistry();
  const first = windows.arm({ epoch: 2, commandId: 'CMD-OLD', actionId: 'ACT-SCAN-B184', componentId: 'B184', expectedKind: 'REVERSE_CONFIRM', hardExpiresAt: 500_000, now: 450_000 });
  windows.reset(); // cancellation / expiry boundary
  const fresh = windows.arm({ epoch: 2, commandId: 'CMD-FRESH', actionId: 'ACT-SCAN-B184', componentId: 'B184', expectedKind: 'REVERSE_PREPARE', now: 451_000 });
  const opened = windows.markPromptDone({ epoch: 2, commandId: 'CMD-FRESH', audibleDoneAt: 452_000, now: 451_500 });
  const decision = windows.assess({ epoch: 2, commandId: 'CMD-FRESH', kind: 'REVERSE_PREPARE', componentId: 'B184', speechStartedAt: 452_700, now: 452_800 });
  check('PSW-9 terminal old window cannot poison a fresh inspect for the same action', first?.commandId === 'CMD-OLD' && fresh?.commandId === 'CMD-FRESH' && opened?.state === 'OPEN' && decision.trusted);
}

const originalFetch = globalThis.fetch;
let verifyCalls = 0;
const installVerify = (handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/api/reliability/telemetry')) {
      return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } });
    }
    verifyCalls += 1;
    return handler(url, init);
  }) as typeof fetch;
};

const claimedWithoutVerification = (result: Awaited<ReturnType<typeof executeVerifiedAction>>) => {
  metrics.actionsTested += 1;
  if (canClaimSuccess(result) && !(result.verificationAttempted && result.verified)) metrics.falseSuccessClaims += 1;
};
try {
  installVerify(async () => new Response('{}', { status: 200 }));
  let requestCalls = 0;
  let action = await executeVerifiedAction({
    commandId: 'TEST-CMD-1', toolName: 'reverse_last_scan', transcriptContext: 'Yes.',
    args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => true,
    request: async () => { requestCalls += 1; return new Response('{}', { status: 200 }); },
  });
  claimedWithoutVerification(action);
  check('Bare yes cannot reach mutation executor', action.outcome === 'NEEDS_CLARIFICATION' && requestCalls === 0);

  requestCalls = 0;
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-2', toolName: 'reverse_last_scan', transcriptContext: 'Reverse scan B184',
    args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' }, isCommandCurrent: () => false, isCommandReady: () => true,
    request: async () => { requestCalls += 1; return new Response('{}', { status: 200 }); },
  });
  claimedWithoutVerification(action);
  check('Stale command cannot reach mutation executor', action.outcome === 'STALE_COMMAND' && requestCalls === 0);

  requestCalls = 0;
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-INCOMPLETE', toolName: 'reverse_last_scan', transcriptContext: 'I scanned...',
    args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => false,
    request: async () => { requestCalls += 1; return new Response('{}', { status: 200 }); },
  });
  claimedWithoutVerification(action);
  check('Incomplete fragment cannot reach mutation executor', action.outcome === 'NEEDS_CLARIFICATION' && requestCalls === 0 && action.error?.code === 'INCOMPLETE_COMMAND');

  requestCalls = 0;
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-CANCEL', toolName: 'reverse_last_scan', transcriptContext: "Reverse that... actually don't.",
    args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => true,
    request: async () => { requestCalls += 1; return new Response('{}', { status: 200 }); },
  });
  claimedWithoutVerification(action);
  check('Explicit cancellation prevents mutation executor', action.outcome === 'REJECTED' && requestCalls === 0 && action.error?.code === 'EXPLICIT_CANCELLATION');

  requestCalls = 0;
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-AMBIG', toolName: 'report_exception', transcriptContext: 'I have B148 and B184 here.',
    commandSlots: {},
    args: { type: 'WRONG_COMPONENT', observed_component: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => true,
    request: async () => { requestCalls += 1; return new Response('{}', { status: 200 }); },
  });
  claimedWithoutVerification(action);
  check('Missing trusted typed E1 slot prevents mutation executor', action.outcome === 'NEEDS_CLARIFICATION' && requestCalls === 0 && action.error?.code === 'CRITICAL_ENTITY_REQUIRED');

  requestCalls = 0;
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-MISMATCH', toolName: 'report_exception', transcriptContext: 'I have B185.',
    commandSlots: { observedComponent: 'B185' },
    args: { type: 'WRONG_COMPONENT', observed_component: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => true,
    request: async () => { requestCalls += 1; return new Response('{}', { status: 200 }); },
  });
  claimedWithoutVerification(action);
  check('Transcript/tool entity mismatch prevents mutation executor', action.outcome === 'NEEDS_CLARIFICATION' && requestCalls === 0 && action.error?.code === 'ENTITY_ARGUMENT_MISMATCH');

  verifyCalls = 0;
  installVerify(async () => new Response(JSON.stringify({ ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184', reversed: true } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-3', toolName: 'reverse_last_scan', transcriptContext: 'Reverse scan B184',
    args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => true,
    request: async () => new Response(JSON.stringify({ ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184' }, verified: false }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  claimedWithoutVerification(action);
  check('Mutation response needs separate authoritative verify', action.outcome === 'VERIFIED_SUCCESS' && action.verified && verifyCalls === 1 && canClaimSuccess(action));

  verifyCalls = 0;
  installVerify(async () => new Response(JSON.stringify({ ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184', reversed: true } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-4', toolName: 'reverse_last_scan', transcriptContext: 'Reverse scan B184',
    args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => true,
    request: async () => new Response(JSON.stringify({ ok: false, error: 'INJECTED_POST_MUTATION_FAILURE', unknown_action_state: true, action_id: 'ACT-SCAN-B184', component: 'B184' }), { status: 503, headers: { 'content-type': 'application/json' } }),
  });
  claimedWithoutVerification(action);
  check('Post-mutation unknown state is inspected without blind retry', action.outcome === 'VERIFIED_SUCCESS' && action.verified && verifyCalls === 1 && !action.mutationReportedSuccess);

  verifyCalls = 0;
  installVerify(async () => new Response(JSON.stringify({ ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184', reversed: false } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  action = await executeVerifiedAction({
    commandId: 'TEST-CMD-5', toolName: 'reverse_last_scan', transcriptContext: 'Reverse scan B184',
    args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' }, isCommandCurrent: () => true, isCommandReady: () => true,
    request: async () => new Response(JSON.stringify({ ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  claimedWithoutVerification(action);
  check('Verification failure blocks success claim', action.outcome === 'VERIFY_FAILED' && !action.verified && !canClaimSuccess(action));
} finally {
  globalThis.fetch = originalFetch;
}


// v0.8.7 command-bound recovery inspection authority
const recoveryNow = 200_000;
const recoveryContext = makeRecoverySpeechContext({
  commandId: 'CMD-RCV-1',
  actionId: 'ACT-SCAN-B184',
  componentId: 'B184',
  observedAt: recoveryNow - 1_000,
  source: 'TOOL_RESULT',
});
check('Recovery context constructor binds command/action/component', recoveryContext?.commandId === 'CMD-RCV-1' && recoveryContext.actionId === 'ACT-SCAN-B184' && recoveryContext.componentId === 'B184');
check('Recovery context is fresh for same command', isRecoverySpeechContextFresh(recoveryContext, 'CMD-RCV-1', recoveryNow));
check('Recovery context cannot cross commandId boundary', !isRecoverySpeechContextFresh(recoveryContext, 'CMD-RCV-2', recoveryNow));
check('Recovery context expires at TTL boundary', !isRecoverySpeechContextFresh(recoveryContext, 'CMD-RCV-1', recoveryNow + RECOVERY_CONTEXT_TTL_MS + 1));
check('Recovery context rejects malformed component authority', makeRecoverySpeechContext({ commandId: 'CMD-RCV-1', actionId: 'ACT-1', componentId: '', source: 'SERVER_AUDIT' }) === null);


// ---------------------------------------------------------------------------
// v0.8.8 — Turn-bound authority (root-cause regression for the final-confirmation failure)
//
// Harness: mirrors voiceAgent.ts gate order for `transcript.user` and the authority path of
// `handleToolCall` using the real gate classes. Rejected speech never calls grant(); the only
// way to obtain authority is an ACCEPTED turn. Mutation/verify calls are counted through fetch.
// ---------------------------------------------------------------------------
type Harness = {
  registry: CommandRegistry;
  ambient: AmbientSpeechGate;
  duplex: DuplexEchoGuard;
  trust: CriticalSpeechTrustGate;
  confirmation: CriticalConfirmationGate;
  authorities: TurnAuthorityRegistry;
  workflow: WorkflowPolicy;
  replyAuthority: ReplyAuthorityRegistry;
  sessionId: string | null;
  recoveryComponent: string | null;
  turnSeq: number;
  now: number;
};

function makeHarness(sessionId = 'SESSION-A'): Harness {
  const replyAuthority = new ReplyAuthorityRegistry();
  replyAuthority.reset(1);
  return {
    registry: new CommandRegistry(),
    ambient: new AmbientSpeechGate(),
    duplex: new DuplexEchoGuard(),
    trust: new CriticalSpeechTrustGate(),
    confirmation: new CriticalConfirmationGate(),
    authorities: new TurnAuthorityRegistry(),
    workflow: new WorkflowPolicy(),
    replyAuthority,
    sessionId,
    recoveryComponent: null,
    turnSeq: 0,
    now: 1_000_000,
  };
}

type SpeechResult = { turnId: string; accepted: boolean; rejectedBy?: string; commandId?: string };

function speak(h: Harness, text: string, options: { speechStartedAt?: number | null; agentReplyActive?: boolean } = {}): SpeechResult {
  h.turnSeq += 1;
  const turnId = `turn-${h.turnSeq}`;
  const speechStartedAt = options.speechStartedAt === undefined ? h.now - 800 : options.speechStartedAt;
  if (options.agentReplyActive) h.duplex.markReplyStarted(h.now - 2_000);

  const duplexDecision = h.duplex.assessUserTranscript(text, { speechStartedAt, now: h.now });
  if (duplexDecision.blocked) return { turnId, accepted: false, rejectedBy: `DUPLEX:${duplexDecision.reason}` };

  const prepared = h.confirmation.pending();
  const criticalTrust = h.trust.assess({
    transcript: text,
    speechStartedAt,
    now: h.now,
    agentReplyActive: h.duplex.isAgentReplyActive(),
    agentReplyDoneAt: h.duplex.lastReplyDoneAt(),
    hasRecoveryContext: Boolean(h.recoveryComponent) || Boolean(prepared),
    recoveryComponentId: h.recoveryComponent,
    preparedComponentId: prepared?.componentId ?? null,
  });
  if (criticalTrust.critical && !criticalTrust.trusted) return { turnId, accepted: false, rejectedBy: `CRITICAL:${criticalTrust.reason}` };

  const ambientDecision = h.ambient.assess(text, {
    hasActiveCommand: h.registry.hasActiveOperationalContext(),
    awaitingClarification: h.registry.isAwaitingClarification(),
    activeCommandId: h.registry.current()?.id ?? null,
    now: h.now,
  });
  if (!ambientDecision.accepted) {
    h.replyAuthority.noteTurn(turnId, 'REJECTED');
    return { turnId, accepted: false, rejectedBy: `AMBIENT:${ambientDecision.status}` };
  }

  const command = h.registry.acceptFinalTranscript(text);
  h.authorities.grant({
    sessionId: h.sessionId,
    turnId,
    commandId: command.id,
    transcript: text,
    wakeAuthorised: ambientDecision.accepted && ambientDecision.wakeActive,
    criticalSpeechTrusted: criticalTrust.critical ? criticalTrust.trusted : false,
    criticalKind: criticalTrust.kind,
    intent: command.intent,
    componentId: criticalTrust.componentId ?? null,
    now: h.now,
  });
  return { turnId, accepted: true, commandId: command.id };
}

type ToolOutcome = {
  outcome: string;
  authorityReason?: string;
  confirmationStatus?: string;
  mutations: number;
  verifications: number;
  verified: boolean;
};

async function reverseToolCall(h: Harness, args: { action_id: string; component_id: string }, options: { serverReversed?: boolean; commandIdOverride?: string } = {}): Promise<ToolOutcome> {
  const commandId = options.commandIdOverride ?? h.registry.commandForToolCall();
  const resolution = h.authorities.resolve({
    commandId,
    sessionId: h.sessionId,
    isCommandCurrent: h.registry.isCurrent(commandId),
    requireCriticalTrust: true,
    mutationToolName: 'reverse_last_scan',
    now: h.now,
  });
  if (!resolution.ok) {
    const stale = resolution.reason === 'COMMAND_NOT_CURRENT' || resolution.reason === 'COMMAND_MISMATCH' || resolution.reason === 'SESSION_MISMATCH';
    return { outcome: stale ? 'STALE_COMMAND' : resolution.reason === 'MUTATION_ALREADY_CONSUMED' ? 'REJECTED' : 'NEEDS_CLARIFICATION', authorityReason: resolution.reason, mutations: 0, verifications: 0, verified: false };
  }
  const authority = resolution.authority;
  const confirmation = h.confirmation.assessReverse({
    commandId,
    turnId: authority.turnId,
    transcript: authority.transcript,
    actionId: args.action_id,
    componentId: args.component_id,
    now: h.now,
  });
  if (confirmation.status !== 'CONFIRMED') {
    return { outcome: confirmation.status === 'PREPARED' ? 'NEEDS_CLARIFICATION' : 'REJECTED', confirmationStatus: confirmation.status, mutations: 0, verifications: 0, verified: false };
  }

  let mutations = 0;
  let verifications = 0;
  const serverReversed = options.serverReversed ?? true;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('/api/reliability/telemetry')) return new Response('{}', { status: 202 });
    verifications += 1;
    return new Response(JSON.stringify({ ok: true, action: { id: args.action_id, component: args.component_id, reversed: serverReversed } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await executeVerifiedAction({
      commandId,
      toolName: 'reverse_last_scan',
      transcriptContext: h.registry.contextFor(commandId) || authority.transcript,
      commandSlots: h.registry.slotsFor(commandId) ?? {},
      args,
      sessionId: h.sessionId,
      turnId: authority.turnId,
      isCommandCurrent: () => h.registry.isCurrent(commandId),
      isCommandReady: () => h.registry.isReady(commandId),
      request: async () => {
        h.authorities.consumeMutation(authority, 'reverse_last_scan');
        mutations += 1;
        return new Response(JSON.stringify({ ok: true, changed: true, reversal_executed: true, verified: false, action: { id: args.action_id, component: args.component_id, reversed: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    return { outcome: result.outcome, confirmationStatus: 'CONFIRMED', mutations, verifications, verified: result.verified && canClaimSuccess(result) };
  } finally {
    globalThis.fetch = savedFetch;
  }
}

const REVERSE_ARGS = { action_id: 'ACT-SCAN-B184', component_id: 'B184' };

/** Drives the validated pre-confirmation path: mistaken scan → inspect context → prepare. */
async function prepareReversal(h: Harness): Promise<{ prepareTurn: SpeechResult; prepareOutcome: ToolOutcome }> {
  const t1 = speak(h, 'VoiceStrike, I scanned B184 by mistake.');
  check('A: mistaken-scan turn is accepted', t1.accepted);
  h.recoveryComponent = 'B184'; // authoritative inspect_last_action result (command-bound) already validated in v0.8.7
  h.now += 3_000;
  h.registry.beginReply(); h.registry.finishReply();
  const prepareTurn = speak(h, 'VoiceStrike, reverse scan B184.');
  check('A: prepare turn is accepted', prepareTurn.accepted);
  h.registry.beginReply();
  const prepareOutcome = await reverseToolCall(h, REVERSE_ARGS);
  h.registry.finishReply();
  check('A: prepare turn produces PREPARED with mutation 0', prepareOutcome.confirmationStatus === 'PREPARED' && prepareOutcome.mutations === 0);
  const pending = h.confirmation.pending();
  if (pending) {
    h.confirmation.activateConfirmationWindow({
      commandId: pending.preparedCommandId,
      actionId: pending.actionId,
      componentId: pending.componentId,
      expiresAt: h.now + CONFIRMATION_TTL_MS,
    });
  }
  h.now += 3_000;
  return { prepareTurn, prepareOutcome };
}

{
  // MANDATORY REGRESSION: valid protected confirmation → later ambient/echo/rejected speech →
  // delayed tool.call from the original confirmation → original authority still valid →
  // exactly one reverse → one independent verify → VERIFIED_SUCCESS.
  const h = makeHarness();
  await prepareReversal(h);
  const confirmTurn = speak(h, 'VoiceStrike, confirm reverse scan B184.');
  check('A1 confirmation turn accepted', confirmTurn.accepted);
  const authorityAtAcceptance = h.authorities.current();
  h.registry.beginReply();

  // Later speech, all rejected, arriving before the delayed tool.call:
  h.duplex.markReplyStarted(h.now + 100);
  h.duplex.noteAgentText('Confirm reverse scan B184. Executing the reversal now.', h.now + 200);
  h.now += 500;
  const echo = speak(h, 'confirm reverse scan B184 executing the reversal now', { speechStartedAt: h.now - 100 });
  check('A1 TTS echo transcript is rejected', !echo.accepted && String(echo.rejectedBy).startsWith('DUPLEX:'));
  const untrustedCritical = speak(h, 'reverse scan B184', { speechStartedAt: null });
  check('A1 untrusted critical transcript is rejected', !untrustedCritical.accepted && (String(untrustedCritical.rejectedBy).startsWith('DUPLEX:') || String(untrustedCritical.rejectedBy).startsWith('CRITICAL:')));
  h.duplex.markReplyDone(h.now);
  h.now += 2_000;
  const ambient = speak(h, 'and tonight on the news the weather will be cold', { speechStartedAt: h.now - 300 });
  check('A1 ambient transcript is rejected', !ambient.accepted && String(ambient.rejectedBy).startsWith('AMBIENT:'));
  h.now += 14_000; // wake window (15 s since the accepted confirmation) has expired; the 20 s prepared-confirmation TTL has not
  check('A1 wake window has expired before the delayed tool.call', !h.ambient.isActive(h.now));
  check('A1 rejected speech did not replace or revoke the accepted authority', h.authorities.current() === authorityAtAcceptance);

  const delayed = await reverseToolCall(h, REVERSE_ARGS);
  check('A1 later ambient/echo speech cannot revoke valid prior turn authority', delayed.authorityReason === undefined && delayed.confirmationStatus === 'CONFIRMED');
  check('A1 final protected confirmation => exactly one mutation', delayed.mutations === 1);
  check('A1 exactly one independent verification after mutation', delayed.verifications === 1);
  check('A1 outcome is VERIFIED_SUCCESS with verified === true', delayed.outcome === 'VERIFIED_SUCCESS' && delayed.verified);

  const repeat = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += repeat.mutations;
  metrics.actionsTested += 1; if (delayed.verified && delayed.verifications !== 1) metrics.falseSuccessClaims += 1;
  check('A1 repeated tool.call under the same turn authority cannot mutate again', repeat.mutations === 0 && repeat.outcome !== 'VERIFIED_SUCCESS');
  h.registry.finishReply();
}

{
  // Inverse: wrong commandId — tool call attributed to a different command than the accepted turn.
  const h = makeHarness();
  await prepareReversal(h);
  speak(h, 'VoiceStrike, confirm reverse scan B184.');
  h.registry.beginReply();
  const wrong = await reverseToolCall(h, REVERSE_ARGS, { commandIdOverride: 'CMD-OTHER' });
  metrics.unsafeInputs += 1; metrics.unsafeMutations += wrong.mutations;
  check('A2 wrong commandId => mutation 0', wrong.mutations === 0 && wrong.outcome === 'STALE_COMMAND' && wrong.authorityReason === 'COMMAND_MISMATCH');
  check('A2 authority cannot transfer to another command', h.authorities.resolve({ commandId: 'CMD-OTHER', sessionId: h.sessionId, isCommandCurrent: true, now: h.now }).ok === false);
}

{
  // Inverse: wrong component — confirmation names a different component than the prepared action.
  const h = makeHarness();
  await prepareReversal(h);
  const wrongComponent = speak(h, 'VoiceStrike, confirm reverse scan B148.');
  check('A3 wrong-component confirmation is rejected before command acceptance', !wrongComponent.accepted && wrongComponent.rejectedBy === 'CRITICAL:PREPARED_COMPONENT_MISMATCH');
  h.registry.beginReply();
  const outcome = await reverseToolCall(h, { action_id: 'ACT-SCAN-B184', component_id: 'B148' });
  metrics.unsafeInputs += 1; metrics.unsafeMutations += outcome.mutations;
  check('A3 wrong component => mutation 0', outcome.mutations === 0 && outcome.outcome !== 'VERIFIED_SUCCESS');
}

{
  // Inverse: stale authority — correction/barge-in invalidates the command that owned the confirmation.
  const h = makeHarness();
  await prepareReversal(h);
  speak(h, 'VoiceStrike, confirm reverse scan B184.');
  const replyCommand = h.registry.beginReply();
  const correction = speak(h, 'No wait, actually B148.');
  check('A4 correction is accepted as a new command', correction.accepted && correction.commandId !== replyCommand);
  const stale = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += stale.mutations;
  check('A4 tool call from the interrupted reply stays bound to the invalidated command', h.registry.commandForToolCall() === replyCommand && !h.registry.isCurrent(String(replyCommand)));
  check('A4 stale authority => mutation 0', stale.mutations === 0 && stale.outcome === 'STALE_COMMAND');
}

{
  // Inverse: reconnect — authority never survives a session boundary.
  const h = makeHarness();
  await prepareReversal(h);
  speak(h, 'VoiceStrike, confirm reverse scan B184.');
  h.registry.beginReply();
  h.authorities.reset(); h.confirmation.reset(); h.ambient.reset(); h.duplex.reset(); // voiceAgent close/connect path
  h.sessionId = 'SESSION-B';
  const afterReconnect = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += afterReconnect.mutations;
  check('A5 reconnect => mutation 0', afterReconnect.mutations === 0 && afterReconnect.authorityReason === 'NO_ACCEPTED_TURN');
}

{
  // Inverse: cancelled confirmation.
  const h = makeHarness();
  await prepareReversal(h);
  const cancel = speak(h, "VoiceStrike, reverse it... actually don't.");
  check('A6 cancellation turn is accepted as speech', cancel.accepted);
  h.registry.beginReply();
  const cancelled = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += cancelled.mutations;
  check('A6 cancelled confirmation => mutation 0', cancelled.mutations === 0 && cancelled.outcome !== 'VERIFIED_SUCCESS');
}

{
  // Inverse: no wake authority — confirmation phrase without VoiceStrike wake word.
  const h = makeHarness();
  await prepareReversal(h);
  const noWake = speak(h, 'confirm reverse scan B184.');
  check('A7 confirmation without wake phrase is rejected', !noWake.accepted && noWake.rejectedBy === 'CRITICAL:WAKE_PHRASE_REQUIRED');
  h.registry.beginReply();
  const outcome = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += outcome.mutations;
  check('A7 no wake authority => mutation 0', outcome.mutations === 0 && outcome.outcome !== 'VERIFIED_SUCCESS');
}

{
  // Inverse: no accepted turn at all after prepare (LLM calls the tool without a confirmation turn).
  const h = makeHarness();
  await prepareReversal(h);
  h.registry.beginReply();
  const outcome = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += outcome.mutations;
  check('A8 prepare-only authority cannot confirm: repeated prepare turn stays non-mutating', outcome.mutations === 0 && outcome.outcome !== 'VERIFIED_SUCCESS');
}

{
  // Pure authority-object properties.
  const registry = new TurnAuthorityRegistry();
  const granted = registry.grant({ sessionId: 'S', turnId: 'T1', commandId: 'C1', transcript: 'VoiceStrike, confirm reverse scan B184', wakeAuthorised: true, criticalSpeechTrusted: true, criticalKind: 'REVERSE_CONFIRM', now: 10_000 });
  check('A9 TurnAuthority is immutable', Object.isFrozen(granted));
  check('A9 authority has no revoke-by-speech API', !('revoke' in registry) && !('setAuthorised' in registry));
  check('A9 authority resolves for its own command', registry.resolve({ commandId: 'C1', sessionId: 'S', isCommandCurrent: true, now: 12_000 }).ok);
  check('A9 authority rejects another command', !registry.resolve({ commandId: 'C2', sessionId: 'S', isCommandCurrent: true, now: 12_000 }).ok);
  check('A9 authority rejects another session', !registry.resolve({ commandId: 'C1', sessionId: 'S2', isCommandCurrent: true, now: 12_000 }).ok);
  check('A9 authority rejects invalidated command', !registry.resolve({ commandId: 'C1', sessionId: 'S', isCommandCurrent: false, now: 12_000 }).ok);
  check('A9 authority expires after TTL', !registry.resolve({ commandId: 'C1', sessionId: 'S', isCommandCurrent: true, now: 10_000 + TURN_AUTHORITY_TTL_MS + 1 }).ok);
  const notWake: TurnAuthority = { ...granted, wakeAuthorised: false };
  check('A9 non-wake authority cannot authorise tools', resolveTurnAuthority(notWake, { commandId: 'C1', sessionId: 'S', isCommandCurrent: true, now: 12_000 }, new Set()).ok === false);
  const nonCritical: TurnAuthority = { ...granted, criticalKind: 'NONE', criticalSpeechTrusted: false };
  check('A9 non-critical turn cannot authorise the protected reverse mutation', resolveTurnAuthority(nonCritical, { commandId: 'C1', sessionId: 'S', isCommandCurrent: true, requireCriticalTrust: true, now: 12_000 }, new Set()).ok === false);
  registry.consumeMutation(granted, 'reverse_last_scan');
  check('A9 consumed mutation cannot be re-attempted under the same authority', registry.resolve({ commandId: 'C1', sessionId: 'S', isCommandCurrent: true, mutationToolName: 'reverse_last_scan', now: 12_000 }).ok === false);
  check('A9 consumption is per mutation tool, so a second distinct mutation in the same turn (E1 report+status) stays possible', registry.resolve({ commandId: 'C1', sessionId: 'S', isCommandCurrent: true, mutationToolName: 'update_job_status', now: 12_000 }).ok);
  registry.reset();
  check('A9 reset clears authority', registry.current() === null);
}


// ---------------------------------------------------------------------------
// v0.9.0 — BUILD 7 Final Candidate regressions (spec section 7: R-A … R-R)
//
// These exercise the consolidated lifecycle with the real modules. The harness mirrors
// voiceAgent.ts gate order; nothing here stubs a safety gate.
// ---------------------------------------------------------------------------

type ToolStage = OperationalStage;

/** Mirrors handleToolCall for a mutation: authority -> readiness -> workflow -> execute. */
async function mutationToolCall(
  h: Harness,
  name: 'report_exception' | 'update_job_status' | 'report_inventory_discrepancy',
  args: Record<string, unknown>,
  server: { status: number; payload: Record<string, unknown> },
  verifyOk: boolean,
): Promise<{ outcome: string; attempted: boolean; mutations: number; grounding: ReturnType<ClaimEvidence['ground']>; blockedReason?: string }> {
  const commandId = h.registry.commandForToolCall();
  const evidence = new ClaimEvidence(name);
  evidence.record('TOOL_REQUESTED');
  const resolution = h.authorities.resolve({
    commandId,
    sessionId: h.sessionId,
    isCommandCurrent: h.registry.isCurrent(commandId),
    mutationToolName: name,
    now: h.now,
  });
  evidence.record('TOOL_AUTHORISATION_CHECKED');
  if (!resolution.ok) {
    evidence.record('TOOL_BLOCKED_LOCAL');
    return { outcome: 'NO_AUTHORITY', attempted: false, mutations: 0, grounding: evidence.ground(resolution.reason), blockedReason: resolution.reason };
  }
  if (!h.registry.isReady(commandId)) {
    evidence.record('TOOL_BLOCKED_LOCAL');
    return { outcome: 'NEEDS_CLARIFICATION', attempted: false, mutations: 0, grounding: evidence.ground('complete worker command'), blockedReason: 'COMMAND_NOT_READY' };
  }
  const decision = h.workflow.assess(commandId, name, args, h.now);
  if (!decision.ok) {
    evidence.record('TOOL_BLOCKED_LOCAL');
    return { outcome: 'PRECONDITION_REQUIRED', attempted: false, mutations: 0, grounding: evidence.ground(decision.missing), blockedReason: decision.missing };
  }

  const authority = resolution.authority;
  let mutations = 0;
  let attempted = false;
  evidence.record('MUTATION_STARTED');
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('/api/reliability/telemetry')) return new Response('{}', { status: 202 });
    // authoritative verification read
    const state = verifyOk
      ? { job: { id: 'JOB-482', status: 'BLOCKED' }, exceptions: [{ id: 'EXC-1', type: 'WRONG_COMPONENT', status: 'OPEN' }], inventory: [{ component: 'B148', location: 'C12', quantity: 0 }] }
      : { job: { id: 'JOB-482', status: 'IN_PROGRESS' }, exceptions: [], inventory: [] };
    return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await executeVerifiedAction({
      commandId,
      toolName: name,
      transcriptContext: h.registry.contextFor(commandId) || authority.transcript,
      commandSlots: h.registry.slotsFor(commandId) ?? {},
      args,
      sessionId: h.sessionId,
      turnId: authority.turnId,
      isCommandCurrent: () => h.registry.isCurrent(commandId),
      isCommandReady: () => h.registry.isReady(commandId),
      request: async () => {
        h.authorities.consumeMutation(authority, name);
        attempted = true;
        mutations += 1;
        evidence.record('TOOL_ATTEMPTED');
        return new Response(JSON.stringify(server.payload), { status: server.status, headers: { 'content-type': 'application/json' } });
      },
    });
    if (result.mutationReportedSuccess) evidence.record('MUTATION_COMPLETED');
    if (result.verificationAttempted) evidence.record('VERIFICATION_STARTED');
    if (result.outcome === 'TOOL_FAILED') evidence.record('TOOL_RETURNED_FAILURE');
    if (canClaimSuccess(result)) {
      evidence.record('VERIFICATION_PASSED');
      evidence.record('VERIFIED_SUCCESS');
      if (name === 'report_exception') h.workflow.noteExceptionVerified(commandId, { jobId: 'JOB-482', observed: args.observed_component }, h.now);
      if (name === 'update_job_status') h.workflow.noteJobBlockedVerified(commandId, { jobId: 'JOB-482' }, h.now);
    } else if (result.verificationAttempted) {
      evidence.record('VERIFICATION_FAILED');
    }
    return { outcome: result.outcome, attempted, mutations, grounding: evidence.ground() };
  } finally {
    globalThis.fetch = savedFetch;
  }
}

/** Mirrors handleToolCall for a read: authority -> central read policy -> optional endpoint. */
function readToolCall(h: Harness, name: string, args: Record<string, unknown>, attemptResult?: { ok: boolean; failed?: boolean }) {
  const commandId = h.registry.commandForToolCall();
  const evidence = new ClaimEvidence(name);
  evidence.record('TOOL_REQUESTED');
  const resolution = h.authorities.resolve({ commandId, sessionId: h.sessionId, isCommandCurrent: h.registry.isCurrent(commandId), now: h.now });
  evidence.record('TOOL_AUTHORISATION_CHECKED');
  if (!resolution.ok) {
    evidence.record('TOOL_BLOCKED_LOCAL');
    return { allowed: false, attempted: false, code: resolution.reason, grounding: evidence.ground(resolution.reason) };
  }
  const readiness = assessReadReadiness({
    toolName: name,
    args,
    commandReady: h.registry.isReady(commandId),
    workflow: h.registry.workflowFor(commandId),
    trustedComponent: h.registry.trustedComponentForTool(commandId, name),
    pendingEntityConfirmation: h.registry.pendingEntityConfirmation(commandId)?.expectedValue ?? null,
  });
  if (!readiness.ok) {
    evidence.record('TOOL_BLOCKED_LOCAL');
    return { allowed: false, attempted: false, code: readiness.code, grounding: evidence.ground(readiness.code) };
  }
  evidence.record('TOOL_ATTEMPTED');
  if (attemptResult?.failed) evidence.record('TOOL_RETURNED_FAILURE');
  return { allowed: true, attempted: true, code: 'ATTEMPTED', grounding: evidence.ground() };
}

/** Accepted E1 turn: "VoiceStrike, I think I've got the wrong part." -> "B184." */
function acceptWrongComponentTurn(h: Harness) {
  const t1 = speak(h, "VoiceStrike, I think I've got the wrong part.");
  check('R-pre E1 wrong-part turn accepted', t1.accepted);
  h.registry.beginReply();
  h.registry.finishReply();
  const collecting = h.registry.current();
  if (collecting?.status === 'COLLECTING') h.ambient.openClarificationWindow(collecting.id, h.now);
  h.now += 2_000;
  const t2 = speak(h, 'B184.');
  check('R-pre component clarification accepted on the same command', t2.accepted && t2.commandId === t1.commandId);
  return t2;
}

const E1_ARGS_EXCEPTION = { type: 'WRONG_COMPONENT', observed_component: 'B184', details: 'Observed B184; expected B148.' };
const E1_SERVER_EXCEPTION = { status: 201, payload: { ok: true, created: true, exception: { id: 'EXC-1', job_id: 'JOB-482' }, verified: false, verification_required: true } };
const E1_SERVER_BLOCK = { status: 200, payload: { ok: true, changed: true, job: { id: 'JOB-482', status: 'BLOCKED' }, verified: false, verification_required: true } };

{
  // R-A — E1 correct order: mismatch -> exception verified -> block verified -> claim allowed.
  const h = makeHarness('SESSION-E1A');
  acceptWrongComponentTurn(h);
  h.workflow.noteComponentCheck(String(h.registry.current()?.id ?? ''), { jobId: 'JOB-482', observed: 'B184', expected: 'B148', verdict: 'MISMATCH' }, h.now);
  h.registry.beginReply();
  const exception = await mutationToolCall(h, 'report_exception', E1_ARGS_EXCEPTION, E1_SERVER_EXCEPTION, true);
  check('R-A report_exception reaches VERIFIED_SUCCESS', exception.outcome === 'VERIFIED_SUCCESS' && exception.mutations === 1);
  const block = await mutationToolCall(h, 'update_job_status', { status: 'BLOCKED' }, E1_SERVER_BLOCK, true);
  check('R-A update_job_status is allowed only after the verified exception', block.outcome === 'VERIFIED_SUCCESS' && block.mutations === 1);
  check('R-A success wording is permitted only with verified state', block.grounding.may_claim_state_changed && block.grounding.may_claim_success);
  check('R-A workflow reached JOB_BLOCKED_VERIFIED', h.workflow.phase(String(h.registry.current()?.id ?? ''), h.now) === 'JOB_BLOCKED_VERIFIED');
  metrics.actionsTested += 1;
  h.registry.finishReply();
}

{
  // R-B — premature block: locally refused, endpoint never called, later legitimate block still possible exactly once.
  const h = makeHarness('SESSION-E1B');
  acceptWrongComponentTurn(h);
  h.workflow.noteComponentCheck(String(h.registry.current()?.id ?? ''), { jobId: 'JOB-482', observed: 'B184', expected: 'B148', verdict: 'MISMATCH' }, h.now);
  h.registry.beginReply();
  const premature = await mutationToolCall(h, 'update_job_status', { status: 'BLOCKED' }, E1_SERVER_BLOCK, true);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += premature.mutations;
  check('R-B premature block is refused locally', premature.outcome === 'PRECONDITION_REQUIRED');
  check('R-B premature block never calls the endpoint', premature.attempted === false && premature.mutations === 0 && premature.grounding.tool_call_attempted === false);
  check('R-B premature block cannot be verbalised as a state change or a tool failure', !premature.grounding.may_claim_state_changed && !premature.grounding.may_claim_tool_failure);
  const exception = await mutationToolCall(h, 'report_exception', E1_ARGS_EXCEPTION, E1_SERVER_EXCEPTION, true);
  check('R-B report_exception still verifies after the refused block', exception.outcome === 'VERIFIED_SUCCESS');
  const block = await mutationToolCall(h, 'update_job_status', { status: 'BLOCKED' }, E1_SERVER_BLOCK, true);
  check('R-B the legitimate block remains possible exactly once', block.outcome === 'VERIFIED_SUCCESS' && block.mutations === 1);
  const repeat = await mutationToolCall(h, 'update_job_status', { status: 'BLOCKED' }, E1_SERVER_BLOCK, true);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += repeat.mutations;
  check('R-B the same turn cannot block twice', repeat.mutations === 0 && repeat.outcome !== 'VERIFIED_SUCCESS');
  metrics.actionsTested += 1;
  h.registry.finishReply();
}

{
  // R-C — false success impossible: rejected, unattempted and verification-failed mutations.
  const h = makeHarness('SESSION-RC');
  acceptWrongComponentTurn(h);
  h.workflow.noteComponentCheck(String(h.registry.current()?.id ?? ''), { jobId: 'JOB-482', observed: 'B184', expected: 'B148', verdict: 'MISMATCH' }, h.now);
  h.registry.beginReply();
  const verifyFails = await mutationToolCall(h, 'report_exception', E1_ARGS_EXCEPTION, E1_SERVER_EXCEPTION, false);
  metrics.unsafeInputs += 1;
  check('R-C verification failure cannot claim a state change', verifyFails.outcome !== 'VERIFIED_SUCCESS' && !verifyFails.grounding.may_claim_state_changed && !verifyFails.grounding.may_claim_success);
  check('R-C a mutation that never verified never reports VERIFIED_SUCCESS stage', !verifyFails.grounding.stages.includes('VERIFIED_SUCCESS'));
  const unattempted = groundClaims({ tool: 'update_job_status', stages: ['TOOL_REQUESTED', 'TOOL_AUTHORISATION_CHECKED', 'TOOL_BLOCKED_LOCAL'] });
  check('R-C an unattempted mutation cannot claim success', !unattempted.may_claim_success && !unattempted.may_claim_state_changed);
  metrics.actionsTested += 1;
  h.registry.finishReply();
}

{
  // R-D — false tool failure impossible after a local read block.
  const h = makeHarness('SESSION-RD');
  const t = speak(h, 'VoiceStrike, I scanned.');
  check('R-D fragment turn accepted', t.accepted);
  h.registry.beginReply();
  const inspect = readToolCall(h, 'inspect_last_action', {});
  check('R-D incomplete command still blocks the authoritative inspection', !inspect.allowed && inspect.code === 'COMMAND_INCOMPLETE');
  check('R-D blocked read reports tool_call_attempted=false', inspect.grounding.tool_call_attempted === false && inspect.grounding.blocked_locally);
  check('R-D blocked read cannot claim a retrieval or tool failure', !inspect.grounding.may_claim_retrieval_failure && !inspect.grounding.may_claim_tool_failure);
  check('R-D blocked read names the forbidden claims explicitly', inspect.grounding.forbidden_claims.some((claim) => claim.startsWith('I cannot retrieve')));
  h.registry.finishReply();
}

{
  // R-E — read bootstrap: "VoiceStrike, where can I find B148?" must resolve from authoritative state.
  const h = makeHarness('SESSION-RE');
  const t = speak(h, 'VoiceStrike, where can I find B148?');
  check('R-E locate request is accepted', t.accepted);
  h.registry.beginReply();
  const job = readToolCall(h, 'get_current_job', {});
  check('R-E get_current_job may bootstrap an incomplete command', job.allowed && job.attempted);
  const inventory = readToolCall(h, 'check_inventory', { component_id: 'B148' });
  check('R-E check_inventory is allowed with a safely resolved component', inventory.allowed && inventory.attempted);
  const guess = readToolCall(h, 'check_inventory', { component_id: 'B' });
  check('R-E an unresolved component is still refused', !guess.allowed && guess.code === 'CRITICAL_ENTITY_REQUIRED');
  check('R-E read bootstrap remains read-only even when lookup command is READY', h.registry.isReady(String(t.commandId)) && !h.workflow.hasVerifiedException(String(t.commandId), h.now) && !h.workflow.hasVerifiedBlock(String(t.commandId), h.now));
  h.registry.finishReply();
}

{
  // R-F — idle ambient: no accepted turn, no tool, no authority, no spoken reply.
  const h = makeHarness('SESSION-RF');
  h.replyAuthority.reset(1);
  const greeting = h.replyAuthority.beginReply('reply-greeting', 1);
  check('R-F the session greeting is authorised once', greeting.authorised && greeting.reason === 'SESSION_GREETING');
  h.replyAuthority.finishReply();
  const ambient = speak(h, 'and tonight on the news the weather will be cold', { speechStartedAt: h.now - 300 });
  check('R-F ambient transcript is rejected', !ambient.accepted);
  h.replyAuthority.noteTurn(ambient.turnId, 'REJECTED');
  const orphan = h.replyAuthority.beginReply('reply-orphan', 1);
  check('R-F a reply caused by rejected speech is an orphan', !orphan.authorised && orphan.reason === 'NO_ACCEPTED_TURN');
  check('R-F an orphan reply is never audible or authoritative', h.replyAuthority.isCurrentReplyAuthorised() === false);
  h.replyAuthority.finishReply();
  const secondOrphan = h.replyAuthority.beginReply('reply-orphan-2', 1);
  check('R-F repeated idle replies stay suppressed (no self-reply cascade)', !secondOrphan.authorised);
  h.replyAuthority.finishReply();
  check('R-F rejected turns and suppressed replies are counted', h.replyAuthority.counters().suppressedReplies >= 2);
  metrics.unsafeInputs += 1;
}

{
  // R-F2 — a successful tool result keeps the accepted turn alive for exactly one post-tool
  // continuation reply. This is the v0.9.0 runtime regression where get_current_job completed
  // but the provider's reply-3 was suppressed as NO_ACCEPTED_TURN.
  const replies = new ReplyAuthorityRegistry();
  replies.reset(1);
  const greeting = replies.beginReply('reply-f2-greeting', 1);
  check('R-F2 session greeting is authorised before the worker turn', greeting.authorised);
  replies.finishReply();
  replies.noteTurn('turn-f2', 'ACCEPTED', 'CMD-F2');
  const initial = replies.beginReply('reply-f2-initial', 1);
  check('R-F2 initial reply binds to the accepted worker turn', initial.authorised && initial.reason === 'BOUND_TO_ACCEPTED_TURN');
  replies.markPendingWork();
  // A rejected TV transcript during the tool round-trip must not revoke the worker turn.
  replies.noteTurn('turn-f2-tv', 'REJECTED');
  replies.markToolResultSent();
  replies.finishReply();
  check('R-F2 accepted turn remains open after tool.result handoff', replies.hasOpenTurn());
  const continuation = replies.beginReply('reply-f2-continuation', 1);
  check('R-F2 post-tool reply is authorised as the same turn continuation', continuation.authorised && continuation.reason === 'TOOL_CONTINUATION' && continuation.turnId === 'turn-f2' && continuation.commandId === 'CMD-F2');
  replies.finishReply();
  check('R-F2 turn closes only after the post-tool continuation completes', !replies.hasOpenTurn());
  const late = replies.beginReply('reply-f2-late', 1);
  check('R-F2 a later unbound reply is still suppressed as orphan', !late.authorised && late.reason === 'NO_ACCEPTED_TURN');
  replies.finishReply();
}

{
  // R-F3 — live AssemblyAI ordering observed on Windows for protected recovery:
  // accepted critical turn -> reply.done -> another reply.started -> delayed tool.call.
  // The causal turn must survive for the tool result continuation, but the intervening reply
  // must remain inaudible/orphan so ambient/self-talk safety is not weakened.
  const replies = new ReplyAuthorityRegistry();
  replies.reset(1);
  replies.beginReply('reply-f3-greeting', 1, 1_000);
  replies.finishReply(1_100);
  replies.noteTurn('turn-f3', 'ACCEPTED', 'CMD-F3');
  check('R-F3 protected lease arms only on the accepted command/turn', replies.armProtectedToolLease({ turnId: 'turn-f3', commandId: 'CMD-F3', expectedTool: 'reverse_last_scan', now: 2_000 }));
  const initial = replies.beginReply('reply-f3-initial', 1, 2_100);
  check('R-F3 first reply after protected turn is authorised', initial.authorised && initial.reason === 'BOUND_TO_ACCEPTED_TURN');
  replies.finishReply(2_200);
  check('R-F3 accepted turn survives the first reply boundary while waiting for delayed tool.call', replies.hasOpenTurn() && replies.hasProtectedToolLease('CMD-F3'));
  replies.noteTurn('turn-f3-tv', 'REJECTED');
  const interstitial = replies.beginReply('reply-f3-interstitial', 1, 2_300);
  check('R-F3 intervening provider reply stays suppressed while protected lease waits for tool.call', !interstitial.authorised && interstitial.reason === 'PROTECTED_TOOL_LEASE_PENDING');
  replies.finishReply(2_400);
  check('R-F3 rejected ambient turn cannot revoke protected causal lease', replies.hasOpenTurn() && replies.hasProtectedToolLease('CMD-F3'));
  check('R-F3 exact delayed reverse tool claims the protected lease', replies.noteToolRequest('CMD-F3', 'reverse_last_scan', 2_500));
  check('R-F3 wrong tool cannot claim the protected lease', !replies.noteToolRequest('CMD-F3', 'update_job_status', 2_501));
  replies.markPendingWork();
  replies.markToolResultSent();
  const continuation = replies.beginReply('reply-f3-confirm-prompt', 1, 2_700);
  check('R-F3 confirmation prompt reply is authorised as TOOL_CONTINUATION on the same command', continuation.authorised && continuation.reason === 'TOOL_CONTINUATION' && continuation.turnId === 'turn-f3' && continuation.commandId === 'CMD-F3');
  replies.finishReply(2_800);
  check('R-F3 protected causal turn closes after the post-tool continuation completes', !replies.hasOpenTurn());

  const expiredLease = new ReplyAuthorityRegistry();
  expiredLease.reset(1);
  expiredLease.noteTurn('turn-expired-lease', 'ACCEPTED', 'CMD-LEASE-OLD');
  expiredLease.armProtectedToolLease({ turnId: 'turn-expired-lease', commandId: 'CMD-LEASE-OLD', expectedTool: 'reverse_last_scan', now: 10_000 });
  expiredLease.beginReply('reply-lease-initial', 1, 10_100);
  expiredLease.finishReply(10_200);
  const lateClaim = expiredLease.noteToolRequest('CMD-LEASE-OLD', 'reverse_last_scan', 10_000 + PROTECTED_TOOL_LEASE_TTL_MS + 1);
  check('R-F3 protected reply lease expires instead of holding a stale turn forever', !lateClaim && !expiredLease.hasOpenTurn());
}

{
  // R-F4 — confirmation TTL is not consumed while the confirmation prompt has not yet been
  // delivered. It begins only when the protected REVERSE_CONFIRM speech window opens.
  const gate = new CriticalConfirmationGate();
  const prepared = gate.assessReverse({
    commandId: 'CMD-TTL', turnId: 'TURN-PREP', transcript: 'VoiceStrike, reverse scan B184.',
    actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 100_000,
  });
  check('R-F4 protected action enters PREPARED before prompt delivery', prepared.status === 'PREPARED' && gate.pending()?.expiresAt === null);
  check('R-F4 ordinary 20 s confirmation TTL does not expire before prompt delivery', gate.sweep(121_000) === null);
  const windows = new ProtectedSpeechWindowRegistry();
  windows.arm({ epoch: 1, commandId: 'CMD-TTL', actionId: 'ACT-SCAN-B184', componentId: 'B184', expectedKind: 'REVERSE_CONFIRM', now: 121_000 });
  const opened = windows.markPromptDone({ epoch: 1, commandId: 'CMD-TTL', audibleDoneAt: 122_000, now: 121_500 });
  check('R-F4 REVERSE_CONFIRM window opens only after audible confirmation prompt', opened?.state === 'OPEN' && opened.expiresAt != null);
  if (opened?.expiresAt != null) gate.activateConfirmationWindow({ commandId: 'CMD-TTL', actionId: 'ACT-SCAN-B184', componentId: 'B184', expiresAt: opened.expiresAt });
  check('R-F4 gate deadline is activated from the opened confirmation window', gate.pending()?.expiresAt === opened?.expiresAt);
  check('R-F4 confirmation remains valid just before worker-visible TTL deadline', opened?.expiresAt != null && gate.sweep(opened.expiresAt - 1) === null);
  check('R-F4 confirmation expires after worker-visible TTL deadline', opened?.expiresAt != null && gate.sweep(opened.expiresAt + 1)?.preparedCommandId === 'CMD-TTL');
}

{
  // R-F5 — integrated reproduction of the live v0.9.2 failure sequence. This intentionally
  // places an extra provider reply boundary before each delayed protected tool.call, then proves
  // that PREPARE can deliver an audible confirmation prompt and CONFIRM can still reach the gate.
  const replies = new ReplyAuthorityRegistry();
  const windows = new ProtectedSpeechWindowRegistry();
  const gate = new CriticalConfirmationGate();
  replies.reset(1);
  replies.beginReply('reply-f5-greeting', 1, 200_000);
  replies.finishReply(200_100);

  windows.arm({ epoch: 1, commandId: 'CMD-F5', actionId: 'ACT-SCAN-B184', componentId: 'B184', expectedKind: 'REVERSE_PREPARE', now: 200_200 });
  const preparePrompt = windows.markPromptDone({ epoch: 1, commandId: 'CMD-F5', audibleDoneAt: 201_000, now: 200_900 });
  const prepareSpeech = windows.assess({ epoch: 1, commandId: 'CMD-F5', kind: 'REVERSE_PREPARE', componentId: 'B184', speechStartedAt: 201_700, now: 201_800 });
  check('R-F5 PREPARE protected window accepts the fresh worker turn', preparePrompt?.state === 'OPEN' && prepareSpeech.trusted);
  if (prepareSpeech.trusted) windows.consume(prepareSpeech.window.id);

  replies.noteTurn('turn-f5-prepare', 'ACCEPTED', 'CMD-F5');
  replies.armProtectedToolLease({ turnId: 'turn-f5-prepare', commandId: 'CMD-F5', expectedTool: 'reverse_last_scan', now: 201_800 });
  const prepareInitialReply = replies.beginReply('reply-f5-prepare-initial', 1, 201_900);
  replies.finishReply(202_000);
  const prepareInterveningReply = replies.beginReply('reply-f5-prepare-intervening', 1, 202_050);
  replies.finishReply(202_100);
  check('R-F5 pre-tool extra reply is suppressed without losing PREPARE causality', prepareInitialReply.authorised && !prepareInterveningReply.authorised && replies.hasOpenTurn());
  check('R-F5 delayed PREPARE tool.call still claims the exact held turn', replies.noteToolRequest('CMD-F5', 'reverse_last_scan', 202_200));

  const prepared = gate.assessReverse({ commandId: 'CMD-F5', turnId: 'turn-f5-prepare', transcript: 'VoiceStrike, reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 202_200 });
  check('R-F5 delayed tool.call reaches PREPARED rather than CRITICAL_SPEECH_NOT_TRUSTED', prepared.status === 'PREPARED');
  windows.arm({ epoch: 1, commandId: 'CMD-F5', actionId: 'ACT-SCAN-B184', componentId: 'B184', expectedKind: 'REVERSE_CONFIRM', now: 202_200 });
  replies.markPendingWork();
  replies.markToolResultSent();
  const confirmPromptReply = replies.beginReply('reply-f5-confirm-prompt', 1, 202_300);
  replies.finishReply(202_500);
  const confirmWindow = windows.markPromptDone({ epoch: 1, commandId: 'CMD-F5', audibleDoneAt: 203_000, now: 202_500 });
  if (confirmWindow?.expiresAt != null) gate.activateConfirmationWindow({ commandId: 'CMD-F5', actionId: 'ACT-SCAN-B184', componentId: 'B184', expiresAt: confirmWindow.expiresAt });
  check('R-F5 confirmation prompt is authorised and opens REVERSE_CONFIRM window', confirmPromptReply.authorised && confirmPromptReply.reason === 'TOOL_CONTINUATION' && confirmWindow?.state === 'OPEN');
  check('R-F5 confirmation TTL begins only after the audible prompt window opens', gate.pending()?.expiresAt === confirmWindow?.expiresAt && gate.pending()?.expiresAt != null);

  const confirmSpeech = windows.assess({ epoch: 1, commandId: 'CMD-F5', kind: 'REVERSE_CONFIRM', componentId: 'B184', speechStartedAt: 203_700, now: 203_800 });
  check('R-F5 fresh confirmation speech is trusted inside the opened confirmation window', confirmSpeech.trusted);
  if (confirmSpeech.trusted) windows.consume(confirmSpeech.window.id);
  replies.noteTurn('turn-f5-confirm', 'ACCEPTED', 'CMD-F5');
  replies.armProtectedToolLease({ turnId: 'turn-f5-confirm', commandId: 'CMD-F5', expectedTool: 'reverse_last_scan', now: 203_800 });
  replies.beginReply('reply-f5-confirm-initial', 1, 203_900);
  replies.finishReply(204_000);
  const confirmInterstitial = replies.beginReply('reply-f5-confirm-intervening', 1, 204_050);
  replies.finishReply(204_100);
  check('R-F5 confirm-side extra reply is also suppressed while delayed tool.call remains attributable', !confirmInterstitial.authorised && replies.hasOpenTurn());
  check('R-F5 delayed CONFIRM tool.call claims the exact confirmation turn', replies.noteToolRequest('CMD-F5', 'reverse_last_scan', 204_200));
  const confirmed = gate.assessReverse({ commandId: 'CMD-F5', turnId: 'turn-f5-confirm', transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 204_200 });
  check('R-F5 integrated delayed PREPARE→prompt→CONFIRM lifecycle reaches CONFIRMED', confirmed.status === 'CONFIRMED');
}

{
  // R-G — clarification continuity preserved while ambient speech cannot steal the window.
  const h = makeHarness('SESSION-RG');
  const t1 = speak(h, "VoiceStrike, I think I've got the wrong part.");
  check('R-G wrong-part turn accepted', t1.accepted);
  const collecting = h.registry.current();
  check('R-G command is COLLECTING and awaits the component', collecting?.status === 'COLLECTING');
  h.ambient.openClarificationWindow(String(collecting?.id), h.now);
  h.now += 1_000;
  const tv = h.ambient.assess('yes', {
    hasActiveCommand: h.registry.hasActiveOperationalContext(),
    awaitingClarification: h.registry.isAwaitingClarification(),
    activeCommandId: h.registry.current()?.id ?? null,
    now: h.now,
  });
  check('R-G a bare ambient approval cannot take the clarification window', !tv.accepted);
  check('R-G the clarification window survives the rejected ambient turn', h.ambient.isClarificationActive(String(collecting?.id), h.now));
  h.now += 1_000;
  const answer = speak(h, 'B184.');
  check('R-G the real clarification answer is accepted on the same command', answer.accepted && answer.commandId === t1.commandId);
  check('R-G the clarified command becomes READY', h.registry.isReady(String(answer.commandId)));
}

{
  // R-H — natural cancellation of a pending protected action.
  const h = makeHarness('SESSION-RH');
  await prepareReversal(h);
  const pending = h.confirmation.pending();
  check('R-H a protected action is pending before cancellation', pending?.actionId === 'ACT-SCAN-B184');
  const intent = assessCancellationIntent("VoiceStrike, actually don't reverse it.", {
    actionId: pending?.actionId ?? null,
    componentId: pending?.componentId ?? null,
    commandId: pending?.preparedCommandId ?? null,
  });
  check('R-H natural cancellation is detected against the pending action', intent.cancel && intent.reason === 'NEGATED_PENDING_ACTION');
  const cancelled = h.confirmation.cancel(h.now);
  check('R-H cancellation invalidates the prepared authority immediately', cancelled?.actionId === 'ACT-SCAN-B184' && h.confirmation.pending() === null);
  h.registry.invalidate(String(pending?.preparedCommandId));
  const cancelCommand = h.registry.cancelActive("VoiceStrike, actually don't reverse it.");
  check('R-H the cancellation turn is terminal and carries no reversal intent', cancelCommand.status === 'CANCELLED' && cancelCommand.intent === 'CANCEL_ACTION');
  check('R-H a cancelled command is never current', !h.registry.isCurrent(cancelCommand.id));
  h.registry.beginReply();
  const replay = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += replay.mutations;
  check('R-H mutation count remains 0 after cancellation', replay.mutations === 0 && replay.outcome !== 'VERIFIED_SUCCESS');
  const tombstone = h.confirmation.lastTerminalState();
  check('R-H cancellation is observable as a terminal lifecycle state', tombstone?.state === 'CANCELLED' && tombstone.actionId === 'ACT-SCAN-B184');
  const oldReplay = h.confirmation.assessReverse({ commandId: String(pending?.preparedCommandId), turnId: 'turn-old-replay', transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now + 1_000 });
  check('R-H replaying the old confirmation on the cancelled command is refused as CANCELLED', oldReplay.status === 'REJECTED' && oldReplay.code === 'CONFIRMATION_CANCELLED');
  const staleConfirmOnNewCommand = h.confirmation.assessReverse({ commandId: 'CMD-NEW', turnId: 'turn-new-stale-confirm', transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now + 1_001 });
  check('R-H a stale confirm phrase cannot bootstrap a fresh command', staleConfirmOnNewCommand.status === 'REJECTED' && staleConfirmOnNewCommand.code === 'EXPLICIT_CONFIRMATION_REQUIRED');
  const freshPrepare = h.confirmation.assessReverse({ commandId: 'CMD-NEW', turnId: 'turn-new-prepare', transcript: 'VoiceStrike, reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now + 1_002 });
  check('R-H cancellation does not blacklist a fresh inspected command for the same action', freshPrepare.status === 'PREPARED' && freshPrepare.preparedCommandId === 'CMD-NEW');
  check('R-H cancellation safety does not need the TTL', h.now + 1_000 < (pending?.expiresAt ?? 0));
  h.registry.finishReply();
}

{
  // R-H2 — conservative detection: an unrelated negation is not a cancellation.
  const unrelated = assessCancellationIntent("VoiceStrike, don't block the job, just tell me where B148 is.", { actionId: 'ACT-SCAN-B184', componentId: 'B184', commandId: 'CMD-1' });
  check('R-H2 an unrelated negation naming another component is not cancellation', !unrelated.cancel);
  const noPending = assessCancellationIntent('VoiceStrike, stop.', null);
  check('R-H2 cancellation requires a compatible pending protected action', !noPending.cancel);
  const confirming = assessCancellationIntent('VoiceStrike, confirm reverse scan B184.', { actionId: 'ACT-SCAN-B184', componentId: 'B184', commandId: 'CMD-1' });
  check('R-H2 a confirmation phrase is never read as cancellation', !confirming.cancel);
  const explicit = assessCancellationIntent('VoiceStrike, cancel that.', { actionId: 'ACT-SCAN-B184', componentId: 'B184', commandId: 'CMD-1' });
  check('R-H2 explicit cancellation variants are accepted', explicit.cancel && explicit.reason === 'EXPLICIT_CANCEL_PHRASE');
}

{
  // R-I — confirmation expiry is a hard lifecycle boundary.
  const h = makeHarness('SESSION-RI');
  const { prepareTurn } = await prepareReversal(h);
  const preparedCommandId = String(prepareTurn.commandId);
  h.now += CONFIRMATION_TTL_MS + 1_000;
  const expired = h.confirmation.sweep(h.now);
  check('R-I expiry is swept deterministically', expired?.preparedCommandId === preparedCommandId);
  h.registry.invalidate(preparedCommandId);
  h.recoveryComponent = null; // the expired command's inspection authority is dropped
  check('R-I the expired protected command is closed', !h.registry.isCurrent(preparedCommandId));
  const stale = h.confirmation.assessReverse({ commandId: preparedCommandId, turnId: 'turn-stale', transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now });
  check('R-I the expired confirmation can never mutate', stale.status === 'REJECTED' && stale.code === 'CONFIRMATION_EXPIRED');
  const fresh = speak(h, 'VoiceStrike, reverse scan B184.');
  check('R-I a fresh reverse without inspection is refused, not merged', !fresh.accepted && fresh.rejectedBy === 'CRITICAL:RECOVERY_CONTEXT_REQUIRED');
  h.recoveryComponent = 'B184'; // fresh inspect_last_action on the new command
  const reinspected = speak(h, 'VoiceStrike, reverse scan B184.');
  check('R-I the fresh reverse obtains a new commandId', reinspected.accepted && reinspected.commandId !== preparedCommandId);
  check('R-I no expired confirmation text is concatenated into the fresh command', !h.registry.contextFor(String(reinspected.commandId)).toLowerCase().includes('confirm reverse'));
  const staleConfirmOnFreshCommand = h.confirmation.assessReverse({ commandId: String(reinspected.commandId), turnId: 'turn-fresh-stale-confirm', transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now + 1 });
  check('R-I stale confirm text cannot silently prepare the fresh command', staleConfirmOnFreshCommand.status === 'REJECTED' && staleConfirmOnFreshCommand.code === 'EXPLICIT_CONFIRMATION_REQUIRED');
  const freshPrepared = h.confirmation.assessReverse({ commandId: String(reinspected.commandId), turnId: String(reinspected.turnId), transcript: 'VoiceStrike, reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now + 2 });
  check('R-I a fresh inspected command can prepare the same action after expiry', freshPrepared.status === 'PREPARED' && freshPrepared.preparedCommandId === reinspected.commandId);
}

{
  // R-J — full demo reset: a new epoch isolates the next run completely.
  const h = makeHarness('SESSION-RJ');
  await prepareReversal(h);
  speak(h, 'VoiceStrike, confirm reverse scan B184.');
  const epochs = new SessionEpochRegistry(h.now);
  const before = epochs.current();
  // voiceAgent.beginSessionEpoch('DEMO_RESET') clears exactly these holders:
  const change = epochs.next('DEMO_RESET', h.now);
  h.registry.reset(); h.ambient.reset(); h.duplex.reset(); h.confirmation.reset();
  h.authorities.reset(); h.replyAuthority.reset(change.epoch); h.workflow.reset();
  h.recoveryComponent = null;
  check('R-J the session epoch changes on a full demo reset', change.epoch === before + 1 && change.reason === 'DEMO_RESET');
  check('R-J pre-reset authority does not survive', h.authorities.current() === null);
  check('R-J pre-reset prepared confirmation does not survive', h.confirmation.pending() === null && h.confirmation.lastTerminalState() === null);
  check('R-J pre-reset command state does not survive', h.registry.current() === null);
  check('R-J pre-reset workflow phase does not survive', h.workflow.phase(h.now) === 'IDLE');
  check('R-J a stale-epoch async event is refused', !epochs.isCurrent(before) && epochs.isCurrent(change.epoch));
  h.registry.beginReply();
  const afterReset = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += afterReset.mutations;
  check('R-J a pre-reset confirmation cannot mutate the new session', afterReset.mutations === 0 && afterReset.authorityReason === 'NO_ACCEPTED_TURN');
}

{
  // R-K — Worker/Supervisor switching is presentation only (v0.8.10 must not regress).
  const app = readFileSync(resolve(root, 'client/src/App.tsx'), 'utf8');
  check('R-K both view trees stay mounted across view switches', app.includes("hidden={view !== 'worker'}") && app.includes("hidden={view !== 'supervisor'}"));
  check('R-K view switching never resets the session epoch', !app.includes('resetSession'));
  const panel = readFileSync(resolve(root, 'client/src/components/VoicePanel.tsx'), 'utf8');
  check('R-K only an explicit demo reset resets the voice session', panel.includes("clientRef.current?.resetSession('DEMO_RESET')") && panel.includes('DEMO_RESET_EVENT_DOM'));
}

{
  // R-L — natural correction: the superseded entity never survives.
  const corrected = resolveCorrectedTechnicalEntity('component_id', "VoiceStrike, I think I've got the wrong part. It's B148. Sorry, I mean B184.");
  check('R-L correction supersedes the stale entity', corrected.canonicalValue === 'B184' && corrected.status === 'CORRECTED');
  metrics.correctionTotal += 1; if (corrected.canonicalValue === 'B184') metrics.correctionCorrect += 1;
}

{
  // R-M — fragmented technical ID keeps one command and never guesses.
  const registry = new CommandRegistry();
  const f1 = registry.acceptFinalTranscript('VoiceStrike, I scanned');
  const f2 = registry.acceptFinalTranscript('B one');
  const f3 = registry.acceptFinalTranscript('84.');
  check('R-M fragments stay on one commandId', f1.id === f2.id && f2.id === f3.id);
  check('R-M the reconstructed ID is not yet authority', f3.status === 'COLLECTING' && registry.pendingEntityConfirmation(f3.id)?.expectedValue === 'B184');
  const f4 = registry.acceptFinalTranscript('B184.');
  check('R-M the repeated complete ID confirms on the same command', f4.id === f3.id && registry.isReady(f4.id));
  metrics.entityTotal += 1; metrics.entityCorrect += 1; metrics.entitySafe += 1;
}

{
  // R-N — existing E3 golden recovery still ends in exactly one verified reversal.
  const h = makeHarness('SESSION-RN');
  await prepareReversal(h);
  const confirmTurn = speak(h, 'VoiceStrike, confirm reverse scan B184.');
  check('R-N the second confirmation turn is accepted', confirmTurn.accepted);
  h.registry.beginReply();
  const outcome = await reverseToolCall(h, REVERSE_ARGS);
  check('R-N exactly one reversal and one independent verification', outcome.mutations === 1 && outcome.verifications === 1);
  check('R-N the golden path still reaches VERIFIED_SUCCESS', outcome.outcome === 'VERIFIED_SUCCESS' && outcome.verified);
  metrics.actionsTested += 1;
  h.registry.finishReply();
}

{
  // R-O — a repeated confirmation after success cannot mutate again.
  const h = makeHarness('SESSION-RO');
  const prepared = await prepareReversal(h);
  const consumedCommandId = String(prepared.prepareTurn.commandId);
  speak(h, 'VoiceStrike, confirm reverse scan B184.');
  h.registry.beginReply();
  const first = await reverseToolCall(h, REVERSE_ARGS);
  check('R-O the first confirmation reverses once', first.mutations === 1 && first.outcome === 'VERIFIED_SUCCESS');
  h.registry.finishReply();
  h.now += 3_000;
  const replayTurn = speak(h, 'VoiceStrike, confirm reverse scan B184.');
  check('R-O a repeated confirmation is rejected before command acceptance', !replayTurn.accepted && String(replayTurn.rejectedBy).startsWith('CRITICAL:'));
  const consumedOldCommand = h.confirmation.assessReverse({ commandId: consumedCommandId, turnId: 'turn-replay-old', transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now });
  check('R-O the consumed command tombstone refuses its own replay', consumedOldCommand.status === 'REJECTED' && consumedOldCommand.code === 'CONFIRMATION_ALREADY_CONSUMED');
  const staleConfirmNewCommand = h.confirmation.assessReverse({ commandId: 'CMD-REPLAY-NEW', turnId: 'turn-replay-new', transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: h.now + 1 });
  metrics.unsafeInputs += 1;
  check('R-O a confirmation-only phrase cannot bootstrap a new command after consumption', staleConfirmNewCommand.status === 'REJECTED' && staleConfirmNewCommand.code === 'EXPLICIT_CONFIRMATION_REQUIRED');
}

{
  // R-P — unknown/ambiguous component clarifies and never mutates.
  const ambiguous = resolveTechnicalEntity('component_id', ['I have B148 and B184 here.']);
  check('R-P an ambiguous component is never guessed', ambiguous.status === 'AMBIGUOUS');
  const unknown = normalizeTechnicalId('B185', 'component_id');
  check('R-P an unknown component is not nearest-corrected', unknown === 'B185');
  const h = makeHarness('SESSION-RP');
  const t = speak(h, 'VoiceStrike, I think I have the wrong part, B148 and B184.');
  check('R-P the ambiguous turn is accepted as speech', t.accepted);
  h.registry.beginReply();
  const read = readToolCall(h, 'check_component', { component_id: 'B184' });
  metrics.unsafeInputs += 1;
  check('R-P an ambiguous critical entity blocks the check instead of guessing', !read.allowed && read.code === 'CRITICAL_ENTITY_REQUIRED');
  check('R-P the ambiguity block is not a tool failure', !read.grounding.may_claim_tool_failure && read.grounding.blocked_locally);
}

{
  // R-Q — rejected speech cannot revoke a previously valid immutable TurnAuthority.
  const h = makeHarness('SESSION-RQ');
  await prepareReversal(h);
  const confirmTurn = speak(h, 'VoiceStrike, confirm reverse scan B184.');
  const authorityAtAcceptance = h.authorities.current();
  h.registry.beginReply();
  const ambient = speak(h, 'and now the sports results', { speechStartedAt: h.now - 200 });
  check('R-Q the ambient turn is rejected', !ambient.accepted);
  h.replyAuthority.noteTurn(ambient.turnId, 'REJECTED');
  check('R-Q the accepted authority is untouched by rejected speech', h.authorities.current() === authorityAtAcceptance && confirmTurn.accepted);
  const delayed = await reverseToolCall(h, REVERSE_ARGS);
  check('R-Q the delayed tool call still resolves its original authority', delayed.mutations === 1 && delayed.outcome === 'VERIFIED_SUCCESS');
  metrics.actionsTested += 1;
  h.registry.finishReply();
}

{
  // R-R — no blind retry after an uncertain post-mutation state.
  const h = makeHarness('SESSION-RR');
  await prepareReversal(h);
  speak(h, 'VoiceStrike, confirm reverse scan B184.');
  h.registry.beginReply();
  const uncertain = await reverseToolCall(h, REVERSE_ARGS, { serverReversed: false });
  metrics.unsafeInputs += 1;
  check('R-R a failed verification never claims success', uncertain.outcome !== 'VERIFIED_SUCCESS' && !uncertain.verified);
  check('R-R the uncertain mutation was attempted exactly once', uncertain.mutations === 1);
  const retry = await reverseToolCall(h, REVERSE_ARGS);
  metrics.unsafeInputs += 1; metrics.unsafeMutations += retry.mutations;
  check('R-R the same authority cannot blindly retry the mutation', retry.mutations === 0 && retry.authorityReason === 'MUTATION_ALREADY_CONSUMED');
  metrics.actionsTested += 1;
  h.registry.finishReply();
}

{
  // Claim grounding unit invariants (defect 5.2), independent of any harness.
  const blocked = groundClaims({ tool: 'get_current_job', stages: ['TOOL_REQUESTED', 'TOOL_AUTHORISATION_CHECKED', 'TOOL_BLOCKED_LOCAL'] });
  check('CG a locally blocked read is not a tool failure', !blocked.may_claim_tool_failure && !blocked.may_claim_retrieval_failure && blocked.blocked_locally);
  const attemptedFailure = groundClaims({ tool: 'check_inventory', stages: ['TOOL_REQUESTED', 'TOOL_ATTEMPTED', 'TOOL_RETURNED_FAILURE'] });
  check('CG a real returned failure may be reported as one', attemptedFailure.may_claim_tool_failure && !attemptedFailure.may_claim_state_changed);
  const mutated = groundClaims({ tool: 'update_job_status', stages: ['TOOL_REQUESTED', 'TOOL_ATTEMPTED', 'MUTATION_COMPLETED', 'VERIFICATION_STARTED', 'VERIFICATION_FAILED'] });
  check('CG a completed but unverified mutation cannot claim a state change', !mutated.may_claim_state_changed && !mutated.may_claim_success);
  const verified = groundClaims({ tool: 'update_job_status', stages: ['TOOL_REQUESTED', 'TOOL_ATTEMPTED', 'MUTATION_COMPLETED', 'VERIFICATION_STARTED', 'VERIFICATION_PASSED', 'VERIFIED_SUCCESS'] });
  check('CG only an independently verified mutation permits a success claim', verified.may_claim_state_changed && verified.may_claim_success);
  const stages: ToolStage[] = verified.stages;
  check('CG the stage vocabulary is preserved in order', stages[0] === 'TOOL_REQUESTED' && stages.at(-1) === 'VERIFIED_SUCCESS');
}

{
  // Tool classification (defect 5.3) — the classes are exhaustive and correctly split.
  check('TP every operational tool has exactly one class', ['get_current_job', 'check_component', 'check_inventory', 'find_alternative_inventory', 'inspect_last_action', 'report_exception', 'update_job_status', 'report_inventory_discrepancy', 'reverse_last_scan'].every((tool) => toolClass(tool) !== null));
  check('TP read-only and mutation classes do not overlap', ['get_current_job', 'check_component', 'check_inventory', 'find_alternative_inventory', 'inspect_last_action'].every((tool) => isReadOnlyTool(tool) && !isMutationToolName(tool)));
  check('TP every mutation tool is classified as MUTATION', ['report_exception', 'update_job_status', 'report_inventory_discrepancy', 'reverse_last_scan'].every((tool) => isMutationToolName(tool) && !isReadOnlyTool(tool)));
  const pendingConfirmation = assessReadReadiness({ toolName: 'check_component', args: { component_id: 'B184' }, commandReady: false, trustedComponent: 'B184', pendingEntityConfirmation: 'B184' });
  check('TP an unconfirmed reconstructed ID blocks entity reads', !pendingConfirmation.ok && pendingConfirmation.code === 'ENTITY_CONFIRMATION_REQUIRED');
  const contextRead = assessReadReadiness({ toolName: 'get_current_job', args: {}, commandReady: false, pendingEntityConfirmation: null });
  check('TP context reads are never blocked by command readiness', contextRead.ok);
}

// ---------------------------------------------------------------------------
// BUILD 7 §36 metrics (Layer A, deterministic)
// ---------------------------------------------------------------------------
const pct = (num: number, den: number) => (den ? `${((100 * num) / den).toFixed(1)}%` : 'n/a');
console.log('\nBUILD 7 metrics (deterministic Layer A):');
console.log(`  M1 Critical Entity Accuracy        = ${metrics.entityCorrect}/${metrics.entityTotal} (${pct(metrics.entityCorrect, metrics.entityTotal)}) — ambiguous cases are counted as safely clarified in M2, not as correct here`);
console.log(`  M2 Safe Entity Resolution          = ${metrics.entitySafe}/${metrics.entityTotal} (${pct(metrics.entitySafe, metrics.entityTotal)})  target 100%`);
console.log(`  M3 Unsafe Mutation Rate            = ${metrics.unsafeMutations}/${metrics.unsafeInputs} (${pct(metrics.unsafeMutations, metrics.unsafeInputs)})  target 0%`);
console.log(`  M4 False Success Rate              = ${metrics.falseSuccessClaims}/${metrics.actionsTested} (${pct(metrics.falseSuccessClaims, metrics.actionsTested)})  target 0%`);
console.log(`  M5 Correction Handling             = ${metrics.correctionCorrect}/${metrics.correctionTotal} (${pct(metrics.correctionCorrect, metrics.correctionTotal)})  target 100%`);
check('M2 Critical Entity Safe Resolution = 100%', metrics.entityTotal > 0 && metrics.entitySafe === metrics.entityTotal);
check('M3 Unsafe Mutation Rate = 0%', metrics.unsafeInputs >= 8 && metrics.unsafeMutations === 0);
check('M4 False Success Rate = 0%', metrics.actionsTested >= 5 && metrics.falseSuccessClaims === 0);
check('M5 Correction Handling = 100%', metrics.correctionTotal >= 4 && metrics.correctionCorrect === metrics.correctionTotal);

console.log(`\nReliability core tests: ${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
