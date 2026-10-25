import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, passwordHash } from '../lib/database.ts';
import { DatabaseSync } from 'node:sqlite';
import { resourceWriter } from '../lib/resources.ts';
import { attachmentService, reconcile } from '../lib/attachments.ts';
import { dataLock, unlockDeadProcess } from '../lib/data-lock.ts';
import { backupSnapshot, verifySnapshot, restoreSnapshot, inspectData } from '../lib/snapshots.ts';
import { httpFixture } from './http-fixture.ts';
const password='Isolated-Recovery-Test-2026';
const actor={actorId:'admin',actorName:'隔离管理员',requestId:'recovery-test'};
async function fixture() {
  const parent=mkdtempSync(join(tmpdir(),'station-recovery-')),directory=join(parent,'source');
  process.env.ADMIN_PASSWORD=password;const store=openStore(directory),writer=resourceWriter(store),project=writer.create('projects',{title:'recovery project'},'tester',actor),task=store.tasks(project.id)[0];
  const tasks=store.tasks(project.id);tasks.push({...task,id:'first',parentId:task.id,kind:'task',start:'2026-10-26',duration:1});tasks.push({...tasks.at(-1)!,id:'second',title:'dependency',predecessors:['first']});store.saveTasks(project.id,tasks,0,actor);
  const file=await attachmentService(store).upload(task.id,'restore.txt',(async function*(){yield Buffer.from('restored-attachment-bytes');})(),actor);
  return {parent,directory,store,project,task,file};
}
const unlockIfNeeded=(directory:string)=>{if(existsSync(join(directory,'.station-lock')))unlockDeadProcess(directory);};

test('pre-upgrade A snapshot retains schema 001 and legacy attachment; isolated restore upgrades once with preserved resource/task versions',async()=>{
  const parent=mkdtempSync(join(tmpdir(),'station-a-snapshot-')),source=join(parent,'source');mkdirSync(join(source,'uploads'),{recursive:true});
  const db=new DatabaseSync(join(source,'project-station.sqlite'));db.exec(readFileSync(fileURLToPath(new URL('./fixtures/a-schema.sql',import.meta.url)),'utf8'));
  const {template}=await import('../lib/schedule.ts'),task={...template('p')[0],id:'legacy-task',kind:'task' as const};
  db.prepare('INSERT INTO settings VALUES(?,?)').run('site',JSON.stringify({id:'site',title:'A fixture',description:''}));
  db.prepare('INSERT INTO users VALUES(?,?)').run('admin',JSON.stringify({id:'admin',name:'isolated',role:'admin',salt:'fixture-salt',hash:passwordHash(password,'fixture-salt')}));
  db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('p',JSON.stringify({id:'p',title:'A project',progress:0,status:'计划中'}),7,3);
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(task.id,'p',null,JSON.stringify(task));db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?)').run('legacy-file',task.id,'old.txt',3,'admin','2026-10-24');writeFileSync(join(source,'uploads','legacy-file'),'old');db.close();
  const snap=join(parent,'snapshot');const manifest=backupSnapshot(source,snap,'31713b1');assert.deepEqual(manifest.database.migrations.map(row=>row.version),[1]);
  const restored=join(parent,'restored');restoreSnapshot(snap,restored);assert.deepEqual(inspectData(restored),manifest.database);
  for(let n=0;n<2;n++) {
    const service=await httpFixture({directory:restored,password});try{const timing=await service.call('projects/p/timing',undefined,service.cookie);assert.equal(timing.status,200);assert.equal(timing.data.project.version,3);assert.equal(timing.data.revision,7);assert.equal(await(await fetch(service.base+'/api/attachments/legacy-file',{headers:{Cookie:service.cookie}})).text(),'old');}
    finally{await service.stop();unlockIfNeeded(restored);}
  }
});

