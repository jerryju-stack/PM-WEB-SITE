import {test} from 'node:test';
import assert from 'node:assert/strict';
import {subscribe,unsubscribe} from 'node:diagnostics_channel';
import {FilePool,filePoolConfig} from '../lib/file-pool.ts';
import {MAX_JOB_BYTES} from '../lib/file-job-types.ts';
import type {Task} from '../lib/schedule.ts';
const task=(title='echo',duration=1):Task=>({id:'t',projectId:'p',parentId:null,order:0,title,kind:'task',owner:'PM',start:'2026-11-02',end:'2026-11-02',duration,progress:0,status:'计划中',notes:'',predecessors:[]});
const fixture=new URL('./fixtures/file-worker.ts',import.meta.url);

test('E2 pool bounds actual workers, queue and admissions; rejects overload without starting work',async()=>{
 const pool=new FilePool({workers:2,queue:2,timeoutMs:5000},fixture);
 try{
  const releases=Array.from({length:4},()=>pool.admit());assert.throws(()=>pool.admit(),{status:429});releases.forEach(fn=>{fn();fn();});assert.equal(pool.stats().admissions,0);
  const jobs=Array.from({length:4},()=>pool.run<Task[]>({kind:'confirm',tasks:[task('delay',150)]}));
  await assert.rejects(pool.run({kind:'confirm',tasks:[task()]}),{status:429});
  assert.equal(pool.stats().active,2);assert.equal(pool.stats().queued,2);
  const results=await Promise.all(jobs);assert.equal(results.length,4);assert.equal(results[3].value[0].title,'delay');
  assert.equal(pool.stats().createdWorkers,2);assert.equal(pool.stats().peakWorkers,2);assert.equal(pool.stats().queuedBytes,0);
  assert.ok(results[2].timing.queueMs>100);
 }finally{await pool.close();}
 assert.equal(pool.stats().workers,0);assert.equal(pool.stats().active,0);
});

test('E2 queued cancellation removes job; active cancellation terminates before bounded replacement; snapshot is detached',async()=>{
 const pool=new FilePool({workers:1,queue:2,timeoutMs:5000},fixture),running=new AbortController(),queued=new AbortController();
 try{
  const active=pool.run({kind:'confirm',tasks:[task('hang')]},{signal:running.signal});const activeRejected=assert.rejects(active,{status:499});
  const waiting=pool.run({kind:'confirm',tasks:[task()]},{signal:queued.signal}),waitingRejected=assert.rejects(waiting,{status:499});queued.abort();await waitingRejected;assert.equal(pool.stats().queued,0);
  const values=[task()],next=pool.run<Task[]>({kind:'confirm',tasks:values});values[0].owner='changed outside';running.abort();await activeRejected;
  assert.equal((await next).value[0].owner,'PM');assert.equal(pool.stats().peakWorkers,1);assert.equal(pool.stats().cancelled,2);
 }finally{await pool.close();}
});

for(const mode of ['crash','invalid'])test(`E2 worker ${mode} rejects exactly its job and next request recovers`,async()=>{
 const pool=new FilePool({workers:1,queue:1,timeoutMs:5000},fixture);
 try{await assert.rejects(pool.run({kind:'confirm',tasks:[task(mode)]}),{status:503});assert.equal((await pool.run<Task[]>({kind:'confirm',tasks:[task()]})).value[0].id,'t');assert.equal(pool.stats().peakWorkers,1);}
 finally{await pool.close();}
});

test('E2 total deadline includes queue; timeout reclaims workers, shutdown rejects waiting/active jobs and cannot restart',async()=>{
 const pool=new FilePool({workers:1,queue:1,timeoutMs:150},fixture);
 const active=assert.rejects(pool.run({kind:'confirm',tasks:[task('hang')]}),{status:504});const queued=assert.rejects(pool.run({kind:'confirm',tasks:[task()]}),{status:504});
 await Promise.all([active,queued]);assert.equal(pool.stats().timeouts,2);await pool.close();assert.equal(pool.stats().workers,0);
 const shutdown=new FilePool({workers:1,queue:1,timeoutMs:5000},fixture);
 const a=assert.rejects(shutdown.run({kind:'confirm',tasks:[task('hang')]}),{status:503}),b=assert.rejects(shutdown.run({kind:'confirm',tasks:[task()]}),{status:503});
 await shutdown.close();await Promise.all([a,b]);await assert.rejects(shutdown.run({kind:'confirm',tasks:[task()]}),{status:503});assert.throws(()=>shutdown.admit(),{status:503});assert.equal(shutdown.stats().workers,0);
});

test('E2 queue byte budget and per-job byte bound reject oversized work; configuration has hard limits',async()=>{
 const pool=new FilePool({workers:1,queue:2,queuedBytes:512,timeoutMs:5000},fixture),abort=new AbortController();
 try{
  const held=assert.rejects(pool.run({kind:'confirm',tasks:[task('hang')]},{signal:abort.signal}),{status:499});
  await assert.rejects(pool.run({kind:'confirm',tasks:[{...task(),notes:'x'.repeat(1024)}]}),{status:429});
  await assert.rejects(pool.run({kind:'confirm',tasks:[{...task(),notes:'x'.repeat(MAX_JOB_BYTES)}]}),{status:413});abort.abort();await held;
  assert.throws(()=>filePoolConfig({FILE_WORKERS:'5'}));assert.throws(()=>filePoolConfig({FILE_QUEUE:'999'}));assert.throws(()=>filePoolConfig({FILE_TIMEOUT_MS:'30000'}));assert.equal(filePoolConfig({}).workers,2);
 }finally{await pool.close();}
});

test('E2 real worker errors and diagnostics never emit the supplied workbook signing key',async()=>{
 const pool=new FilePool({workers:1,queue:0}),secret='SyntheticKeyNotARealWorkbookSecret',events:any[]=[];
 const listener=(m:any)=>events.push(m);subscribe('project-station.file-task',listener);
 try{
  await assert.rejects(pool.run({kind:'export',format:'xlsx',signingKey:secret,version:null,plan:{format:1,project:{id:'p',title:'Test'} as any,tasks:[task(secret,3)],schedulePolicy:{id:'x',workweek:[1,2,3,4,5],dependency:'FS',durationUnit:'day',dateBasis:'UTC'}}}),error=>{assert.equal((error as any).status,400);assert.ok(!String(error).includes(secret));return true;});
  assert.ok(events.length);assert.ok(!JSON.stringify(events).includes(secret));
 }finally{unsubscribe('project-station.file-task',listener);await pool.close();}
});

test('E2 late worker messages are rejected by absolute deadline even if the parent event loop delayed timers',async()=>{
 const pool=new FilePool({workers:1,queue:0,timeoutMs:150},fixture);
 try{
  const rejected=assert.rejects(pool.run({kind:'confirm',tasks:[task()]}),{status:504});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);await rejected;
 }finally{await pool.close();}
});
