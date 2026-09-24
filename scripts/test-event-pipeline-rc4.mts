/**
 * VoiceStrike v0.10.0 RC4 — event-pipeline harness.
 *
 * Drives the REAL VoiceAgentClient event handler (serialized queue, reply-causality ledger,
 * tool admission/commit, result handoff, protected windows, claim gate) against the REAL Express
 * API + SQLite on an isolated database. Only the provider WebSocket and speakers are simulated.
 * Provider event orderings follow AssemblyAI's documented flow plus the RC3 live orderings.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tempDir = mkdtempSync(path.join(tmpdir(), 'voicestrike-rc4-'));
process.env.VOICESTRIKE_DB_PATH = path.join(tempDir, 'voicestrike-test.db');

const { default: express } = await import('express');
const { initDatabase, db } = await import('../server/src/db/database.js');
const { apiRouter } = await import('../server/src/routes/api.js');
initDatabase();
const app = express();
app.use(express.json());
app.use('/api', apiRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// ---- browser shims (network goes to the real API; telemetry is captured locally) ----
type Telemetry = Record<string, unknown> & { event: string };
const telemetry: Telemetry[] = [];
const realFetch = globalThis.fetch;
let endpointDelayMs = 0;
const endpointCalls: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('/api/reliability/telemetry')) {
    telemetry.push(JSON.parse(String(init?.body ?? '{}')) as Telemetry);
    return new Response('{}', { status: 202 });
  }
  if (url.startsWith('/api/tools/')) {
    endpointCalls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
    if (endpointDelayMs) await new Promise((r) => setTimeout(r, endpointDelayMs));
  }
  return realFetch(url.startsWith('/') ? `${base}${url}` : url, init);
}) as typeof fetch;
(globalThis as Record<string, unknown>).WebSocket = { OPEN: 1 };

const { VoiceAgentClient } = await import('../client/src/voice/voiceAgent.js');
// RC5: any exception inside the provider event pipeline is a test failure, not log noise.
const handlerErrors: string[] = [];
const realConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (String(args[0] ?? '').startsWith('[VoiceStrike]')) handlerErrors.push(args.map(String).join(' '));
  realConsoleError(...args);
};

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}${detail === undefined ? '' : `  → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sent = { type: string; call_id?: string; result?: string };
type AgentText = { role: string; text: string };

class Session {
  readonly agent: InstanceType<typeof VoiceAgentClient>;
  readonly sent: Sent[] = [];
  readonly transcripts: AgentText[] = [];
  readonly toolEvents: Array<{ name: string; status: string; detail?: string }> = [];
  private seq = 0;
  constructor() {
    this.agent = new VoiceAgentClient({
      onStatus: () => undefined,
      onTranscript: (entry) => { if (entry.final) this.transcripts.push({ role: entry.role, text: entry.text }); },
      onToolEvent: (entry) => this.toolEvents.push({ name: entry.name, status: entry.status, detail: entry.detail }),
      onError: () => undefined,
    });
    const internals = this.agent as unknown as Record<string, unknown>;
    internals.ws = { readyState: 1, send: (raw: string) => this.sent.push(JSON.parse(raw) as Sent) };
  }
  emit(event: Record<string, unknown>): void {
    const agent = this.agent as unknown as { enqueueProviderEvent?(e: { data: string }): void; handleMessage(e: { data: string }): Promise<void> };
    // RC4 pipeline; the fallback reproduces the pre-RC4 unserialized dispatch for baseline comparison.
    if (agent.enqueueProviderEvent) agent.enqueueProviderEvent({ data: JSON.stringify(event) });
    else void agent.handleMessage({ data: JSON.stringify(event) });
  }
  async settle(ms = 60): Promise<void> {
    for (let i = 0; i < 6; i += 1) {
      await (this.agent as unknown as { eventQueue?: Promise<void> }).eventQueue;
      await sleep(ms);
    }
  }
  private static globalSeq = 0;
  callId(): string { Session.globalSeq += 1; this.seq += 1; return `call-${Session.globalSeq}`; }
  resultsFor(callId: string): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type === 'tool.result' && m.call_id === callId).map((m) => JSON.parse(String(m.result)) as Record<string, unknown>);
  }
  /** Worker speech: onset, final transcript. */
  say(text: string, item: string): void {
    this.emit({ type: 'input.speech.started' });
    this.emit({ type: 'input.speech.stopped' });
    this.emit({ type: 'transcript.user', text, item_id: item });
  }
  /** One provider reply: optional spoken text, optional tool calls, reply.done. */
  reply(opts: { text?: string; tools?: Array<{ callId: string; name: string; args?: Record<string, unknown> }>; status?: string; onsetMidReply?: string; itemId?: string; replyId?: string } = {}): void {
    this.emit({ type: 'reply.started', item_id: opts.itemId, reply_id: opts.replyId });
    if (opts.text) {
      this.emit({ type: 'reply.audio', data: Buffer.from(new Int16Array(240).buffer).toString('base64') });
      if (opts.onsetMidReply) {
        this.emit({ type: 'input.speech.started' });
        this.emit({ type: 'transcript.user', text: opts.onsetMidReply, item_id: `tv-${Math.random()}` });
      }
      this.emit({ type: 'transcript.agent', text: opts.text });
    }
    for (const tool of opts.tools ?? []) this.emit({ type: 'tool.call', call_id: tool.callId, name: tool.name, arguments: tool.args ?? {} });
    this.emit({ type: 'reply.done', status: opts.status ?? 'completed', reply_id: opts.replyId });
  }
  audible(): number { return (this.agent as unknown as { audibleSamplesPlayed: number }).audibleSamplesPlayed; }
  sentOfType(type: string): Sent[] { return this.sent.filter((m) => m.type === type); }
}

