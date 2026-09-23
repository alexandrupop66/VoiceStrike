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

check(/(?:^|\n)\s*push:\s*(?:\n|$)/.test(workflow), 'VS-006 workflow has a push trigger');
check(!/(?:^|\n)\s*push:\s*\n\s*branches:\s*\[\s*main\s*\]/.test(workflow), 'VS-006 push trigger is not restricted to main');
check(/windows-latest/.test(workflow) && /ubuntu-latest/.test(workflow), 'VS-006 preserves Windows and Ubuntu matrix');
check(/run:\s*npm run ci:required/.test(workflow), 'VS-006 feature-branch CI still executes mandatory gate');

console.log(`\nVS-006 feature-branch CI trigger: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
