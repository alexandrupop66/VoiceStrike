/**
 * VS-001 regression — verified E3 reversal must not be narrated or played as failure.
 *
 * Reproduces the 22/09/2026 live ordering:
 * fresh E3 -> PREPARE -> CONFIRM -> code-owned mutation/verify + provider reverse_last_scan join
 * -> VERIFIED_SUCCESS -> provider attempts "I could not complete the reversal".
 *
 * This is intentionally an end-to-end VoiceAgentClient harness. It asserts mutation count,
 * authoritative outcome, transcript truth, and audio release.
 */
import { VoiceAgentClient } from '../.test-dist/voice/voiceAgent.js';

const telemetry = [];
let reversed = false;
let reverseMutations = 0;
let callSeq = 0;
const action = () => ({
  id: 'ACT-SCAN-B184',
  job_id: 'JOB-482',
  type: 'SCAN_COMPONENT',
  component: 'B184',
  reversible: true,
  reversed,
  recovery_eligible: !reversed,
  status: reversed ? 'REVERSED' : 'ACTIVE',
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

globalThis.WebSocket = { OPEN: 1 };
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === '/api/reliability/telemetry') {
    try { telemetry.push(JSON.parse(String(init.body ?? '{}'))); } catch { /* evidence only */ }
    return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } });
  }
  if (url === '/api/tools/inspect-last-action') {
    return new Response(JSON.stringify({ ok: true, source: 'vs001_fixture', action: action() }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url === '/api/tools/reverse-last-scan') {
    reverseMutations += 1;
    await sleep(120);
    reversed = true;
    return new Response(JSON.stringify({
      ok: true,
      source: 'vs001_fixture',
      changed: true,
      action: action(),
      reversal_executed: true,
      verified: false,
      verification_required: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url === '/api/recovery-authority') {
    return new Response(JSON.stringify({ ok: false, error: 'NO_RECENT_COMMAND_BOUND_INSPECTION' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`Unexpected fetch ${url}`);
};

class Session {
  sent = [];
  transcripts = [];
  tools = [];
  agent = new VoiceAgentClient({
    onStatus: () => undefined,
    onTranscript: (entry) => { if (entry.final) this.transcripts.push({ role: entry.role, text: entry.text }); },
    onToolEvent: (entry) => this.tools.push(entry),
    onError: (error) => console.error('agent-error', error),
  });

  constructor() {
    this.agent.ws = {
      readyState: 1,
      send: (raw) => this.sent.push(JSON.parse(raw)),
    };
  }

  emit(event) {
    this.agent.enqueueProviderEvent({ data: JSON.stringify(event) });
  }

  async settle(ms = 45) {
    for (let i = 0; i < 8; i += 1) {
      await this.agent.eventQueue;
      await sleep(ms);
    }
  }

  say(text, id) {
    this.emit({ type: 'input.speech.started' });
    this.emit({ type: 'input.speech.stopped' });
    this.emit({ type: 'transcript.user', text, item_id: id });
  }

  reply(opts = {}) {
    this.emit({ type: 'reply.started' });
    if (opts.text) {
      this.emit({ type: 'reply.audio', data: Buffer.from(new Int16Array(240).fill(1000).buffer).toString('base64') });
      this.emit({ type: 'transcript.agent', text: opts.text });
    }
    for (const tool of opts.tools ?? []) this.emit({ type: 'tool.call', call_id: tool.callId, name: tool.name, arguments: tool.args ?? {} });
    this.emit({ type: 'reply.done', status: 'completed' });
  }

  call() { callSeq += 1; return `call-${callSeq}`; }

  results(id) {
    return this.sent
      .filter((entry) => entry.type === 'tool.result' && entry.call_id === id)
      .map((entry) => JSON.parse(String(entry.result)));
  }

  audible() { return this.agent.audibleSamplesPlayed; }
}

const s = new Session();
s.emit({ type: 'session.ready', session_id: 'sess-VS001' });
s.reply({ text: 'VoiceStrike is connected. Say VoiceStrike to begin.' });
await s.settle();

// Fresh E3 inspection.
s.say('VoiceStrike, I scanned B184 by mistake.', 'u-inspect');
const inspectCall = s.call();
s.reply({ tools: [{ callId: inspectCall, name: 'inspect_last_action' }] });
await s.settle();
s.reply({ text: 'I see that B184 was scanned. To reverse this, please say: VoiceStrike, reverse scan B184.' });
await s.settle();

// PREPARE; provider may emit reverse_last_scan and must join the code-owned action.
await sleep(700);
s.say('VoiceStrike, reverse scan B184.', 'u-prepare');
const prepCall = s.call();
s.reply({ tools: [{ callId: prepCall, name: 'reverse_last_scan', args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' } }] });
await s.settle();
const prepResult = s.results(prepCall)[0];
s.reply({ text: 'The reversal is prepared. To complete it, please say: VoiceStrike, confirm reverse scan B184.' });
await s.settle();

// CONFIRM; provider emits the same false failure narration seen live while also joining the
// code-owned reverse_last_scan execution.
await sleep(700);
s.say('VoiceStrike, confirm reverse scan B184.', 'u-confirm');
const confirmCall = s.call();
const audibleBefore = s.audible();
s.reply({
  text: 'I apologize, but I could not complete the reversal.',
  tools: [{ callId: confirmCall, name: 'reverse_last_scan', args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' } }],
});
await s.settle(80);
await sleep(400);
await s.settle(80);
const confirmResult = s.results(confirmCall)[0];

// Provider continuation after it has received VERIFIED_SUCCESS: attempt the same contradiction.
s.reply({ text: 'I apologize, but I could not complete the reversal.' });
await s.settle();

const failureNarrations = s.transcripts.filter((entry) => entry.role === 'agent' && /could not complete the reversal/i.test(entry.text));
const rejectedFailureClaims = telemetry.filter((entry) => entry.event === 'reliability.reply_claim_rejected' && /could not complete the reversal/i.test(String(entry.detail ?? '')));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  got=${JSON.stringify(detail)}`}`);
  if (!ok) failed += 1;
};

check('VS-001 fresh E3 PREPARE reaches SECOND_CONFIRMATION_REQUIRED', prepResult?.error === 'SECOND_CONFIRMATION_REQUIRED', prepResult);
check('VS-001 CONFIRM authoritative result is VERIFIED_SUCCESS', confirmResult?.verified === true && confirmResult?.reliability_outcome === 'VERIFIED_SUCCESS' && reversed === true, confirmResult);
check('VS-001 provider reverse_last_scan joins code-owned execution and total mutation count is exactly 1', reverseMutations === 1 && telemetry.some((entry) => entry.event === 'reliability.code_owned_action_joined' && entry.resultClass === 'CONFIRM'), { reverseMutations });
check('VS-001 false failure narration is rejected and never surfaced', failureNarrations.length === 0 && rejectedFailureClaims.length >= 1, { failureNarrations, rejectedFailureClaims: rejectedFailureClaims.length });
check('VS-001 false failure audio is not released', s.audible() - audibleBefore === 0, { audibleSamplesAdded: s.audible() - audibleBefore });

console.log(`\nVS-001 regression: ${5 - failed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`VS-001 reproduced: ${failed} speech-truth assertion(s) failed.`);
