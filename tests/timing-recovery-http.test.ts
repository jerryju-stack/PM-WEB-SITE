import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {httpFixture} from './http-fixture.ts';

test('E1 HTTP actor fencing, second-page occupancy, validation and stale leases preserve shared draft/execution boundaries',async()=>{
 const f=await httpFixture();
 try{
  const user=(await f.call('session',undefined,f.cookie)).data.user;
  const created=await f.call('projects',{title:'Recovery boundary',category:'Test',owner:'Synthetic',description:'Isolated',startDate:'2026-11-02',date:'2026-12-01',status:'计划中',progress:0},f.cookie);assert.equal(created.status,200);
  const p=created.data.id,base=`projects/${p}`,start=await f.call(base+'/timing/draft/start',{},f.cookie);assert.equal(start.status,200);
  assert.equal((await f.call(base+'/timing/draft/start',{},f.cookie)).status,409);
  const wrong=await fetch(f.base+'/api/'+base+'/timing/draft/start',{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json','X-Timing-Actor':'retired-or-other-uid'},body:'{}'});assert.equal(wrong.status,401);
  const initial=(await f.call(base+'/timing',undefined,f.cookie)).data;
  const b={leaseToken:start.data.leaseToken,draftId:start.data.draft.id,revision:start.data.draft.revision};
  const invalid=await f.call(base+'/tasks',{...b,title:'',kind:'task',duration:1,start:'2026-11-02'},f.cookie);assert.equal(invalid.status,400);
  assert.equal((await f.call(base+'/timing/draft',undefined,f.cookie)).data.draft.revision,b.revision);
  await f.call(base+'/timing/draft/release',{leaseToken:b.leaseToken},f.cookie);
  const next=await f.call(base+'/timing/draft/start',{},f.cookie);assert.notEqual(next.data.leaseToken,b.leaseToken);
  assert.equal((await f.call(base+'/tasks',{...b,title:'stale'},f.cookie)).status,409);
  const view=(await f.call(base+'/timing',undefined,f.cookie)).data;assert.deepEqual(view.tasks,initial.tasks);assert.equal(view.executionRevision,initial.executionRevision);
  const good=await fetch(f.base+'/api/'+base+'/timing',{headers:{Cookie:f.cookie,'X-Timing-Actor':user.id,'X-Timing-Lease':next.data.leaseToken}});assert.equal(good.status,200);
 }finally{await f.stop();}
});

test('E1 successful adoption with transport response lost is recovered by reading, and receipt prevents duplicate versions',async()=>{
 const f=await httpFixture();let proxy:ReturnType<typeof createServer>|undefined;
 try{
  const created=await f.call('projects',{title:'Lost response',category:'Test',owner:'Synthetic',description:'Isolated',startDate:'2026-11-02',date:'2026-12-01',status:'计划中',progress:0},f.cookie);const p=created.data.id,base=`projects/${p}`;
  const lease=(await f.call(base+'/timing/draft/start',{},f.cookie)).data;
  const task=await f.call(base+'/tasks',{leaseToken:lease.leaseToken,draftId:lease.draft.id,revision:lease.draft.revision,title:'Committed once',kind:'task',owner:'PM',duration:1,progress:0,start:'2026-11-02',predecessors:[]},f.cookie);assert.equal(task.status,200);
  const body={leaseToken:lease.leaseToken,draftId:task.data.draft.id,revision:task.data.revision};
  proxy=createServer((req,res)=>{const upstream=request(f.base+'/api/'+base+'/timing/draft/adopt',{method:'POST',headers:{'Content-Type':'application/json',Cookie:f.cookie}},r=>{assert.equal(r.statusCode,200);r.resume();r.on('end',()=>res.destroy());});req.pipe(upstream);});
  await new Promise<void>(ok=>proxy!.listen(0,'127.0.0.1',ok));const address=proxy.address() as any;
  await assert.rejects(fetch(`http://127.0.0.1:${address.port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const read=await f.call(base+'/timing',undefined,f.cookie);assert.equal(read.status,200);assert.equal(read.data.draft,null);assert.ok(read.data.tasks.some((t:any)=>t.title==='Committed once'));
  const versions=(await f.call(base+'/timing/versions',undefined,f.cookie)).data.versions;assert.equal(versions.filter((v:any)=>v.kind==='version').length,1);
  const replay=await f.call(base+'/timing/draft/adopt',body,f.cookie);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
  assert.deepEqual((await f.call(base+'/timing/versions',undefined,f.cookie)).data.versions,versions);
 }finally{if(proxy)await new Promise<void>(ok=>proxy!.close(()=>ok()));await f.stop();}
});
