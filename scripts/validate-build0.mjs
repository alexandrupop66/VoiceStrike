import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const required = [
  'package.json',
  'README.md',
  'client/package.json',
  'client/src/App.tsx',
  'client/src/components/WorkerView.tsx',
  'client/src/components/SupervisorView.tsx',
  'server/package.json',
  'server/src/index.ts',
  'server/src/db/database.ts',
  'server/src/routes/api.ts',
  'evidence/README.md'
];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`Missing required file: ${file}`);
}

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE workers (id TEXT PRIMARY KEY, name TEXT NOT NULL, current_station TEXT NOT NULL);
  CREATE TABLE jobs (id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, station TEXT NOT NULL, expected_component TEXT NOT NULL, status TEXT NOT NULL);
  CREATE TABLE inventory (component TEXT PRIMARY KEY, location TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0));
  CREATE TABLE actions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT, timestamp TEXT NOT NULL, reversible INTEGER NOT NULL DEFAULT 0, reversed INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE exceptions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
  CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, before_state TEXT, after_state TEXT);
`);

db.prepare('INSERT INTO workers VALUES (?, ?, ?)').run('W01', 'Alex Worker', '3040');
db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)').run('JOB-482', 'W01', '3040', 'B148', 'IN_PROGRESS');
db.prepare('INSERT INTO inventory VALUES (?, ?, ?)').run('B148', 'C12', 7);
db.prepare('INSERT INTO inventory VALUES (?, ?, ?)').run('B184', 'A07', 11);

const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get('JOB-482');
const expected = db.prepare('SELECT * FROM inventory WHERE component = ?').get('B148');
const wrong = db.prepare('SELECT * FROM inventory WHERE component = ?').get('B184');

if (!job || job.expected_component !== 'B148' || job.station !== '3040' || job.status !== 'IN_PROGRESS') {
  throw new Error('Seed job validation failed');
}
if (!expected || expected.location !== 'C12' || expected.quantity !== 7) throw new Error('B148 seed validation failed');
if (!wrong || wrong.location !== 'A07' || wrong.quantity !== 11) throw new Error('B184 seed validation failed');

console.log('BUILD 0 structural validation: PASS');
console.log('Seed state validation: PASS');
console.log(JSON.stringify({ job, inventory: [expected, wrong] }, null, 2));
