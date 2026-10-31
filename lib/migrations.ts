import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
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
}, {
  version: 3, name: 'permanent_account_identity',
  up(db) {
    db.exec(`CREATE TABLE identities (
      uid TEXT PRIMARY KEY, login_name TEXT UNIQUE, original_login TEXT NOT NULL,
      created_at TEXT NOT NULL, retired_at TEXT
    );
    CREATE TRIGGER immutable_identity BEFORE UPDATE OF uid ON identities BEGIN SELECT RAISE(ABORT,'Identity is immutable'); END;
    ALTER TABLE audit_events ADD COLUMN actor_uid TEXT REFERENCES identities(uid);
    ALTER TABLE attachments ADD COLUMN uploaded_uid TEXT REFERENCES identities(uid);`);
    const rows=db.prepare('SELECT id,data FROM users').all();
    for(const row of rows) {
      const user=JSON.parse(String(row.data));
      if(user.id!==row.id)throw Error('Identity migration rejected inconsistent user key');
      const uid=randomUUID();
      db.prepare('INSERT INTO identities(uid,login_name,original_login,created_at) VALUES(?,?,?,?)').run(uid,String(row.id),String(row.id),new Date().toISOString());
      db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify({...user,uid,status:user.status===undefined?'active':user.status,authEpoch:0}),String(row.id));
    }
    // No historical login-name -> identity guess: old actor/upload evidence stays
    // untouched and the new identity columns intentionally remain NULL.
  },
}, {
  version:4,name:'project_capability_groups',
  up(db) {
    db.exec(`CREATE TABLE permission_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,capabilities TEXT NOT NULL);
      CREATE TABLE project_members(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_uid TEXT NOT NULL REFERENCES identities(uid),group_id TEXT NOT NULL REFERENCES permission_groups(id),PRIMARY KEY(project_id,user_uid));
      CREATE INDEX members_user ON project_members(user_uid);
      CREATE TABLE project_access(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,cards TEXT NOT NULL CHECK(cards IN ('public','members')),timing TEXT NOT NULL CHECK(timing IN ('authenticated','members')),lessons TEXT NOT NULL CHECK(lessons IN ('authenticated','members')));
      INSERT INTO project_access SELECT id,'public','authenticated','authenticated' FROM projects;
      CREATE TRIGGER project_default_access AFTER INSERT ON projects BEGIN INSERT INTO project_access VALUES(NEW.id,'public','authenticated','authenticated'); END;
      ALTER TABLE articles ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT;
      ALTER TABLE articles ADD COLUMN created_uid TEXT REFERENCES identities(uid);`);
    const read=['timingRead','lessonsRead','membersRead'];
    const editor=[...read,'projectEdit','timingEdit','attachmentUpload','attachmentDelete','lessonCreate','lessonEdit','lessonDelete'];
    for(const [id,name,caps] of [['manager','Manager',[...editor,'projectCreate','projectDelete','membersManage']],['editor','Editor',editor],['viewer','Viewer',read],['engineering','Engineering',[...read,'attachmentUpload','lessonCreate','lessonEdit']]] as [string,string,string[]][])db.prepare('INSERT INTO permission_groups VALUES(?,?,?)').run(id,name,JSON.stringify(caps));
  },
}, {
  version:5,name:'timing_plan_versions',
  up(db) {
    db.exec(`CREATE TABLE timing_versions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('baseline','version','final')), sequence INTEGER,
      name TEXT NOT NULL, reason TEXT NOT NULL, saved_at TEXT NOT NULL,
      actor_uid TEXT NOT NULL REFERENCES identities(uid), actor_name TEXT NOT NULL,
      revision INTEGER NOT NULL, project_version INTEGER NOT NULL,
      request_key TEXT NOT NULL, request_data TEXT NOT NULL, snapshot TEXT NOT NULL,
      UNIQUE(project_id,request_key), UNIQUE(project_id,sequence),
      CHECK((kind='version' AND sequence IS NOT NULL AND sequence>0) OR (kind<>'version' AND sequence IS NULL))
    );
    CREATE INDEX timing_versions_project ON timing_versions(project_id,saved_at);
    CREATE TRIGGER timing_version_readonly BEFORE UPDATE ON timing_versions BEGIN
      SELECT RAISE(ABORT,'Timing versions are read-only');
    END;`);
  },
}, {
  version:6,name:'timing_import_receipts',
  up(db) {
    db.exec(`CREATE TABLE timing_imports (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      actor_uid TEXT NOT NULL REFERENCES identities(uid), revision INTEGER NOT NULL,
      project_version INTEGER NOT NULL, expires_at TEXT NOT NULL, payload TEXT NOT NULL, result TEXT
    ); CREATE INDEX timing_imports_expiry ON timing_imports(expires_at);`);
  },
}, {
  version:7,name:'shared_timing_draft_and_lease',
  up(db) {
    db.exec(`ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE timing_drafts (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, id TEXT NOT NULL UNIQUE,
        source_version TEXT, source_revision INTEGER NOT NULL, source_label TEXT NOT NULL,
        base_revision INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
        actor_uid TEXT NOT NULL REFERENCES identities(uid), actor_name TEXT NOT NULL, saved_at TEXT NOT NULL
      );
      CREATE TABLE timing_edit_leases (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, token TEXT NOT NULL,
        actor_uid TEXT NOT NULL REFERENCES identities(uid), actor_name TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE timing_archives (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('unadopted','previous')), sequence INTEGER,
        name TEXT NOT NULL, reason TEXT NOT NULL, saved_at TEXT NOT NULL,
        actor_uid TEXT NOT NULL REFERENCES identities(uid), actor_name TEXT NOT NULL,
        revision INTEGER NOT NULL, project_version INTEGER NOT NULL, snapshot TEXT NOT NULL,
        source_version TEXT, source_revision INTEGER NOT NULL
      );
      CREATE TRIGGER timing_archive_readonly BEFORE UPDATE ON timing_archives BEGIN SELECT RAISE(ABORT,'Timing archives are read-only'); END;
      CREATE TABLE timing_adoptions (
        draft_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        actor_uid TEXT NOT NULL REFERENCES identities(uid), lease_token TEXT NOT NULL,
        result TEXT NOT NULL, version_id TEXT REFERENCES timing_versions(id) ON DELETE CASCADE,
        source_version TEXT, source_revision INTEGER NOT NULL
      );
      ALTER TABLE timing_imports ADD COLUMN draft_id TEXT;
      ALTER TABLE timing_imports ADD COLUMN lease_token TEXT;`);
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
