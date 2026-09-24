import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./test-event-pipeline-rc4.mts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let passed = 0;
let failed = 0;
const check = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}`); }
};

check('VS-003 harness imports the SQLite db handle so it can close it', /import\('\.\.\/server\/src\/db\/database\.js'\)[\s\S]*\bdb\b/.test(source));
check('VS-003 server shutdown is awaited before temp cleanup', /await new Promise<[^>]*>\(\(resolve, reject\) => \{[\s\S]*server\.close\(/.test(source));
check('VS-003 SQLite handle is closed before temp directory removal', source.indexOf('db.close()') >= 0 && source.indexOf('db.close()') < source.indexOf('rmSync(tempDir'));

console.log(`\nVS-003 cleanup regression: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
