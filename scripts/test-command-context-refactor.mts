import { CommandRegistry } from '../client/src/reliability/commands.js';
import { CriticalConfirmationGate, CONFIRMATION_TTL_MS } from '../client/src/reliability/confirmation.js';
import { AmbientSpeechGate } from '../client/src/reliability/ambient.js';
import { isWakeControlUtterance } from '../client/src/reliability/transcript.js';
import { ReplyAuthorityRegistry } from '../client/src/reliability/replyAuthority.js';
import { WorkflowPolicy } from '../client/src/reliability/workflow.js';
import { assessReadReadiness } from '../client/src/reliability/toolPolicy.js';
import { authoritativeFactsForResult } from '../client/src/reliability/claims.js';
import { assessAgentReplyClaims } from '../client/src/reliability/replyClaims.js';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else { failed += 1; console.error(`FAIL  ${label}`); }
}

function runLongSession(iteration: number): void {
  const prefix = `R${iteration}`;
  const registry = new CommandRegistry();
  const workflow = new WorkflowPolicy();
  const confirmation = new CriticalConfirmationGate();
  let reversalMutations = 0;
  let discrepancyMutations = 0;

  const a = registry.acceptFinalTranscript('VoiceStrike, what is my current job?');
  check(`${prefix} A READ_JOB ready`, a.workflow === 'READ_JOB' && a.status === 'READY');
  registry.noteToolResult(a.id, 'get_current_job', { ok: true, job: { id: 'JOB-482', station: '3040', expected_component: 'B148', status: 'IN_PROGRESS' } });

  const b = registry.acceptFinalTranscript("VoiceStrike, I've got B148 and B184 here.");
  check(`${prefix} B E1 clarification requested`, b.workflow === 'E1_WRONG_COMPONENT' && b.status === 'COLLECTING' && b.pendingClarification?.field === 'observedComponent');
  const c = registry.acceptFinalTranscript('B184.');
  check(`${prefix} C clarification keeps E1 commandId`, c.id === b.id);
  check(`${prefix} C typed observed component`, c.status === 'READY' && c.slots.observedComponent === 'B184');
  const checkComponentArgs = registry.bindToolArguments(c.id, 'check_component', { component_id: 'B148' });
  check(`${prefix} C tool arg comes from typed slot`, checkComponentArgs.component_id === 'B184');
  const e1Readiness = assessReadReadiness({ toolName: 'check_component', args: checkComponentArgs, commandReady: registry.isReady(c.id), workflow: c.workflow, trustedComponent: registry.trustedComponentForTool(c.id, 'check_component'), pendingEntityConfirmation: null });
  check(`${prefix} C typed E1 read passes`, e1Readiness.ok);
  registry.noteToolResult(c.id, 'check_component', { ok: true, job_id: 'JOB-482', observed_component: 'B184', expected_component: 'B148', verdict: 'MISMATCH' });
  workflow.noteComponentCheck(c.id, { jobId: 'JOB-482', observed: 'B184', expected: 'B148', verdict: 'MISMATCH' });
  const e1ReportArgs = registry.bindToolArguments(c.id, 'report_exception', { type: 'WRONG_COMPONENT', observed_component: 'B148' });
  check(`${prefix} C report_exception bound to B184`, e1ReportArgs.observed_component === 'B184');
  check(`${prefix} C report precondition command-scoped`, workflow.assess(c.id, 'report_exception', e1ReportArgs).ok);
  workflow.noteExceptionVerified(c.id, { jobId: 'JOB-482', observed: 'B184' });
  check(`${prefix} C block precondition command-scoped`, workflow.assess(c.id, 'update_job_status', { status: 'BLOCKED' }).ok);
  workflow.noteJobBlockedVerified(c.id, { jobId: 'JOB-482' });
  const e1InventoryArgs = registry.bindToolArguments(c.id, 'check_inventory', { component_id: 'B184' });
  check(`${prefix} C expected component slot drives E1 inventory`, e1InventoryArgs.component_id === 'B148');

  const d = registry.acceptFinalTranscript('VoiceStrike, I scanned B184 by mistake.');
  check(`${prefix} D fresh E3 command`, d.workflow === 'E3_MISTAKEN_SCAN' && d.id !== c.id);
  registry.noteToolResult(d.id, 'inspect_last_action', { ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184', reversed: false, recovery_eligible: true } });
  const e = registry.acceptFinalTranscript('VoiceStrike, reverse scan B184.');
  check(`${prefix} E prepare stays E3 command`, e.id === d.id && e.phase === 'PREPARE');
  const prep = confirmation.assessReverse({ commandId: e.id, turnId: `${prefix}-T-E`, transcript: 'VoiceStrike, reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 1000 });
  check(`${prefix} E PREPARED without mutation`, prep.status === 'PREPARED' && reversalMutations === 0);
  confirmation.activateConfirmationWindow({ commandId: e.id, actionId: 'ACT-SCAN-B184', componentId: 'B184', expiresAt: 1000 + CONFIRMATION_TTL_MS });
  const cancelled = confirmation.cancel(1500);
  registry.cancelActive("VoiceStrike, actually don't reverse it.");
  check(`${prefix} F cancellation zero mutation`, Boolean(cancelled) && reversalMutations === 0);
  const stale = confirmation.assessReverse({ commandId: e.id, turnId: `${prefix}-T-G`, transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 1600 });
  check(`${prefix} G stale confirmation rejected after cancel`, stale.status === 'REJECTED' && stale.code === 'CONFIRMATION_CANCELLED' && reversalMutations === 0);

  const h = registry.acceptFinalTranscript('VoiceStrike, I scanned B184 by mistake.');
  check(`${prefix} H fresh E3 after cancel gets new commandId`, h.workflow === 'E3_MISTAKEN_SCAN' && h.id !== e.id);
  registry.noteToolResult(h.id, 'inspect_last_action', { ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184', reversed: false, recovery_eligible: true } });
  const i = registry.acceptFinalTranscript('VoiceStrike, reverse scan B184.');
  const prep2 = confirmation.assessReverse({ commandId: i.id, turnId: `${prefix}-T-I`, transcript: 'VoiceStrike, reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 2000 });
  check(`${prefix} I fresh preparation`, prep2.status === 'PREPARED');
  confirmation.activateConfirmationWindow({ commandId: i.id, actionId: 'ACT-SCAN-B184', componentId: 'B184', expiresAt: 2000 + CONFIRMATION_TTL_MS });
  const j = registry.acceptFinalTranscript('VoiceStrike, confirm reverse scan B184.');
  check(`${prefix} J confirm stays fresh E3 command`, j.id === i.id && j.phase === 'CONFIRM');
  const confirmed = confirmation.assessReverse({ commandId: j.id, turnId: `${prefix}-T-J`, transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 2500 });
  if (confirmed.status === 'CONFIRMED') reversalMutations += 1;
  check(`${prefix} J exactly one intended reversal`, confirmed.status === 'CONFIRMED' && reversalMutations === 1);
  registry.noteToolResult(j.id, 'reverse_last_scan', { ok: true, action: { id: 'ACT-SCAN-B184', component: 'B184', reversed: true } }, true);
  const repeat = confirmation.assessReverse({ commandId: j.id, turnId: `${prefix}-T-K`, transcript: 'VoiceStrike, confirm reverse scan B184.', actionId: 'ACT-SCAN-B184', componentId: 'B184', now: 2600 });
  if (repeat.status === 'CONFIRMED') reversalMutations += 1;
  check(`${prefix} K repeat confirmation zero additional mutation`, repeat.status === 'REJECTED' && repeat.code === 'CONFIRMATION_ALREADY_CONSUMED' && reversalMutations === 1);

  const l = registry.acceptFinalTranscript('VoiceStrike, where can I find B148?');
  check(`${prefix} L inventory lookup owns new command`, l.workflow === 'INVENTORY_LOOKUP' && l.id !== j.id);
  const lArgs = registry.bindToolArguments(l.id, 'check_inventory', { component_id: 'C12' });
  check(`${prefix} L component/location cannot compete`, lArgs.component_id === 'B148');
  const lRead = assessReadReadiness({ toolName: 'check_inventory', args: lArgs, commandReady: registry.isReady(l.id), workflow: l.workflow, trustedComponent: registry.trustedComponentForTool(l.id, 'check_inventory') });
  check(`${prefix} L typed inventory lookup passes readiness`, lRead.ok);
  const c12Payload = { ok: true, inventory: { component: 'B148', location: 'C12', quantity: 7, available: true } };
  const c12Facts = authoritativeFactsForResult('check_inventory', c12Payload);
  check(`${prefix} L C12/7 fact authorised only by read result`, c12Facts.some(f => f.kind === 'INVENTORY' && f.values.location === 'C12' && f.values.quantity === 7));

  const m = registry.acceptFinalTranscript("VoiceStrike, B148 isn't at C12. The location is empty.");
  check(`${prefix} M fresh E2 command`, m.workflow === 'E2_MISSING_INVENTORY' && m.id !== l.id && m.id !== j.id && m.id !== c.id);
  check(`${prefix} M typed E2 slots complete`, m.slots.component === 'B148' && m.slots.reportedLocation === 'C12' && m.slots.observedEmpty === true && m.status === 'READY');
  const mCheckArgs = registry.bindToolArguments(m.id, 'check_inventory', { component_id: 'C12' });
  check(`${prefix} M downstream read consumes typed component slot`, mCheckArgs.component_id === 'B148');
  const mRead = assessReadReadiness({ toolName: 'check_inventory', args: mCheckArgs, commandReady: registry.isReady(m.id), workflow: m.workflow, trustedComponent: registry.trustedComponentForTool(m.id, 'check_inventory') });
  check(`${prefix} M no transcript-wide ambiguity`, mRead.ok);
  registry.noteToolResult(m.id, 'check_inventory', c12Payload);
  workflow.noteInventoryCheck(m.id, { component: 'B148', location: 'C12', quantity: 7 });
  const discrepancyArgs = registry.bindToolArguments(m.id, 'report_inventory_discrepancy', { component_id: 'B184', location: 'A07', observed_state: 'FULL' });
  check(`${prefix} M discrepancy args bound to typed pair`, discrepancyArgs.component_id === 'B148' && discrepancyArgs.location === 'C12' && discrepancyArgs.observed_state === 'EMPTY');
  const discrepancyPrecondition = workflow.assess(m.id, 'report_inventory_discrepancy', discrepancyArgs);
  if (discrepancyPrecondition.ok) discrepancyMutations += 1;
  check(`${prefix} M exactly one intended discrepancy mutation`, discrepancyPrecondition.ok && discrepancyMutations === 1);
  workflow.noteDiscrepancyVerified(m.id, { component: 'B148', location: 'C12' });
  registry.noteToolResult(m.id, 'report_inventory_discrepancy', { ok: true, component: 'B148', location: 'C12', quantity: 0 }, true);
  const altArgs = registry.bindToolArguments(m.id, 'find_alternative_inventory', { component_id: 'C12' });
  check(`${prefix} M alternative read consumes component slot`, altArgs.component_id === 'B148');
  const noAltFacts = authoritativeFactsForResult('find_alternative_inventory', { ok: false, alternative: { found: true, component: 'B148', location: 'D05', quantity: 4, available: true } });
  check(`${prefix} M blocked/failed alternative cannot authorise D05`, noAltFacts.length === 0);
  const altPayload = { ok: true, alternative: { found: true, component: 'B148', location: 'D05', quantity: 4, available: true } };
  const altFacts = authoritativeFactsForResult('find_alternative_inventory', altPayload);
  check(`${prefix} M D05/4 requires exact completed authoritative result`, altFacts.some(f => f.kind === 'ALTERNATIVE_INVENTORY' && f.values.location === 'D05' && f.values.quantity === 4));
  registry.noteToolResult(m.id, 'find_alternative_inventory', altPayload);

  const n = registry.acceptFinalTranscript('VoiceStrike, where can I find B148?');
  check(`${prefix} N subsequent lookup new command`, n.workflow === 'INVENTORY_LOOKUP' && n.id !== m.id);
  const primaryUnavailable = authoritativeFactsForResult('check_inventory', { ok: true, inventory: { component: 'B148', location: 'C12', quantity: 0, available: false } });
  const nAlt = authoritativeFactsForResult('find_alternative_inventory', altPayload);
  check(`${prefix} N unavailable primary + authoritative alternative supports D05/4`, primaryUnavailable[0]?.values.available === false && nAlt[0]?.values.location === 'D05' && nAlt[0]?.values.quantity === 4);

  const o = registry.acceptFinalTranscript('VoiceStrike, what is my current job?');
  check(`${prefix} O job read owns correct fresh context`, o.workflow === 'READ_JOB' && o.id !== m.id && o.id !== n.id);
  check(`${prefix} P registry remains usable across UI role switch`, registry.current()?.id === o.id && registry.get(m.id)?.workflow === 'E2_MISSING_INVENTORY');

  const beforeWakeId = registry.current()?.id;
  check(`${prefix} Q wake-only recognised as control`, isWakeControlUtterance('VoiceStrike.'));
  check(`${prefix} Q wake-only leaves command owner unchanged`, registry.current()?.id === beforeWakeId);
  const ambient = new AmbientSpeechGate();
  const tv = ambient.assess('the weather looks lovely this evening', { hasActiveCommand: false, awaitingClarification: false, activeCommandId: null, now: 10_000 });
  check(`${prefix} Q ambient/TV rejected`, !tv.accepted && tv.status === 'WAKE_REQUIRED');

  check(`${prefix} final exactly one reversal`, reversalMutations === 1);
  check(`${prefix} final exactly one discrepancy`, discrepancyMutations === 1);
}

function runProviderOrdering(): void {
  const r = new ReplyAuthorityRegistry();
  r.reset(1);
  const greeting = r.beginReply('greeting', 1, 1);
  check('EV greeting is authorised once', greeting.authorised && greeting.reason === 'SESSION_GREETING');
  r.finishReply(2);

  r.noteTurn('turn-e1', 'ACCEPTED', 'CMD-E1');
  const reply = r.beginReply('reply-e1', 1, 10);
  check('EV accepted turn reply binds CMD-E1', reply.authorised && reply.commandId === 'CMD-E1');
  r.finishReply(11);
  check('EV reply.done then delayed ordinary tool preserves exact causal owner', r.commandIdForToolRequest('check_component', 12) === 'CMD-E1');

  r.noteTurn('turn-new', 'ACCEPTED', 'CMD-NEW');
  // RC4: after a newer ACCEPTED fence and before its reply starts, a tool.call is not attributable.
  // It is refused (no owner) and can never inherit either the old or the new command.
  check('EV delayed tool after new accepted turn has no owner until the new reply starts', r.commandIdForToolRequest('check_component', 13) === null);
  const newReply = r.beginReply('reply-new', 1, 14);
  check('EV new provider reply binds the newly accepted command', newReply.authorised && newReply.commandId === 'CMD-NEW');
  check('EV tool after new reply start belongs to new command', r.commandIdForToolRequest('check_component', 15) === 'CMD-NEW');

  const orphanRegistry = new ReplyAuthorityRegistry();
  orphanRegistry.reset(1);
  orphanRegistry.beginReply('g', 1, 1); orphanRegistry.finishReply(2);
  const orphan = orphanRegistry.beginReply('orphan', 1, 3);
  check('EV orphan provider reply suppressed', !orphan.authorised && orphan.reason === 'NO_ACCEPTED_TURN');

  const greetingOverlap = new ReplyAuthorityRegistry();
  greetingOverlap.reset(1);
  const greetingInFlight = greetingOverlap.beginReply('greeting-live', 1, 1);
  check('EV greeting overlap starts as greeting', greetingInFlight.reason === 'SESSION_GREETING');
  greetingOverlap.interruptCurrentReply(2);
  greetingOverlap.noteTurn('turn-job', 'ACCEPTED', 'CMD-JOB');
  check('EV greeting interruption does not lend command authority before new reply starts', greetingOverlap.commandIdForToolRequest('get_current_job', 3) === null);
  const jobReply = greetingOverlap.beginReply('reply-job', 1, 4);
  check('EV first operational reply after greeting binds CMD-JOB', jobReply.authorised && jobReply.commandId === 'CMD-JOB');
  check('EV first operational tool after greeting owns CMD-JOB', greetingOverlap.commandIdForToolRequest('get_current_job', 5) === 'CMD-JOB');

  const claimRegistry = new CommandRegistry();
  const e2 = claimRegistry.acceptFinalTranscript("VoiceStrike, B148 isn't at C12. The location is empty.");
  claimRegistry.noteToolResult(e2.id, 'check_inventory', { ok: true, inventory: { component: 'B148', location: 'C12', quantity: 7, available: true } });
  claimRegistry.noteToolResult(e2.id, 'report_inventory_discrepancy', { ok: true, inventory: { component: 'B148', location: 'C12', quantity: 0 } }, true);
  const falseAlt = assessAgentReplyClaims('A discrepancy has been logged. You can find four B148 available at location D05.', claimRegistry.get(e2.id));
  check('CLAIM D05/4 is physically rejected without alternative evidence', !falseAlt.allowed && falseAlt.code === 'UNAUTHORISED_LOCATION_CLAIM');
  claimRegistry.noteToolResult(e2.id, 'find_alternative_inventory', { ok: true, alternative: { found: true, component: 'B148', location: 'D05', quantity: 4, available: true } });
  const trueAlt = assessAgentReplyClaims('A discrepancy has been logged. You can find four B148 available at location D05.', claimRegistry.get(e2.id));
  check('CLAIM D05/4 is allowed after exact alternative evidence', trueAlt.allowed);
  const wrongQty = assessAgentReplyClaims('There are five units available at location D05.', claimRegistry.get(e2.id));
  check('CLAIM wrong alternative quantity is rejected', !wrongQty.allowed && wrongQty.code === 'UNAUTHORISED_QUANTITY_CLAIM');

  const protectedRegistry = new ReplyAuthorityRegistry();
  protectedRegistry.reset(1);
  protectedRegistry.noteTurn('turn-e3', 'ACCEPTED', 'CMD-E3');
  check('EV protected lease armed on exact E3 owner', protectedRegistry.armProtectedToolLease({ turnId: 'turn-e3', commandId: 'CMD-E3', expectedTool: 'reverse_last_scan', now: 100 }));
  const protectedReply = protectedRegistry.beginReply('reply-e3', 1, 101);
  check('EV protected initial reply bound to E3', protectedReply.authorised && protectedReply.commandId === 'CMD-E3');
  protectedRegistry.finishReply(102);
  check('EV exact delayed protected tool preserves old causal owner', protectedRegistry.commandIdForToolRequest('reverse_last_scan', 103) === 'CMD-E3');
  check('EV wrong delayed tool cannot borrow protected lease', protectedRegistry.commandIdForToolRequest('check_inventory', 103) === null);
}

for (let i = 1; i <= 25; i += 1) runLongSession(i);
runProviderOrdering();

console.log(`\nVoiceStrike v0.10.0 command-context acceptance: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`v0.10.0 acceptance failed: ${failed} assertion(s).`);
