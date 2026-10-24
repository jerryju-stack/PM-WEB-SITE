import type { DatabaseSync } from 'node:sqlite';
export type Migration = { version: number; name: string; up: (db: DatabaseSync) => void };
export const migrations: Migration[] = [{
  version: 1, name: 'resource_versions',
  up(db) {
    db.exec('ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 0; ALTER TABLE articles ADD COLUMN version INTEGER NOT NULL DEFAULT 0;');
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
