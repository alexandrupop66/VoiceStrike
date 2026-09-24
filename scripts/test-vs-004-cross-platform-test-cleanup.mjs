import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const script = pkg.scripts?.['test:vs-001'] ?? '';

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

check(Boolean(script), 'VS-001 regression script exists');
check(!/(^|&&|;)\s*rm\s+-rf\b/.test(script), 'VS-001 cleanup does not depend on Unix rm -rf');
check(/node\s+scripts[\\/]clean-test-dist\.mjs/.test(script), 'VS-001 cleanup uses the cross-platform Node cleanup helper');

console.log(`\nVS-004 cross-platform test cleanup: ${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
