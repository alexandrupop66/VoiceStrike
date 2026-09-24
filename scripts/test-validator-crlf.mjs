import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'voicestrike-vs002-'));
const copyRoot = join(tempRoot, 'repo');

try {
  cpSync(root, copyRoot, {
    recursive: true,
    filter: (source) => {
      const rel = source.slice(root.length).replaceAll('\\', '/');
      return !rel.startsWith('/.git') && !rel.startsWith('/.test-dist') && !rel.includes('/node_modules');
    },
  });

  const voicePath = join(copyRoot, 'client', 'src', 'voice', 'voiceAgent.ts');
  const voice = readFileSync(voicePath, 'utf8').replace(/\r?\n/g, '\r\n');
  writeFileSync(voicePath, voice, 'utf8');

  const run = spawnSync(process.execPath, ['scripts/validate-build7.mjs'], {
    cwd: copyRoot,
    encoding: 'utf8',
  });

  if (run.status !== 0) {
    process.stdout.write(run.stdout ?? '');
    process.stderr.write(run.stderr ?? '');
    console.error('FAIL VS-002: BUILD 7 validator rejects an equivalent CRLF checkout.');
    process.exit(1);
  }

  console.log('PASS VS-002: BUILD 7 validator accepts an equivalent CRLF checkout.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
