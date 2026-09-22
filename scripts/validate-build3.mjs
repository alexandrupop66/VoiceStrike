import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'client/src/voice/voiceAgent.ts',
  'server/src/routes/api.ts',
  'BUILD3_STATUS.md',
  'evidence/build3/BUILD3_TEST_PLAN.md',
];

let failed = false;
for (const rel of required) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.error(`FAIL missing ${rel}`);
    failed = true;
  }
}

const voice = fs.readFileSync(path.join(root, 'client/src/voice/voiceAgent.ts'), 'utf8');
const api = fs.readFileSync(path.join(root, 'server/src/routes/api.ts'), 'utf8');
const checks = [
  ['voice declares check_component', voice.includes("name: 'check_component'")],
  ['voice declares report_exception', voice.includes("name: 'report_exception'")],
  ['voice declares update_job_status', voice.includes("name: 'update_job_status'")],
  ['voice declares check_inventory', voice.includes("name: 'check_inventory'")],
  ['backend check-component route', api.includes("'/tools/check-component'")],
  ['backend report-exception route', api.includes("'/tools/report-exception'")],
  ['backend update-job-status route', api.includes("'/tools/update-job-status'")],
  ['backend check-inventory route', api.includes("'/tools/check-inventory'")],
  ['backend deterministic NO_MISMATCH gate', api.includes("error: 'NO_MISMATCH'")],
  ['backend deterministic block authority gate', api.includes("error: 'NO_AUTHORITY_TO_BLOCK'")],
  ['demo reset route', api.includes("'/demo/reset'")],
];

for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log('BUILD 3 structural validation passed.');
