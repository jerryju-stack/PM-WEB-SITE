import { mkdtempSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir,cpus,totalmem,release } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { openStore } from '../lib/database.ts';
import { timingVersions,schedulePolicy } from '../lib/timing-versions.ts';
import { schedule,dateValue } from '../lib/schedule.ts';
import { syntheticTasks } from './e-a-fixtures.ts';

const output=resolve(process.argv[2]||'docs/validation/batch-e-a/baseline.json');
const directory=mkdtempSync(join(tmpdir(),'station-e-a-bench-'));
process.env.ADMIN_PASSWORD='Isolated-EA-Benchmark-2026';
const store=openStore(directory),results:any[]=[];
const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:Math.max(...values)};};
let peakRss=process.memoryUsage().rss;
const sample=async(name:string,metadata:any,fn:()=>unknown|Promise<unknown>)=>{
 const measure=async()=>{const at=performance.now();await fn();peakRss=Math.max(peakRss,process.memoryUsage().rss);return performance.now()-at;};
 const coldMs=await measure(),values:number[]=[];for(let i=0;i<30;i++)values.push(await measure());
 results.push({name,...metadata,coldMs,...stats(values),processPeakRssBytes:peakRss});
};
for(const n of [100,500,1000])for(const shape of ['chain','fanout','long'] as const){
 const id=`${shape}-${n}`,tasks=syntheticTasks(n,shape,id);
 for(const t of tasks){if(t.start)dateValue(t.start);if(t.end)dateValue(t.end);}
 store.put('projects',{id,title:id,description:'Synthetic capacity plan',category:'Test',owner:'PM',progress:0,status:'计划中',startDate:tasks[0].start,date:tasks[0].end});store.saveTasks(id,tasks);
 await sample('schedule',{tasks:n,shape,depth:20},()=>schedule(tasks));
}
// SQL and snapshot amplification are measured separately from wall-clock samples.
for(const n of [100,1000])for(const versions of [100,1000]){
 const id=`fanout-${n}`,plan={format:1,project:store.get('projects',id),tasks:store.tasks(id),schedulePolicy},snapshot=JSON.stringify(plan);
 store.db.prepare('DELETE FROM timing_versions WHERE project_id=?').run(id);
 store.transaction(()=>{const insert=store.db.prepare('INSERT INTO timing_versions(id,project_id,kind,sequence,name,reason,saved_at,actor_uid,actor_name,revision,project_version,request_key,request_data,snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');for(let i=0;i<versions;i++)insert.run(`${id}-v${i}`,id,'version',i+1,'Synthetic','capacity','2026-11-03T00:00:00Z',store.get('users','admin').uid,'Synthetic',1,0,`${id}-request-${i}`,'{}',snapshot);});
 let queries=0,bytes=0;
 const traced={...store,db:{prepare(sql:string){queries++;const s=store.db.prepare(sql);return {get:(...args:any[])=>s.get(...args),all:(...args:any[])=>{const rows=s.all(...args);for(const row of rows)if(typeof row.snapshot==='string')bytes+=Buffer.byteLength(row.snapshot);return rows;}};}}};
 timingVersions(traced as any).list(id);const amplification={queries,snapshotBytes:bytes};
 await sample('versions.list',{tasks:n,versions,...amplification},()=>timingVersions(store).list(id));
}
store.put('projects',{id:'pdf-long',title:'Synthetic shallow PDF',progress:0,status:'计划中'});store.saveTasks('pdf-long',syntheticTasks(100,'long','pdf-long').map(t=>({...t,parentId:null,kind:'task'})));
store.put('projects',{id:'xlsx-100',title:'Synthetic shallow Excel',progress:0,status:'计划中'});store.saveTasks('xlsx-100',syntheticTasks(100,'fanout','xlsx-100').map(t=>({...t,parentId:null,kind:'task',predecessors:[]})));
store.db.close();
const child=spawn(process.execPath,['--experimental-strip-types','--import',pathToFileURL(resolve('scripts/e-a-metrics.ts')).href,'server.ts'],{env:{...process.env,DATA_DIR:directory,PORT:'0'},stdio:['ignore','pipe','pipe','ipc']});
let childPeakRss=0,childPeakHeap=0,eventLoopMaxMs=0,eventLoopP95MaxMs=0,errors='';
child.on('message',(m:any)=>{childPeakRss=Math.max(childPeakRss,m.rss);childPeakHeap=Math.max(childPeakHeap,m.heapUsed);eventLoopMaxMs=Math.max(eventLoopMaxMs,m.eventLoopMaxMs);eventLoopP95MaxMs=Math.max(eventLoopP95MaxMs,m.eventLoopP95Ms);});
child.stderr!.on('data',b=>errors+=b);
try{
 const base=await new Promise<string>((ok,no)=>{let text='';const timer=setTimeout(()=>no(Error('startup timeout '+errors)),15000);child.stdout!.on('data',b=>{text+=b;const match=/Local: (http:\/\/127.0.0.1:\d+)/.exec(text);if(match){clearTimeout(timer);ok(match[1]);}});child.on('exit',()=>{clearTimeout(timer);no(Error(errors));});});
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'admin',password:process.env.ADMIN_PASSWORD})});if(!login.ok)throw Error('login failed');const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const call=async(path:string,body?:any)=>{const r=await fetch(base+'/api/'+path,{headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});const data=await r.arrayBuffer();if(!r.ok)throw Error(`${path}: ${r.status} ${Buffer.from(data)}`);return data;};
 const lease=JSON.parse(Buffer.from(await call('projects/fanout-1000/timing/draft/start',{})).toString()).leaseToken;
 await sample('http.home',{projects:11,articles:0},()=>call('data'));
 for(const n of [100,1000])await sample('http.versions',{tasks:n,versions:1000},()=>call(`projects/fanout-${n}/timing/versions`));
 const heartbeats:number[]=[],batches:number[]=[],fileTimes:Record<string,number[]>={xlsx:[],xml:[],pdf:[]};let coldBatchMs=0;
 for(let round=-1;round<30;round++){
  const at=performance.now();
  const files=['xlsx','xml','pdf','xml','xlsx'].map(async format=>{const start=performance.now();await call(`projects/${format==='xml'?'chain-1000':format==='pdf'?'pdf-long':'xlsx-100'}/timing/export?format=${format}`);if(round>=0)fileTimes[format].push(performance.now()-start);});
  const beat=async()=>{const start=performance.now();await call('projects/fanout-1000/timing/draft/heartbeat',{leaseToken:lease});if(round>=0)heartbeats.push(performance.now()-start);};
  const timer=setInterval(()=>void beat().catch(e=>errors+=String(e)),25);
  try{await Promise.all([...files,beat()]);}finally{clearInterval(timer);}
  if(round<0)coldBatchMs=performance.now()-at;else batches.push(performance.now()-at);
 }
 results.push({name:'http.five-files',coldMs:coldBatchMs,...stats(batches),heartbeat:stats(heartbeats),files:Object.fromEntries(Object.entries(fileTimes).map(([k,v])=>[k,stats(v)])),leaseSurvived:true});
 await call('projects/fanout-1000/timing/draft/heartbeat',{leaseToken:lease});
}finally{if(child.exitCode===null)await new Promise<void>(ok=>{child.once('exit',()=>ok());child.kill();});}
mkdirSync(resolve(output,'..'),{recursive:true});
writeFileSync(output,JSON.stringify({recordedAt:new Date().toISOString(),commit:execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'rev-parse','HEAD']).toString().trim(),environment:{node:process.version,platform:process.platform,os:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,ramBytes:totalmem()},directory,method:'One first-call sample per operation in this process (not OS cache cold); 30 sequential warm samples. HTTP file rounds launch five requests plus heartbeats every 25ms. Child RSS/heap sampled every 50ms, process.resourceUsage maxRSS supplements synchronous peaks. No browser timings implied.',budgets:{heartbeatP95Ms:1000,homeAndVersionsP95Ms:500,editToInteractiveP95Ms:500,leaseMs:30000},results,memory:{harnessPeakRssBytes:peakRss,harnessMaxRssBytes:process.resourceUsage().maxRSS*1024,childPeakRssBytes:childPeakRss,childPeakHeapBytes:childPeakHeap,eventLoopMaxMs,eventLoopP95MaxMs},errors},null,2));
console.log(output);
