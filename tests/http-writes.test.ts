import { test } from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture } from './http-fixture.ts';
for(const collection of ['projects','articles'] as const)test(collection+' HTTP concurrent update/delete contract and old-client rejection',async()=>{
 const f=await httpFixture();const {call,cookie}=f;try{
 const body=collection==='projects'?{title:'original',description:'before'}:{title:'original',content:'body',description:'before'};
 const created=await call(collection,body,cookie);assert.equal(created.status,200);const id=created.data.id;
 const first=(await call(collection+'/'+id,undefined,cookie)).data,second=structuredClone(first);assert.equal(first.version,0);
 const replies=await Promise.all([call(collection+'/'+id,{...first,title:'A'},cookie,'PATCH'),call(collection+'/'+id,{...second,description:'B'},cookie,'PATCH')]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
 const latest=(await call(collection+'/'+id,undefined,cookie)).data;assert.equal(latest.version,1);
 const winner=replies[0].status===200;assert.equal(latest.title,winner?'A':'original');assert.equal(latest.description,winner?'before':'B');
 const protectedWrite=await call(collection+'/'+id,{id:'replacement',version:1,taskRevision:999,progress:99,status:'已完成',title:'explicit update'},cookie,'PATCH');
 assert.equal(protectedWrite.status,200);const protectedState=(await call(collection+'/'+id,undefined,cookie)).data;assert.equal(protectedState.id,id);assert.equal(protectedState.version,2);assert.equal(protectedState.progress,0);assert.equal(protectedState.status,'计划中');if(collection==='projects')assert.equal(protectedState.taskRevision,0);assert.equal((await call(collection+'/replacement',undefined,cookie)).status,404);
 assert.equal((await call(collection+'/'+id,{...body},cookie,'PATCH')).status,409);
 assert.equal((await call(collection+'/'+id,{version:0,taskRevision:0},cookie,'DELETE')).status,409);
 assert.equal((await call(collection+'/'+id,{},cookie,'DELETE')).status,409);
 const retry=await call(collection+'/'+id,{...latest,title:'manual retry',version:2},cookie,'PATCH');assert.equal(retry.status,200);assert.equal(retry.data.item.title,'manual retry');const saved=(await call(collection+'/'+id,undefined,cookie)).data;assert.equal(saved.title,'manual retry');assert.equal(saved.version,3);
 assert.equal((await call(collection+'/'+id,{version:3,taskRevision:0},cookie,'DELETE')).status,200);
 assert.equal((await call(collection+'/'+id,{...first},cookie,'PATCH')).status,404);
 assert.equal((await call(collection,{...first},cookie)).status,404); // old POST-with-id must never create
 assert.equal((await call(collection+'/'+id,{version:2,taskRevision:0},cookie,'DELETE')).status,404);
 assert.equal((await call('data')).data[collection].length,0);
 }finally{await f.stop();}
});
test('HTTP draft tasks and metadata keep separate versions; derived fields update only on adoption',async()=>{
 const f=await httpFixture();const {call,cookie}=f;try{
  const p=(await call('projects',{title:'original',date:'2026-12-31'},cookie)).data.item;
  const live=(await call('projects/'+p.id+'/timing',undefined,cookie)).data;
  const start=(await call('projects/'+p.id+'/timing/draft/start',{},cookie)).data;
  let revision=start.draft.revision;const body=(extra:any={})=>({leaseToken:start.leaseToken,draftId:start.draft.id,revision,...extra});
  const task=await call('projects/'+p.id+'/tasks',body({title:'leaf',parentId:live.tasks[0].id,duration:1,progress:100}),cookie);assert.equal(task.status,200);revision=task.data.revision;
  const edit=await call('projects/'+p.id,{...p,title:'metadata change',progress:99,status:'已完成'},cookie,'PATCH');assert.equal(edit.status,200);assert.equal(edit.data.item.progress,0);assert.equal(edit.data.item.date,'2026-12-31');
  assert.equal((await call('projects/'+p.id+'/timing',undefined,cookie)).data.revision,0);
  const protectedTask=await call('projects/'+p.id+'/tasks/'+task.data.id,body({id:'replacement',projectId:'elsewhere',version:999,taskRevision:999,owner:''}),cookie,'PATCH');assert.equal(protectedTask.status,200);revision=protectedTask.data.revision;
  assert.equal(protectedTask.data.tasks.find((t:any)=>t.id===task.data.id).projectId,p.id);assert.ok(!protectedTask.data.tasks.some((t:any)=>t.id==='replacement'));
  for(const invalid of [{duration:'2'},{progress:null},{parentId:[]},{duration:2601}])assert.equal((await call('projects/'+p.id+'/tasks/'+task.data.id,body(invalid),cookie,'PATCH')).status,400);
  assert.equal((await call('projects/'+p.id,{title:[],version:1},cookie,'PATCH')).status,400);
  const adopted=await call('projects/'+p.id+'/timing/draft/adopt',body(),cookie);assert.equal(adopted.status,200);
  const final=(await call('projects/'+p.id+'/timing',undefined,cookie)).data;assert.equal(final.project.title,'metadata change');assert.equal(final.project.version,1);assert.equal(final.project.progress,100);assert.equal(final.revision,1);
 }finally{await f.stop();}
});
