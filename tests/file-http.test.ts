import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {createServer,request} from 'node:http';
import {httpFixture} from './http-fixture.ts';
import {exportProjectXml} from '../lib/timing-project.ts';
import {schedule} from '../lib/schedule.ts';
import {schedulePolicy} from '../lib/timing-versions.ts';

async function fixture(env:NodeJS.ProcessEnv={}){
 const f=await httpFixture({preload:'tests/fixtures/file-gate.ts',ipc:true,env});
 const inbox:any[]=[],waiters=new Set<any>();let sequence=0;
 f.child.on('message',(m:any)=>{const waiter=[...waiters].find(w=>w.predicate(m));if(waiter){waiters.delete(waiter);clearTimeout(waiter.timer);waiter.resolve(m);}else inbox.push(m);});
 const wait=(predicate:(m:any)=>boolean):Promise<any>=>{const index=inbox.findIndex(predicate);if(index>=0)return Promise.resolve(inbox.splice(index,1)[0]);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,timer:setTimeout(()=>{waiters.delete(waiter);reject(Error('IPC gate timeout'));},10000)};waiters.add(waiter);});};
 const arm=async(mode='hold')=>{const n=++sequence;f.child.send!({gate:'arm',mode,sequence:n});await wait(m=>m.gate==='armed'&&m.sequence===n);return {held:()=>wait(m=>m.gate==='held'&&m.sequence===n),release:()=>f.child.send!({gate:'release',sequence:n}),exited:()=>wait(m=>m.gate==='worker-exit'&&m.sequence===n)};};
 const db=new DatabaseSync(join(f.directory,'project-station.sqlite'));
 const password='Isolated-EB-Editor-2026',editor=(await f.call('users',{id:'editor',name:'Synthetic editor',role:'editor',password},f.cookie)).data;
 const cookie=(await f.call('login',{id:'editor',password})).cookie;
 const project=(await f.call('projects',{title:'Fixed snapshot',owner:'Synthetic'},f.cookie)).data.id;
 await f.call(`projects/${project}/members`,{userUid:editor.id,groupId:'editor'},f.cookie);
 await f.call(`projects/${project}/access`,{timing:'members'},f.cookie,'PATCH');
 const start=(await f.call(`projects/${project}/timing/draft/start`,{},cookie)).data;
 const session={leaseToken:start.leaseToken,draftId:start.draft.id,revision:start.draft.revision};
 const xml=exportProjectXml({format:1,project:{id:project,title:'Import'} as any,schedulePolicy,tasks:schedule([{id:'new',projectId:project,parentId:null,order:0,title:'Imported',kind:'task',owner:'PM',start:'2026-11-02',end:null,duration:1,progress:0,status:'计划中',notes:'',predecessors:[]}])}).toString('base64');
 const previewBody={...session,file:xml,format:'xml'};
 const snapshot=()=>db.prepare('SELECT id,revision,payload FROM timing_drafts WHERE project_id=?').get(project);
 const imports=()=>db.prepare('SELECT id,payload,result FROM timing_imports WHERE project_id=? ORDER BY id').all(project);
 return {...f,db,editor,cookie,admin:f.cookie,password,project,session,xml,previewBody,arm,wait,snapshot,imports,close:async()=>{for(const w of waiters)clearTimeout(w.timer);db.close();await f.stop();}};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function change(f:Fixture,kind:string,previewId?:string){
 const p=f.project;
 if(kind==='member-remove')assert.equal((await f.call(`projects/${p}/members`,{userUid:f.editor.id},f.admin,'DELETE')).status,200);
 if(kind==='member-downgrade')assert.equal((await f.call(`projects/${p}/members`,{userUid:f.editor.id,groupId:'viewer'},f.admin,'PATCH')).status,200);
 if(kind==='password-reset')assert.equal((await f.call('users/'+f.editor.id+'/password',{password:'Changed-EB-Password'},f.admin)).status,200);
 if(kind==='password-change')assert.equal((await f.call('password',{current:f.password,password:'Changed-EB-Password'},f.cookie)).status,200);
 if(kind==='logout')assert.equal((await f.call('logout',{},f.cookie)).status,200);
 if(kind==='disable')assert.equal((await f.call('users/'+f.editor.id,{status:'disabled'},f.admin,'PATCH')).status,200);
 if(kind==='lease-expired')f.db.prepare('UPDATE timing_edit_leases SET expires_at=0 WHERE project_id=?').run(p);
 if(kind==='lease-replaced'){
  await f.call(`projects/${p}/timing/draft/release`,{leaseToken:f.session.leaseToken},f.cookie);
  assert.equal((await f.call(`projects/${p}/timing/draft/start`,{},f.admin)).status,200);
 }
 if(kind==='draft-revision'){
  const task=(await f.call(`projects/${p}/timing`,undefined,f.admin)).data.tasks[0];
  assert.equal((await f.call(`projects/${p}/tasks/${task.id}`,{...f.session,owner:'Newer edit'},f.cookie,'PATCH')).status,200);
 }
 if(kind==='project-version')assert.equal((await f.call(`projects/${p}`,{title:'Changed metadata',version:0},f.admin,'PATCH')).status,200);
 if(kind==='execution-revision')f.db.prepare('UPDATE projects SET revision=revision+1 WHERE id=?').run(p);
 if(kind==='draft-replaced'){
  assert.equal((await f.call(`projects/${p}/timing/draft/adopt`,f.session,f.cookie)).status,200);
  assert.equal((await f.call(`projects/${p}/timing/draft/start`,{leaseToken:f.session.leaseToken},f.cookie)).status,200);
 }
 if(kind==='preview-expired')f.db.prepare('UPDATE timing_imports SET expires_at=? WHERE id=?').run('2000-01-01',previewId!);
}

