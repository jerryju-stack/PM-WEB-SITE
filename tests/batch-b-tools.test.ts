import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/database.ts';
import { resourceWriter } from '../lib/resources.ts';
import { attachmentService, digest } from '../lib/attachments.ts';
import { backupSnapshot, verifySnapshot, restoreSnapshot } from '../lib/snapshots.ts';
import { httpFixture } from './http-fixture.ts';
const cli=fileURLToPath(new URL('../scripts/data-maintenance.ts',import.meta.url));
const actor={actorId:'admin',actorName:'隔离管理员',requestId:'tools-test'};
const run=(command:string,data:string,args:string[]=[])=>JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',cli,command,'--data',data,'--offline-confirmed','yes',...args],{encoding:'utf8'}));
test('offline CLI reports legacy/missing/corrupt/orphan/pending; quarantines only explicit orphan; retries and exports without overwrite',async()=>{
  const parent=mkdtempSync(join(tmpdir(),'station-tools-')),data=join(parent,'source');process.env.ADMIN_PASSWORD='Isolated-Tools-Test-2026';
  const store=openStore(data),p=resourceWriter(store).create('projects',{title:'tools'},'tester',actor),task=store.tasks(p.id)[0],files=attachmentService(store);
  const upload=()=>files.upload(task.id,'file.txt',(async function*(){yield Buffer.from('normal');})(),actor);
  const normal=await upload(),legacy=await upload(),missing=await upload(),corrupt=await upload();
  store.db.prepare('UPDATE attachments SET sha256=NULL WHERE id=?').run(legacy.id);
  const {unlinkSync}=await import('node:fs');unlinkSync(join(data,'uploads',missing.id));writeFileSync(join(data,'uploads',corrupt.id),'broken');
  writeFileSync(join(data,'uploads','legacy.part'),'orphan');store.db.prepare('INSERT INTO file_jobs(id,kind,created_at) VALUES(?,?,?)').run('pending','upload',new Date().toISOString());writeFileSync(join(data,'uploads','pending.part'),'inflight');store.db.close();
  let report=run('reconcile',data).result;assert.deepEqual(report.normal,[normal.id]);assert.deepEqual(report.legacy,[legacy.id]);assert.deepEqual(report.missing,[missing.id]);assert.deepEqual(report.corrupt,[corrupt.id]);assert.deepEqual(report.orphan,['legacy.part']);assert.equal(report.pending[0].id,'pending');
  assert.throws(()=>run('quarantine',data,['--file',normal.id]));assert.throws(()=>run('quarantine',data,['--file','pending.part']));
  const quarantined=run('quarantine',data,['--file','legacy.part']).result;assert.ok(!existsSync(join(data,'uploads','legacy.part')));
  const entry='orphans/'+quarantined.entry.split(/[\\/]/).at(-1),exported=join(parent,'exported');run('export-quarantine',data,['--entry',entry,'--target',exported]);assert.equal(readFileSync(join(exported,'file'),'utf8'),'orphan');assert.throws(()=>run('export-quarantine',data,['--entry',entry,'--target',exported]));
  run('retry',data);run('retry',data);report=run('reconcile',data).result;assert.equal(report.pending.length,0);assert.equal(readFileSync(join(data,'uploads',normal.id),'utf8'),'normal');assert.equal(readFileSync(join(data,'quarantine','jobs','pending','partial'),'utf8'),'inflight');
  const events=run('audit',data,['--resource','projects','--resource-id',p.id]).result;assert.equal(events[0].actor_id,'admin');assert.equal(events[0].request_id,'tools-test');
  assert.throws(()=>backupSnapshot(data,join(parent,'invalid-snapshot'),'fixture'));
  assert.ok(!existsSync(join(parent,'invalid-snapshot','COMPLETE')));
  for(const name of readdirSync(parent).filter(name=>name.startsWith('.incomplete-')))assert.throws(()=>verifySnapshot(join(parent,name)),/Incomplete/);
});
test('manifest traversal and missing completion marker cannot restore',()=>{
  const parent=mkdtempSync(join(tmpdir(),'station-manifest-')),source=join(parent,'source'),snapshot=join(parent,'snapshot');process.env.ADMIN_PASSWORD='Isolated-Manifest-Test-2026';const store=openStore(source),admin=store.get('users','admin');store.put('users',{...admin,hash:''});store.db.close();
  assert.throws(()=>backupSnapshot(source,join(parent,'unusable-account'),'fixture'),/usable login/);assert.ok(!existsSync(join(parent,'unusable-account','COMPLETE')));
  const repaired=openStore(source);repaired.put('users',admin);repaired.db.close();
  backupSnapshot(source,snapshot,'fixture');const original=readFileSync(join(snapshot,'manifest.json'),'utf8');
  const manifest=JSON.parse(original);manifest.files.push({path:'../outside',size:0,sha256:'x'});const encoded=JSON.stringify(manifest);writeFileSync(join(snapshot,'manifest.json'),encoded);writeFileSync(join(snapshot,'COMPLETE'),digest(Buffer.from(encoded)));
  assert.throws(()=>restoreSnapshot(snapshot,join(parent,'restored')),/Unsafe/);assert.ok(!existsSync(join(parent,'restored')));
  writeFileSync(join(snapshot,'manifest.json'),original);writeFileSync(join(snapshot,'COMPLETE'),'bad');assert.throws(()=>verifySnapshot(snapshot),/Manifest checksum/);
});
test('slow real upload survives unrelated cleanup; offline tools cannot run while server owns the directory',async()=>{
  const f=await httpFixture(),db=new DatabaseSync(join(f.directory,'project-station.sqlite'));let upload:ReturnType<typeof request>|undefined;
  try {
    const project=(await f.call('projects',{title:'inflight'},f.cookie)).data.id,timing=(await f.call('projects/'+project+'/timing',undefined,f.cookie)).data,task=timing.tasks[0].id;
    const path='/api/projects/'+project+'/tasks/'+task+'/attachments';
    const first=await fetch(f.base+path,{method:'POST',headers:{Cookie:f.cookie,'X-File-Name':'normal.txt'},body:'normal'});const firstId=(await first.json()).id;
    const response=new Promise<{status:number;body:any}>((resolve,reject)=>{upload=request(f.base+path,{method:'POST',headers:{Cookie:f.cookie,'X-File-Name':'slow.txt','Transfer-Encoding':'chunked'}},res=>{let value='';res.on('data',chunk=>value+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(value)}));});upload.on('error',reject);upload.write('first-');});
    // Observe a real .part, not just an in-memory promise.
    let pending:any;
    for(let n=0;n<100;n++){pending=db.prepare("SELECT id FROM file_jobs WHERE kind='upload'").get();if(pending&&existsSync(join(f.directory,'uploads',pending.id+'.part')))break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok(pending);assert.ok(existsSync(join(f.directory,'uploads',pending.id+'.part')));
    assert.throws(()=>run('reconcile',f.directory));assert.throws(()=>run('retry',f.directory));
    assert.equal((await f.call('attachments/'+firstId,{},f.cookie,'DELETE')).status,200);assert.ok(existsSync(join(f.directory,'uploads',pending.id+'.part')));
    upload!.end('second');const result=await response;assert.equal(result.status,201);assert.equal(result.body.id,pending.id);
    const bytes=await fetch(f.base+'/api/attachments/'+result.body.id,{headers:{Cookie:f.cookie}});assert.equal(await bytes.text(),'first-second');
  }finally{upload?.destroy();db.close();await f.stop();}
});
