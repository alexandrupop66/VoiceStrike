import fs from 'node:fs';

const checks = [
  ['BUILD5_STATUS exists', fs.existsSync('BUILD5_STATUS.md')],
  ['Build 5 test plan exists', fs.existsSync('evidence/build5/BUILD5_TEST_PLAN.md')],
  ['server route source exists', fs.existsSync('server/src/routes/api.ts')],
  ['voice client exists', fs.existsSync('client/src/voice/voiceAgent.ts')],
];

const api = fs.readFileSync('server/src/routes/api.ts', 'utf8');
const voice = fs.readFileSync('client/src/voice/voiceAgent.ts', 'utf8');
const db = fs.readFileSync('server/src/db/database.ts', 'utf8');
const sup = fs.readFileSync('client/src/components/SupervisorView.tsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

checks.push(
  ['package version 0.6.0', pkg.version === '0.6.0'],
  ['health reports build 5', api.includes('build: 5')],
  ['inventory alternates table', db.includes('inventory_alternates')],
  ['B148 alternative D05 seeded', db.includes("'B148', 'D05', 4")],
  ['report inventory discrepancy endpoint', api.includes("'/tools/report-inventory-discrepancy'")],
  ['recent positive stock gate', api.includes('NO_RECENT_POSITIVE_STOCK_CHECK')],
  ['location mismatch gate', api.includes('LOCATION_MISMATCH')],
  ['inventory discrepancy exception', api.includes("type: 'INVENTORY_DISCREPANCY'")],
  ['find alternative endpoint', api.includes("'/tools/find-alternative-inventory'")],
  ['voice declares discrepancy tool', voice.includes("name: 'report_inventory_discrepancy'")],
  ['voice declares alternative tool', voice.includes("name: 'find_alternative_inventory'")],
  ['voice routes discrepancy tool locally', voice.includes("/api/tools/report-inventory-discrepancy")],
  ['voice routes alternative tool locally', voice.includes("/api/tools/find-alternative-inventory")],
  ['supervisor renders inventory discrepancy', sup.includes('INVENTORY DISCREPANCY ACTIVE')],
  ['supervisor renders alternative stock', sup.includes('Alternative stock')],
  ['reset restores C12 qty 7', api.includes("location = 'C12', quantity = 7")],
  ['server log says Build 5', fs.readFileSync('server/src/index.ts','utf8').includes('VoiceStrike Build 5 API')],
);

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}
if (failures) {
  console.error(`BUILD 5 structural validation failed: ${failures} check(s).`);
  process.exit(1);
}
console.log(`BUILD 5 structural validation passed: ${checks.length}/${checks.length}.`);
