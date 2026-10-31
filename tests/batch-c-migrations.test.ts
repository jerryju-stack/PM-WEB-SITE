import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore,passwordHash } from '../lib/database.ts';
import { migrations,applyMigrations } from '../lib/migrations.ts';
import { template } from '../lib/schedule.ts';
import { accountService } from '../lib/accounts.ts';
import { policy } from '../lib/policy.ts';
import { resourceWriter } from '../lib/resources.ts';
function bFixture(){
  const directory=mkdtempSync(join(tmpdir(),'station-c-migration-')),db=new DatabaseSync(join(directory,'project-station.sqlite'));
  db.exec(readFileSync(new URL('./fixtures/b-schema.sql',import.meta.url),'utf8'));
  const user={id:'admin',name:'legacy name',role:'admin',salt:'isolated-salt',hash:passwordHash('Isolated-B-to-C-2026','isolated-salt')};
  db.prepare('INSERT INTO users VALUES(?,?)').run('admin',JSON.stringify(user));
  db.prepare('INSERT INTO settings VALUES(?,?)').run('site',JSON.stringify({id:'site'}));
  db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('p',JSON.stringify({id:'p',title:'keep',owner:'legacy name'}),7,3);
  db.prepare('INSERT INTO articles VALUES(?,?,?)').run('a',JSON.stringify({id:'a',title:'knowledge',content:'keep body'}),2);
  for(const task of [{...template('p')[0],id:'one',kind:'task'}, {...template('p')[0],id:'two',kind:'task',predecessors:['one']}])db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(task.id,'p',null,JSON.stringify(task));
  db.prepare('INSERT INTO dependencies VALUES(?,?)').run('two','one');
  db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').run('old-file','one','old.txt',3,'admin','2026-10-20',null);
  db.prepare('INSERT INTO file_jobs VALUES(?,?,?,?,?)').run('old-job','upload','2026-10-20',2,'FILE_ERROR');
  db.prepare('INSERT INTO audit_events(actor_id,actor_name,request_id,operation,resource,resource_id,occurred_at,versions,changes) VALUES(?,?,?,?,?,?,?,?,?)').run('admin','legacy name','historical','create','projects','p','2026-10-20','{}','{}');
  return {directory,db,user};
}
for(const version of [3,4])test(`explicit B -> C preserves evidence; migration ${version} failure rolls back its entire step then retries stably`,()=>{
  const {directory,db,user}=bFixture();
  const before=Object.fromEntries(['tasks','dependencies','file_jobs'].map(table=>[table,db.prepare(table==='tasks'?'SELECT id,project_id,parent_id,data FROM tasks':'SELECT * FROM '+table).all()]));
  const steps=migrations.slice(0,version).map(step=>step.version===version?{...step,up(db:DatabaseSync){step.up(db);db.exec('INSERT INTO injected_identity_failure VALUES(1)');}}:step);
  assert.throws(()=>applyMigrations(db,steps),/injected_identity_failure/);
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,version-1);
  if(version===3){assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='identities'").get(),undefined);assert.deepEqual(JSON.parse(String(db.prepare('SELECT data FROM users').get()!.data)),user);assert.ok(!db.prepare('PRAGMA table_info(audit_events)').all().some(row=>row.name==='actor_uid'));}
  else {assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='project_members'").get(),undefined);assert.ok(!db.prepare('PRAGMA table_info(articles)').all().some(row=>row.name==='project_id'));}
  db.close();let uid='';
  for(let i=0;i<2;i++){const store=openStore(directory);try{
    const account=store.get('users','admin');if(uid)assert.equal(account.uid,uid);uid=account.uid;
    assert.notEqual(uid,'admin');assert.equal(account.hash,user.hash);assert.equal(account.name,user.name);
    assert.equal(store.get('projects','p').owner,'legacy name');assert.equal(store.get('projects','p').version,3);assert.equal(store.revision('p'),7);
    assert.equal(store.get('articles','a').content,'keep body');assert.equal(store.get('articles','a').projectId,null);
    for(const table of ['tasks','dependencies','file_jobs'])assert.deepEqual(store.db.prepare(table==='tasks'?'SELECT id,project_id,parent_id,data FROM tasks':'SELECT * FROM '+table).all(),before[table]);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM project_members').get()!.n,0);
    const event=store.db.prepare('SELECT * FROM audit_events').get()!;assert.equal(event.actor_id,'admin');assert.equal(event.actor_uid,null);
    const file=store.db.prepare('SELECT * FROM attachments').get()!;assert.equal(file.uploaded_by,'admin');assert.equal(file.uploaded_uid,null);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n,1);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{store.db.close();}}
});
test('account/password/member state and identity registry roll back with audit failure',()=>{
  process.env.ADMIN_PASSWORD='Isolated-C-Rollback-2026';const store=openStore(mkdtempSync(join(tmpdir(),'station-c-rollback-')));
  try{
    const actor=store.get('users','admin'),service=accountService(store),context={actorId:actor.uid,actorName:actor.name,actorUid:actor.uid,requestId:'rollback'};
    const second=service.create(actor,{id:'second',name:'same',role:'admin',password:'Second-Isolated-2026'},context)!;
    const project=resourceWriter(store).create('projects',{title:'rollback membership'},'text',context);const access=policy(store);
    const policyBefore={groups:store.db.prepare('SELECT * FROM permission_groups').all(),members:store.db.prepare('SELECT * FROM project_members').all(),access:store.db.prepare('SELECT * FROM project_access').all()};
    const before=store.db.prepare('SELECT * FROM users').all(),identities=store.db.prepare('SELECT * FROM identities').all(),history=store.db.prepare('SELECT * FROM audit_events').all();
    store.db.exec("CREATE TRIGGER fail_identity_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'identity audit failure'); END;");
    for(const operation of [()=>service.create(actor,{id:'failed',role:'editor',password:'Failed-Isolated-2026'},context),()=>service.update(actor,second.id,{role:'viewer',name:'lost'},context),()=>service.remove(actor,second.id,context),()=>service.password(actor,second.id,{password:'Changed-Isolated-2026'},context,true)])assert.throws(operation,/identity audit failure/);
    for(const operation of [()=>access.setMember(actor,project.id,second.id,'manager',context),()=>access.setAccess(actor,project.id,{timing:'members'},context),()=>access.saveGroup(actor,undefined,{name:'must rollback',capabilities:['timingRead']},context)])assert.throws(operation,/identity audit failure/);
    assert.deepEqual(store.db.prepare('SELECT * FROM users').all(),before);assert.deepEqual(store.db.prepare('SELECT * FROM identities').all(),identities);assert.deepEqual(store.db.prepare('SELECT * FROM audit_events').all(),history);
    assert.deepEqual({groups:store.db.prepare('SELECT * FROM permission_groups').all(),members:store.db.prepare('SELECT * FROM project_members').all(),access:store.db.prepare('SELECT * FROM project_access').all()},policyBefore);
  }finally{store.db.close();}
});
