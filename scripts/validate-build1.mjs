import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  '.env.example',
  'client/public/pcm-processor.js',
  'client/src/voice/voiceAgent.ts',
  'client/src/components/VoicePanel.tsx',
  'server/src/routes/api.ts',
  'BUILD1_STATUS.md',
];

let ok = true;
for (const file of required) {
  const exists = fs.existsSync(path.join(root, file));
  console.log(`${exists ? 'PASS' : 'FAIL'} ${file}`);
  ok &&= exists;
}

const server = fs.readFileSync(path.join(root, 'server/src/routes/api.ts'), 'utf8');
const client = fs.readFileSync(path.join(root, 'client/src/voice/voiceAgent.ts'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

for (const [label, condition] of [
  ['temporary token route', server.includes("'/voice-token'")],
  ['server-only AssemblyAI key', server.includes('process.env.ASSEMBLYAI_API_KEY')],
  ['Voice Agent WebSocket', client.includes('wss://agents.assemblyai.com/v1/ws')],
  ['24 kHz AudioContext', client.includes('sampleRate: SAMPLE_RATE') && client.includes('24000')],
  ['input.audio streaming', client.includes("type: 'input.audio'")],
  ['reply.audio playback', client.includes("case 'reply.audio'")],
  ['session.end cleanup', client.includes("type: 'session.end'")],
  ['.env ignored', /^\.env$/m.test(gitignore)],
]) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`);
  ok &&= Boolean(condition);
}

process.exit(ok ? 0 : 1);
