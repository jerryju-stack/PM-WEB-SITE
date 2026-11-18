import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FilePool} from '../lib/file-pool.ts';
import {FileJobError} from '../lib/file-job-types.ts';
import {timingFileService} from '../lib/timing-file-service.ts';
import {openStore} from '../lib/database.ts';
import {timingDrafts} from '../lib/timing-drafts.ts';
import {schedulePolicy} from '../lib/timing-versions.ts';
import {exportProjectXml} from '../lib/timing-project.ts';
import {schedule,template} from '../lib/schedule.ts';

for(const operation of ['preview','confirm'])test(`E2 ${operation} rechecks the deadline inside its transaction after payload serialization, and rolls back`,async()=>{
 process.env.ADMIN_PASSWORD='Isolated-EB-Final-Gate';const store=openStore(mkdtempSync(join(tmpdir(),'station-e-b-gate-'))),pool=new FilePool(),service=timingFileService(store,pool);
 try{
  store.put('projects',{id:'p',title:'Final gate'});store.saveTasks('p',template('p'));const user=store.get('users','admin'),context={actorId:user.uid,actorUid:user.uid,actorName:'Synthetic',requestId:'isolated'};
  const start=timingDrafts(store).start('p',{},context),session={leaseToken:start.leaseToken,draftId:start.draft!.id,revision:start.draft!.revision},signal=new AbortController().signal;
  const file=exportProjectXml({format:1,project:store.get('projects','p'),schedulePolicy,tasks:schedule([{id:'new',projectId:'p',parentId:null,order:0,title:'Import',kind:'task',owner:'PM',start:'2026-11-02',end:null,duration:1,progress:0,status:'计划中',notes:'',predecessors:[]}])}).toString('base64');
  const body={...session,format:'xml',file};let previewId:string|undefined;
  if(operation==='confirm')previewId=(await service.preview('p',body,context,{signal,guard:()=>{}})).previewId!;
  const before=store.db.prepare('SELECT payload,revision FROM timing_drafts WHERE project_id=?').get('p'),imports=store.db.prepare('SELECT id,result FROM timing_imports').all();let checks=0;
  const call={signal,guard:()=>{if(++checks===2)throw new FileJobError('FILE_TIMEOUT',504,'synthetic deadline at commit');}};
  await assert.rejects(operation==='preview'?service.preview('p',body,context,call):service.confirm('p',{...session,previewId},context,call),{status:504});
  assert.equal(checks,2);assert.deepEqual(store.db.prepare('SELECT payload,revision FROM timing_drafts WHERE project_id=?').get('p'),before);assert.deepEqual(store.db.prepare('SELECT id,result FROM timing_imports').all(),imports);
 }finally{await pool.close();store.db.close();}
});

for(const operation of ['preview','confirm'])test(`E2 ${operation} refuses a lease expiring at the final serialization boundary`,async()=>{
 process.env.ADMIN_PASSWORD='Isolated-EB-Expiry-Gate';const store=openStore(mkdtempSync(join(tmpdir(),'station-e-b-expiry-'))),pool=new FilePool(),service=timingFileService(store,pool);
 try{
  store.put('projects',{id:'p',title:'Expiry gate'});store.saveTasks('p',template('p'));const user=store.get('users','admin'),context={actorId:user.uid,actorUid:user.uid,actorName:'Synthetic',requestId:'isolated'};
  const start=timingDrafts(store).start('p',{},context),session={leaseToken:start.leaseToken,draftId:start.draft!.id,revision:start.draft!.revision},signal=new AbortController().signal;
  const file=exportProjectXml({format:1,project:store.get('projects','p'),schedulePolicy,tasks:template('p')}).toString('base64'),body={...session,format:'xml',file};
  const previewId=operation==='confirm'?(await service.preview('p',body,context,{signal,guard:()=>{}})).previewId:undefined;
  if(operation==='confirm')assert.ok(previewId);
  const before=store.db.prepare('SELECT payload,revision FROM timing_drafts').all(),imports=store.db.prepare('SELECT id,payload,result FROM timing_imports').all();let checks=0;
  // Run after the real worker completed and after payload serialization, within the transaction.
  const call={signal,guard:()=>{if(++checks===2)store.db.prepare('UPDATE timing_edit_leases SET expires_at=0').run();}};
  await assert.rejects(operation==='preview'?service.preview('p',body,context,call):service.confirm('p',{...session,previewId},context,call),{status:409});
  assert.equal(checks,2);assert.deepEqual(store.db.prepare('SELECT payload,revision FROM timing_drafts').all(),before);assert.deepEqual(store.db.prepare('SELECT id,payload,result FROM timing_imports').all(),imports);
 }finally{await pool.close();store.db.close();}
});

test('E2 confirmation rechecks preview time after serialization immediately before writing',async()=>{
 process.env.ADMIN_PASSWORD='Isolated-EB-Preview-Time';const store=openStore(mkdtempSync(join(tmpdir(),'station-e-b-preview-time-'))),pool=new FilePool(),service=timingFileService(store,pool);
 const realNow=Date.now;
 try{
  store.put('projects',{id:'p',title:'Preview clock gate'});store.saveTasks('p',template('p'));const user=store.get('users','admin'),context={actorId:user.uid,actorUid:user.uid,actorName:'Synthetic',requestId:'isolated'};
  const start=timingDrafts(store).start('p',{},context),session={leaseToken:start.leaseToken,draftId:start.draft!.id,revision:start.draft!.revision},signal=new AbortController().signal;
  const file=exportProjectXml({format:1,project:store.get('projects','p'),schedulePolicy,tasks:template('p')}).toString('base64');
  const preview=await service.preview('p',{...session,format:'xml',file},context,{signal,guard:()=>{}});assert.ok(preview.previewId);
  // Date uses the same clock as lease/preview gates; an advancing clock never changes stored rows.
  const at=realNow(),expiry=at+1000;store.db.prepare('UPDATE timing_imports SET expires_at=?').run(new Date(expiry).toISOString());
  const before=store.db.prepare('SELECT payload,revision FROM timing_drafts').all(),imports=store.db.prepare('SELECT id,payload,result FROM timing_imports').all();
  // Freeze the global Date constructor's time for both initial and final ISO checks.
  const NativeDate=Date;let now=at,checks=0;
  class TestDate extends NativeDate{constructor(...args:any[]){if(!args.length)super(now);else super(args[0]);}static now(){return now;}}
  globalThis.Date=TestDate as DateConstructor;
  try{
   await assert.rejects(service.confirm('p',{...session,previewId:preview.previewId},context,{signal,guard:()=>{if(++checks===2)now=expiry+1;}}),{status:409});
   assert.equal(checks,2);
  }finally{globalThis.Date=NativeDate;}
  assert.deepEqual(store.db.prepare('SELECT payload,revision FROM timing_drafts').all(),before);assert.deepEqual(store.db.prepare('SELECT id,payload,result FROM timing_imports').all(),imports);
 }finally{Date.now=realNow;await pool.close();store.db.close();}
});
