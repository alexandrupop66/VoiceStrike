import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// RC4: VOICESTRIKE_DB_PATH lets the event-pipeline harness run against an isolated SQLite file.
// Unset in normal use, so the runtime database location is unchanged.
const dbPath = process.env.VOICESTRIKE_DB_PATH ? path.resolve(process.env.VOICESTRIKE_DB_PATH) : path.join(path.resolve(__dirname, '../../data'), 'voicestrike.db');
const dataDir = path.dirname(dbPath);

// ZIP archives do not preserve empty folders reliably. Ensure the SQLite
// directory always exists before opening the database.
mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_station TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      station TEXT NOT NULL,
      expected_component TEXT NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      component TEXT PRIMARY KEY,
      location TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity >= 0)
    );

    CREATE TABLE IF NOT EXISTS inventory_alternates (
      component TEXT NOT NULL,
      location TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity >= 0),
      PRIMARY KEY (component, location)
    );

    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      timestamp TEXT NOT NULL,
      reversible INTEGER NOT NULL DEFAULT 0,
      reversed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS exceptions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      event TEXT NOT NULL,
      before_state TEXT,
      after_state TEXT
    );
  `);

  const workerCount = db.prepare('SELECT COUNT(*) AS count FROM workers').get() as { count: number };
  if (workerCount.count === 0) {
    const insertWorker = db.prepare('INSERT INTO workers (id, name, current_station) VALUES (?, ?, ?)');
    const insertJob = db.prepare('INSERT INTO jobs (id, worker_id, station, expected_component, status) VALUES (?, ?, ?, ?, ?)');
    const insertInventory = db.prepare('INSERT INTO inventory (component, location, quantity) VALUES (?, ?, ?)');
    const insertAlternate = db.prepare('INSERT INTO inventory_alternates (component, location, quantity) VALUES (?, ?, ?)');
    const insertAction = db.prepare('INSERT INTO actions (id, job_id, type, payload, timestamp, reversible, reversed) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertAudit = db.prepare('INSERT INTO audit_log (timestamp, actor, event, before_state, after_state) VALUES (?, ?, ?, ?, ?)');

    const seed = db.transaction(() => {
      insertWorker.run('W01', 'Alex Worker', '3040');
      insertJob.run('JOB-482', 'W01', '3040', 'B148', 'IN_PROGRESS');
      insertInventory.run('B148', 'C12', 7);
      insertInventory.run('B184', 'A07', 11);
      insertAlternate.run('B148', 'D05', 4);
      insertAction.run('ACT-SCAN-B184', 'JOB-482', 'SCAN_COMPONENT', JSON.stringify({ component: 'B184', station: '3040' }), new Date().toISOString(), 1, 0);
      insertAudit.run(new Date().toISOString(), 'SYSTEM', 'DEMO_STATE_INITIALISED', null, JSON.stringify({ job: 'JOB-482', expected_component: 'B148' }));
    });
    seed();
  }

  // Build 6 migration/seed: ensure the deterministic alternative stock location exists
  // and a reversible mistaken scan exists even when an older demo database is reused.
  // Build 5 migration/seed: ensure the deterministic alternative stock location exists
  // even when an older demo database is reused.
  db.prepare(`
    INSERT OR IGNORE INTO inventory_alternates (component, location, quantity)
    VALUES ('B148', 'D05', 4)
  `).run();

  const actionCount = db.prepare(`SELECT COUNT(*) AS count FROM actions WHERE job_id = 'JOB-482'`).get() as { count: number };
  if (actionCount.count === 0) {
    db.prepare(`
      INSERT INTO actions (id, job_id, type, payload, timestamp, reversible, reversed)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `).run('ACT-SCAN-B184', 'JOB-482', 'SCAN_COMPONENT', JSON.stringify({ component: 'B184', station: '3040' }), new Date().toISOString());
  }
}
