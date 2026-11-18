import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir,cpus,totalmem,release} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {openStore} from '../lib/database.ts';
import {syntheticTasks} from './e-a-fixtures.ts';
import {httpFixture} from '../tests/http-fixture.ts';
import {filePoolConfig} from '../lib/file-pool.ts';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

// Include transitive compute code, especially PDF/schedule changes in a dirty workspace.
const measuredSources=['server.ts','scripts/benchmark-e-b.ts','scripts/e-a-fixtures.ts','lib/file-pool.ts','lib/file-worker.ts','lib/file-job-types.ts','lib/timing-file-compute.ts','lib/timing-file-service.ts','lib/timing-io.ts','lib/timing-drafts.ts','lib/timing-pdf.ts','lib/timing-project.ts','lib/timing-workbook.ts','lib/timing-xml.ts','lib/timing-formulas.ts','lib/schedule.ts','lib/task-index.ts','lib/timing-versions.ts','lib/history-index.ts','lib/contracts.ts','pnpm-lock.yaml','assets/Timing_Sample_v3_Print.xlsx','assets/fonts/NotoSansCJKsc-Regular.otf'];
const sourceHashes=()=>Object.fromEntries(measuredSources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const sourceSha256=sourceHashes();

const destination=resolve(process.argv[2]||'docs/validation/batch-e-b/performance.json'),directory=mkdtempSync(join(tmpdir(),'station-e-b-bench-'));
process.env.ADMIN_PASSWORD='Isolated-EB-Benchmark-2026';
const store=openStore(directory);
for(const n of [100,500,1000])for(const shape of ['chain','fanout','long'] as const){const id=`${shape}-${n}`,tasks=syntheticTasks(n,shape,id);store.put('projects',{id,title:id,description:'Synthetic capacity plan',category:'Test',owner:'PM',progress:0,status:'计划中',startDate:tasks[0].start,date:tasks[0].end});store.saveTasks(id,tasks);}
for(const [id,shape] of [['pdf-long','long'],['xlsx-100','fanout']] as const){store.put('projects',{id,title:id==='pdf-long'?'Synthetic shallow PDF':'Synthetic shallow Excel',progress:0,status:'计划中'});store.saveTasks(id,syntheticTasks(100,shape,id).map(t=>({...t,parentId:null,kind:'task',...(shape==='fanout'?{predecessors:[]}:{} )})));}
store.db.close();
const f=await httpFixture({directory,password:process.env.ADMIN_PASSWORD,preload:'scripts/e-b-metrics.ts',ipc:true});
const tasks:any[]=[],memory={rss:0,heapUsed:0,maxRss:0,loopMaxMs:0,loopP95Ms:0,maxTimerDriftMs:0};
f.child.on('message',(value:any)=>{if(value.type==='file-task')tasks.push(value);if(value.type==='memory')for(const key of Object.keys(memory))memory[key]=Math.max(memory[key],value[key]);});
const stats=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return {samples:values.length,p95Ms:s[Math.ceil(s.length*.95)-1],maxMs:Math.max(...values)};};
const headers:any={Cookie:f.cookie},results:any[]=[],rounds:number[]=[],heartbeats:number[]=[],ordinary:number[]=[],errors:string[]=[];let cold:any,deepPdfProbe:any;
const call=async(path:string,body?:any)=>{const r=await fetch(f.base+'/api/'+path,{headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});const bytes=await r.arrayBuffer();if(!r.ok)throw Error(`HTTP ${r.status}`);return {bytes,response:r};};
try{
 const lease=JSON.parse(Buffer.from((await call('projects/fanout-1000/timing/draft/start',{})).bytes).toString()).leaseToken;
 for(let round=-1;round<30;round++){
  const at=performance.now(),beats:number[]=[],reads:number[]=[],pending=new Set<Promise<void>>();
  const probe=(path:string,body:any,values:number[])=>{const started=performance.now();const p=call(path,body).then(()=>{values.push(performance.now()-started);}).catch(e=>{errors.push(String(e));}).finally(()=>pending.delete(p));pending.add(p);};
  const timer=setInterval(()=>{probe('projects/fanout-1000/timing/draft/heartbeat',{leaseToken:lease},beats);probe('data',undefined,reads);},25);
  const fileRows:any[]=[];
  try{
   probe('projects/fanout-1000/timing/draft/heartbeat',{leaseToken:lease},beats);probe('data',undefined,reads);
   await Promise.all(['xlsx','xml','pdf','xml','xlsx'].map(async format=>{const started=performance.now(),result=await call(`projects/${format==='xlsx'?'xlsx-100':format==='xml'?'chain-1000':'pdf-long'}/timing/export?format=${format}`);fileRows.push({format,ms:performance.now()-started,serverTiming:result.response.headers.get('server-timing'),bytes:result.bytes.byteLength});}));
  }finally{clearInterval(timer);await Promise.all([...pending]);}
  const value={round,batchMs:performance.now()-at,files:fileRows,heartbeat:stats(beats),ordinary:stats(reads)};
  if(round<0)cold=value;else{rounds.push(value.batchMs);heartbeats.push(...beats);ordinary.push(...reads);results.push(value);}
 }
 await call('projects/fanout-1000/timing/draft/heartbeat',{leaseToken:lease});
 // R7 remains a separate format issue. Exercise pathological depth under the same bounded pool,
 // with four other file requests and ongoing ordinary/heartbeat traffic; never let it hang the server.
 const check=new DatabaseSync(join(directory,'project-station.sqlite'),{readOnly:true});
 const revision=()=>check.prepare('SELECT id,revision,version FROM projects ORDER BY id').all();const before=revision();
 const beats:number[]=[],reads:number[]=[],pending=new Set<Promise<void>>();
 const probe=(path:string,body:any,values:number[])=>{const at=performance.now();const p=call(path,body).then(()=>{values.push(performance.now()-at);}).catch(e=>{errors.push(String(e));}).finally(()=>pending.delete(p));pending.add(p);};
 const timer=setInterval(()=>{probe('projects/fanout-1000/timing/draft/heartbeat',{leaseToken:lease},beats);probe('data',undefined,reads);},25),started=performance.now();
 const files:any[]=[];
 try{await Promise.all(['long-100/pdf','chain-1000/xml','xlsx-100/xlsx','fanout-1000/xml','pdf-long/pdf'].map(async entry=>{
  const [project,format]=entry.split('/'),at=performance.now();const response=await fetch(`${f.base}/api/projects/${project}/timing/export?format=${format}`,{headers});const bytes=await response.arrayBuffer();files.push({project,format,status:response.status,ms:performance.now()-at,bytes:response.ok?bytes.byteLength:0});
 }));}finally{clearInterval(timer);await Promise.all([...pending]);}
 deepPdfProbe={ms:performance.now()-started,files,heartbeat:stats(beats),ordinary:stats(reads),projectRevisionsUnchanged:JSON.stringify(before)===JSON.stringify(revision())};check.close();
 await call('projects/fanout-1000/timing/draft/heartbeat',{leaseToken:lease});
}finally{await f.stop();}
const measuredTasks=tasks.slice(0,155),fileTasks=measuredTasks.filter(t=>t.ok),hotTasks=fileTasks.slice(5),config=filePoolConfig();
assert.deepEqual(sourceHashes(),sourceSha256,'Measured source changed during the benchmark; rerun without concurrent edits');
assert.equal(errors.length,0,'Ordinary/heartbeat failures invalidate the performance sample');
assert.equal(results.length,30);assert.equal(hotTasks.length,150);assert.equal(fileTasks.length,155);
assert.ok(results.every(row=>row.files.length===5&&row.heartbeat.samples>0&&row.ordinary.samples>0));
assert.ok(deepPdfProbe.files.every((row:any)=>row.status===200));assert.equal(deepPdfProbe.projectRevisionsUnchanged,true);
mkdirSync(resolve(destination,'..'),{recursive:true});writeFileSync(destination,JSON.stringify({recordedAt:new Date().toISOString(),commit:execFileSync('git',['-c','safe.directory='+process.cwd(),'rev-parse','HEAD']).toString().trim(),sourceSha256,config,environment:{node:process.version,os:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,ramBytes:totalmem()},directory,method:'Same E-A synthetic file cases: xlsx100 shallow, XML1000 depth20 chain, PDF100 long duration/name. One cold worker-start round +30 hot rounds; 5 simultaneous file requests, heartbeat AND /api/data every25ms. No history list load (E-C). Input/worker resource limits unchanged. RSS is whole process including workers; worker heap is sampled after computation, not a hard RSS cap. Deep PDF stress is separate from the 30 valid-format rounds.',cold,summary:{rounds:stats(rounds),heartbeat:stats(heartbeats),ordinary:stats(ordinary),queue:stats(fileTasks.map(t=>t.queueMs)),workerWall:stats(fileTasks.map(t=>t.executionMs)),workerCompute:stats(fileTasks.map(t=>t.computeMs)),hotQueue:stats(hotTasks.map(t=>t.queueMs)),hotWorkerWall:stats(hotTasks.map(t=>t.executionMs)),hotWorkerCompute:stats(hotTasks.map(t=>t.computeMs)),maxWorkerHeapSampleBytes:Math.max(...fileTasks.map(t=>t.heapUsedBytes)),peakWorkers:Math.max(...tasks.map(t=>t.peakWorkers)),peakQueue:Math.max(...tasks.map(t=>t.peakQueue)),leaseSurvived:true},deepPdfProbe,memory,errors,budgets:{heartbeatP95Ms:1000,ordinaryP95Ms:500,leaseMs:30000},rounds:results,fileTasks:tasks},null,2));console.log(destination);
