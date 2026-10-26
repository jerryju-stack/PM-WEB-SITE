import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../lib/database.ts';
import { applyMigrations, migrations } from '../lib/migrations.ts';
import { resourceWriter } from '../lib/resources.ts';
import { attachmentService, reconcile } from '../lib/attachments.ts';
const actor={actorId:'isolated',actorName:'旧显示名',requestId:'test-request'};
const setup=()=>{process.env.ADMIN_PASSWORD='Isolated-B-Test-2026';return openStore(mkdtempSync(join(tmpdir(),'station-b-')));};

test('A schema fixture upgrades to B; failure halfway rolls back all B DDL and marker; retry preserves versions',()=>{
  const store=setup(),dir=store.directory;
  const project=resourceWriter(store).create('projects',{title:'keep'},'tester');resourceWriter(store).update('projects',project.id,{version:0,title:'v1'});
  store.saveTasks(project.id,store.tasks(project.id),0);store.db.close();
  // Reconstruct exactly the A structures, with A version values and records, without B structures.
  const db=new DatabaseSync(join(dir,'project-station.sqlite'));
  db.exec('DROP TRIGGER timing_version_readonly; DROP TABLE timing_versions; DROP TRIGGER project_default_access; DROP TABLE project_members; DROP TABLE project_access; DROP TABLE permission_groups; ALTER TABLE articles DROP COLUMN project_id; ALTER TABLE articles DROP COLUMN created_uid; ALTER TABLE attachments DROP COLUMN uploaded_uid; DROP TRIGGER immutable_identity; DROP TRIGGER attachment_cleanup; DROP INDEX attachments_task; DROP TABLE file_jobs; DROP TABLE audit_events; DROP TABLE identities; ALTER TABLE attachments DROP COLUMN sha256; DELETE FROM schema_migrations WHERE version>=2');
  assert.throws(()=>applyMigrations(db,[migrations[0],{...migrations[1],up(db){migrations[1].up(db);db.exec('INSERT INTO injected_missing VALUES(1)');}}]),/injected_missing/);
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,1);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='file_jobs'").get(),undefined);
  assert.ok(!db.prepare('PRAGMA table_info(attachments)').all().some(row=>row.name==='sha256'));
  db.close();
  for(let n=0;n<2;n++){const reopened=openStore(dir);try{assert.equal(reopened.get('projects',project.id).version,1);assert.equal(reopened.revision(project.id),1);assert.equal(reopened.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n,0);}finally{reopened.db.close();}}
});

test('audit failure rolls back resource/task data, versions, successful history and cleanup intent atomically',()=>{
  const store=setup();try{
    const writer=resourceWriter(store),project=writer.create('projects',{title:'original'},'tester',actor);
    store.db.prepare('INSERT INTO attachments(id,task_id,name,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?)').run('rollback-file',store.tasks(project.id)[0].id,'fixture.txt',3,'isolated','2026-10-25');
    const before=store.db.prepare('SELECT * FROM audit_events').all();
    store.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");
    assert.throws(()=>writer.update('projects',project.id,{title:'lost',version:0},actor),/injected/);
    assert.equal(store.get('projects',project.id).title,'original');assert.equal(store.get('projects',project.id).version,0);
    const tasks=store.tasks(project.id);tasks[0].title='lost';assert.throws(()=>store.saveTasks(project.id,tasks,0,actor),/injected/);
    assert.equal(store.revision(project.id),0);assert.notEqual(store.tasks(project.id)[0].title,'lost');
    assert.throws(()=>store.saveTasks(project.id,store.tasks(project.id).slice(1),0,actor),/injected/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM attachments').get()!.n,1);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM file_jobs').get()!.n,0);
    assert.throws(()=>writer.remove('projects',project.id,{version:0,taskRevision:0},actor),/injected/);
    assert.ok(store.get('projects',project.id));assert.deepEqual(store.db.prepare('SELECT * FROM audit_events').all(),before);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM attachments').get()!.n,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM file_jobs').get()!.n,0);
    store.db.exec('DROP TRIGGER fail_audit');writer.remove('projects',project.id,{version:0,taskRevision:0},actor);
    assert.equal(store.db.prepare("SELECT actor_id FROM audit_events WHERE resource='projects' AND operation='delete'").get()!.actor_id,'isolated');
    assert.ok(store.db.prepare("SELECT * FROM audit_events WHERE resource='tasks' AND operation='delete'").all().length===8);
  }finally{store.db.close();}
});

test('attachment rename/registration errors retain recoverable bytes; durable cleanup retries are idempotent',async()=>{
  const store=setup();try{
    const project=resourceWriter(store).create('projects',{title:'test'},'tester'),task=store.tasks(project.id)[0];
    const chunks=async function*(){yield Buffer.from('byte-content');};
    const injected=attachmentService(store,async point=>{if(point==='upload-rename')throw Object.assign(Error('injected disk error'),{code:'EIO'});});
    await assert.rejects(injected.upload(task.id,'file.txt',chunks(),actor),/injected/);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM attachments').get()!.n,0);assert.equal(reconcile(store).orphan.length,0);
    const files=attachmentService(store),good=await files.upload(task.id,'normal.txt',chunks(),actor);
    const versions=JSON.parse(String(store.db.prepare("SELECT versions FROM audit_events WHERE resource='attachments' AND resource_id=?").get(good.id)!.versions));assert.equal(versions.projectId,project.id);assert.equal(versions.projectVersion,0);assert.equal(versions.taskRevision,0);
    store.db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'injected SQL failure'); END");
    await assert.rejects(files.upload(task.id,'bad.txt',chunks(),actor),/injected SQL/);store.db.exec('DROP TRIGGER fail_registration');
    files.remove(good.id,actor);
    const q=join(store.directory,'quarantine','jobs',good.id);mkdirSync(q,{recursive:true});writeFileSync(join(q,'file'),'collision');
    const failed=await files.retry();assert.equal(failed[0].ok,false);assert.equal(store.db.prepare('SELECT attempts FROM file_jobs WHERE id=?').get(good.id)!.attempts,1);
    assert.equal(readFileSync(join(store.directory,'uploads',good.id),'utf8'),'byte-content');
    const {unlinkSync}=await import('node:fs');unlinkSync(join(q,'file'));
    assert.equal((await files.retry())[0].ok,true);assert.deepEqual(await files.retry(),[]);assert.ok(existsSync(join(q,'file')));
    const again=await files.upload(task.id,'stay.txt',chunks(),actor);await files.retry();await files.retry();assert.equal(readFileSync(join(store.directory,'uploads',again.id),'utf8'),'byte-content');
    // A pending upload, even with a .part file, is never classified as an orphan.
    store.db.prepare('INSERT INTO file_jobs(id,kind,created_at) VALUES(?,?,?)').run('inflight','upload',new Date().toISOString());writeFileSync(join(store.directory,'uploads','inflight.part'),'partial');
    assert.ok(!reconcile(store).orphan.includes('inflight.part'));assert.equal(reconcile(store).pending.length,1);
  }finally{store.db.close();}
});
