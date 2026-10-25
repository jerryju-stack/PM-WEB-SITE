import type { DatabaseSync } from 'node:sqlite';
export type Migration = { version: number; name: string; up: (db: DatabaseSync) => void };
export const migrations: Migration[] = [{
  version: 1, name: 'resource_versions',
  up(db) {
    db.exec('ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 0; ALTER TABLE articles ADD COLUMN version INTEGER NOT NULL DEFAULT 0;');
  },
}, {
  version: 2, name: 'audit_and_attachment_recovery',
  up(db) {
    db.exec(`
      CREATE TABLE audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
        request_id TEXT NOT NULL, operation TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL, versions TEXT NOT NULL, changes TEXT NOT NULL
      );
      CREATE INDEX audit_resource ON audit_events(resource,resource_id,sequence);
      ALTER TABLE attachments ADD COLUMN sha256 TEXT;
      CREATE TABLE file_jobs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('upload','delete')),
        created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
      );
      CREATE TRIGGER attachment_cleanup AFTER DELETE ON attachments BEGIN
        INSERT INTO file_jobs(id,kind,created_at) VALUES(OLD.id,'delete',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(id) DO UPDATE SET kind='delete',last_error=NULL;
      END;
      CREATE INDEX attachments_task ON attachments(task_id);
    `);
  },
}];
/** Each migration and its marker commit together. Failed migrations can be retried on next open. */
export function applyMigrations(db: DatabaseSync, steps: Migration[] = migrations) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
  if (applied.some(row => !steps.some(step => step.version === row.version))) throw Error('数据库版本高于此应用支持的版本，请使用匹配的代码');
  for (const step of steps) {
    if (applied.some(row => row.version === step.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck under the write lock, including when another startup completed this migration.
      if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(step.version)) {
        step.up(db);
        db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(step.version, step.name, new Date().toISOString());
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}
