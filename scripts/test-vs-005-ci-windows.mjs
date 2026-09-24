import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');
let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
  }
}

check(/runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/.test(workflow), 'VS-005 required job runs from OS matrix');
check(/ubuntu-latest/.test(workflow), 'VS-005 CI includes Ubuntu runner');
check(/windows-latest/.test(workflow), 'VS-005 CI includes Windows runner');
check(/node-version:\s*['"]?24['"]?/.test(workflow), 'VS-005 CI uses Node 24 to match validated runtime family');
check(/run:\s*npm run ci:required/.test(workflow), 'VS-005 every matrix runner executes ci:required');

console.log(`\nVS-005 CI portability gate: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
