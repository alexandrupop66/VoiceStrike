/**
 * VoiceStrike v0.10.0 RC4 — reply-causality ledger regressions (registry level).
 * L1–L4 reproduced the RC3 defects; see evidence/build7/v0.10.0_RC4_LIFECYCLE_DIAGNOSIS.md.
 */
import { ReplyAuthorityRegistry } from '../client/src/reliability/replyAuthority.js';
import { ProtectedSpeechWindowRegistry } from '../client/src/reliability/protectedSpeech.js';
import { TurnAuthorityRegistry } from '../client/src/reliability/authority.js';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}  got=${JSON.stringify(got)}`); }
};

function e3AfterInspect() {
  const reply = new ReplyAuthorityRegistry(); reply.reset(1);
  const windows = new ProtectedSpeechWindowRegistry();
  const auth = new TurnAuthorityRegistry();
  reply.beginReply('greet', 1, 0); reply.finishReply(0);
  reply.noteTurn('Ti', 'ACCEPTED', 'C3', 1000);
  auth.grant({ sessionId: 'S', turnId: 'Ti', commandId: 'C3', transcript: 'VoiceStrike, I scanned B184 by mistake', wakeAuthorised: true, criticalSpeechTrusted: false, criticalKind: 'NONE', now: 1000 });
  reply.beginReply('R1', 1, 1100);
  const owner = reply.commandIdForToolRequest('inspect_last_action', 1150)!;
  reply.noteToolRequest(owner, 'inspect_last_action', 1150, 'call-inspect');
  reply.markPendingWork('call-inspect');
  windows.arm({ epoch: 1, commandId: 'C3', actionId: 'ACT-SCAN-B184', componentId: 'B184', expectedKind: 'REVERSE_PREPARE', now: 1200 });
  reply.finishReply(1400); reply.markToolResultSent('call-inspect');
  const r2 = reply.beginReply('R2', 1, 1500);
  return { reply, windows, auth, r2 };
}
function replyDone(reply: ReplyAuthorityRegistry, windows: ProtectedSpeechWindowRegistry, at: number) {
  const fin = reply.finishReply(at);
  if (fin?.authorised && fin.reason === 'TOOL_CONTINUATION') windows.markPromptDone({ epoch: 1, commandId: fin.commandId, audibleDoneAt: at, now: at });
  return fin;
}
const legitPrepare = (w: ProtectedSpeechWindowRegistry) =>
  w.assess({ epoch: 1, commandId: 'C3', kind: 'REVERSE_PREPARE', componentId: 'B184', speechStartedAt: 9000, now: 10500 });

{ const { reply, windows, r2 } = e3AfterInspect();
  check('L0 instruction prompt is the inspect TOOL_CONTINUATION', r2.reason === 'TOOL_CONTINUATION', r2.reason);
  replyDone(reply, windows, 5000);
  check('L0 legit PREPARE trusted when no onset occurs during prompt', legitPrepare(windows).trusted); }

{ const { reply, windows } = e3AfterInspect();
  reply.interruptCurrentReply(3000); reply.noteTurn('Ttv', 'REJECTED');
  check('L1 speech onset during a prompt does not revoke its audibility', reply.isCurrentReplyAuthorised());
  const fin = replyDone(reply, windows, 5000);
  check('L1 reply.done after an onset still reports the finished continuation', fin?.reason === 'TOOL_CONTINUATION' && fin.onsetDuringReplyAt === 3000, fin);
  const d = legitPrepare(windows);
  check('L1 onset during the protected prompt does not prevent the PREPARE window opening', d.trusted, d.trusted ? 'TRUSTED' : d.reason);
  check('L1 the inspect turn closes at its continuation reply.done', !reply.hasOpenTurn()); }

{ const { reply, windows, auth } = e3AfterInspect();
  reply.interruptCurrentReply(3000); reply.noteTurn('Ttv', 'REJECTED'); replyDone(reply, windows, 5000);
  reply.interruptCurrentReply(9000); reply.noteTurn('Tp', 'REJECTED');
  const r3 = reply.beginReply('R3', 1, 9800);
  const owner = reply.commandIdForToolRequest('reverse_last_scan', 9900);
  check('L2 provider reply to a locally rejected turn is an inaudible orphan', !r3.authorised, r3.reason);
  check('L2 its reverse_last_scan has no owner', owner === null, owner);
  const res = auth.resolve({ commandId: owner ?? '', sessionId: 'S', isCommandCurrent: true, requireCriticalTrust: true, now: 9900 });
  check('L2 such a call can never resolve to authority', !res.ok); }

{ const { reply } = e3AfterInspect();
  reply.finishReply(5000); // continuation done, turn closed and lingering
  reply.noteTurn('Ttv', 'REJECTED');
  check('L2b a rejected fence ends the same-turn tool linger', reply.commandIdForToolRequest('reverse_last_scan', 5200) === null); }

{ const reply = new ReplyAuthorityRegistry(); reply.reset(1);
  reply.beginReply('greet', 1, 0); reply.finishReply(0);
  reply.noteTurn('T1', 'ACCEPTED', 'C_E2', 1000); reply.beginReply('R1', 1, 1100);
  const o = reply.commandIdForToolRequest('check_inventory', 1200)!;
  check('L3 tool emitted in the bound reply is owned by its command', o === 'C_E2', o);
  reply.noteToolRequest(o, 'check_inventory', 1200, 'call-e2');
  reply.finishReply(1300);
  check('L3 a turn with an in-flight call stays open across reply.done', reply.hasOpenTurn());
  reply.markPendingWork('call-e2'); reply.markToolResultSent('call-e2');
  const r2 = reply.beginReply('R2', 1, 2900);
  check('L3 its result gets a bound TOOL_CONTINUATION', r2.authorised && r2.reason === 'TOOL_CONTINUATION' && r2.commandId === 'C_E2', r2);
  reply.finishReply(3000);
  check('L3 the turn closes after the continuation', !reply.hasOpenTurn()); }

{ const reply = new ReplyAuthorityRegistry(); reply.reset(1);
  reply.beginReply('greet', 1, 0); reply.finishReply(0);
  reply.noteTurn('T1', 'ACCEPTED', 'C_OLD', 1000); reply.beginReply('R1', 1, 1100);
  reply.interruptCurrentReply(3000); reply.noteTurn('T2', 'ACCEPTED', 'C_NEW', 4000);
  check('L4 the old reply is detached (inaudible) by the new accepted turn', !reply.isCurrentReplyAuthorised());
  const owner = reply.commandIdForToolRequest('get_current_job', 4200);
  check('L4 a tool.call before the new reply starts has no owner (never the old command)', owner === null, owner);
  check('L4 no rehydration of the old command over the new turn', !reply.noteToolRequest('C_OLD', 'get_current_job', 4200, 'stray'));
  const r2 = reply.beginReply('R2', 1, 4500);
  check('L4 the new turn keeps its own first reply', r2.reason === 'BOUND_TO_ACCEPTED_TURN' && r2.commandId === 'C_NEW', r2);
  check('L4 tools inside the new reply belong to the new command', reply.commandIdForToolRequest('get_current_job', 4600) === 'C_NEW'); }

{ const reply = new ReplyAuthorityRegistry(); reply.reset(1);
  reply.beginReply('greet', 1, 0); reply.finishReply(0);
  reply.noteTurn('T1', 'ACCEPTED', 'C1', 1000); reply.beginReply('R1', 1, 1100); reply.finishReply(1200);
  const extra = reply.beginReply('R-extra', 1, 1300);
  check('L5 a second provider reply without owed tool result is orphan (no self-reply cascade)', !extra.authorised, extra.reason);
  reply.finishReply(1400);
  reply.noteTurn('T2', 'ACCEPTED', 'C2', 2000); reply.beginReply('R2', 1, 2100);
  reply.noteToolRequest('C2', 'check_component', 2150, 'k1'); reply.noteToolRequest('C2', 'report_exception', 2160, 'k2');
  reply.finishReply(2200); reply.markPendingWork('k1'); reply.markToolResultSent('k1');
  check('L5 turn stays open while a second call is still in flight', reply.hasOpenTurn());
  reply.releaseToolResult('k2', false, 2300);
  const c = reply.beginReply('R3', 1, 2400);
  check('L5 a released call no longer holds the turn; continuation still bound', c.reason === 'TOOL_CONTINUATION' && c.commandId === 'C2', c);
  reply.finishReply(2500);
  check('L5 turn closes after continuation once nothing is held', !reply.hasOpenTurn()); }

// RC5 — code-owned work, code continuation, provider-correlation demotion.
{ const reply = new ReplyAuthorityRegistry(); reply.reset(1);
  reply.beginReply('greet', 1, 0); reply.finishReply(0);
  reply.noteTurn('Tc', 'ACCEPTED', 'C9', 1000);
  reply.armProtectedToolLease({ turnId: 'Tc', commandId: 'C9', expectedTool: 'reverse_last_scan', now: 1000 });
  check('L6 code work hold is accepted for the open turn', reply.holdCodeWork('C9', 'code-confirm-Tc'));
  reply.beginReply('R1', 1, 1100); reply.finishReply(1200);
  check('L6 code work keeps the protected turn open', reply.hasOpenTurn());
  check('L6 code hold does not consume the provider protected lease', reply.commandIdForToolRequest('reverse_last_scan', 1300) === 'C9');
  check('L6 no code reply while the provider lease is still attributable only if nothing else is owed', reply.canRequestCodeReply('C9', 'code-confirm-Tc'));
  check('L6 expectCodeReply binds the next reply as CODE_CONTINUATION', reply.expectCodeReply('C9'));
  reply.releaseCodeWork('code-confirm-Tc', 1400);
  check('L6 turn stays open while a code reply is owed', reply.hasOpenTurn());
  const c = reply.beginReply('R2', 1, 1500);
  check('L6 code-requested reply is CODE_CONTINUATION on the same command', c.authorised && c.reason === 'CODE_CONTINUATION' && c.commandId === 'C9', c);
  reply.finishReply(1600);
  check('L6 after the code continuation a late provider reverse_last_scan is still attributable (it will join the code result)', reply.commandIdForToolRequest('reverse_last_scan', 1700) === 'C9');
  reply.commandIdForToolRequest('reverse_last_scan', 1000 + 30_001);
  check('L6 the protected turn closes when its lease expires', !reply.hasOpenTurn()); }

{ const reply = new ReplyAuthorityRegistry(); reply.reset(1);
  reply.beginReply('greet', 1, 0); reply.finishReply(0);
  reply.noteTurn('T1', 'ACCEPTED', 'C1', 1000); reply.beginReply('R1', 1, 1100);
  reply.noteToolRequest('C1', 'inspect_last_action', 1150, 'x1'); reply.finishReply(1200);
  reply.markPendingWork('x1'); reply.markToolResultSent('x1');
  const wrong = reply.beginReply('R-wrong', 1, 1300);
  const demoted = reply.demoteCurrentReply();
  check('L7 demotion makes a bound reply inaudible', wrong.authorised && demoted?.authorised === false && !reply.isCurrentReplyAuthorised());
  check('L7 a demoted reply owns no tools', reply.commandIdForToolRequest('reverse_last_scan', 1350) === null);
  reply.finishReply(1400);
  const real = reply.beginReply('R-real', 1, 1500);
  check('L7 the owed continuation survives the demotion', real.reason === 'TOOL_CONTINUATION' && real.commandId === 'C1', real); }

console.log(`\nVoiceStrike RC5 lifecycle ledger: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`RC4 lifecycle regressions failed: ${failed}`);
