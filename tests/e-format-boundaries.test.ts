import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpFixture} from './http-fixture.ts';
import {readProjectXml} from '../lib/timing-project.ts';
import {readWorkbook} from '../lib/timing-workbook.ts';

test('E5 worker exports execution or explicit history, and Excel/XML confirmation changes only the shared draft',async()=>{
 const f=await httpFixture();
 try{
  const project=(await f.call('projects',{title:'Three snapshot boundaries',owner:'Synthetic'},f.cookie)).data.id,base=`projects/${project}`;
  let session:any;let leafId='';
  const start=async()=>{const result=await f.call(base+'/timing/draft/start',session?{leaseToken:session.leaseToken}:{},f.cookie);assert.equal(result.status,200);session={leaseToken:result.data.leaseToken,draftId:result.data.draft.id,revision:result.data.draft.revision};};
  const owner=async(value:string)=>{const result=await f.call(base+'/tasks'+(leafId?'/'+leafId:''),{...session,...(!leafId?{title:'Snapshot leaf',kind:'task',start:'2026-11-16',duration:1,predecessors:[]}:{}),owner:value},f.cookie,leafId?'PATCH':'POST');assert.equal(result.status,200);leafId=result.data.id;session.revision=result.data.revision;};
  const adopt=async()=>{const result=await f.call(base+'/timing/draft/adopt',session,f.cookie);assert.equal(result.status,200);};
  await start();await owner('HISTORY OWNER');await adopt();
  const initial=(await f.call(base+'/timing',undefined,f.cookie)).data;
  const saved=await f.call(base+'/timing/versions',{kind:'baseline',name:'Historical owner',reason:'Boundary test',revision:initial.revision,projectVersion:initial.project.version,requestKey:'e5-three-snapshots'},f.cookie);assert.equal(saved.status,201);const historical=saved.data.version.id;
  await start();await owner('EXECUTION OWNER');await adopt();await start();
  const formal=(await f.call(base+'/timing',undefined,f.cookie)).data,versions=(await f.call(base+'/timing/versions',undefined,f.cookie)).data.versions;
  for(const format of ['xml','xlsx']){
   await owner('SHARED DRAFT OWNER '+format);
   const files=new Map<string,Buffer>();
   for(const version of ['current',historical]){
    const response=await fetch(`${f.base}/api/${base}/timing/export?format=${format}&version=${version}`,{headers:{Cookie:f.cookie}});assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.match(decodeURIComponent(response.headers.get('content-disposition')!),version==='current'?/当前-r/:/基线-Historical owner-r/);
    const bytes=Buffer.from(await response.arrayBuffer());files.set(version,bytes);
    // Identity validation is not needed to inspect a workbook. Do not read/log its signing key.
    const parsed=format==='xml'?readProjectXml(bytes):readWorkbook(bytes,'');
    assert.equal(parsed.rows.find(row=>row.title==='Snapshot leaf')?.owner,version==='current'?'EXECUTION OWNER':'HISTORY OWNER');
   }
   const preview=await f.call(base+'/timing/import/preview',{...session,format,file:files.get(historical)!.toString('base64')},f.cookie);assert.equal(preview.status,200);assert.deepEqual(preview.data.issues,[]);assert.ok(preview.data.previewId);
   const confirmed=await f.call(base+'/timing/import/confirm',{...session,previewId:preview.data.previewId},f.cookie);assert.equal(confirmed.status,200);session.revision=confirmed.data.revision;
   const draftResponse=await fetch(`${f.base}/api/${base}/timing`,{headers:{Cookie:f.cookie,'X-Timing-Lease':session.leaseToken}});assert.equal(draftResponse.status,200);const draft=await draftResponse.json();
   assert.equal(draft.tasks.find((task:any)=>task.id===leafId)?.owner,'HISTORY OWNER');
   const execution=(await f.call(base+'/timing',undefined,f.cookie)).data;assert.deepEqual(execution.tasks,formal.tasks);assert.equal(execution.executionRevision,formal.executionRevision);
   assert.deepEqual((await f.call(base+'/timing/versions',undefined,f.cookie)).data.versions,versions);
   assert.equal((await f.call(base+'/timing/versions/'+historical,undefined,f.cookie)).data.plan.tasks.find((task:any)=>task.id===leafId)?.owner,'HISTORY OWNER');
  }
 }finally{await f.stop();}
});