for(const op of ['preview','confirm'] as const)for(const state of ['member-remove','member-downgrade','password-reset','password-change','logout','disable','lease-expired','lease-replaced','draft-revision','project-version','execution-revision','draft-replaced',...(op==='confirm'?['preview-expired']:[])])test(`E2 real HTTP ${op} rejects ${state} changed while computed worker result is held, without partial writes`,async()=>{
 const f=await fixture();try{
  let previewId:string|undefined;
  if(op==='confirm'){const preview=await f.call(`projects/${f.project}/timing/import/preview`,f.previewBody,f.cookie);assert.equal(preview.status,200);previewId=preview.data.previewId;assert.ok(previewId);}
  const gate=await f.arm(),pending=f.call(`projects/${f.project}/timing/import/${op}`,op==='preview'?f.previewBody:{...f.session,previewId},f.cookie);
  await gate.held();await change(f,state,previewId);const draft=f.snapshot(),imports=f.imports();gate.release();
  const result=await pending;
  assert.equal(result.status,['password-reset','password-change','logout','disable'].includes(state)?401:state==='member-remove'?404:state==='member-downgrade'?403:409,JSON.stringify(result.data));
  assert.deepEqual(f.snapshot(),draft);assert.deepEqual(f.imports(),imports);
 }finally{await f.close();}
});

for(const state of ['member-remove','password-reset','disable','logout'])test(`E2 export reauthorizes ${state} after async file work`,async()=>{
 const f=await fixture();try{
  const gate=await f.arm(),pending=fetch(`${f.base}/api/projects/${f.project}/timing/export?format=xml`,{headers:{Cookie:f.cookie}});
  await gate.held();await change(f,state);gate.release();const response=await pending;
  assert.equal(response.status,state==='member-remove'?404:401);assert.equal(response.headers.get('content-disposition'),null);assert.ok(!(await response.text()).includes('<Project'));
 }finally{await f.close();}
});

test('E2 export keeps its fixed captured version when the current project changes',async()=>{
 const f=await fixture();try{
  const gate=await f.arm(),pending=fetch(`${f.base}/api/projects/${f.project}/timing/export?format=xml`,{headers:{Cookie:f.cookie}});
  await gate.held();await change(f,'project-version');gate.release();const response=await pending;assert.equal(response.status,200);
  assert.ok((await response.text()).includes('<Name>Fixed snapshot</Name>'));assert.ok(decodeURIComponent(response.headers.get('content-disposition')!).includes('Fixed snapshot'));
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('server-timing')?.includes('file_queue'));
 }finally{await f.close();}
});

