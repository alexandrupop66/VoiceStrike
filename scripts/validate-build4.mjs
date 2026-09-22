import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const expect = (name, condition) => checks.push({ name, pass: Boolean(condition) });

const pkg = JSON.parse(read('package.json'));
const server = read('server/src/routes/api.ts');
const index = read('server/src/index.ts');
const db = read('server/src/db/database.ts');
const app = read('client/src/App.tsx');
const supervisor = read('client/src/components/SupervisorView.tsx');
const styles = read('client/src/styles.css');
const status = read('BUILD4_STATUS.md');
const testPlan = read('evidence/build4/BUILD4_TEST_PLAN.md');

expect('version is 0.5.0', pkg.version === '0.5.0');
expect('BUILD4_STATUS exists', status.includes('Supervisor Live State'));
expect('BUILD4 test plan exists', testPlan.includes('Two-screen primary demo'));
expect('health reports build 4', server.includes('build: 4'));
expect('server log says Build 4', index.includes('VoiceStrike Build 4 API running'));
expect('SQLite data directory auto-created', db.includes('mkdirSync(dataDir, { recursive: true })'));
expect('server exposes SSE endpoint', server.includes("apiRouter.get('/events'"));
expect('server emits text/event-stream', server.includes("text/event-stream"));
expect('server broadcasts authoritative state', server.includes('broadcastState(event'));
expect('client uses EventSource', app.includes("new EventSource('/api/events')"));
expect('client has reconnect state', app.includes("'reconnecting'"));
expect('fallback only when SSE not open', app.includes('events.readyState !== EventSource.OPEN'));
expect('UI is labeled BUILD 4', app.includes('BUILD 4'));
expect('Supervisor has live link', supervisor.includes('LIVE LINK'));
expect('Supervisor has production exception banner', supervisor.includes('PRODUCTION EXCEPTION ACTIVE'));
expect('Supervisor derives observed component from audit', supervisor.includes('observed_component'));
expect('latest audit is highlighted', styles.includes('.audit-latest'));
expect('BUILD 3 authority workflow preserved', server.includes('NO_RECENT_VERIFIED_MISMATCH') && server.includes('NO_AUTHORITY_TO_BLOCK'));

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}`);
  if (!check.pass) failed = true;
}

if (failed) {
  console.error('\nBUILD 4 structural validation failed.');
  process.exit(1);
}

console.log('\nBUILD 4 structural validation passed.');
