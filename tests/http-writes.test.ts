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
 assert.equal((await call(collection+'/'+id,{...body},cookie,'PATCH')).status,409);
 assert.equal((await call(collection+'/'+id,{version:0,taskRevision:0},cookie,'DELETE')).status,409);
 assert.equal((await call(collection+'/'+id,{},cookie,'DELETE')).status,409);
 const retry=await call(collection+'/'+id,{...latest,title:'manual retry',version:1},cookie,'PATCH');assert.equal(retry.status,200);assert.equal(retry.data.item.title,'manual retry');
 assert.equal((await call(collection+'/'+id,{version:2,taskRevision:0},cookie,'DELETE')).status,200);
 assert.equal((await call(collection+'/'+id,{...first},cookie,'PATCH')).status,404);
 assert.equal((await call(collection,{...first},cookie)).status,404); // old POST-with-id must never create
 assert.equal((await call(collection+'/'+id,{version:2,taskRevision:0},cookie,'DELETE')).status,404);
 assert.equal((await call('data')).data[collection].length,0);
 }finally{await f.stop();}
});
test('HTTP task and metadata writes keep separate versions and stale aggregate fields cannot overwrite results',async()=>{
 const f=await httpFixture();const {call,cookie}=f;try{
 const p=(await call('projects',{title:'original',date:'2026-12-31'},cookie)).data.item;
 let timing=(await call('projects/'+p.id+'/timing',undefined,cookie)).data;
 const task=await call('projects/'+p.id+'/tasks',{title:'leaf',parentId:timing.tasks[0].id,duration:1,progress:100,revision:0},cookie);assert.equal(task.status,200);
 const edit=await call('projects/'+p.id,{...p,title:'metadata change',progress:0,status:'计划中'},cookie,'PATCH');assert.equal(edit.status,200);assert.equal(edit.data.item.progress,100);assert.equal(edit.data.item.date,'2026-12-31');
 assert.equal((await call('projects/'+p.id,{version:1,taskRevision:0},cookie,'DELETE')).status,409);
 assert.equal((await call('projects/'+p.id+'/tasks/'+task.data.id,{revision:1,progress:0},cookie,'PATCH')).status,200);
 timing=(await call('projects/'+p.id+'/timing',undefined,cookie)).data;assert.equal(timing.project.title,'metadata change');assert.equal(timing.project.version,1);assert.equal(timing.revision,2);
 for(const body of [{revision:2,duration:'2'},{revision:2,progress:null},{revision:2,parentId:[]},{revision:2,duration:2601}])assert.equal((await call('projects/'+p.id+'/tasks/'+task.data.id,body,cookie,'PATCH')).status,400);
 assert.equal((await call('projects/'+p.id,{title:[],version:1},cookie,'PATCH')).status,400);
 assert.equal((await call('projects/'+p.id+'/timing',undefined,cookie)).data.revision,2);
 }finally{await f.stop();}
});
