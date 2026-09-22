import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CommandRegistry } from '../client/src/reliability/commands.js';
import { ReplyAuthorityRegistry } from '../client/src/reliability/replyAuthority.js';
import { assessAgentReplyClaims } from '../client/src/reliability/replyClaims.js';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}`); }
};

// Regression 1: the first operational turn may overlap the provider greeting, but the greeting
// can never own the worker's tool call.
const replies = new ReplyAuthorityRegistry();
replies.reset(1);
const greeting = replies.beginReply('greeting', 1, 1);
check('LIVE first greeting is greeting-only authority', greeting.authorised && greeting.reason === 'SESSION_GREETING');
replies.interruptCurrentReply(2);
replies.noteTurn('turn-job', 'ACCEPTED', 'CMD-JOB');
check('LIVE interrupted greeting gives no tool owner before new reply', replies.commandIdForToolRequest('get_current_job', 3) === null);
const firstOperationalReply = replies.beginReply('reply-job', 1, 4);
check('LIVE first operational reply binds first worker command', firstOperationalReply.commandId === 'CMD-JOB' && firstOperationalReply.authorised);
check('LIVE first job tool is owned by first worker command', replies.commandIdForToolRequest('get_current_job', 5) === 'CMD-JOB');


// Regression 1b: reply.done before an ordinary delayed tool.call must recreate the exact old
// causal turn so the tool.result gets one correctly bound continuation instead of becoming orphan.
const delayed = new ReplyAuthorityRegistry();
delayed.reset(1);
delayed.noteTurn('turn-e2', 'ACCEPTED', 'CMD-E2', 10);
const delayedReply = delayed.beginReply('reply-e2', 1, 11);
check('LIVE delayed-tool setup binds E2 reply', delayedReply.authorised && delayedReply.commandId === 'CMD-E2');
delayed.finishReply(12);
check('LIVE delayed ordinary tool is owned by the same lingering turn', delayed.commandIdForToolRequest('check_inventory', 13) === 'CMD-E2');
check('LIVE delayed ordinary tool reopens its own (not a newer) causal turn', delayed.noteToolRequest('CMD-E2', 'check_inventory', 13));
delayed.markPendingWork();
delayed.markToolResultSent();
const delayedContinuation = delayed.beginReply('reply-e2-result', 1, 14);
check('LIVE delayed tool result continuation returns to exact E2 command', delayedContinuation.authorised && delayedContinuation.reason === 'TOOL_CONTINUATION' && delayedContinuation.commandId === 'CMD-E2');

// Regression 1c: the protected E3 lease is more specific than any stale generic reply binding.
const protectedReplies = new ReplyAuthorityRegistry();
protectedReplies.reset(1);
protectedReplies.noteTurn('turn-old', 'ACCEPTED', 'CMD-OLD', 20);
protectedReplies.beginReply('reply-old', 1, 21);
protectedReplies.noteTurn('turn-e3', 'ACCEPTED', 'CMD-E3', 22);
protectedReplies.armProtectedToolLease({ turnId: 'turn-e3', commandId: 'CMD-E3', expectedTool: 'reverse_last_scan', now: 23 });
check('LIVE protected reverse tool lease outranks stale reply binding', protectedReplies.commandIdForToolRequest('reverse_last_scan', 24) === 'CMD-E3');

// Regression 2: exact failed E1 conversation from 20/09/2026.
const registry = new CommandRegistry();
const e1 = registry.acceptFinalTranscript("VoiceStrike, I've got B148 and B184 here.");
const e1Clarified = registry.acceptFinalTranscript('B184.');
check('LIVE E1 clarification stays in same command', e1.id === e1Clarified.id);
check('LIVE E1 clarification fills only observedComponent', e1Clarified.slots.observedComponent === 'B184' && e1Clarified.status === 'READY');
check('LIVE E1 check_component uses typed B184', registry.bindToolArguments(e1.id, 'check_component', {}).component_id === 'B184');

const api = read('server/src/routes/api.ts');
check('LIVE mutation guard no longer requires semantic keyword in transcript', api.includes('requireOperationalSignal: false'));
check('LIVE mutation guard requires typed workflow', api.includes("X-VoiceStrike-Workflow") && api.includes("WORKFLOW_MISMATCH"));
check('LIVE mutation guard requires command readiness', api.includes("X-VoiceStrike-Command-Ready") && api.includes("COMMAND_NOT_READY"));

// Regression 3: exact failed E2 report must be complete in one utterance.
const e2 = registry.acceptFinalTranscript("VoiceStrike, B148 isn't at C12. The location is empty.");
check('LIVE E2 exact sentence is READY without yes/no clarification', e2.workflow === 'E2_MISSING_INVENTORY' && e2.status === 'READY' && !e2.pendingClarification);
check('LIVE E2 slots are typed B148/C12/EMPTY', e2.slots.component === 'B148' && e2.slots.reportedLocation === 'C12' && e2.slots.observedEmpty === true);
check('LIVE E2 discrepancy args cannot be replaced by model text', (() => {
  const args = registry.bindToolArguments(e2.id, 'report_inventory_discrepancy', { component_id: 'B184', location: 'A07', observed_state: 'FULL' });
  return args.component_id === 'B148' && args.location === 'C12' && args.observed_state === 'EMPTY';
})());

const voice = read('client/src/voice/voiceAgent.ts');
check('LIVE E2 orchestration is code-owned after authoritative check', voice.includes('continueDeterministicE2(') && voice.includes("const mutationName: MutationToolName = 'report_inventory_discrepancy'") && voice.includes("const altName = 'find_alternative_inventory'"));
check('LIVE E2 alternative result is recorded before command completion', voice.indexOf('this.noteAuthoritativeRead(commandId, altName, altArgs, altPayload)') < voice.indexOf('this.commandRegistry.markComplete(commandId)', voice.indexOf('this.noteAuthoritativeRead(commandId, altName, altArgs, altPayload)')));

// Regression 4: the exact false D05/4 live claim must be impossible before authoritative evidence.
registry.noteToolResult(e2.id, 'check_inventory', { ok: true, inventory: { component: 'B148', location: 'C12', quantity: 7, available: true } });
registry.noteToolResult(e2.id, 'report_inventory_discrepancy', { ok: true, inventory: { component: 'B148', location: 'C12', quantity: 0 } }, true);
const unsafe = assessAgentReplyClaims('A discrepancy has been logged. You can find four B148 available at location D05.', registry.get(e2.id));
check('LIVE D05/4 claim is blocked without alternative read', !unsafe.allowed && unsafe.code === 'UNAUTHORISED_LOCATION_CLAIM');
registry.noteToolResult(e2.id, 'find_alternative_inventory', { ok: true, alternative: { found: true, component: 'B148', location: 'D05', quantity: 4, available: true } });
const safe = assessAgentReplyClaims('A discrepancy has been logged. You can find four B148 available at location D05.', registry.get(e2.id));
check('LIVE D05/4 claim is allowed only after exact alternative evidence', safe.allowed);
// RC5: operational PCM is still held before claim validation, but per validated sentence
// (transcript.agent.delta) instead of until the whole reply ends; no timing => full buffer.
check('LIVE operational PCM is gated before deterministic claim validation', voice.includes("? 'BUFFER'") && voice.includes('assessAgentReplyClaims(text, command)') && voice.includes('assessAgentReplyClaims(this.gatedDeltaText, command)') && voice.includes('this.releaseGatedAudio();'));
check('LIVE rejected claim PCM is dropped rather than spoken', voice.includes("this.replyClaimMode = 'BLOCK'") && voice.includes('this.gatedAudio = [];') && voice.includes('Unsafe operational claim suppressed'));

// RC4: AssemblyAI documents `interactive` as the default for sub-5 s lookups; under `hold` user
// speech does not trigger replies while a tool is in flight. Ordering races are now handled by the
// serialized pipeline and the reply-causality ledger, not by suppressing transition replies.
check('LIVE operational tools use documented interactive execution mode', (voice.match(/execution_mode: 'interactive'/g) ?? []).length === 9 && !voice.includes("execution_mode: 'hold'"));
check('LIVE worker VAD threshold no longer uses over-conservative 0.6', voice.includes('vad_threshold: 0.45') && !voice.includes('vad_threshold: 0.6'));


console.log(`\nVoiceStrike live-session regression: ${passed} passed, ${failed} failed.`);
if (failed) throw new Error(`Live regression failed: ${failed} assertion(s).`);