for(const op of ['preview','confirm'])for(const mode of ['cancel','timeout','crash'])test(`E2 HTTP ${op} ${mode} leaves no partial writes and permits a clean retry`,async()=>{
 const f=await fixture(mode==='timeout'?{FILE_TIMEOUT_MS:'2000'}:{});try{
  let body:any=f.previewBody;
  if(op==='confirm'){const preview=await f.call(`projects/${f.project}/timing/import/preview`,f.previewBody,f.cookie);assert.equal(preview.status,200);body={...f.session,previewId:preview.data.previewId};}
  const gate=await f.arm(mode==='crash'?'crash':'hold'),abort=new AbortController(),before=f.snapshot(),imports=f.imports();
  const pending=fetch(`${f.base}/api/projects/${f.project}/timing/import/${op}`,{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json'},body:JSON.stringify(body),signal:abort.signal});
  const cancelled=mode==='cancel'?assert.rejects(pending):undefined;
  await gate.held();if(mode==='cancel')abort.abort();
  if(cancelled)await cancelled;else{const response=await pending;assert.equal(response.status,mode==='timeout'?504:503);}
  await gate.exited();assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.imports(),imports);
  const retry=await f.call(`projects/${f.project}/timing/import/${op}`,body,f.cookie);assert.equal(retry.status,200);
  if(op==='preview')assert.ok(retry.data.previewId);else{assert.equal(retry.data.revision,1);assert.equal((await f.call(`projects/${f.project}/timing/import/confirm`,body,f.cookie)).data.replayed,true);}
 }finally{await f.close();}
});

test('E2 real worker result followed by SQL/audit failure rolls back both draft and receipt; retry commits once',async()=>{
 const f=await fixture();try{
  const preview=await f.call(`projects/${f.project}/timing/import/preview`,f.previewBody,f.cookie),body={...f.session,previewId:preview.data.previewId};assert.ok(body.previewId);
  const before=f.snapshot(),imports=f.imports();f.db.exec("CREATE TRIGGER eb_reject_import BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'isolated failure'); END");
  assert.equal((await f.call(`projects/${f.project}/timing/import/confirm`,body,f.cookie)).status,500);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.imports(),imports);
  f.db.exec('DROP TRIGGER eb_reject_import');assert.equal((await f.call(`projects/${f.project}/timing/import/confirm`,body,f.cookie)).data.revision,1);
  assert.equal((await f.call(`projects/${f.project}/timing/import/confirm`,body,f.cookie)).data.replayed,true);
 }finally{await f.close();}
});

