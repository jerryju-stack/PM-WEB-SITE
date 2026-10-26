import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/database.ts';
import { applyMigrations, migrations } from '../lib/migrations.ts';
import { template } from '../lib/schedule.ts';
const oldSchema="PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;\n    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);\n    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);\n    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT NOT NULL);\n    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);\n    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, data TEXT NOT NULL);\n    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL);\n    CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);\n    CREATE TABLE IF NOT EXISTS dependencies (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY(task_id, predecessor_id));\n    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL);\n  ";
function oldFixture(){
 const directory=mkdtempSync(join(tmpdir(),'station-migration-test-')),db=new DatabaseSync(join(directory,'project-station.sqlite'));
 db.exec(oldSchema);db.prepare('INSERT INTO meta VALUES(?,?)').run('initialized','1');
 db.prepare('INSERT INTO projects VALUES(?,?,?)').run('p',JSON.stringify({id:'p',title:'legacy',progress:50,status:'进行中'}),7);
 db.prepare('INSERT INTO articles VALUES(?,?)').run('a',JSON.stringify({id:'a',title:'article',content:'body'}));
 for(const task of [{...template('p')[0],id:'t1',kind:'task'}, {...template('p')[0],id:'t2',kind:'task',predecessors:['t1']}])db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(task.id,'p',null,JSON.stringify(task));
 db.prepare('INSERT INTO dependencies VALUES(?,?)').run('t2','t1');db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?)').run('file','t1','test.txt',3,'legacy-user','2026-01-01');
 return {directory,db};
}
test('old SQLite upgrade preserves projects articles tasks dependencies and attachments; repeated startup is stable',()=>{
 const {directory,db}=oldFixture();const before={tasks:db.prepare('SELECT * FROM tasks').all(),dependencies:db.prepare('SELECT * FROM dependencies').all(),attachments:db.prepare('SELECT * FROM attachments').all()};db.close();
 for(let attempt=0;attempt<2;attempt++){const store=openStore(directory);try{
 assert.equal(store.get('projects','p').version,0);assert.equal(store.get('articles','a').version,0);assert.equal(store.revision('p'),7);assert.equal(store.get('articles','a').content,'body');
 for(const table of ['tasks','dependencies','attachments'] as const)assert.deepEqual(store.db.prepare(table==='attachments'?'SELECT id,task_id,name,size,uploaded_by,created_at FROM attachments':'SELECT * FROM '+table).all(),before[table]);
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n,5);
 assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{store.db.close();}}
});
test('failed migration rolls back DDL and marker, then retries successfully',()=>{
 const {db}=oldFixture();try{
 assert.throws(()=>applyMigrations(db,[{version:1,name:'injected failure',up(db){migrations[0].up(db);db.exec('INSERT INTO missing_table VALUES(1)');}}]),/missing_table/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n,0);
 assert.ok(!(db.prepare('PRAGMA table_info(projects)').all() as {name:string}[]).some(row=>row.name==='version'));
 applyMigrations(db);applyMigrations(db);assert.ok((db.prepare('PRAGMA table_info(projects)').all() as {name:string}[]).some(row=>row.name==='version'));
 }finally{db.close();}
});
test('new database and JSON import receive zero resource versions without resetting task versions',()=>{
 for(const legacy of [false,true]){const directory=mkdtempSync(join(tmpdir(),'station-init-test-'));if(legacy)writeFileSync(join(directory,'store.json'),JSON.stringify({settings:{},users:[],projects:[{id:'p',title:'JSON project'}],articles:[{id:'a',title:'JSON article',content:'keep'}]}));
 process.env.ADMIN_PASSWORD='Isolated-Test-Only-2026';const store=openStore(directory);try{
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n,5);
 if(legacy){assert.equal(store.get('projects','p').version,0);assert.equal(store.get('articles','a').version,0);assert.equal(store.tasks('p').length,8);assert.equal(store.revision('p'),0);}
 }finally{store.db.close();}}
});
