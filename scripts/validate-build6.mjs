import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const checks = [];
const check = (label, ok) => { checks.push([label, Boolean(ok)]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const api = read('server/src/routes/api.ts');
const db = read('server/src/db/database.ts');
const voice = read('client/src/voice/voiceAgent.ts');
const supervisor = read('client/src/components/SupervisorView.tsx');
const types = read('client/src/types.ts');
const app = read('client/src/App.tsx');
const pkg = JSON.parse(read('package.json'));

check('BUILD6_STATUS exists', existsSync(resolve(root, 'BUILD6_STATUS.md')));
check('Build 1 reliability findings preserved', existsSync(resolve(root, 'evidence/build1/BUILD1_FINDINGS.md')));
check('Build 6 test plan exists', existsSync(resolve(root, 'evidence/build6/BUILD6_TEST_PLAN.md')));
check('Version is 0.7.0', pkg.version === '0.7.0');
check('Health reports build 6', api.includes('build: 6'));
check('Server log reports Build 6', read('server/src/index.ts').includes('VoiceStrike Build 6 API'));
check('Demo seeds reversible B184 scan', db.includes("'ACT-SCAN-B184'") && db.includes("'SCAN_COMPONENT'"));
check('Dashboard includes actions', api.includes('const actions =') && api.includes('alternatives, exceptions, actions, audit'));
check('inspect_last_action endpoint exists', api.includes("'/tools/inspect-last-action'"));
check('reverse_last_scan endpoint exists', api.includes("'/tools/reverse-last-scan'"));
check('Recovery requires recent inspection', api.includes('NO_RECENT_INSPECTION'));
check('Recovery requires exact action id', api.includes('ACTION_ID_MISMATCH'));
check('Recovery requires exact component', api.includes('COMPONENT_MISMATCH'));
check('Bare confirmation is deterministically rejected', api.includes('EXPLICIT_CONFIRMATION_REQUIRED'));
check('Confirmation comes from latest user transcript', voice.includes('confirmationText: this.lastFinalUserText'));
check('Client captures final user transcript', voice.includes('this.lastFinalUserText = text'));
check('Voice registers inspect_last_action', voice.includes("name: 'inspect_last_action'"));
check('Voice registers reverse_last_scan', voice.includes("name: 'reverse_last_scan'"));
check('Prompt requires post-reversal verification', voice.includes('Then call inspect_last_action again to verify reversed is true'));
check('Tool result remains JSON string', voice.includes('result: JSON.stringify(tool.result)'));
check('Tool results still wait for reply.done', /this\.(lastEventType|resultHandoffEvent) !== 'reply\.done'/.test(voice) /* RC4: same invariant, documented handoff gate */);
check('Interrupted replies discard pending tools', voice.includes("String(message.status ?? '') === 'interrupted'"));
check('Supervisor renders recovery verified state', supervisor.includes('RECOVERY VERIFIED') && supervisor.includes('scan → REVERSED'));
check('Client type includes actions', types.includes('actions: ActionRecord[]'));
check('Build tag is BUILD 6', app.includes('BUILD 6'));

if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log(`\nBUILD 6 structural validation passed (${checks.length}/${checks.length}).`);