test('consistent WAL snapshot rejects running writer, corruption and missing files; whole snapshot restores deletion with actual login/read/download',async()=>{
  const f=await fixture(),before=inspectData(f.directory);f.store.db.close();
  const running=await httpFixture({directory:f.directory,password});
  try{assert.throws(()=>backupSnapshot(f.directory,join(f.parent,'blocked'),'fixture'),/锁定/);assert.throws(()=>unlockDeadProcess(f.directory),/存活/);}finally{await running.stop();unlockIfNeeded(f.directory);}
  const snapshot=join(f.parent,'snapshot'),backupStart=performance.now();const manifest=backupSnapshot(f.directory,snapshot,'isolated-fixture-code');
  assert.deepEqual(manifest.database,before);assert.ok(!readdirSync(snapshot).some(name=>name.endsWith('-wal')||name.endsWith('-shm')));
  assert.equal(manifest.files.find(row=>row.path==='uploads/'+f.file.id)!.size,Buffer.byteLength('restored-attachment-bytes'));
  assert.throws(()=>backupSnapshot(f.directory,snapshot,'fixture'),/exists/);
  const bytes=readFileSync(join(snapshot,'uploads',f.file.id));writeFileSync(join(snapshot,'uploads',f.file.id),'corrupt');
  assert.throws(()=>verifySnapshot(snapshot),/checksum/);assert.throws(()=>restoreSnapshot(snapshot,join(f.parent,'bad-restore')),/checksum/);assert.ok(!existsSync(join(f.parent,'bad-restore')));
  unlinkSync(join(snapshot,'uploads',f.file.id));assert.throws(()=>verifySnapshot(snapshot),/checksum/);writeFileSync(join(snapshot,'uploads',f.file.id),bytes);verifySnapshot(snapshot);
  // Simulate an authorized but mistaken hard deletion, including its attachment cleanup.
  const source=openStore(f.directory);resourceWriter(source).remove('projects',f.project.id,{version:0,taskRevision:1},actor);await attachmentService(source).retry();assert.equal(source.get('projects',f.project.id),null);source.db.close();
  const restoreStart=performance.now(),restored=join(f.parent,'restored');restoreSnapshot(snapshot,restored);assert.throws(()=>restoreSnapshot(snapshot,restored),/exists/);
  const restoredAgain=join(f.parent,'restored-again');restoreSnapshot(snapshot,restoredAgain);assert.deepEqual(inspectData(restoredAgain),before);
  const service=await httpFixture({directory:restored,password});
  try {
    const timing=await service.call('projects/'+f.project.id+'/timing',undefined,service.cookie);assert.equal(timing.status,200);assert.equal(timing.data.tasks.length,10);assert.equal(timing.data.revision,1);assert.equal(timing.data.attachments[0].id,f.file.id);
    assert.deepEqual(timing.data.tasks.find((row:any)=>row.id==='second').predecessors,['first']);
    const response=await fetch(service.base+'/api/attachments/'+f.file.id,{headers:{Cookie:service.cookie}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  }finally{await service.stop();unlockIfNeeded(restored);}
  console.log(JSON.stringify({drill:'whole-snapshot-mistaken-delete',backupAndChecksMs:Math.round(restoreStart-backupStart),restoreLoginReadDownloadMs:Math.round(performance.now()-restoreStart)}));
});

for(const point of ['upload-intent','upload-part','upload-rename','upload-commit','delete-commit','cleanup-rename'])test('real SIGKILL at '+point+'; startup recovery is repeatable and preserves normal files',async()=>{
  const f=await fixture();f.store.db.close();
  const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./fixtures/crash-worker.ts',import.meta.url)),f.directory,point,f.task.id,f.file.id],{stdio:['ignore','pipe','pipe','ipc']});
  let stderr='';child.stderr!.on('data',chunk=>stderr+=chunk);
  try {
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('crash boundary timeout: '+stderr)),10000);child.once('message',message=>{clearTimeout(timer);assert.equal((message as any).point,point);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(Error('worker exited before boundary: '+stderr));});child.once('error',reject);});
    await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGKILL');});assert.ok(child.signalCode||child.exitCode!==0);
    unlockIfNeeded(f.directory);
    if(point==='upload-commit') {
      // Worker was killed without close(): committed rows still depend on a real WAL here.
      assert.ok(existsSync(join(f.directory,'project-station.sqlite-wal')));
      const snap=join(f.parent,'post-crash-snapshot');const manifest=backupSnapshot(f.directory,snap,'crash-fixture');
      assert.equal(manifest.database.tables.attachments.count,2);verifySnapshot(snap);
    }
    for(let attempt=0;attempt<2;attempt++) {
      const service=await httpFixture({directory:f.directory,password});
      try {const timing=await service.call('projects/'+f.project.id+'/timing',undefined,service.cookie);assert.equal(timing.status,200);
        const expected=point==='upload-commit'?2:point.startsWith('upload-')?1:0;assert.equal(timing.data.attachments.length,expected);
        if(point.startsWith('upload-'))assert.equal(await (await fetch(service.base+'/api/attachments/'+f.file.id,{headers:{Cookie:service.cookie}})).text(),'restored-attachment-bytes');
      }finally{await service.stop();unlockIfNeeded(f.directory);}
    }
    const store=openStore(f.directory);try{assert.equal(reconcile(store).pending.length,0);assert.equal(reconcile(store).orphan.length,0);assert.equal(reconcile(store).missing.length,0);assert.equal(reconcile(store).corrupt.length,0);
      if(point==='upload-part'||point==='upload-rename'||point==='delete-commit'||point==='cleanup-rename')assert.ok(readdirSync(join(f.directory,'quarantine','jobs')).length>0);
      if(point==='upload-commit')assert.equal(store.db.prepare("SELECT count(*) AS n FROM audit_events WHERE resource='attachments' AND operation='create'").get()!.n,2);
      if(!point.startsWith('upload-'))assert.ok(existsSync(join(f.directory,'quarantine','jobs',f.file.id,'file')));
    }finally{store.db.close();}
  }finally{if(child.exitCode===null&&child.signalCode===null){await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGKILL');});}}
});