const pcm = (samples: number) => Buffer.from(new Int16Array(samples).fill(1000).buffer).toString('base64');

async function resetDemo(): Promise<void> {
  await realFetch(`${base}/api/demo/reset`, { method: 'POST' });
}
async function actionState(): Promise<{ reversed: boolean }> {
  const res = await realFetch(`${base}/api/tools/inspect-last-action`);
  const payload = await res.json() as Record<string, unknown>;
  const action = (payload.action ?? {}) as Record<string, unknown>;
  return { reversed: Boolean(action.reversed) || String(action.status ?? '').toUpperCase() === 'REVERSED' };
}
const reverseMutations = () => endpointCalls.filter((c) => c.startsWith('POST /api/tools/reverse-last-scan')).length;
const since = (mark: number, event: string) => telemetry.slice(mark).filter((t) => t.event === event);

async function freshSession(): Promise<Session> {
  await resetDemo();
  endpointCalls.length = 0;
  const s = new Session();
  s.emit({ type: 'session.ready', session_id: `S-${Date.now()}-${Math.random()}` });
  s.reply({ text: 'VoiceStrike is connected. Say VoiceStrike to begin.' });
  await s.settle();
  return s;
}

/** INSPECT: returns after the instruction prompt reply has completed. */
async function inspect(s: Session, opts: { tvDuringPrompt?: boolean } = {}): Promise<string> {
  s.say('VoiceStrike, I scanned B184 by mistake.', `u-inspect-${Math.random()}`);
  const call = s.callId();
  s.reply({ text: 'Let me check the last scan.', tools: [{ callId: call, name: 'inspect_last_action' }] });
  await s.settle();
  s.reply({
    text: 'I see B184 was scanned. To reverse this, please say: VoiceStrike, reverse scan B184.',
    onsetMidReply: opts.tvDuringPrompt ? 'and after the break the weather in the north' : undefined,
  });
  await s.settle();
  return call;
}
async function prepare(s: Session): Promise<string> {
  await sleep(700); // natural pause after the audible prompt (> 550 ms protected quiet gap)
  s.say('VoiceStrike, reverse scan B184.', `u-prepare-${Math.random()}`);
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'reverse_last_scan', args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' } }] });
  await s.settle();
  s.reply({ text: 'To complete the reversal, please say: VoiceStrike, confirm reverse scan B184.' });
  await s.settle();
  return call;
}
async function confirm(s: Session): Promise<string> {
  await sleep(700);
  s.say('VoiceStrike, confirm reverse scan B184.', `u-confirm-${Math.random()}`);
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'reverse_last_scan', args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' } }] });
  await s.settle(120);
  s.reply({ text: 'The reversal of B184 has been verified.' });
  await s.settle();
  return call;
}
const outcomeOf = (s: Session, call: string) => {
  const r = s.resultsFor(call)[0] ?? {};
  return String(r.reliability_outcome ?? r.confirmation_status ?? r.status ?? r.error ?? (r.ok === true ? 'OK' : 'NONE'));
};

// ---------------------------------------------------------------------------------------------
// P1 — E3 full cycle with TV speech onset during EVERY protected prompt (RC3 L1/L2 live defect).
{
  const s = await freshSession();
  await inspect(s, { tvDuringPrompt: true });
  const mark = telemetry.length;
  const prep = await prepare(s);
  check('P1 PREPARE window opened although TV speech began during the instruction prompt', since(0, 'reliability.protected_speech_window_opened').length >= 1);
  check('P1 legit PREPARE speech is accepted (no protected-window rejection)', since(mark, 'reliability.protected_speech_window_rejected').length === 0, since(mark, 'reliability.protected_speech_window_rejected').map((t) => t.detail));
  const prepResult = s.resultsFor(prep)[0] ?? {};
  check('P1 PREPARE tool.call is authorised and reaches PREPARED (SECOND_CONFIRMATION_REQUIRED), mutation 0', reverseMutations() === 0 && prepResult.error === 'SECOND_CONFIRMATION_REQUIRED' && prepResult.mutation_attempted === false, prepResult);
  const conf = await confirm(s);
  check('P1 CONFIRM executes exactly one reversal', reverseMutations() === 1, endpointCalls);
  check('P1 CONFIRM result is VERIFIED_SUCCESS', outcomeOf(s, conf) === 'VERIFIED_SUCCESS' || JSON.stringify(s.resultsFor(conf)[0] ?? {}).includes('VERIFIED_SUCCESS'), s.resultsFor(conf)[0]);
  check('P1 authoritative state is REVERSED', (await actionState()).reversed);
  check('P1 no CRITICAL_SPEECH_NOT_TRUSTED / COMMAND_MISMATCH on legitimate turns',
    !telemetry.slice(mark).some((t) => t.event === 'reliability.tool_authorisation_checked' && /CRITICAL_SPEECH_NOT_TRUSTED|COMMAND_MISMATCH/.test(String(t.resultClass))));
}