test('E2 overload counts a waiting request body and returns Retry-After without buffering unbounded work',async()=>{
 const f=await fixture({FILE_WORKERS:'1',FILE_QUEUE:'1'}),abort=new AbortController();let slow:ReturnType<typeof request>|undefined;
 try{
  const gate=await f.arm(),before=f.snapshot();
  const first=fetch(`${f.base}/api/projects/${f.project}/timing/import/preview`,{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json'},body:JSON.stringify(f.previewBody),signal:abort.signal});const firstCancelled=assert.rejects(first);await gate.held();
  let continued!:()=>void;const ready=new Promise<void>(ok=>continued=ok);
  const second=new Promise<void>(ok=>{slow=request(`${f.base}/api/projects/${f.project}/timing/import/preview`,{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json',Expect:'100-continue','Transfer-Encoding':'chunked'}},r=>{r.resume();r.on('end',()=>ok());});slow.on('continue',continued);slow.on('error',()=>ok());slow.write('{"file":');});await ready;
  const third=await fetch(`${f.base}/api/projects/${f.project}/timing/export?format=xml`,{headers:{Cookie:f.cookie}});assert.equal(third.status,429);assert.equal(third.headers.get('retry-after'),'2');
  slow!.destroy();abort.abort();await Promise.all([firstCancelled,second]);await gate.exited();assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.imports(),[]);
 }finally{slow?.destroy();abort.abort();await f.close();}
});

test('E2 server stop closes real workers and cannot commit held file results',async()=>{
 const f=await fixture();try{
  const gate=await f.arm(),before=f.snapshot(),pending=fetch(`${f.base}/api/projects/${f.project}/timing/import/preview`,{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json'},body:JSON.stringify(f.previewBody)}).then(r=>r.status,()=>0);
  await gate.held();const exit=new Promise<void>(ok=>f.child.once('exit',()=>ok()));f.child.send!({gate:'shutdown'});await exit;
  const status=await pending;assert.ok(status===0||status===503);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.imports(),[]);
 }finally{await f.close();}
});

test('E2 decoded upload size and source JSON size are checked before file computation or partial writes',async()=>{
 const f=await fixture();try{
  const before=f.snapshot();const tooLarge=await f.call(`projects/${f.project}/timing/import/preview`,{...f.previewBody,file:Buffer.alloc(8*1024*1024+1).toString('base64')},f.cookie);assert.equal(tooLarge.status,413);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.imports(),[]);
  // A corrupted/oversized existing source is rejected by SQL length before JSON materialization.
  f.db.prepare('UPDATE timing_drafts SET payload=? WHERE project_id=?').run('x'.repeat(32*1024*1024+1),f.project);
  assert.equal((await f.call(`projects/${f.project}/timing/import/preview`,f.previewBody,f.cookie)).status,413);assert.deepEqual(f.imports(),[]);
 }finally{await f.close();}
});

test('E2 concurrent identical confirmations replay the committed receipt, preserve atomicity and never duplicate adoption',async()=>{
 const f=await fixture();try{
  const preview=await f.call(`projects/${f.project}/timing/import/preview`,f.previewBody,f.cookie);assert.equal(preview.status,200);
  const body={...f.session,previewId:preview.data.previewId},gate=await f.arm(),first=f.call(`projects/${f.project}/timing/import/confirm`,body,f.cookie);await gate.held();
  const second=await f.call(`projects/${f.project}/timing/import/confirm`,body,f.cookie);assert.equal(second.status,200);assert.equal(second.data.replayed,false);
  gate.release();const replay=await first;assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(f.snapshot()!.revision,1);
  const adoption={...f.session,revision:second.data.revision};const adopted=await f.call(`projects/${f.project}/timing/draft/adopt`,adoption,f.cookie);assert.equal(adopted.status,200);
  assert.equal((await f.call(`projects/${f.project}/timing/draft/adopt`,adoption,f.cookie)).data.replayed,true);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM timing_versions WHERE project_id=? AND kind='version'").get(f.project)!.n,1);
 }finally{await f.close();}
});

test('E2 committed confirmation with a lost response is readable and retries its receipt without another revision or adoption',async()=>{
 const f=await fixture();let proxy:ReturnType<typeof createServer>|undefined;
 try{
  const preview=await f.call(`projects/${f.project}/timing/import/preview`,f.previewBody,f.cookie);
  assert.equal(preview.status,200);const body={...f.session,previewId:preview.data.previewId};
  let upstreamStatus:number|undefined;
  proxy=createServer((req,res)=>{
   const upstream=request(`${f.base}/api/projects/${f.project}/timing/import/confirm`,{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json'}},response=>{
    upstreamStatus=response.statusCode;response.resume();response.on('end',()=>res.destroy());
   });
   upstream.on('error',()=>res.destroy());req.pipe(upstream);
  });
  await new Promise<void>(ok=>proxy!.listen(0,'127.0.0.1',ok));const port=(proxy.address() as import('node:net').AddressInfo).port;
  await assert.rejects(fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  assert.equal(upstreamStatus,200);
  const saved=f.snapshot(),receipts=f.imports();assert.equal(saved!.revision,1);assert.ok(receipts[0].result);
  const read=await f.call(`projects/${f.project}/timing`,undefined,f.cookie);
  assert.equal(read.data.draft.revision,1);assert.ok(!read.data.tasks.some((t:any)=>t.title==='Imported'),'execution remains unchanged');
  const replay=await f.call(`projects/${f.project}/timing/import/confirm`,body,f.cookie);
  assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.equal(replay.data.revision,1);
  assert.deepEqual(f.snapshot(),saved);assert.deepEqual(f.imports(),receipts);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM timing_adoptions WHERE project_id=?').get(f.project)!.n,0);
  const adoption={...f.session,revision:1};assert.equal((await f.call(`projects/${f.project}/timing/draft/adopt`,adoption,f.cookie)).status,200);
  assert.equal((await f.call(`projects/${f.project}/timing/draft/adopt`,adoption,f.cookie)).data.replayed,true);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM timing_versions WHERE project_id=? AND kind='version'").get(f.project)!.n,1);
 }finally{if(proxy)await new Promise<void>(ok=>proxy!.close(()=>ok()));await f.close();}
});
