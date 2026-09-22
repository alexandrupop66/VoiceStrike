import fs from 'node:fs';

const checks = [
  ['BUILD2_STATUS.md exists', fs.existsSync('BUILD2_STATUS.md')],
  ['Build 1 findings preserved', fs.existsSync('evidence/build1/BUILD1_FINDINGS.md')],
  ['Server exposes first tool', fs.readFileSync('server/src/routes/api.ts', 'utf8').includes("'/tools/get-current-job'")],
  ['Voice session declares get_current_job', fs.readFileSync('client/src/voice/voiceAgent.ts', 'utf8').includes("name: 'get_current_job'")],
  ['Voice client handles tool.call', fs.readFileSync('client/src/voice/voiceAgent.ts', 'utf8').includes("case 'tool.call'")],
  ['Tool result is JSON string', fs.readFileSync('client/src/voice/voiceAgent.ts', 'utf8').includes('result: JSON.stringify(tool.result)')],
  ['Tool result waits for reply.done', /reply\.done'/.test(fs.readFileSync('client/src/voice/voiceAgent.ts', 'utf8')) && /this\.(lastEventType|resultHandoffEvent) !== 'reply\.done'/.test(fs.readFileSync('client/src/voice/voiceAgent.ts', 'utf8')) /* RC4: same invariant, documented handoff gate */],
  ['Unknown tools rejected', fs.readFileSync('client/src/voice/voiceAgent.ts', 'utf8').includes('Unknown or unauthorised tool')],
  ['Health reports build 2', fs.readFileSync('server/src/routes/api.ts', 'utf8').includes('build: 2')],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('BUILD 2 structural validation passed.');