// P2 — provider answers a locally REJECTED protected transcript (early start inside the quiet gap).
{
  const s = await freshSession();
  await inspect(s);
  const mark = telemetry.length;
  // Worker starts immediately (inside the 550 ms quiet gap): rejected locally.
  s.say('VoiceStrike, reverse scan B184.', 'u-early');
  const orphanCall = s.callId();
  s.reply({ text: 'I see B184 was scanned. To reverse this, please say: VoiceStrike, reverse scan B184.', tools: [{ callId: orphanCall, name: 'reverse_last_scan', args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' } }] });
  await s.settle();
  check('P2 early protected speech is rejected locally (duplex tail or protected quiet gap)', since(mark, 'reliability.ambient_turn_rejected').length === 1, since(mark, 'reliability.ambient_turn_rejected').map((t) => t.detail));
  check('P2 provider reply to the rejected transcript is an inaudible orphan', since(mark, 'reliability.orphan_reply_suppressed').length === 1 && since(mark, 'reliability.reply_bound_to_turn').length === 0);
  const orphanAuth = since(mark, 'reliability.tool_authorisation_checked').find((t) => String(t.detail).includes(`call=${orphanCall}`));
  check('P2 its reverse_last_scan has NO owner (not the inspect command) and never reaches an endpoint', String(orphanAuth?.detail ?? '').includes('causal_owner=NONE') && reverseMutations() === 0, orphanAuth?.detail);
  // Worker repeats after the pause: the window is still open and unconsumed.
  const prep = await prepare(s);
  check('P2 repeated PREPARE after the pause is accepted and reaches PREPARED', (s.resultsFor(prep)[0] ?? {}).error === 'SECOND_CONFIRMATION_REQUIRED', s.resultsFor(prep)[0]);
  const conf = await confirm(s);
  check('P2 exactly one reversal after the recovered sequence', reverseMutations() === 1 && (await actionState()).reversed, s.resultsFor(conf)[0]);
}

// P3 — tool still running when reply.done arrives (E3 inspect with slow endpoint; RC3 L3).
{
  const s = await freshSession();
  endpointDelayMs = 400;
  s.say('VoiceStrike, I scanned B184 by mistake.', 'u-slow');
  const call = s.callId();
  s.reply({ text: 'Let me check.', tools: [{ callId: call, name: 'inspect_last_action' }] }); // reply.done precedes tool completion
  await s.settle(150);
  endpointDelayMs = 0;
  check('P3 tool.result is handed over after the in-flight tool completes', s.resultsFor(call).length === 1);
  const mark = telemetry.length;
  s.reply({ text: 'I see B184 was scanned. To reverse this, please say: VoiceStrike, reverse scan B184.' });
  await s.settle();
  const bound = since(mark, 'reliability.reply_bound_to_turn');
  check('P3 the continuation is bound as TOOL_CONTINUATION (not orphan)', bound.some((t) => String(t.detail).includes('TOOL_CONTINUATION')), since(mark, 'reliability.orphan_reply_suppressed').map((t) => t.detail));
  check('P3 continuation opens the PREPARE window', since(mark, 'reliability.protected_speech_window_opened').length === 1);
}

// P4 — TV transcript delta after reply.done must not strand a completed result (RC3 C4).
{
  const s = await freshSession();
  endpointDelayMs = 250;
  s.say('VoiceStrike, what is my current job?', 'u-job');
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'get_current_job' }] });
  s.emit({ type: 'transcript.user.delta', text: 'and now the news' }); // TV partial, not a speech onset
  await s.settle(120);
  endpointDelayMs = 0;
  check('P4 result is sent although a TV transcript delta followed reply.done', s.resultsFor(call).length === 1);
  const sentEvent = telemetry.filter((t) => t.event === 'reliability.tool_result_sent' && String(t.detail).includes(`call=${call}`));
  check('P4 handoff dwell is recorded', sentEvent.length === 1 && typeof sentEvent[0].latencyMs === 'number');
}

// P5 — documented rule: speech onset after reply.done holds results until that turn's reply.done.
{
  const s = await freshSession();
  endpointDelayMs = 250;
  s.say('VoiceStrike, what is my current job?', 'u-job2');
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'get_current_job' }] });
  s.emit({ type: 'input.speech.started' });
  await s.settle(120);
  endpointDelayMs = 0;
  check('P5 result is held while a new user turn is in flight', s.resultsFor(call).length === 0);
  s.emit({ type: 'transcript.user', text: 'and the weather tonight', item_id: 'tv-x' });
  s.reply({});
  await s.settle();
  check('P5 result is sent at the next reply.done', s.resultsFor(call).length === 1);
}

