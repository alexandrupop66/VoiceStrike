import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const checks = [];
const check = (label, ok) => {
  checks.push([label, Boolean(ok)]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const api = read('server/src/routes/api.ts');
const voice = read('client/src/voice/voiceAgent.ts');
const supervisor = read('client/src/components/SupervisorView.tsx');
const app = read('client/src/App.tsx');
const serverIndex = read('server/src/index.ts');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const safeAction = read('client/src/reliability/safeAction.ts');
const transcript = read('client/src/reliability/transcript.ts');
const entities = read('client/src/reliability/entities.ts');
const inventoryEntities = read('client/src/reliability/inventoryEntities.ts');
const commands = read('client/src/reliability/commands.ts');
const ambient = read('client/src/reliability/ambient.ts');
const duplex = read('client/src/reliability/duplex.ts');
const confirmation = read('client/src/reliability/confirmation.ts');
const criticalSpeech = read('client/src/reliability/criticalSpeech.ts');
const protectedSpeech = read('client/src/reliability/protectedSpeech.ts');
const clientTelemetry = read('client/src/reliability/telemetry.ts');
const toolReporting = read('client/src/reliability/toolReporting.ts');
const recovery = read('client/src/reliability/recovery.ts');
const authority = read('client/src/reliability/authority.ts');
const toolPolicy = read('client/src/reliability/toolPolicy.ts');
const workflow = read('client/src/reliability/workflow.ts');
const claims = read('client/src/reliability/claims.ts');
const replyClaims = read('client/src/reliability/replyClaims.ts');
const replyAuthority = read('client/src/reliability/replyAuthority.ts');
const cancellation = read('client/src/reliability/cancellation.ts');
const sessionEpoch = read('client/src/reliability/session.ts');
const clientTypes = read('client/src/reliability/types.ts');
const reliabilityTests = read('scripts/test-reliability-core.mts');
const voicePanel = read('client/src/components/VoicePanel.tsx');
const serverConfirmation = read('server/src/reliability/confirmation.ts');
const pcmProcessor = read('client/public/pcm-processor.js');
const telemetry = read('server/src/reliability/telemetry.ts');
const faults = read('server/src/reliability/faults.ts');
const corpus = JSON.parse(read('tests/reliability/reliability-corpus.json'));

check('BUILD7_STATUS exists', existsSync(resolve(root, 'BUILD7_STATUS.md')));
check('Build 7 runtime test plan exists', existsSync(resolve(root, 'evidence/build7/BUILD7_TEST_PLAN.md')));
check('v0.9.3 root-cause evidence exists', existsSync(resolve(root, 'evidence/build7/v0.9.3_ROOT_CAUSE_AND_FIX.md')));
check('v0.9.3 automated evidence exists', existsSync(resolve(root, 'evidence/build7/v0.9.3_AUTOMATED_RESULTS.md')));
check('v0.9.3 runtime acceptance plan exists', existsSync(resolve(root, 'evidence/build7/v0.9.3_RUNTIME_ACCEPTANCE_PLAN.md')));
check('v0.9.4 root-cause evidence exists', existsSync(resolve(root, 'evidence/build7/v0.9.4_ROOT_CAUSE_AND_FIX.md')));
check('v0.9.4 automated evidence exists', existsSync(resolve(root, 'evidence/build7/v0.9.4_AUTOMATED_RESULTS.md')));
check('v0.9.4 runtime acceptance plan exists', existsSync(resolve(root, 'evidence/build7/v0.9.4_RUNTIME_ACCEPTANCE_PLAN.md')));
check('v0.9.5 root-cause evidence exists', existsSync(resolve(root, 'evidence/build7/v0.9.5_ROOT_CAUSE_AND_FIX.md')));
check('v0.9.5 automated evidence exists', existsSync(resolve(root, 'evidence/build7/v0.9.5_AUTOMATED_RESULTS.md')));
check('v0.9.5 runtime acceptance plan exists', existsSync(resolve(root, 'evidence/build7/v0.9.5_RUNTIME_ACCEPTANCE_PLAN.md')));
check('Build 1 reliability findings preserved', existsSync(resolve(root, 'evidence/build1/BUILD1_FINDINGS.md')));
check('Controlled reliability corpus exists', existsSync(resolve(root, 'tests/reliability/reliability-corpus.json')));
check('Controlled reliability corpus has at least 30 cases', corpus.length >= 30);
check('Corpus covers every BUILD 7.8 audio category', ['baseline', 'technical_id', 'correction', 'fragmented', 'sanity', 'ambiguity', 'ambient', 'accent', 'noise', 'wake_control', 'protected_confirmation', 'cancellation', 'interruption'].every((category) => corpus.some((item) => item.category === category)));
check('Version is 0.10.0', pkg.version === '0.10.0' && clientPkg.version === '0.10.0' && serverPkg.version === '0.10.0');
check('Health reports build 7', api.includes('build: 7'));
check('Server log reports Build 7', serverIndex.includes('VoiceStrike Build 7 API'));
check('Client build tag is BUILD 7', app.includes('BUILD 7'));
// v0.8.10 UI lifecycle: view switching must not unmount the live Worker voice session.
check('Worker and Supervisor views remain mounted across view switches', app.includes("hidden={view !== 'worker'}") && app.includes("hidden={view !== 'supervisor'}"));
check('Worker view is no longer conditionally mounted by active view', !app.includes("state && view === 'worker'") && !app.includes("state && view === 'supervisor'"));
check('Persistent Worker view still owns the single VoicePanel instance', read('client/src/components/WorkerView.tsx').includes('<VoicePanel />') && (read('client/src/components/WorkerView.tsx').match(/<VoicePanel \/>/g) ?? []).length === 1);
check('v0.8.7 keeps adaptive Voice Agent endpointing', voice.includes('turn_detection') && !voice.includes('min_silence:') && !voice.includes('max_silence:'));
check('Recovery context is command-bound in client', recovery.includes('commandId') && recovery.includes('isRecoverySpeechContextFresh'));
check('Successful inspect binds recovery context to commandId', voice.includes("source: 'TOOL_RESULT'") && voice.includes('makeRecoverySpeechContext'));
check('Critical prepare can restore only prior server-audited inspection', voice.includes('restoreRecoverySpeechContext') && voice.includes('/api/reliability/recovery-context'));
check('Server exposes read-only recovery-context authority endpoint', api.includes("apiRouter.get('/reliability/recovery-context'") && api.includes('NO_RECENT_COMMAND_BOUND_INSPECTION'));
check('Inspect audit records reliability command binding', api.includes('reliability_command_id: reliabilityCommandId || null'));

// v0.8.8 turn-bound authority (root cause of the final-confirmation failure)
check('Turn-bound authority module exists', existsSync(resolve(root, 'client/src/reliability/authority.ts')));
check('TurnAuthority carries session/turn/command/transcript/wake/critical binding', ['sessionId', 'turnId', 'commandId', 'transcript', 'wakeAuthorised', 'criticalSpeechTrusted', 'createdAt'].every((field) => authority.includes(`readonly ${field}`)));
check('TurnAuthority is frozen at grant time', authority.includes('Object.freeze('));
check('Authority registry exposes no revoke-by-speech API', !/\brevoke\w*\(/.test(authority) && !authority.includes('setAuthorised'));
check('Authority resolution refuses other command/session/invalidated/expired', ['COMMAND_MISMATCH', 'SESSION_MISMATCH', 'COMMAND_NOT_CURRENT', 'AUTHORITY_EXPIRED'].every((reason) => authority.includes(reason)));
check('Authority consumption makes a mutation single-attempt per turn', authority.includes('MUTATION_ALREADY_CONSUMED') && voice.includes('this.turnAuthorities.consumeMutation(authority, name)'));
check('Mutable session flag lastInputAuthorised is gone', !voice.includes('lastInputAuthorised'));
check('Accepted turns grant immutable authority', voice.includes('this.turnAuthorities.grant({'));
check('Tool calls resolve turn authority instead of live session state', voice.includes('this.turnAuthorities.resolve({') && voice.includes("requireCriticalTrust: name === 'reverse_last_scan'"));
check('Rejected speech paths leave existing authority untouched', (voice.match(/Rejected speech: existing turn authority is deliberately left untouched\./g) ?? []).length === 3);
check('Accepted turn id is bound only after all speech gates accept', voice.indexOf('this.lastFinalTurnId = id;') > voice.indexOf('if (!ambientDecision.accepted) {'));
check('Reliability headers derive from accepted-turn authority, not live wake window', voice.includes("'X-VoiceStrike-Turn-Id': authority.turnId") && voice.includes("authority.wakeAuthorised ? 'WAKE_PHRASE_ACTIVE' : 'WAKE_REQUIRED'") && !voice.includes("this.ambientGate.isActive() ? 'WAKE_PHRASE_ACTIVE'"));
check('Protected confirmation is assessed against authority-bound transcript/turn', voice.includes('turnId: authority.turnId,\n            transcript: authority.transcript,') && voice.includes('confirmationText: authority.transcript'));
// v0.9.0: authority clearing is no longer duplicated at three call sites. Every conversation
// lifecycle boundary (connect, close, disconnect, full demo reset) goes through one epoch reset
// that clears authority together with every other lifecycle holder. The invariant is unchanged
// and is now asserted on the single owner instead of on a copy count.
check('Reconnect/disconnect/reset clear turn authority through one epoch owner', voice.includes('this.turnAuthorities.reset();') && voice.includes('private beginSessionEpoch(reason: SessionEpochReason): number') && (voice.match(/this\.beginSessionEpoch\(/g) ?? []).length >= 4);
check('Tool calls stay bound to causal reply ownership after invalidation', commands.includes('commandForToolCall(causalCommandId?: string | null)') && commands.includes('causalCommandId ?? this.replyCommandId'));
check('READY commands do not absorb unrelated later intents', commands.includes('A genuinely new operational intent owns a new commandId') && commands.includes("active.status = 'COMPLETE'"));
check('Mandatory delayed tool.call regression exists', reliabilityTests.includes('A1 later ambient/echo speech cannot revoke valid prior turn authority') && reliabilityTests.includes('A1 final protected confirmation => exactly one mutation') && reliabilityTests.includes('A1 exactly one independent verification after mutation'));
check('Inverse regressions exist (wrong commandId, wrong component, stale, reconnect, cancelled, no wake)', ['A2 wrong commandId => mutation 0', 'A3 wrong component => mutation 0', 'A4 stale authority => mutation 0', 'A5 reconnect => mutation 0', 'A6 cancelled confirmation => mutation 0', 'A7 no wake authority => mutation 0'].every((label) => reliabilityTests.includes(label)));

check('Critical entity resolver exists', existsSync(resolve(root, 'client/src/reliability/entities.ts')));
check('Technical ID normaliser exists', entities.includes('normalizeTechnicalId'));
check('Spoken B/bee variants supported', entities.includes("bee: 'B'"));
check('Unknown IDs are not nearest-known mapped', !entities.includes('B185') && !entities.includes('nearest'));
check('Correction resolver exists', entities.includes('resolveCorrectedTechnicalEntity'));
check('E2 typed inventory entity resolver exists', existsSync(resolve(root, 'client/src/reliability/inventoryEntities.ts')) && inventoryEntities.includes('resolveInventoryDiscrepancyEntities'));
check('E2 typed resolver separates component/location roles', inventoryEntities.includes("component_id") && inventoryEntities.includes("location_id") && inventoryEntities.includes('observedEmpty'));
check('Missing-inventory readiness requires typed component/location plus EMPTY', commands.includes("command.workflow === 'E2_MISSING_INVENTORY'") && commands.includes('command.slots.reportedLocation') && commands.includes('command.slots.observedEmpty !== true'));
check('E2 mutation gate validates command-owned typed entities', safeAction.includes('const slots = options.commandSlots ?? {}') && safeAction.includes('INVENTORY_TYPED_ENTITIES_REQUIRED') && safeAction.includes('slots.observedEmpty !== true'));
check('E2 telemetry emits command-owned typed entities', voice.includes('for (const entity of command.entities)') && voice.includes('typed_command_slot'));
check('E2 typed regression suite exists', ['E2-T1','E2-T5','E2-T9','E2-T14'].every((label) => reliabilityTests.includes(label)));
check('E2 long-session continuity regression suite exists', ['E2-C1','E2-C4','E2-C7'].every((label) => reliabilityTests.includes(label)));
check('Bare wake phrase is classified as control-only', transcript.includes('isWakeControlUtterance') && voice.includes('Wake/control turn accepted; operational command and tool authority unchanged.'));
check('Wake-only control bypasses CommandRegistry mutation path', voice.indexOf('if (isWakeControlUtterance(text))') < voice.indexOf('this.commandRegistry.acceptFinalTranscript(text)'));
check('READY E2 clarification continuity is command-bound', commands.includes("active.workflow === 'E2_MISSING_INVENTORY'") && commands.includes('isWakeQualifiedShortResponse(text)') && commands.includes('fillPendingClarification'));
check('E2 prompt forbids redundant yes/no confirmation once typed EMPTY is complete', voice.includes('do NOT ask Did you check that location') && voice.includes('refresh it by calling check_inventory again under the SAME discrepancy command'));
check('Long transcript/tool/reliability histories preserve stress-test evidence', voicePanel.includes('const TRANSCRIPT_HISTORY = 500') && voicePanel.includes('const TOOL_HISTORY = 100') && voicePanel.includes('const RELIABILITY_HISTORY = 200'));
check('Transcript evidence controls exist', voicePanel.includes('Copy transcript') && voicePanel.includes('Export transcript JSON') && voicePanel.includes('voicestrike-transcript-'));

check('Multiple candidates can become AMBIGUOUS', entities.includes("status: 'AMBIGUOUS'"));

check('Transcript sanity gate exists in client', transcript.includes('assessTranscriptSanity'));
check('Bare yes/ok/da are explicitly ambiguous', transcript.includes("'yes'") && transcript.includes("'okay'") && transcript.includes("'da'"));
check('Unexpected script detection exists', transcript.includes('Script=Latin'));
check('Mutation sanity gate rejects non-operational Latin drift', transcript.includes('NO_OPERATIONAL_SIGNAL') && transcript.includes('requireOperationalSignal'));
check('Server mutation authority is typed and transcript is sanity-only', api.includes('mutationContextGuard') && api.includes('X-VoiceStrike-Workflow') && api.includes('X-VoiceStrike-Command-Ready') && api.includes('requireOperationalSignal: false') && api.includes("mutationContextGuard(req, res, 'E1_WRONG_COMPONENT')") && api.includes("mutationContextGuard(req, res, 'E2_MISSING_INVENTORY')") && api.includes("mutationContextGuard(req, res, 'E3_MISTAKEN_SCAN')"));
check('Prompt states speech is input not authority', voice.includes('Speech is input, not authority'));
check('Prompt states speech content does not prove speaker authority', voice.includes('Speech content alone never proves speaker authority'));

check('Pending command registry exists', existsSync(resolve(root, 'client/src/reliability/commands.ts')));
check('Pending commands support COLLECTING/READY/INVALIDATED', commands.includes("'COLLECTING'") && commands.includes("'READY'") && commands.includes("'INVALIDATED'"));
check('Incomplete commands are blocked before mutation', safeAction.includes('isCommandReady') && safeAction.includes('INCOMPLETE_COMMAND'));
check('Tool calls are tied to causal commandId with no registry fallback', voice.includes('commandIdForToolRequest(name)') && voice.includes("commandForToolCall(causalCommandId ?? '')") && voice.includes('X-VoiceStrike-Command-Id'));
check('Stale tool calls are rejected', voice.includes('STALE_COMMAND') && voice.includes('isCurrent(commandId)'));
check('Explicit cancellation is blocked centrally', safeAction.includes('EXPLICIT_CANCELLATION') && safeAction.includes('isExplicitCancellation'));
check('Untrusted or mismatched critical entity is blocked centrally', safeAction.includes('CRITICAL_ENTITY_REQUIRED') && safeAction.includes('ENTITY_ARGUMENT_MISMATCH') && safeAction.includes('criticalEntityGate(options)'));
check('Transcript/tool entity mismatch is blocked centrally', safeAction.includes('ENTITY_ARGUMENT_MISMATCH'));
check('Reply authority is bound to the causal command and explicitly closed', voice.includes('commandRegistry.beginReply(binding.authorised ? binding.commandId : null)') && voice.includes('commandRegistry.finishReply()'));
check('Compact partial IDs remain incomplete', transcript.includes('isIncompleteTechnicalFragment') && transcript.includes('/(?:^|\\s)[a-d]\\d$/i'));
check('Hybrid compact/spoken IDs are supported', entities.includes('Hybrid compact/spoken forms can occur across STT turn boundaries'));
check('Digits-only STT continuation is supported', transcript.includes('numericDigitsOnly') && transcript.includes('/^(?:\\d{1,8}\\s*)+$/'));
check('Mixed technical IDs accept compact numeric STT tokens', entities.includes('\\d{1,8}'));
check('Agent prompt explains B1 + 84 / 8-4 continuation', voice.includes('B1 followed by 84 or 8-4 means B184'));
// v0.9.0 (defect 5.3): read readiness is decided per tool class, not by the mutation readiness
// gate. get_current_job may bootstrap an accepted turn; entity reads require a safely resolved
// component; the authoritative recovery inspection still requires a READY command (v0.8.1/v0.8.6).
check('Read readiness is decided by the central tool policy', voice.includes('assessReadReadiness({') && voice.includes('commandReady: this.commandRegistry.isReady(commandId)'));
check('Mutations still require a READY command', voice.includes("} else if (mutation && !this.commandRegistry.isReady(commandId)) {"));
check('Tool classes separate read-only bootstrap from mutation', toolPolicy.includes("get_current_job:'CONTEXT_READ'") && toolPolicy.includes("check_inventory:'ENTITY_READ'") && toolPolicy.includes("inspect_last_action:'AUTHORITATIVE_READ'") && ['report_exception','update_job_status','report_inventory_discrepancy','reverse_last_scan'].every((tool) => toolPolicy.includes(`${tool}:'MUTATION'`)));
check('Authoritative recovery inspection still requires a READY command', toolPolicy.includes("if(kind==='AUTHORITATIVE_READ')") && toolPolicy.includes('COMMAND_INCOMPLETE'));
check('Read-only bootstrap cannot rediscover or grant mutation authority', toolPolicy.includes('accumulated transcript is never reparsed') && toolPolicy.includes('trustedComponent') && !toolPolicy.includes('commandContext: string'));
check('Typed bounded clarification retention exists', commands.includes('pendingClarification') && commands.includes('fillPendingClarification') && commands.includes('allowedType'));
check('Fragment-reconstructed component requires explicit entity confirmation', commands.includes('requireConfirmationForReconstructedEntity') && commands.includes("status:'PENDING'") && commands.includes("status: 'CONFIRMED'"));
check('Entity confirmation stays on the same command when the ID matches', commands.includes('receivedValue === pending.expectedValue') && commands.includes('commandId: active.id'));
check('Different entity confirmation supersedes instead of combining IDs', commands.includes("status: 'SUPERSEDED'") && commands.includes('replacementCommandId'));
check('Entity confirmation is an explicit reliability event', voice.includes("event: 'reliability.entity_confirmation'") && read('client/src/reliability/types.ts').includes("'reliability.entity_confirmation'"));
check('Pending entity confirmation blocks read tools before inspect', voice.includes('ENTITY_CONFIRMATION_REQUIRED') && voice.includes('pendingEntityConfirmation(commandId)'));
check('Pronoun-only mistaken-scan clarification can retain intent', transcript.includes("return 'MISTAKEN_SCAN'") && transcript.includes('detectOperationalIntent'));
check('Hyphenated numeric STT continuation is supported', transcript.includes('numericDigitsOnly') && entities.includes("replace(/(?<=\\d)-(?=\\d)/g, ' ')"));
check('Ambient speech gate exists', existsSync(resolve(root, 'client/src/reliability/ambient.ts')) && ambient.includes('AmbientSpeechGate'));
check('Wake phrase is required before operational conversation', ambient.includes('WAKE_REQUIRED') && voice.includes('Say VoiceStrike to begin'));
check('Unrelated ambient speech does not extend wake window', ambient.includes('Unrelated TV/background speech does not') || ambient.includes('Unrelated TV/background speech'));
// v0.9.0 (defect 5.4): the mutable session flag `suppressAmbientReply` is gone. Suppression is a
// per-reply immutable binding that a later reply boundary cannot clear.
check('Mutable session suppression flag is gone', !voice.includes('suppressAmbientReply'));
check('Replies are bound to the accepted turn that caused them', voice.includes('this.replyAuthority.beginReply(replyId, this.epochs.current())') && voice.includes('TURN_AUTHORITY_REQUIRED'));
check('Orphan replies are never audible and operational PCM is claim-gated', voice.includes('if (!audio || !this.replyAuthority.isCurrentReplyAuthorised()) break;') && voice.includes("this.replyClaimMode === 'BUFFER'") && voice.includes('assessAgentReplyClaims(text, command)') && voice.includes('this.gatedAudio = [];') && voice.includes('if (!text || !authorised) break;'));
check('RC4 speech onset is recorded without revoking the reply in progress', voice.includes('this.replyAuthority.interruptCurrentReply(this.lastSpeechStartedAt)') && replyAuthority.includes('interruptCurrentReply(now = Date.now())') && replyAuthority.includes('onsetDuringReplyAt') && !replyAuthority.includes('delayedToolOwner'));
check('RC4 no stale tail and no rehydration over a newer accepted turn', !replyAuthority.includes('delayedToolOwner') && replyAuthority.includes('this.lingering = null;') && replyAuthority.includes("if (!turn.initialReplyStarted) return null;"));
check('Mutation requests carry typed workflow and command-ready headers', voice.includes('X-VoiceStrike-Workflow') && voice.includes('X-VoiceStrike-Command-Ready'));
check('E2 complete typed EMPTY report continues deterministically in code', voice.includes('continueDeterministicE2(') && voice.includes("const mutationName: MutationToolName = 'report_inventory_discrepancy'") && voice.includes("const altName = 'find_alternative_inventory'"));
check('E2 deterministic continuation records authoritative alternative before completion', voice.includes('this.noteAuthoritativeRead(commandId, altName, altArgs, altPayload)') && voice.includes('this.commandRegistry.markComplete(commandId)'));
check('Final operational speech claim gate exists', replyClaims.includes('assessAgentReplyClaims') && replyClaims.includes('UNAUTHORISED_LOCATION_CLAIM') && replyClaims.includes('UNAUTHORISED_QUANTITY_CLAIM') && replyClaims.includes('UNVERIFIED_MUTATION_CLAIM'));
check('False operational PCM is dropped before reaching worker', voice.includes("this.replyClaimMode = 'BLOCK'") && voice.includes('Unsafe operational claim suppressed') && voice.includes('private releaseGatedAudio(): void'));
// RC5
const spokenIds = read('client/src/reliability/spokenIds.ts');
check('RC5 claim gate normalises spoken IDs and parses quantities with IDs masked', replyClaims.includes('normalizeSpokenTechnicalIds(rawText)') && replyClaims.includes('claimedAvailabilityQuantities(quantityText)') && spokenIds.includes('export function maskTechnicalIds'));
check('RC5 PCM is released per validated sentence, with full-buffer fallback when word timing is missing', voice.includes("case 'transcript.agent.delta': {") && voice.includes('Math.round(endMs * SAMPLES_PER_MS)') && voice.includes("this.gatedMode = 'FULL_BUFFER';"));
check('RC5 trusted PREPARE/CONFIRM are executed by code from authoritative state', voice.includes('this.startCodeOwnedProtectedAction(id, command.id,') && voice.includes("if (ctx && ctx.commandId === commandId) { actionId = ctx.actionId; componentId = ctx.componentId; }") && voice.includes("if (pending && pending.preparedCommandId === commandId) { actionId = pending.actionId; componentId = pending.componentId; }"));
check('RC5 code-owned execution runs through the same gated tool path', voice.includes("{ call_id: entry.syntheticCallId, name: 'reverse_last_scan', arguments: { action_id: actionId, component_id: componentId } },") && voice.includes('internal ? internal.commandId : this.replyAuthority.commandIdForToolRequest(name)'));
check('RC5 provider reverse_last_scan joins code execution (no second mutation)', voice.includes('const joined = !internal && name === \'reverse_last_scan\' && commandId ? this.codeOwnedFor(commandId) : null;'));
check('RC5 code outcome delivered by conversation.message + reply.create only when nothing is owed', voice.includes("type: 'reply.create'") && voice.includes("type: 'conversation.message', role: 'system'") && voice.includes('this.replyAuthority.canRequestCodeReply(entry.commandId, entry.syntheticCallId)'));
check('RC5 provider correlation can only downgrade reply authority', voice.includes("this.replyAuthority.demoteCurrentReply('PROVIDER_ITEM_REJECTED')") && replyAuthority.includes('demoteCurrentReply('));
check('RC5 interrupted fc-<call_id> replies discard their call result', voice.includes("providerReplyId.startsWith('fc-')") && voice.includes('this.interruptedCallIds.has(tool.callId)'));
check('RC5 regressions exist', existsSync(resolve(root, 'scripts/test-claims-rc5.mts')));
check('Reply claim rejection is exported as reliability telemetry', clientTypes.includes("'reliability.reply_claim_rejected'") && voice.includes("event: 'reliability.reply_claim_rejected'"));
check('Rejected speech cannot open or close a reply-authorised turn', replyAuthority.includes("if (verdict === 'REJECTED')") && replyAuthority.includes('NO_ACCEPTED_TURN'));
check('RC4 tool calls are registered at admission and hold their turn until handed off', replyAuthority.includes('inFlightCalls') && voice.includes('this.replyAuthority.noteToolRequest(commandId, name, Date.now(), callId)') && voice.includes('this.replyAuthority.markPendingWork(tool.callId);') && voice.includes('this.replyAuthority.markToolResultSent(tool.callId);'));
check('RC4 provider events are processed through one ordered queue', voice.includes("this.ws.addEventListener('message', (event) => this.enqueueProviderEvent(event));") && voice.includes('this.enqueueInternal(() => this.commitToolResult(completed));') && !voice.includes('void this.handleMessage(event)'));
check('RC4 tool.result handoff follows the documented reply.started/input.speech.started/reply.done rule', voice.includes("this.resultHandoffEvent !== 'reply.done'") && !voice.includes("this.lastEventType !== 'reply.done'"));
check('RC4 an accepted turn owns one initial reply plus owed continuations only', replyAuthority.includes("'TURN_REPLY_ALREADY_USED'") && replyAuthority.includes('if (!turn.initialReplyStarted) {'));
check('RC4 wake-only utterance is a reply fence', voice.includes("this.turnAuthorities.clearCurrent();\n          // RC4: a wake-only utterance is a reply fence"));
check('RC4 lifecycle instrumentation exists', ['reliability.provider_event', 'reliability.tool_result_sent', 'reliability.tool_result_discarded', 'reliability.protected_speech_window_not_opened'].every((e) => voice.includes(`'${e}'`)) && voice.includes('rejected_text='));
check('RC4 regressions exist', existsSync(resolve(root, 'scripts/test-lifecycle-rc4.mts')) && existsSync(resolve(root, 'scripts/test-event-pipeline-rc4.mts')));
check('Mutation requests carry wake authority', voice.includes('X-VoiceStrike-Wake-Authority') && api.includes('WAKE_AUTHORITY_REQUIRED'));
check('Reverse confirmation requires wake phrase in latest worker turn', serverConfirmation.includes('hasWakePhrase') && api.includes('VoiceStrike, confirm reverse scan'));
check('Microphone AGC is disabled to avoid boosting background speech', voice.includes('autoGainControl: false'));
check('Browser noise suppression and echo cancellation remain enabled', voice.includes('echoCancellation: true') && voice.includes('noiseSuppression: true'));
check('Voice isolation is requested when browser supports it', voice.includes('voiceIsolation'));
check('Local RMS noise gate exists', pcmProcessor.includes('openThreshold') && pcmProcessor.includes('closeThreshold') && pcmProcessor.includes('hangoverFrames'));
check('VAD threshold balances worker sensitivity with ambient filtering', voice.includes('vad_threshold: 0.45') && !voice.includes('vad_threshold: 0.6'));
check('Wake clarification window is shortened from 30s', ambient.includes('WAKE_WINDOW_MS = 15_000'));
// v0.8.11 conversational clarification continuity
check('Solicited clarification window exists and is bounded', ambient.includes('CLARIFICATION_WINDOW_MS = 30_000') && ambient.includes("'CLARIFICATION_WINDOW'"));
check('Clarification window is bound to the active command', ambient.includes('clarificationCommandId') && ambient.includes('activeCommandId') && ambient.includes('this.clarificationCommandId === commandId'));
check('Clarification window accepts only clarification continuations', ambient.includes('isClarificationContinuation(text)') && ambient.includes('solicitedClarification'));
check('Accepted clarification consumes its one-shot window', ambient.includes('this.clearClarificationWindow();') && ambient.includes("status: 'CLARIFICATION_WINDOW'"));
check('Agent reply completion opens clarification only for COLLECTING command', voice.includes("activeCommand.status === 'COLLECTING'") && voice.includes('this.ambientGate.openClarificationWindow(activeCommand.id)'));
check('Ambient assessment receives current command binding', voice.includes('activeCommandId: this.commandRegistry.current()?.id ?? null'));
check('Protected critical trust still runs before clarification wake handling', voice.indexOf('criticalSpeechTrustGate.assess') < voice.indexOf('ambientGate.assess'));
// v0.9.0 (defect 5.2): truthful reporting is no longer carried by one hand-written sentence.
// Every tool result carries derived claim grounding; the wording rule lives in claims.ts.
check('Locally blocked tools never claim a tool/system failure', toolPolicy.includes('No operational tool has failed or been called.') && voice.includes('No operational tool has failed or been called.'));
check('Claim grounding carries exact authorised read facts', voice.includes('authoritativeFactsForResult') && voice.includes('authorised_facts') && voice.includes('claim_grounding'));
check('Claim grounding requires an attempted call before a failure claim', claims.includes("const toolFailure = attempted && has('TOOL_RETURNED_FAILURE');"));
check('Claim grounding requires independent verification before a state-change claim', claims.includes("const verified = has('VERIFIED_SUCCESS') && has('VERIFICATION_PASSED');"));
check('Operational stage vocabulary is explicit', ['TOOL_REQUESTED', 'TOOL_BLOCKED_LOCAL', 'TOOL_ATTEMPTED', 'TOOL_RETURNED_FAILURE', 'MUTATION_STARTED', 'MUTATION_COMPLETED', 'VERIFICATION_STARTED', 'VERIFICATION_FAILED', 'VERIFICATION_PASSED', 'VERIFIED_SUCCESS'].every((stage) => claims.includes(`'${stage}'`)));
check('E1 solicited clarification regression is automated', reliabilityTests.includes('E1 solicited B184 stays on the same commandId') && reliabilityTests.includes('E1 solicited B184 makes WRONG_COMPONENT command READY'));
check('Duplex echo guard exists', existsSync(resolve(root, 'client/src/reliability/duplex.ts')) && duplex.includes('DuplexEchoGuard'));
check('Critical reversal phrases are blocked when speech begins during agent audio', duplex.includes('CRITICAL_DURING_AGENT_AUDIO') && duplex.includes('isProtectedCriticalPhrase'));
check('Critical reversal requires a fresh VAD speech-start event', duplex.includes('CRITICAL_WITHOUT_FRESH_SPEECH_START'));
check('Echo-like transcript overlap is suppressed only inside agent audio window', duplex.includes('ECHO_LIKE_DURING_AGENT_AUDIO') && duplex.includes('similarity >= 0.72'));
check('Voice client tracks speech start for duplex authority', voice.includes('lastSpeechStartedAt') && voice.includes('assessUserTranscript'));
check('Echo suppression is silent before command acceptance', voice.includes('reliability.echo_suppressed') && voice.includes('Possible speaker/TV echo ignored'));
check('Critical Speech Trust Gate exists', existsSync(resolve(root, 'client/src/reliability/criticalSpeech.ts')) && criticalSpeech.includes('CriticalSpeechTrustGate'));
check('Critical Trust Gate requires fresh VAD', criticalSpeech.includes('NO_FRESH_VAD') && criticalSpeech.includes('speechStartedAt'));
check('Critical Trust Gate requires post-TTS quiet gap', criticalSpeech.includes('CRITICAL_POST_TTS_QUIET_MS = 1_500') && criticalSpeech.includes('POST_TTS_QUIET_GAP_REQUIRED'));
// v0.9.2: real protected speech uses an exact command/action/component window tied to audible PCM completion.
check('Protected speech window module exists', existsSync(resolve(root, 'client/src/reliability/protectedSpeech.ts')) && protectedSpeech.includes('ProtectedSpeechWindowRegistry'));
check('Protected speech window binds epoch/command/action/component/kind', ['epoch', 'commandId', 'actionId', 'componentId', 'expectedKind'].every((field) => protectedSpeech.includes(`${field}:`)));
check('Protected speech window opens from audible playback completion', protectedSpeech.includes('promptAudioDoneAt') && protectedSpeech.includes('PROTECTED_POST_TTS_QUIET_MS = 550') && voice.includes('estimatedPlaybackDoneWallClock'));
check('Protected critical speech requires matching window in runtime path', voice.includes('this.protectedSpeechWindows.assess') && protectedSpeech.includes('PROTECTED_WINDOW_REQUIRED'));
check('Rejected protected speech does not consume the window', protectedSpeech.includes('Only a fully accepted matching worker turn consumes the window') && voice.indexOf('protectedSpeechWindows.consume') > voice.indexOf('turnAuthorities.grant'));
check('Inspect arms PREPARE and protected preparation arms CONFIRM windows', voice.includes("expectedKind: 'REVERSE_PREPARE'") && voice.includes("expectedKind: 'REVERSE_CONFIRM'"));
check('Protected window timing regressions exist', ['PSW-4 too-early protected speech is rejected without consuming the window', 'PSW-8 trusted command-bound window replaces the fragile global 1.5 s wait', 'PSW-9 terminal old window cannot poison a fresh inspect for the same action'].every((label) => reliabilityTests.includes(label)));
// v0.9.3: live provider ordering may place reply boundaries before the protected tool.call.
check('Protected reply tool-call lease exists', replyAuthority.includes('PROTECTED_TOOL_LEASE_TTL_MS') && replyAuthority.includes('armProtectedToolLease') && replyAuthority.includes('PROTECTED_TOOL_LEASE_PENDING'));
check('Protected tool-call lease is armed only by accepted PREPARE/CONFIRM turns', voice.includes('this.replyAuthority.armProtectedToolLease({') && voice.includes("expectedTool: 'reverse_last_scan'"));
check('Delayed protected tool.call is explicitly correlated to its held turn', voice.includes('this.replyAuthority.noteToolRequest(commandId, name, Date.now(), callId)') && replyAuthority.includes('noteToolRequest(commandId: string, toolName: string'));
check('Confirmation TTL starts after audible confirmation prompt', confirmation.includes('activateConfirmationWindow') && confirmation.includes('expiresAt: number | null') && voice.includes('this.criticalConfirmationGate.activateConfirmationWindow({'));
check('Live reply-boundary and deferred confirmation-TTL regressions exist', ['R-F3 intervening provider reply stays suppressed while protected lease waits for tool.call', 'R-F3 confirmation prompt reply is authorised as TOOL_CONTINUATION on the same command', 'R-F4 ordinary 20 s confirmation TTL does not expire before prompt delivery', 'R-F4 gate deadline is activated from the opened confirmation window'].every((label) => reliabilityTests.includes(label)));
check('Integrated live-order protected recovery regression exists', reliabilityTests.includes('R-F5 integrated delayed PREPARE→prompt→CONFIRM lifecycle reaches CONFIRMED'));
check('Critical Trust Gate requires explicit wake phrase', criticalSpeech.includes('WAKE_PHRASE_REQUIRED') && criticalSpeech.includes('containsWakePhrase'));
check('False critical confirm requires a prepared confirmation', criticalSpeech.includes('NO_PREPARED_CONFIRMATION') && voice.includes('criticalConfirmationGate.pending()'));
check('Prepared confirmation component must match trusted speech', criticalSpeech.includes('PREPARED_COMPONENT_MISMATCH'));
check('Cold reverse command requires established recovery context', criticalSpeech.includes('RECOVERY_CONTEXT_REQUIRED') && voice.includes('hasRecoveryContext'));
check('Authoritative recovery speech context comes only from inspect_last_action', voice.includes("name === 'inspect_last_action'") && voice.includes('recovery_eligible === true') && voice.includes("source: 'TOOL_RESULT'") && api.includes("event = 'TOOL_INSPECT_LAST_ACTION'"));
check('Recovery speech context expires with the server inspection window', recovery.includes('RECOVERY_CONTEXT_TTL_MS = 120_000') && api.includes('Date.now() - 2 * 60 * 1000'));
check('Protected reverse component must match inspected recovery component', criticalSpeech.includes('RECOVERY_COMPONENT_MISMATCH') && criticalSpeech.includes('recoveryComponentId'));
check('Rejected critical speech is blocked before command registry acceptance', voice.indexOf('critical_speech_rejected') < voice.indexOf('commandRegistry.acceptFinalTranscript(text)'));
check('Rejected critical speech produces a dead conversational turn', voice.includes('Critical speech rejected:') && voice.includes("this.rejectTurn(id, `CRITICAL_${criticalTrust.reason ?? 'UNTRUSTED'}`);") && voice.includes("this.replyAuthority.noteTurn(turnId, 'REJECTED');"));
check('Rejected speech removes any surfaced partial transcript', voice.includes('onTranscriptRemove?.(id)') && voicePanel.includes('onTranscriptRemove'));
check('Critical trust score is telemetry only, not mutation authority', criticalSpeech.includes('score') && voice.includes('trust=${criticalTrust.score.toFixed(2)}'));
check('Dangerous full mutation phrases are not AssemblyAI keyterms', !voice.includes("'VoiceStrike reverse scan B184', 'VoiceStrike confirm reverse scan B184'") && voice.includes("'JOB-482'") && voice.includes("'B184'"));
check('Project false-transcript rule is persisted', existsSync(resolve(root, 'evidence/build7/PROJECT_RULES.md')) && read('evidence/build7/PROJECT_RULES.md').includes('False transcript may happen. False mutation must not.'));
check('Local Reliability DEV panel exists', voicePanel.includes('Reliability DEV panel') && clientTelemetry.includes('voicestrike:reliability'));
check('Reliability DEV telemetry remains separate from operational audit', clientTelemetry.includes('separate from operational audit') && telemetry.includes('MAX_EVENTS = 3000'));
check('Truthful tool reporting helper exists', existsSync(resolve(root, 'client/src/reliability/toolReporting.ts')) && toolReporting.includes('classifyToolReporting'));
check('TOOL_FAILED requires an attempted returned tool failure', toolReporting.includes('input.toolCallAttempted && input.toolReturnedFailure') && toolReporting.includes("input.pipelineOutcome === 'TOOL_FAILED' ? 'REJECTED'"));
check('Gate refusals are not generically rewritten as TOOL_FAILED', !voice.includes("outcome: isError ? 'TOOL_FAILED' : undefined") && voice.includes('toolReturnedFailure: toolFailed'));
check('Not-ready read response states no operational tool failed or was called', voice.includes('No operational tool has failed or been called.'));
check('Critical confirmation gate exists', existsSync(resolve(root, 'client/src/reliability/confirmation.ts')) && confirmation.includes('CriticalConfirmationGate'));
check('First protected reversal only prepares action', confirmation.includes("status: 'PREPARED'") && confirmation.includes('SECOND_CONFIRMATION_REQUIRED'));
check('Second confirmation must be a separate worker turn', confirmation.includes('SECOND_CONFIRMATION_MUST_BE_NEW_TURN') && confirmation.includes('preparedTurnId === input.turnId'));
check('Second confirmation is bound to command/action/component', confirmation.includes('preparedCommandId !== input.commandId') && confirmation.includes('this.prepared.actionId !== actionId') && confirmation.includes('this.prepared.componentId !== componentId'));
check('Second confirmation requires VoiceStrike + confirm + reverse + scan + component', confirmation.includes("tokenSet.has('CONFIRM')") && confirmation.includes('containsWakePhrase'));
check('Voice tool handler stages reversal before Safe Action Executor', voice.includes('criticalConfirmationGate.assessReverse') && voice.includes("event: 'reliability.second_confirmation_required'"));
check('Confirmed reversal carries deterministic prepared-authority headers', voice.includes('X-VoiceStrike-Prepared-Command-Id') && voice.includes('X-VoiceStrike-Prepared-Turn-Id') && voice.includes('X-VoiceStrike-Prepared-Action-Id') && voice.includes('X-VoiceStrike-Prepared-Component-Id'));
check('Server prepared-confirmation validator exists', existsSync(resolve(root, 'server/src/reliability/confirmation.ts')) && serverConfirmation.includes('validatePreparedReversalAuthority'));
check('Server independently requires prepared two-step authority', api.includes('validatePreparedReversalAuthority') && serverConfirmation.includes('SECOND_CONFIRMATION_REQUIRED') && serverConfirmation.includes("requiredWords = ['CONFIRM', 'REVERSE', 'SCAN'"));
check('Server requires prepared and confirmation turns to differ', serverConfirmation.includes('input.preparedTurnId !== input.currentTurnId'));
check('Recovery audit records two-step authority', api.includes('RECENT_INSPECTION_PLUS_TWO_STEP_ACTION_SPECIFIC_USER_CONFIRMATION'));
check('Reliability runner uses ESM-safe .mts', pkg.scripts['test:reliability-core']?.includes('test-reliability-core.mts'));
check('Client tsconfig avoids invalid allowImportingTsExtensions build flag', !read('client/tsconfig.node.json').includes('allowImportingTsExtensions'));

check('Safe Action Executor exists', existsSync(resolve(root, 'client/src/reliability/safeAction.ts')));
check('Current mutation tools use common executor', safeAction.includes("'report_exception'") && safeAction.includes("'update_job_status'") && safeAction.includes("'report_inventory_discrepancy'") && safeAction.includes("'reverse_last_scan'"));
check('Mutation success requires independent verification', safeAction.includes('verification_started') && safeAction.includes('verifyMutation'));
check('Success claim gate requires VERIFIED_SUCCESS + verified true', safeAction.includes("result.outcome === 'VERIFIED_SUCCESS' && result.verified === true"));
check('Reverse verification performs independent inspect', safeAction.includes("/api/tools/inspect-last-action") && safeAction.includes("X-VoiceStrike-Verification"));
check('Wrong-component exception gets authoritative state verification', safeAction.includes("toolName === 'report_exception'") && safeAction.includes("state.exceptions"));
check('Job BLOCKED mutation gets authoritative state verification', safeAction.includes("toolName === 'update_job_status'") && safeAction.includes('job.status'));
check('Inventory discrepancy gets authoritative verification', safeAction.includes('POST_DISCREPANCY_VERIFICATION_FAILED'));
check('No blind mutation retry path', safeAction.includes('never blindly retried') && !safeAction.includes('retryMutation'));

check('Reliability telemetry ring exists', telemetry.includes('MAX_EVENTS = 3000'));
check('Reliability telemetry API exists', api.includes("'/reliability/telemetry'"));
// v0.9.0 (defect 5.8): `reliability.tool_called` was emitted even when tool_call_attempted=false.
// Intent, authorisation, local refusal and real execution are now separate, unambiguous events.
check('Ambiguous reliability.tool_called event is gone', !voice.includes('reliability.tool_called') && !clientTypes.includes('reliability.tool_called'));
check('Tool lifecycle telemetry is unambiguous', ['reliability.tool_requested', 'reliability.tool_authorisation_checked', 'reliability.tool_blocked_local', 'reliability.tool_attempted', 'reliability.tool_result', 'reliability.verified_success'].every((event) => voice.includes(event) && clientTypes.includes(event)));
check('Latency-stage telemetry events exist', voice.includes('reliability.speech_end') && voice.includes('reliability.transcript_final') && voice.includes('reliability.tool_attempted') && voice.includes('reliability.tool_result') && voice.includes('reliability.response_started'));
check('Telemetry carries correlation identifiers', ['epoch', 'actionId', 'componentId', 'authorityId', 'tool', 'attempted', 'resultClass'].every((field) => clientTypes.includes(`${field}?:`)));
check('Audit and telemetry remain separate modules', api.includes("audit('TOOL_") && existsSync(resolve(root, 'server/src/reliability/telemetry.ts')));

check('Failure injection module exists', existsSync(resolve(root, 'server/src/reliability/faults.ts')));
check('Failure injection disabled unless explicit non-production flag', faults.includes("NODE_ENV !== 'production'") && faults.includes("VOICESTRIKE_ENABLE_RELIABILITY_FAULTS === 'true'"));
check('Failure injection API exists', api.includes("'/reliability/fault'"));
check('REVERSE_AFTER_MUTATION fault exists', faults.includes('REVERSE_AFTER_MUTATION') && api.includes("consumeFault('REVERSE_AFTER_MUTATION')"));
check('Post-mutation fault returns unknown action state', api.includes('unknown_action_state: true'));
check('Verification failure points exist', faults.includes('VERIFY_BEFORE') && faults.includes('VERIFY_TIMEOUT'));
check('Verification faults apply to state and last-action reads', api.includes("apiRouter.get('/state', (req, res)") && api.includes("apiRouter.get('/tools/inspect-last-action', (req, res)"));

check('Connection loss records reliability event', voice.includes('reliability.connection_lost'));
check('Unknown connection state requires recovery', voice.includes('recoveryRequired'));
check('Reconnect runs authoritative recovery before mutations', voice.includes('recoverAfterConnectionLoss') && voice.includes('RECOVERY_REQUIRED'));
check('Recovery refreshes state and last action', voice.includes("fetch('/api/state'") && voice.includes("fetch('/api/tools/inspect-last-action'"));
check('Recovery explicitly avoids mutation replay', voice.includes('No mutation was replayed'));

check('Keyterms A/B switch exists', voice.includes("get('keyterms') === 'off'"));
check('Job-specific keyterms preserved', voice.includes("'JOB-482'") && voice.includes("'B148'") && voice.includes("'B184'"));

// BUILD 6 regression invariants
check('BUILD 6 seeded reversible B184 scan preserved', read('server/src/db/database.ts').includes("'ACT-SCAN-B184'") && read('server/src/db/database.ts').includes("'SCAN_COMPONENT'"));
check('inspect_last_action endpoint preserved', api.includes("'/tools/inspect-last-action'"));
check('reverse_last_scan endpoint preserved', api.includes("'/tools/reverse-last-scan'"));
check('Recovery still requires recent inspection', api.includes('NO_RECENT_INSPECTION'));
check('Recovery still requires exact action ID', api.includes('ACTION_ID_MISMATCH'));
check('Recovery still requires exact component', api.includes('COMPONENT_MISMATCH'));
check('Action-specific confirmation still enforced', serverConfirmation.includes('EXPLICIT_CONFIRMATION_REQUIRED'));
check('Mutation cannot self-declare verified', api.includes('reversal_executed: true') && api.includes('verified: false') && api.includes('verification_required: true'));
check('Supervisor RECOVERY VERIFIED still requires post-reverse inspection', supervisor.includes('Boolean(postReverseInspection)') && supervisor.includes('RECOVERY VERIFIED'));
check('Inspect → Reverse → Inspect evidence remains possible', voice.includes("name: 'inspect_last_action'") && voice.includes("name: 'reverse_last_scan'"));

if (checks.some(([, ok]) => !ok)) {
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  console.error(`\nBUILD 7 structural validation FAILED (${checks.length - failed.length}/${checks.length}).`);
  console.error(`Failed: ${failed.join('; ')}`);
  process.exit(1);
}

console.log(`\nBUILD 7 structural validation passed (${checks.length}/${checks.length}).`);
