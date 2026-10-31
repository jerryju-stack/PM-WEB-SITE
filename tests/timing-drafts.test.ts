import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/database.ts';
import { timingDrafts, EDIT_LEASE_MS } from '../lib/timing-drafts.ts';
import { timingVersions } from '../lib/timing-versions.ts';
import type { Task } from '../lib/schedule.ts';
import { httpFixture } from './http-fixture.ts';
const task=(id:string,extra:Partial<Task>={}):Task=>({id,projectId:'p',parentId:null,order:0,title:'same name',kind:'task',owner:'PM',start:'2026-10-26',end:'2026-10-26',duration:1,progress:0,status:'计划中',notes:'',predecessors:[],...extra});
function fixture(){
 process.env.ADMIN_PASSWORD='Isolated-D8-Test-2026';const directory=mkdtempSync(join(tmpdir(),'station-d8-')),store=openStore(directory);
 store.put('projects',{id:'p',title:'D8',progress:0,status:'计划中'});store.saveTasks('p',[task('a'),task('b',{order:1})]);
 const user=store.get('users','admin'),context={actorId:user.uid,actorUid:user.uid,actorName:user.name,requestId:randomUUID()};
 let clock=Date.now();const drafts=timingDrafts(store,()=>clock),plans=timingVersions(store);
 const body=(token:string)=>({leaseToken:token,draftId:drafts.state('p').draft!.id,revision:drafts.state('p').draft!.revision});
 const baseline=()=>plans.save('p',{kind:'baseline',name:'Original',reason:'kickoff',revision:store.revision('p'),projectVersion:store.get('projects','p').version,requestKey:randomUUID()},context).version;
 return {directory,store,context,drafts,plans,body,baseline,advance:()=>clock+=EDIT_LEASE_MS+1};
}
test('D8 shared draft is durable and isolated; one session per project including the same account; expired sessions are fenced',()=>{
 const f=fixture();const {store,drafts,context,body}=f;
 try{
  const before=store.tasks('p'),revision=store.revision('p'),first=drafts.start('p',{},context),token=first.leaseToken;
  assert.throws(()=>drafts.start('p',{},context),{status:409});
  drafts.mutate('p','a','PATCH',{...body(token),owner:'Draft owner'},context);
  assert.deepEqual(store.tasks('p'),before);assert.equal(store.revision('p'),revision);
  const d=drafts.state('p').draft;drafts.heartbeat('p',{leaseToken:token},context);assert.deepEqual(drafts.state('p').draft,d);
  drafts.release('p',{leaseToken:token},context);assert.equal(drafts.state('p').editor,null);
  const reopened=openStore(f.directory);try{assert.equal(timingDrafts(reopened).plan('p').tasks[0].owner,'Draft owner');}finally{reopened.db.close();}
  const second=drafts.start('p',{},context);assert.equal(second.draft!.id,d!.id);assert.equal(second.plan.tasks[0].owner,'Draft owner');
  f.advance();assert.equal(drafts.state('p').editor,null);const third=drafts.start('p',{},context);
  assert.throws(()=>drafts.mutate('p','a','PATCH',{...body(second.leaseToken),owner:'stale'},context),{status:409});
  assert.throws(()=>drafts.adopt('p',body(second.leaseToken),context),{status:409});
  assert.throws(()=>drafts.heartbeat('p',{leaseToken:second.leaseToken},context),{status:409});
  drafts.release('p',{leaseToken:second.leaseToken},context);assert.ok(drafts.state('p').editor);drafts.check('p',{leaseToken:third.leaseToken},context);
 }finally{store.db.close();}
});
test('D8 adoption is atomic, idempotent, versioned, keeps lease and baseline, skips no-ops, preserves removed-task attachments',()=>{
 const {store,drafts,plans,context,body,baseline}=fixture();
 try{
  const base=baseline(),before=store.tasks('p'),revision=store.revision('p');
  store.db.prepare('INSERT INTO attachments(id,task_id,name,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?)').run('retained-file','b','keep.txt',0,'admin',new Date().toISOString());
  const token=drafts.start('p',{},context).leaseToken;
  drafts.mutate('p','a','PATCH',{...body(token),duration:3},context);drafts.mutate('p','b','DELETE',body(token),context);
  const request=body(token),draft=drafts.state('p').draft;
  store.db.exec("CREATE TRIGGER reject_d8 BEFORE INSERT ON timing_versions WHEN NEW.kind='version' BEGIN SELECT RAISE(ABORT,'adoption failure'); END");
  assert.throws(()=>drafts.adopt('p',request,context),/adoption failure/);assert.deepEqual(store.tasks('p'),before);assert.equal(store.revision('p'),revision);assert.deepEqual(drafts.state('p').draft,draft);assert.equal(plans.list('p').length,1);
  store.db.exec('DROP TRIGGER reject_d8');const adopted=drafts.adopt('p',request,context);
  assert.equal(adopted.sequence,1);assert.equal(drafts.adopt('p',request,context).replayed,true);assert.equal(plans.list('p').length,2,'identical baseline covers original execution');
  assert.deepEqual(plans.get('p',base.id).plan.tasks,before);assert.equal(plans.get('p',adopted.versionId).version.sourceRevision,revision);
  assert.equal(store.tasks('p').length,1);assert.ok(store.db.prepare('SELECT 1 FROM attachments WHERE id=?').get('retained-file'));assert.equal(store.db.prepare('SELECT 1 FROM file_jobs WHERE id=?').get('retained-file'),undefined);
  assert.equal(drafts.state('p').draft,null);drafts.check('p',{leaseToken:token},context);
  drafts.start('p',{leaseToken:token},context);assert.equal(drafts.adopt('p',body(token),context).changed,false);assert.equal(plans.list('p').length,2);
  drafts.start('p',{leaseToken:token},context);drafts.mutate('p','a','PATCH',{...body(token),owner:'Next'},context);assert.equal(drafts.adopt('p',body(token),context).sequence,2);
 }finally{store.db.close();}
});
test('D8 preserves an unversioned original execution and rolls back an archive failure; historical scheduling uses stable-ID latest progress',()=>{
 const {store,drafts,plans,context,body,baseline}=fixture();
 try{
  const history=baseline();store.saveTasks('p',[task('a',{progress:80,status:'进行中',start:'2026-11-02'}),task('new',{progress:25,order:1})]);
  const token=drafts.start('p',{},context).leaseToken;drafts.mutate('p','a','PATCH',{...body(token),owner:'Unadopted'},context);
  const original=drafts.state('p').draft!,switchBody={...body(token),expectedDraftId:original.id,sourceVersion:history.id,decision:'archive'};
  assert.throws(()=>drafts.start('p',{...switchBody,decision:undefined},context),{status:409});
  assert.equal(plans.get('p',history.id).plan.tasks[0].progress,0);plans.compare('p',history.id,'current');assert.equal(drafts.state('p').draft!.id,original.id);
  store.db.exec("CREATE TRIGGER fail_draft_archive BEFORE INSERT ON timing_archives BEGIN SELECT RAISE(ABORT,'archive failure'); END");
  assert.throws(()=>drafts.start('p',switchBody,context),/archive failure/);assert.equal(drafts.state('p').draft!.id,original.id);
  store.db.exec('DROP TRIGGER fail_draft_archive');const switched=drafts.start('p',switchBody,context);
  assert.notEqual(switched.draft!.id,original.id);assert.equal(switched.plan.tasks.find(t=>t.id==='a')!.start,'2026-10-26');assert.equal(switched.plan.tasks.find(t=>t.id==='a')!.progress,80);assert.equal(switched.plan.tasks.find(t=>t.id==='a')!.status,'进行中');assert.equal(switched.plan.tasks.find(t=>t.id==='b')!.progress,0);assert.ok(!switched.plan.tasks.some(t=>t.id==='new'));
  const archived=plans.list('p').find(v=>v.kind==='unadopted')!;assert.equal(plans.get('p',archived.id).plan.tasks[0].owner,'Unadopted');assert.equal(archived.sequence,null);
  assert.throws(()=>store.db.prepare('UPDATE timing_archives SET name=? WHERE id=?').run('changed',archived.id),/read-only/);
  drafts.adopt('p',body(token),context);assert.ok(plans.list('p').some(v=>v.kind==='previous'));assert.equal(plans.list('p').filter(v=>v.kind==='version').length,1);
  drafts.start('p',{leaseToken:token},context);const latest=drafts.state('p').draft!;
  drafts.start('p',{...body(token),expectedDraftId:latest.id,sourceVersion:history.id,decision:'discard'},context);assert.equal(plans.list('p').filter(v=>v.kind==='unadopted').length,1);
 }finally{store.db.close();}
});
test('D8 HTTP writes and imports require a valid page lease; view stays live and publishing does not release ownership',async()=>{
 const f=await httpFixture();try{
  const {call,cookie}=f,created=await call('projects',{title:'D8 HTTP'},cookie);assert.equal(created.status,200,JSON.stringify(created));const p=created.data.id;
  const response=await call('projects/'+p+'/timing',undefined,cookie);assert.equal(response.status,200,JSON.stringify(response));const live=response.data;
  assert.equal((await call('projects/'+p+'/tasks/'+live.tasks[0].id,{owner:'bypass',revision:0},cookie,'PATCH')).status,409);
  assert.equal((await call('projects/'+p+'/timing/import/preview',{file:'eA=='},cookie)).status,409);
  const start=(await call('projects/'+p+'/timing/draft/start',{},cookie)).data;
  assert.equal((await call('projects/'+p+'/timing/draft/start',{},cookie)).status,409);
  const b={leaseToken:start.leaseToken,draftId:start.draft.id,revision:start.draft.revision};
  const saved=await call('projects/'+p+'/tasks/'+live.tasks[0].id,{...b,owner:'shared draft'},cookie,'PATCH');assert.equal(saved.status,200);
  assert.notEqual((await call('projects/'+p+'/timing',undefined,cookie)).data.tasks[0].owner,'shared draft');
  const draftRead=await fetch(f.base+'/api/projects/'+p+'/timing',{headers:{Cookie:cookie,'X-Timing-Lease':start.leaseToken}});assert.equal((await draftRead.json()).tasks[0].owner,'shared draft');
  const publish={...b,revision:saved.data.revision};const adopted=await call('projects/'+p+'/timing/draft/adopt',publish,cookie);assert.equal(adopted.status,200);assert.equal(adopted.data.sequence,1);
  assert.equal((await call('projects/'+p+'/timing/draft/adopt',publish,cookie)).data.replayed,true);
  assert.equal((await call('projects/'+p+'/timing/draft/start',{},cookie)).status,409);
  assert.equal((await call('projects/'+p+'/timing',undefined,cookie)).data.tasks[0].owner,'shared draft');
  await call('projects/'+p+'/timing/draft/release',{leaseToken:start.leaseToken},cookie);
  assert.equal((await call('projects/'+p+'/timing/draft/start',{},cookie)).status,200);
 }finally{await f.stop();}
});