// P6 — new accepted turn, then a tool.call before the new reply starts: never owned by the old command (RC3 L4).
{
  const s = await freshSession();
  s.say('VoiceStrike, where can I find B148?', 'u-lookup');
  const c1 = s.callId();
  s.reply({ tools: [{ callId: c1, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle();
  s.emit({ type: 'reply.started' });
  s.emit({ type: 'transcript.agent', text: 'You can find seven units of B148 at location C12.' });
  // Worker starts a new request while that reply is still formally open.
  s.say('VoiceStrike, what is my current job?', 'u-job3');
  const mark = telemetry.length;
  const stray = s.callId();
  s.emit({ type: 'tool.call', call_id: stray, name: 'get_current_job', arguments: {} }); // before the new reply.started
  s.emit({ type: 'reply.done', status: 'completed' });
  await s.settle();
  const auth = since(mark, 'reliability.tool_authorisation_checked').find((t) => String(t.detail).includes(`call=${stray}`));
  check('P6 unattributable tool.call is refused with no owner (never the old command)', String(auth?.detail ?? '').includes('causal_owner=NONE'), auth?.detail);
  const good = s.callId();
  s.reply({ tools: [{ callId: good, name: 'get_current_job' }] });
  await s.settle();
  const goodAuth = telemetry.find((t) => t.event === 'reliability.tool_authorisation_checked' && String(t.detail).includes(`call=${good}`));
  check('P6 the new turn\'s own reply tool is authorised', goodAuth?.resultClass === 'AUTHORISED', goodAuth?.detail);
}

// P7 — E2 single utterance: deterministic chain, continuation bound to the E2 command, claim allowed.
{
  const s = await freshSession();
  s.say("VoiceStrike, B148 isn't at C12. The location is empty.", 'u-e2');
  const call = s.callId();
  s.reply({ text: 'Let me check that location.', tools: [{ callId: call, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(150);
  const result = s.resultsFor(call)[0] ?? {};
  check('P7 E2 deterministic chain completed inside the tool round-trip', JSON.stringify(result).includes('deterministic_workflow'), Object.keys(result));
  const mark = telemetry.length;
  s.reply({ text: 'I have logged the discrepancy at C12. You can find four units of B148 available at location D05.' });
  await s.settle();
  check('P7 E2 continuation is bound to the E2 command', since(mark, 'reliability.reply_bound_to_turn').some((t) => String(t.detail).includes('TOOL_CONTINUATION')));
  check('P7 truthful E2 claim passes the claim gate (no false failure)', since(mark, 'reliability.reply_claim_rejected').length === 0, since(mark, 'reliability.reply_claim_rejected').map((t) => t.detail));
}

// P8 — CANCEL then EXPIRE-free fresh cycle for the same action/component: exactly one mutation.
{
  const s = await freshSession();
  await inspect(s);
  await prepare(s);
  await sleep(700);
  s.say("VoiceStrike, actually don't reverse it.", 'u-cancel');
  s.reply({ text: 'The reversal preparation has been cancelled and nothing has changed.' });
  await s.settle();
  check('P8 cancel leaves mutation count 0 and state ACTIVE', reverseMutations() === 0 && !(await actionState()).reversed);
  await sleep(700);
  await inspect(s, { tvDuringPrompt: true });
  const prep = await prepare(s);
  check('P8 fresh PREPARE after cancel reaches PREPARED', (s.resultsFor(prep)[0] ?? {}).error === 'SECOND_CONFIRMATION_REQUIRED', s.resultsFor(prep)[0]);
  await confirm(s);
  check('P8 fresh cycle after cancel performs exactly one reversal', reverseMutations() === 1 && (await actionState()).reversed, endpointCalls);
}

// ============================================================================================
// RC5 — code-owned protected actions (provider emits NO reverse_last_scan)
// ============================================================================================
async function prepareNoTool(s: Session): Promise<void> {
  await sleep(700);
  s.say('VoiceStrike, reverse scan B184.', `u-prep-nt-${Math.random()}`);
  s.reply({ text: 'Okay.' });                         // provider answers without any tool.call
  await s.settle();
  await sleep(1_500);                                  // > CODE_DELIVERY_GRACE_MS
  await s.settle();
  s.reply({ text: 'The reversal is prepared. Please say: VoiceStrike, confirm reverse scan B184.' }); // reply to reply.create
  await s.settle();
}
async function confirmNoTool(s: Session): Promise<void> {
  await sleep(700);
  s.say('VoiceStrike, confirm reverse scan B184.', `u-conf-nt-${Math.random()}`);
  s.reply({ text: 'Understood.' });
  await s.settle(120);
  await sleep(1_500);
  await s.settle();
  s.reply({ text: 'The reversal of B184 is complete and verified.' });
  await s.settle();
}
const codeDelivered = (mark: number, stage: string) => telemetry.slice(mark).filter((t) => t.event === 'reliability.code_owned_action_delivered' && String(t.resultClass) === `${stage}:CODE_REPLY`).length;

// P9 — full E3 with the provider never emitting reverse_last_scan.
{
  const s = await freshSession();
  await inspect(s, { tvDuringPrompt: true });
  const mark = telemetry.length;
  await prepareNoTool(s);
  check('P9 PREPARE executed by code without a provider tool.call (mutation 0)', telemetry.slice(mark).some((t) => t.event === 'reliability.code_owned_action_completed' && t.resultClass === 'PREPARE') && reverseMutations() === 0);
  check('P9 PREPARE outcome delivered by conversation.message + reply.create', codeDelivered(mark, 'PREPARE') === 1 && s.sentOfType('reply.create').length === 1 && s.sentOfType('conversation.message').length >= 1);
  check('P9 the code-requested prompt is bound as CODE_CONTINUATION and opens the CONFIRM window',
    since(mark, 'reliability.reply_bound_to_turn').some((t) => String(t.detail).includes('CODE_CONTINUATION')) && since(mark, 'reliability.protected_speech_window_opened').some((t) => t.resultClass === 'REVERSE_CONFIRM'));
  const mark2 = telemetry.length;
  await confirmNoTool(s);
  check('P9 trusted CONFIRM with NO provider tool.call performs exactly one reversal', reverseMutations() === 1, endpointCalls);
  check('P9 reversal independently verified (state REVERSED)', (await actionState()).reversed);
  check('P9 CONFIRM outcome delivered by code reply', codeDelivered(mark2, 'CONFIRM') === 1);
  check('P9 truthful "complete and verified" claim passes the gate', since(mark2, 'reliability.reply_claim_rejected').length === 0, since(mark2, 'reliability.reply_claim_rejected').map((t) => t.detail));
  check('P9 no synthetic code call id is ever sent to the provider as tool.result', !s.sent.some((m) => m.type === 'tool.result' && String(m.call_id).startsWith('code-')));
}

// P10 — provider emits reverse_last_scan while code-owned CONFIRM is executing (slow endpoint).
{
  const s = await freshSession();
  await inspect(s);
  await prepare(s);
  await sleep(700);
  endpointDelayMs = 300;
  s.say('VoiceStrike, confirm reverse scan B184.', 'u-conf-join');
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'reverse_last_scan', args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' } }] });
  await s.settle(250);
  endpointDelayMs = 0;
  await sleep(1_500); await s.settle();
  const r = s.resultsFor(call)[0] ?? {};
  check('P10 provider call joins code execution: exactly one reversal', reverseMutations() === 1, endpointCalls);
  check('P10 provider call receives the verified result', r.verified === true && r.reliability_outcome === 'VERIFIED_SUCCESS', r);
  check('P10 no code reply.create when the provider already received the result', s.sentOfType('reply.create').length === 0);
  // A late duplicate provider call for the same turn gets the same result and no second mutation.
  const late = s.callId();
  s.reply({ tools: [{ callId: late, name: 'reverse_last_scan', args: { action_id: 'ACT-SCAN-B184', component_id: 'B184' } }] });
  await s.settle();
  check('P10 late duplicate provider call: 0 additional mutations, same verified result', reverseMutations() === 1 && (s.resultsFor(late)[0] ?? {}).verified === true);
}

// P11 — cancelled / stale confirmation with no provider tool.call: zero mutation.
{
  const s = await freshSession();
  await inspect(s);
  await prepareNoTool(s);
  await sleep(700);
  s.say("VoiceStrike, actually don't reverse it.", 'u-cancel-nt');
  s.reply({ text: 'Cancelled. Nothing has changed.' });
  await s.settle();
  const mark = telemetry.length;
  await sleep(700);
  s.say('VoiceStrike, confirm reverse scan B184.', 'u-stale-conf');
  s.reply({ text: 'Okay.' });
  await s.settle();
  await sleep(1_500); await s.settle();
  check('P11 stale confirmation after cancel starts no code-owned execution', !telemetry.slice(mark).some((t) => t.event === 'reliability.code_owned_action_started'));
  check('P11 zero mutations and state ACTIVE', reverseMutations() === 0 && !(await actionState()).reversed);
}

// ============================================================================================
// RC5 — sentence-level streaming claim gate
// ============================================================================================
async function e2Ready(s: Session): Promise<void> {
  s.say("VoiceStrike, B148 isn't at C12. The location is empty.", `u-e2g-${Math.random()}`);
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(150);
}
// P12 — first valid sentence is audible before transcript.agent; a later false sentence is cut.
{
  const s = await freshSession();
  await e2Ready(s);
  const mark = telemetry.length;
  const before = s.audible();
  s.emit({ type: 'reply.started' });
  s.emit({ type: 'reply.audio', data: pcm(24_000) });   // 1.0 s
  s.emit({ type: 'reply.audio', data: pcm(48_000) });   // 2.0 s
  const words1 = ['I', 'logged', 'the', 'discrepancy', 'at', 'C12.'];
  words1.forEach((w, i) => s.emit({ type: 'transcript.agent.delta', delta: w, start_ms: i * 150, end_ms: i === words1.length - 1 ? 1_000 : i * 150 + 140 }));
  await s.settle(30);
  const afterFirst = s.audible() - before;
  check('P12 first validated sentence is audible before the final agent transcript', afterFirst === 24_000, afterFirst);
  const words2 = ['You', 'can', 'find', 'nine', 'units', 'of', 'B148', 'available', 'at', 'D05.'];
  words2.forEach((w, i) => s.emit({ type: 'transcript.agent.delta', delta: w, start_ms: 1_000 + i * 180, end_ms: 1_000 + i * 180 + 170 }));
  s.emit({ type: 'transcript.agent', text: 'I logged the discrepancy at C12. You can find nine units of B148 available at D05.' });
  s.emit({ type: 'reply.done', status: 'completed' });
  await s.settle();
  check('P12 unsupported second sentence is never played', s.audible() - before === 24_000, s.audible() - before);
  check('P12 rejection recorded at sentence stage with released_ms', telemetry.slice(mark).some((t) => t.event === 'reliability.reply_claim_rejected' && String(t.detail).includes('stage=SENTENCE') && String(t.detail).includes('released_ms=1000')));
  check('P12 time-to-first-audio recorded in STREAM_GATE mode', telemetry.slice(mark).some((t) => t.event === 'reliability.reply_audio_released' && t.resultClass === 'STREAM_GATE'));
}
// P13 — no word timing: falls back to full buffer, released only after the full check.
{
  const s = await freshSession();
  await e2Ready(s);
  const before = s.audible();
  s.emit({ type: 'reply.started' });
  s.emit({ type: 'reply.audio', data: pcm(24_000) });
  ['Four', 'units', 'of', 'B', 'one', 'four', 'eight', 'are', 'available', 'at', 'D05.'].forEach((w) => s.emit({ type: 'transcript.agent.delta', delta: w, start_ms: null, end_ms: null }));
  await s.settle(30);
  check('P13 without word timing nothing is played before the final transcript', s.audible() === before);
  s.emit({ type: 'transcript.agent', text: 'Four units of B one four eight are available at D05.' });
  s.emit({ type: 'reply.done', status: 'completed' });
  await s.settle();
  check('P13 spelled-ID reply passes the full check and is released (no B148 quantity contamination)', s.audible() - before === 24_000, s.audible() - before);
}

// ============================================================================================
// RC5 — provider correlation
// ============================================================================================
// P14 — reply.done(interrupted) with reply_id fc-<call_id> discards that call's in-flight result.
{
  const s = await freshSession();
  endpointDelayMs = 300;
  s.say('VoiceStrike, what is my current job?', 'u-fc');
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'get_current_job' }], status: 'interrupted', replyId: `fc-${call}` });
  await s.settle(150);
  endpointDelayMs = 0;
  check('P14 result of the interrupted fc-<call_id> reply is not sent', s.resultsFor(call).length === 0);
  check('P14 discard is recorded', telemetry.some((t) => t.event === 'reliability.tool_result_discarded' && String(t.detail).includes(`call=${call}`)));
}
// P15 — provider item_id pointing at a rejected transcript downgrades an otherwise-bound reply.
{
  const s = await freshSession();
  s.say('VoiceStrike, I scanned B184 by mistake.', 'u-inspect-corr');
  const call = s.callId();
  s.reply({ tools: [{ callId: call, name: 'inspect_last_action' }] });
  await s.settle();                                     // result sent: a continuation is owed
  s.emit({ type: 'input.speech.started' });
  s.emit({ type: 'transcript.user', text: 'reverse scan B184', item_id: 'tv-item-1' }); // no wake: rejected
  await s.settle();
  const mark = telemetry.length;
  s.reply({ text: 'Reversing B184 now.', itemId: 'tv-item-1' });
  await s.settle();
  check('P15 reply correlated to the rejected transcript is downgraded to orphan', since(mark, 'reliability.orphan_reply_suppressed').length === 1 && since(mark, 'reliability.reply_bound_to_turn').length === 0);
  s.reply({ text: 'I see B184 was scanned. To reverse this, please say: VoiceStrike, reverse scan B184.', itemId: 'reply-item-own' });
  await s.settle();
  check('P15 the owed continuation is preserved for the real continuation', since(mark, 'reliability.reply_bound_to_turn').some((t) => String(t.detail).includes('TOOL_CONTINUATION')));
}
// P16 — a rejected protected utterance is reported to the model as not accepted.
{
  const s = await freshSession();
  await inspect(s);
  s.say('VoiceStrike, reverse scan B184.', 'u-too-early');   // inside the quiet gap: rejected
  await s.settle();
  const notes = s.sentOfType('conversation.message').map((m) => String((m as Record<string, unknown>).content ?? ''));
  check('P16 rejected protected utterance produces a system context note', notes.some((n) => n.includes('did not accept the utterance')), notes);
}

// P17 — malformed odd-length PCM chunk inside a gated reply does not break the pipeline.
{
  const s = await freshSession();
  await e2Ready(s);
  s.emit({ type: 'reply.started' });
  s.emit({ type: 'reply.audio', data: 'AAAA' });
  s.emit({ type: 'transcript.agent', text: 'Checking.' });
  s.emit({ type: 'reply.done', status: 'completed' });
  await s.settle();
  check('P17 odd-length PCM chunk handled without an exception', !handlerErrors.some((e) => e.includes('RangeError')));
}

// P18 / VS-008 — incomplete E2 must preserve the exact pending clarification after an unsafe provider claim.
{
  const s = await freshSession();
  s.say("VoiceStrike location for B148 is empty.", 'u-e2-vs008');
  const call = s.callId();
  s.reply({ text: 'Let me check the inventory record.', tools: [{ callId: call, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(150);
  const result = s.resultsFor(call)[0] ?? {};
  check('P18 VS-008 read completes but deterministic E2 does not mutate without reportedLocation', !JSON.stringify(result).includes('deterministic_workflow'), result);

  const mark = telemetry.length;
  s.reply({ text: 'I logged the discrepancy at C12.' });
  await s.settle();

  const rejected = since(mark, 'reliability.reply_claim_rejected');
  const lastAgent = [...s.transcripts].reverse().find((entry) => entry.role === 'agent')?.text ?? '';
  check('P18 VS-008 unsafe mutation claim is rejected', rejected.some((t) => t.resultClass === 'UNVERIFIED_MUTATION_CLAIM'), rejected);
  check('P18 VS-008 safe fallback asks only for the pending E2 location', /which location for B148 is empty\??/i.test(lastAgent), lastAgent);
}

// P19 / VS-009 — final worker-visible agent transcript must canonicalise technical IDs.
{
  const s = await freshSession();
  await e2Ready(s);
  s.reply({ text: 'A discrepancy was logged, and the primary location C 1 2 has been marked as unavailable. You can find four B 1 4 8 at location D 0 5.' });
  await s.settle();
  const lastAgent = [...s.transcripts].reverse().find((entry) => entry.role === 'agent')?.text ?? '';
  check('P19 VS-009 worker-visible transcript canonicalises B148/C12/D05', /B148/.test(lastAgent) && /C12/.test(lastAgent) && /D05/.test(lastAgent), lastAgent);
  check('P19 VS-009 worker-visible transcript contains no spaced critical IDs', !/\b[BCD](?:\s+\d){2,6}\b/.test(lastAgent), lastAgent);
}

// P20 / VS-010 — E2 must recover after STT drops the component letter, then worker re-states B148.
{
  const s = await freshSession();

  // Live sequence: STT loses the leading B from B148.
  s.say('VoiceStrike location for 148 is empty.', 'u-e2-vs010-1');
  const jobCall = s.callId();
  s.reply({ text: 'Let me check the current job.', tools: [{ callId: jobCall, name: 'get_current_job' }] });
  await s.settle(150);
  check('P20 VS-010 current job read completes after incomplete E2 component', s.resultsFor(jobCall).length === 1, s.resultsFor(jobCall));

  // Worker supplies the location while component is still unresolved.
  s.say('C12.', 'u-e2-vs010-2');
  s.reply({ text: 'I need to confirm the component for your report. Did you mean component B148?' });
  await s.settle();

  // Worker now explicitly re-states the complete component in a full E2 utterance.
  s.say('VoiceStrike location for B148 is empty.', 'u-e2-vs010-3');
  const inventoryCall = s.callId();
  s.reply({ tools: [{ callId: inventoryCall, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(180);

  const inventoryResult = s.resultsFor(inventoryCall)[0] ?? {};
  const blockedCritical = s.toolEvents.filter((e) => e.name === 'check_inventory' && e.status === 'blocked' && String(e.detail ?? '').includes('CRITICAL_ENTITY_REQUIRED'));
  check('P20 VS-010 explicit B148 confirmation allows check_inventory endpoint result', Boolean(inventoryResult.ok), inventoryResult);
  check('P20 VS-010 no CRITICAL_ENTITY_REQUIRED remains after explicit B148 re-statement', blockedCritical.length === 0, blockedCritical);
}

// P21 / VS-010 — once the worker resolves B148, E2 must not depend on the provider choosing check_inventory.
{
  const s = await freshSession();

  s.say('VoiceStrike location for 148 is empty.', 'u-e2-vs010-code-1');
  const jobCall = s.callId();
  s.reply({ tools: [{ callId: jobCall, name: 'get_current_job' }] });
  await s.settle(120);

  s.say('C12.', 'u-e2-vs010-code-2');
  s.reply({ text: 'I need to confirm the component for your report. Did you mean component B148?' });
  await s.settle();

  const beforeInventory = endpointCalls.filter((entry) => entry.includes('/api/tools/check-inventory')).length;
  const beforeDiscrepancy = endpointCalls.filter((entry) => entry.includes('/api/tools/report-inventory-discrepancy')).length;

  // This is the exact live recovery utterance. Deliberately emit no provider tool.call afterward.
  s.say('VoiceStrike location for B148 is empty.', 'u-e2-vs010-code-3');
  await s.settle(300);

  const afterInventory = endpointCalls.filter((entry) => entry.includes('/api/tools/check-inventory')).length;
  const afterDiscrepancy = endpointCalls.filter((entry) => entry.includes('/api/tools/report-inventory-discrepancy')).length;

  check('P21 VS-010 READY E2 starts authoritative check_inventory without provider tool selection', afterInventory === beforeInventory + 1, { beforeInventory, afterInventory, endpointCalls });
  check('P21 VS-010 deterministic E2 continuation records discrepancy without provider orchestration', afterDiscrepancy === beforeDiscrepancy + 1, { beforeDiscrepancy, afterDiscrepancy, endpointCalls });
}

// P22 / VS-011 — successful inventory read must not close an incomplete E2 command.
{
  const s = await freshSession();
  s.say('VoiceStrike location for B148 is empty.', 'u-e2-vs011');
  const call = s.callId();
  s.reply({
    text: 'The system shows seven units of B148 at location C12.',
    tools: [{ callId: call, name: 'check_inventory', args: { component_id: 'B148' } }],
  });
  await s.settle(180);

  const result = s.resultsFor(call)[0] ?? {};
  const lastAgent = [...s.transcripts].reverse().find((entry) => entry.role === 'agent')?.text ?? '';
  check('P22 VS-011 incomplete E2 inventory read still completes successfully', Boolean(result.ok), result);
  check('P22 VS-011 successful read cannot replace pending location clarification', /which location for B148 is empty\??/i.test(lastAgent), lastAgent);
}

// P23 / VS-011 — exact live ordering: context read -> inventory read -> truthful stock reply.
{
  const s = await freshSession();
  s.say('VoiceStrike location for B148 is empty.', 'u-e2-vs011-live');

  const jobCall = s.callId();
  s.reply({ tools: [{ callId: jobCall, name: 'get_current_job' }] });
  await s.settle(150);

  const inventoryCall = s.callId();
  s.reply({ tools: [{ callId: inventoryCall, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(150);

  s.reply({ text: 'The system shows seven units of B148 at location C12.' });
  await s.settle();

  const lastAgent = [...s.transcripts].reverse().find((entry) => entry.role === 'agent')?.text ?? '';
  check('P23 VS-011 exact live ordering preserves pending location clarification', /which location for B148 is empty\??/i.test(lastAgent), lastAgent);
}

// P24 / VS-012 — a pending location clarification owns a short location answer by type, not by reparsing prior prose.
{
  const s = await freshSession();
  s.say('VoiceStrike location for B148 is empty', 'u-e2-vs012-short-1');
  s.reply({ text: 'Which location for B148 is empty?' });
  await s.settle();

  s.say('C12.', 'u-e2-vs012-short-2');
  await s.settle();

  const registry = (s.agent as unknown as { commandRegistry: { current(): { status?: string; slots?: Record<string, unknown>; pendingClarification?: { field?: string } } | null } }).commandRegistry;
  const command = registry.current();
  check('P24 VS-012 short C12 binds directly to pending reportedLocation', command?.slots?.reportedLocation === 'C12', command);
  check('P24 VS-012 short C12 makes the E2 command READY without component reconfirmation',
    command?.status === 'READY' && command?.pendingClarification === undefined, command);
}

// P25 / VS-012 — early authoritative read + later C12 must continue deterministically with NO provider tool selection.
{
  const s = await freshSession();
  s.say('VoiceStrike location for B148 is empty.', 'u-e2-vs012-ready-1');

  const jobCall = s.callId();
  s.reply({ tools: [{ callId: jobCall, name: 'get_current_job' }] });
  await s.settle(120);

  const inventoryCall = s.callId();
  s.reply({ tools: [{ callId: inventoryCall, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(150);

  // Provider asks the correct pending question; the next worker turn supplies only the missing slot.
  s.reply({ text: 'Which location for B148 is empty?' });
  await s.settle();

  const beforeInventory = endpointCalls.filter((entry) => entry.includes('/api/tools/check-inventory')).length;
  const beforeDiscrepancy = endpointCalls.filter((entry) => entry.includes('/api/tools/report-inventory-discrepancy')).length;
  const beforeAlternative = endpointCalls.filter((entry) => entry.includes('/api/tools/find-alternative-inventory')).length;

  s.say('C12.', 'u-e2-vs012-ready-2');
  await s.settle(300); // deliberately no provider tool.call after the clarification

  const afterInventory = endpointCalls.filter((entry) => entry.includes('/api/tools/check-inventory')).length;
  const afterDiscrepancy = endpointCalls.filter((entry) => entry.includes('/api/tools/report-inventory-discrepancy')).length;
  const afterAlternative = endpointCalls.filter((entry) => entry.includes('/api/tools/find-alternative-inventory')).length;

  check('P25 VS-012 READY transition owns deterministic E2 continuation after an early read',
    afterDiscrepancy === beforeDiscrepancy + 1 && afterAlternative === beforeAlternative + 1,
    { beforeInventory, afterInventory, beforeDiscrepancy, afterDiscrepancy, beforeAlternative, afterAlternative, endpointCalls });
}

// P26 / VS-012 — if the provider tries to close a pending clarification with stock facts,
// VoiceStrike must request a code-owned spoken clarification, not only inject UI transcript text.
{
  const s = await freshSession();
  s.say('VoiceStrike location for B148 is empty.', 'u-e2-vs012-audio-1');

  const jobCall = s.callId();
  s.reply({ tools: [{ callId: jobCall, name: 'get_current_job' }] });
  await s.settle(120);

  const inventoryCall = s.callId();
  s.reply({ tools: [{ callId: inventoryCall, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(150);

  const replyCreateBefore = s.sentOfType('reply.create').length;
  const audibleBefore = s.audible();
  s.reply({ text: 'The system shows seven units of B148 at location C12.' });
  await s.settle(120);

  const replyCreateAfter = s.sentOfType('reply.create').length;
  const lastAgentAfterBlock = [...s.transcripts].reverse().find((entry) => entry.role === 'agent')?.text ?? '';
  check('P26 VS-012 stock-only close is replaced by the exact pending clarification',
    /which location for B148 is empty\??/i.test(lastAgentAfterBlock), lastAgentAfterBlock);
  check('P26 VS-012 deterministic clarification requests an actual spoken code reply',
    replyCreateAfter === replyCreateBefore + 1,
    { replyCreateBefore, replyCreateAfter, sent: s.sentOfType('reply.create') });

  // Simulate the provider rendering the code-requested exact prompt. It must be audible.
  s.reply({ text: 'Which location for B148 is empty?' });
  await s.settle();
  check('P26 VS-012 code-owned clarification is audibly deliverable',
    s.audible() > audibleBefore,
    { audibleBefore, audibleAfter: s.audible() });
}

// P27 / VS-012 — stale early inventory evidence must trigger a fresh read on READY, not strand the command.
{
  const s = await freshSession();
  s.say('VoiceStrike location for B148 is empty.', 'u-e2-vs012-stale-1');

  const inventoryCall = s.callId();
  s.reply({ tools: [{ callId: inventoryCall, name: 'check_inventory', args: { component_id: 'B148' } }] });
  await s.settle(150);
  s.reply({ text: 'Which location for B148 is empty?' });
  await s.settle();

  const internals = s.agent as unknown as {
    commandRegistry: { current(): { id: string } | null };
    workflow: { noteInventoryCheck(commandId: string, result: Record<string, unknown>, now?: number): void };
  };
  const commandId = internals.commandRegistry.current()?.id ?? '';
  internals.workflow.noteInventoryCheck(commandId, { component: 'B148', location: 'C12', quantity: 7 }, Date.now() - 121_000);

  const beforeInventory = endpointCalls.filter((entry) => entry.includes('/api/tools/check-inventory')).length;
  const beforeDiscrepancy = endpointCalls.filter((entry) => entry.includes('/api/tools/report-inventory-discrepancy')).length;

  s.say('C12.', 'u-e2-vs012-stale-2');
  await s.settle(300); // no provider tool.call

  const afterInventory = endpointCalls.filter((entry) => entry.includes('/api/tools/check-inventory')).length;
  const afterDiscrepancy = endpointCalls.filter((entry) => entry.includes('/api/tools/report-inventory-discrepancy')).length;
  check('P27 VS-012 stale early evidence is refreshed and then continued deterministically',
    afterInventory === beforeInventory + 1 && afterDiscrepancy === beforeDiscrepancy + 1,
    { beforeInventory, afterInventory, beforeDiscrepancy, afterDiscrepancy, endpointCalls });
}

check('HARNESS no exception inside the provider event pipeline', handlerErrors.length === 0, handlerErrors.slice(0, 3));
globalThis.fetch = realFetch;
console.error = realConsoleError;
await new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});
db.close();
rmSync(tempDir, { recursive: true, force: true });
console.log(`\nVoiceStrike RC5 event-pipeline harness: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
