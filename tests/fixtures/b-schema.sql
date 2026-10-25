-- Explicit B/002 fixture, no account data or production credentials.
PRAGMA foreign_keys=ON;
CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE settings (id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE projects (id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE articles (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tasks (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,data TEXT NOT NULL);
CREATE INDEX tasks_project ON tasks(project_id);
CREATE TABLE dependencies (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,PRIMARY KEY(task_id,predecessor_id));
CREATE TABLE attachments (id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,name TEXT NOT NULL,size INTEGER NOT NULL,uploaded_by TEXT NOT NULL,created_at TEXT NOT NULL,sha256 TEXT);
CREATE INDEX attachments_task ON attachments(task_id);
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
CREATE TABLE audit_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,request_id TEXT NOT NULL,operation TEXT NOT NULL,resource TEXT NOT NULL,resource_id TEXT NOT NULL,occurred_at TEXT NOT NULL,versions TEXT NOT NULL,changes TEXT NOT NULL);
CREATE INDEX audit_resource ON audit_events(resource,resource_id,sequence);
CREATE TABLE file_jobs (id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('upload','delete')),created_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);
CREATE TRIGGER attachment_cleanup AFTER DELETE ON attachments BEGIN
 INSERT INTO file_jobs(id,kind,created_at) VALUES(OLD.id,'delete',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET kind='delete',last_error=NULL;
END;
INSERT INTO meta VALUES('initialized','1');
INSERT INTO schema_migrations VALUES(1,'resource_versions','2026-10-24T00:00:00.000Z');
INSERT INTO schema_migrations VALUES(2,'audit_and_attachment_recovery','2026-10-25T00:00:00.000Z');
