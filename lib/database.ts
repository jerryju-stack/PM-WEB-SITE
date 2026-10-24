import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { template, schedule, projectProgress } from './schedule.ts';
import type { Task } from './schedule.ts';
export const passwordHash = (value: string, salt: string) => scryptSync(value, salt, 64).toString('hex');
export function openStore(directory: string) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'project-station.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
    CREATE TABLE IF NOT EXISTS dependencies (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY(task_id, predecessor_id));
    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  function transaction<T>(operation: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const value = operation(); db.exec('COMMIT'); return value; } catch(e) { db.exec('ROLLBACK'); throw e; } }
  const tables = new Set(['settings','users','projects','articles']);
  const checked = (table: string) => { if (!tables.has(table)) throw Error('无效数据表'); return table; };
  const all = (table: string): any[] => db.prepare(`SELECT data FROM ${checked(table)} ORDER BY rowid`).all().map((row: any) => JSON.parse(row.data));
  const get = (table: string, id: string): any => { const row = db.prepare(`SELECT data FROM ${checked(table)} WHERE id=?`).get(id) as any; return row ? JSON.parse(row.data) : null; };
  const put = (table: string, item: any) => db.prepare(`INSERT INTO ${checked(table)} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(item.id, JSON.stringify(item));
  const remove = (table: string, id: string) => db.prepare(`DELETE FROM ${checked(table)} WHERE id=?`).run(id);
  const tasks = (projectId: string): Task[] => db.prepare('SELECT data FROM tasks WHERE project_id=? ORDER BY rowid').all(projectId).map((row: any) => JSON.parse(row.data));
  const revision = (id: string): number => Number((db.prepare('SELECT revision FROM projects WHERE id=?').get(id) as any)?.revision || 0);
  function saveTasks(projectId: string, values: Task[], expected?: number) {
    return transaction(() => {
      if (expected !== undefined && revision(projectId) !== expected) throw Object.assign(Error('项目已被其他操作更新，请刷新后重试'), { status: 409 });
      const hadLeaves = tasks(projectId).some(t => t.kind !== 'summary');
      const normalized = schedule(values), ids = new Set(normalized.map(t => t.id));
      for (const t of normalized) db.prepare('INSERT INTO tasks(id,project_id,parent_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,data=excluded.data').run(t.id,projectId,t.parentId,JSON.stringify(t));
      for (const old of tasks(projectId)) if (!ids.has(old.id)) db.prepare('DELETE FROM tasks WHERE id=?').run(old.id);
      db.prepare('DELETE FROM dependencies WHERE task_id IN (SELECT id FROM tasks WHERE project_id=?)').run(projectId);
      for (const t of normalized) for (const predecessor of t.predecessors) db.prepare('INSERT INTO dependencies VALUES(?,?)').run(t.id,predecessor);
      db.prepare('UPDATE projects SET revision=revision+1 WHERE id=?').run(projectId);
      const project = get('projects',projectId), leaves=normalized.filter(t=>t.kind!=='summary');
      if (leaves.length) { project.progress=projectProgress(normalized); project.status=project.progress===100?'已完成':project.progress>0?'进行中':'计划中'; put('projects',project); }
      else if (hadLeaves) { project.progress=0;project.status='计划中';put('projects',project); }
      return normalized;
    });
  }
  if (!db.prepare("SELECT value FROM meta WHERE key='initialized'").get()) {
    const legacy = join(directory, 'store.json');
    let seed: any;
    if (existsSync(legacy)) { copyFileSync(legacy, join(directory, `store.pre-sqlite-${Date.now()}.json`)); seed=JSON.parse(readFileSync(legacy,'utf8')); }
    else { const password=process.env.ADMIN_PASSWORD || randomBytes(16).toString('base64url'), salt=randomBytes(16).toString('hex'); seed={settings:{title:'Project Station',description:'连接目标、计划与交付。',name:'项目经理',intro:'用清晰的方法连接想法与成果。',team:'透明沟通，共同负责，持续改进。'},users:[{id:'admin',name:'管理员',role:'admin',salt,hash:passwordHash(password,salt)}],projects:[],articles:[]};console.log(`首次管理员账号：admin；初始密码：${password}`); }
    transaction(() => {
      put('settings',{...seed.settings,id:'site',title:'Project Station'});
      for (const table of ['users','projects','articles']) for (const item of seed[table] || []) put(table,item);
      for (const project of seed.projects || []) for (const task of template(project.id)) db.prepare('INSERT INTO tasks(id,project_id,parent_id,data) VALUES(?,?,?,?)').run(task.id,project.id,null,JSON.stringify(task));
      db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','1');
    });
  }
  return { db, all, get, put, remove, tasks, revision, saveTasks, transaction, directory };
}
