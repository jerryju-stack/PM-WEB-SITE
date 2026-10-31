import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/database.ts';
import { timingVersions, comparePlans, schedulePolicy } from '../lib/timing-versions.ts';
import type { PlanSnapshot } from '../lib/timing-versions.ts';
import type { Task } from '../lib/schedule.ts';
import { applyMigrations, migrations } from '../lib/migrations.ts';
import { inspectData } from '../lib/snapshots.ts';
import { httpFixture } from './http-fixture.ts';
const task=(id:string,extra:Partial<Task>={}):Task=>({id,projectId:'p',parentId:null,order:0,title:id,kind:'task',owner:'PM',start:'2026-10-23',end:'2026-10-23',duration:1,progress:0,status:'计划中',notes:'',predecessors:[],...extra});
function fixture(){
  process.env.ADMIN_PASSWORD='Isolated-D1-Test-2026';
  const directory=mkdtempSync(join(tmpdir(),'station-d1-')),store=openStore(directory),user=store.get('users','admin');
  store.put('projects',{id:'p',title:'D1 plan',description:'original',progress:0,status:'计划中',startDate:'2026-10-23'});
  const context={actorId:user.uid,actorUid:user.uid,actorName:user.name,requestId:randomUUID()},plans=timingVersions(store);
  const body=(extra:any={})=>({kind:'baseline',name:'基线',reason:'评审通过',revision:store.revision('p'),projectVersion:store.get('projects','p').version,requestKey:randomUUID(),...extra});
  return {directory,store,context,plans,body};
}
test('D1 migration preserves existing plans, creates no history and retries atomically',()=>{
  const {store,plans}=fixture();try{
    store.saveTasks('p',[task('a')]);const before=store.tasks('p'),revision=store.revision('p');
    store.db.exec('DROP TRIGGER timing_version_readonly; DROP TABLE timing_versions; DELETE FROM schema_migrations WHERE version=5');
    const steps=migrations.map(s=>s.version===5?{...s,up(db:typeof store.db){s.up(db);db.exec('INSERT INTO injected_d1_failure VALUES(1)');}}:s);
    assert.throws(()=>applyMigrations(store.db,steps),/injected_d1_failure/);
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='timing_versions'").get(),undefined);
    applyMigrations(store.db);applyMigrations(store.db);
    assert.deepEqual(plans.list('p'),[]);assert.deepEqual(store.tasks('p'),before);assert.equal(store.revision('p'),revision);
  }finally{store.db.close();}
});
test('explicit snapshots retain exact calculated values, metadata and project after edits, deletion and reopen',()=>{
  const {directory,store,plans,body,context}=fixture();let id='';
  try{
    store.saveTasks('p',[task('a',{notes:'original notes'}),task('b',{predecessors:['a'],order:1})]);
    const original=store.tasks('p'),revision=store.revision('p');
    const saved=plans.save('p',body(),context);id=saved.version.id;
    assert.equal(store.revision('p'),revision);assert.equal(saved.version.actorUid,context.actorUid);assert.equal(saved.version.actorName,context.actorName);assert.ok(saved.version.savedAt);
    // Future calculation rules must not run while opening retained data. A stored
    // date that a later scheduler would normalize is returned byte-for-byte.
    store.saveTasks('p',[task('a',{start:'2026-11-02',owner:'new owner'})]);
    store.put('projects',{...store.get('projects','p'),title:'new title'});
    const history=plans.get('p',id);assert.deepEqual(history.plan.tasks,original);assert.equal(history.plan.project.title,'D1 plan');assert.deepEqual(history.plan.schedulePolicy,schedulePolicy);
    assert.throws(()=>store.db.prepare('UPDATE timing_versions SET name=? WHERE id=?').run('overwrite',id),/read-only/);
    assert.equal(plans.list('p').length,1);assert.equal(inspectData(directory).tables.timing_versions.count,1);
  }finally{store.db.close();}
  const reopened=openStore(directory);try{assert.equal(timingVersions(reopened).get('p',id).plan.tasks[0].notes,'original notes');}finally{reopened.db.close();}
});
test('save checks revisions, project versions, validation and retry identity; sequential versions do not overwrite',()=>{
  const {store,plans,body,context}=fixture();try{
    const request=body();const first=plans.save('p',request,context);store.saveTasks('p',[task('a')]);
    assert.deepEqual(plans.save('p',request,context).version,first.version);assert.equal(plans.save('p',request,context).replayed,true);
    assert.throws(()=>plans.save('p',{...request,name:'other'},context),{status:409});
    assert.throws(()=>plans.save('p',body({revision:0}),context),{status:409});
    assert.throws(()=>plans.save('p',body({projectVersion:1}),context),{status:409});
    assert.throws(()=>plans.save('p',body({reason:' '}),context),{status:400});
    assert.throws(()=>plans.save('p',body({kind:'auto'}),context),{status:400});
    assert.throws(()=>plans.save('p',body({revision:undefined}),context),{status:409});
    for(const sequence of [1,2])assert.equal(plans.save('p',body({kind:'version',name:'PM 评审'}),context).version.sequence,sequence);
    plans.save('p',body({kind:'final',name:'最终版'}),context);assert.equal(plans.list('p').length,4);
    store.db.exec("CREATE TRIGGER reject_d1_audit BEFORE INSERT ON audit_events WHEN NEW.resource='timing-versions' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
    const retry=body({kind:'version',name:'第三次评审'});
    assert.throws(()=>plans.save('p',retry,context),/injected audit failure/);assert.equal(plans.list('p').length,4);
    store.db.exec('DROP TRIGGER reject_d1_audit');
    assert.equal(plans.save('p',retry,context).version.sequence,3);
    assert.equal(store.revision('p'),1);
  }finally{store.db.close();}
});
test('comparison matches stable IDs and reports all required fields with signed calendar date shifts',()=>{
  const project={id:'p',title:'plan'} as PlanSnapshot['project'];
  const make=(tasks:Task[]):PlanSnapshot=>({format:1,project,tasks,schedulePolicy});
  const before=make([task('a'),task('b',{title:'same',order:1,predecessors:['a']}),task('removed',{title:'same',order:2}),task('summary',{kind:'summary',order:3}),task('undated',{start:null,end:null,order:4})]);
  const after=make([task('a',{owner:'Other',duration:3,start:'2026-10-26',end:'2026-10-28',kind:'milestone',parentId:'summary',notes:'new',progress:50}),task('b',{title:'same',order:1,predecessors:[]}),task('added',{title:'same',order:2}),task('summary',{kind:'summary',order:3}),task('undated',{order:4})]);
  const diff=comparePlans(before,after);assert.equal(diff.summary.added,1);assert.equal(diff.summary.removed,1);
  const changes=diff.differences.find(d=>d.id==='a')!.changes;
  for(const field of ['owner','duration','start','end','kind','hierarchy','notes','progress'])assert.ok(changes.some(c=>c.field===field),field);
  assert.equal(changes.find(c=>c.field==='start')!.delta,3);assert.equal(comparePlans(after,before).differences.find(d=>d.id==='a')!.changes.find(c=>c.field==='start')!.delta,-3);
  assert.equal(diff.differences.find(d=>d.id==='undated')!.changes.find(c=>c.field==='start')!.delta,null);
  assert.ok(diff.differences.find(d=>d.id==='b')!.changes.some(c=>c.field==='predecessors'));
  assert.match(diff.dateBasis,/UTC 日历日/);assert.deepEqual(comparePlans(before,structuredClone(before)).summary,{added:0,removed:0,changed:0,unchanged:5});
  const ordered=make([task('a'),task('b',{predecessors:['x','y']})]),reordered=make([task('a'),task('b',{predecessors:['y','x']})]);
  assert.equal(comparePlans(ordered,reordered).summary.changed,0);
});
test('HTTP history and comparison reuse project access; only timing editors can explicitly save, history is read-only',async()=>{
  const f=await httpFixture();const {call,cookie}=f;
  try{
    const created=await call('projects',{title:'D1 HTTP'},cookie),p=created.data.id;
    const current=(await call(`projects/${p}/timing`,undefined,cookie)).data;
    assert.equal((await call(`projects/${p}/timing/versions`,undefined,cookie)).data.versions.length,0);
    const body={kind:'baseline',name:'HTTP baseline',reason:'kickoff',revision:current.revision,projectVersion:current.project.version,requestKey:randomUUID()};
    const saved=await call(`projects/${p}/timing/versions`,body,cookie);assert.equal(saved.status,201);const id=saved.data.version.id;
    assert.equal((await call(`projects/${p}/timing/versions`,body,cookie)).status,200);
    assert.equal((await call(`projects/${p}/timing/versions/${id}`,{name:'overwrite'},cookie,'PATCH')).status,405);
    assert.equal((await call(`projects/${p}/timing/versions/${id}`,{},cookie,'DELETE')).status,200);
    assert.equal((await call(`projects/${p}/timing/versions/${id}`,undefined,cookie)).status,404);
    assert.equal((await call(`projects/${p}/timing/versions/${id}/restore`,{},cookie)).status,200);
    const started=(await call(`projects/${p}/timing/draft/start`,{},cookie)).data;
    const session={leaseToken:started.leaseToken,draftId:started.draft.id,revision:started.draft.revision};
    const changed=await call(`projects/${p}/tasks/${current.tasks[0].id}`,{...session,owner:'updated'},cookie,'PATCH');assert.equal(changed.status,200);
    assert.equal((await call(`projects/${p}/timing/versions`,undefined,cookie)).data.versions.length,1);
    const adopted=await call(`projects/${p}/timing/draft/adopt`,{...session,revision:changed.data.revision},cookie);assert.equal(adopted.status,200);
    const v2=await call(`projects/${p}/timing/versions`,{...body,kind:'version',name:'review',revision:changed.data.revision,requestKey:randomUUID()},cookie);assert.equal(v2.status,201);
    const diff=await call(`projects/${p}/timing/compare?from=${id}&to=current`,undefined,cookie);assert.equal(diff.status,200);assert.equal(diff.data.summary.changed,1);
    assert.equal((await call(`projects/${p}/timing/compare?from=${id}&to=${v2.data.version.id}`,undefined,cookie)).data.summary.changed,1);
    const p2=(await call('projects',{title:'other project'},cookie)).data.id;
    assert.equal((await call(`projects/${p2}/timing/versions/${id}`,undefined,cookie)).status,404);
    assert.equal((await call(`projects/${p}/timing/versions`,undefined)).status,401);
    const viewer=await call('users',{id:'d1viewer',name:'Viewer',password:'D1-Viewer-Only-2026',role:'viewer'},cookie);
    assert.equal(viewer.status,200);
    const viewerCookie=(await call('login',{id:'d1viewer',password:'D1-Viewer-Only-2026'})).cookie;
    assert.equal((await call(`projects/${p}/timing/versions/${id}`,undefined,viewerCookie)).status,200);
    assert.equal((await call(`projects/${p}/timing/versions/${id}`,{},viewerCookie,'DELETE')).status,403);
    assert.equal((await call(`projects/${p}/timing/versions/${id}/restore`,{},viewerCookie)).status,403);
    assert.equal((await call(`projects/${p2}/timing/versions/${id}`,{},cookie,'DELETE')).status,404);
    assert.equal((await call(`projects/${p}/timing/versions`,{...body,revision:changed.data.revision,requestKey:randomUUID()},viewerCookie)).status,403);
    await call(`projects/${p}/access`,{timing:'members'},cookie,'PATCH');
    assert.equal((await call(`projects/${p}/timing/versions`,undefined,viewerCookie)).status,404);
    assert.equal((await call(`projects/${p}/timing/compare?from=${id}&to=current`,undefined,viewerCookie)).status,404);
  }finally{await f.stop();}
});

test('D8 history deletion is reversible and atomic, retains snapshots and never reuses V numbers',()=>{
 const {store,plans,body,context}=fixture();try{
  const baseline=plans.save('p',body(),context).version;
  const version=plans.save('p',body({kind:'version',name:'V one'}),context).version;
  const live=plans.current('p');
  store.db.exec("CREATE TRIGGER reject_history_delete BEFORE INSERT ON audit_events WHEN NEW.resource='timing-versions' AND NEW.operation='delete' BEGIN SELECT RAISE(ABORT,'history delete failure'); END");
  assert.throws(()=>plans.remove('p',version.id,context),/history delete failure/);assert.equal(plans.get('p',version.id).version.id,version.id);
  store.db.exec('DROP TRIGGER reject_history_delete');
  assert.equal(plans.remove('p',version.id,context).replayed,false);assert.equal(plans.remove('p',version.id,context).replayed,true);
  assert.ok(!plans.list('p').some(v=>v.id===version.id));assert.throws(()=>plans.get('p',version.id),{status:404});assert.throws(()=>plans.compare('p',version.id,'current'),{status:404});
  assert.ok(store.db.prepare('SELECT 1 FROM timing_versions WHERE id=?').get(version.id));assert.deepEqual(plans.current('p'),live);assert.equal(plans.get('p',baseline.id).version.kind,'baseline');
  assert.equal(plans.save('p',body({kind:'version',name:'V two'}),context).version.sequence,2);
  plans.restore('p',version.id,context);assert.equal(plans.get('p',version.id).version.sequence,1);assert.equal(plans.list('p').length,3);
 }finally{store.db.close();}
});
