import {Worker} from 'node:worker_threads';
import {serialize,deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {channel} from 'node:diagnostics_channel';
import {FileJobError,fileCancelled,MAX_JOB_BYTES} from './file-job-types.ts';
import type {FileTask,FileTiming} from './file-job-types.ts';

export type FilePoolConfig={workers:number;queue:number;timeoutMs:number;queuedBytes:number;heapMb:number};
export const defaultFilePoolConfig:FilePoolConfig={workers:2,queue:8,timeoutMs:10000,queuedBytes:64*1024*1024,heapMb:256};
export function filePoolConfig(env:NodeJS.ProcessEnv=process.env):FilePoolConfig{
 const integer=(key:string,fallback:number,min:number,max:number)=>{const n=env[key]===undefined?fallback:Number(env[key]);if(!Number.isInteger(n)||n<min||n>max)throw Error(`Invalid ${key}`);return n;};
 return {...defaultFilePoolConfig,workers:integer('FILE_WORKERS',2,1,4),queue:integer('FILE_QUEUE',8,0,16),timeoutMs:integer('FILE_TIMEOUT_MS',10000,100,20000)};
}
type Job={id:number;kind:string;bytes:Uint8Array;size:number;created:number;started:number;cold:boolean;signal?:AbortSignal;abort:()=>void;timer?:ReturnType<typeof setTimeout>;resolve:(result:any)=>void;reject:(error:unknown)=>void;done:boolean};
type Slot={worker:Worker;current?:Job;retiring:boolean;uses:number;exit:Promise<void>};
const metrics=channel('project-station.file-task');
const busy=()=>new FileJobError('FILE_QUEUE_FULL',429,'文件处理队列已满，请稍后重试；本次未提交');
const stopped=()=>new FileJobError('FILE_STOPPING',503,'文件处理服务正在停止，请稍后重试');
const timedOut=()=>new FileJobError('FILE_TIMEOUT',504,'文件处理超时，未提交结果；请稍后重试');

/** Fixed-size, lazy, reusable workers. No SQLite, application credentials or payload logging in workers. */
export class FilePool {
 readonly config:FilePoolConfig;
 private workerUrl:URL;
 private slots=new Set<Slot>();
 private queue:Job[]=[];
 private queuedBytes=0;
 private sequence=0;
 private closed=false;
 private admissions=0;
 private counts={completed:0,failed:0,cancelled:0,timeouts:0,createdWorkers:0,peakWorkers:0,peakQueue:0};
 constructor(config:Partial<FilePoolConfig>={},workerUrl=new URL('./file-worker.ts',import.meta.url)){
  this.config={...defaultFilePoolConfig,...config};this.workerUrl=workerUrl;
  const c=this.config;
  if(!Number.isInteger(c.workers)||c.workers<1||c.workers>4||!Number.isInteger(c.queue)||c.queue<0||c.queue>16||!Number.isInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>20000||!Number.isInteger(c.queuedBytes)||c.queuedBytes<1||c.queuedBytes>64*1024*1024||!Number.isInteger(c.heapMb)||c.heapMb<16||c.heapMb>256)throw Error('Invalid file pool limits');
 }
 /** Includes request-body ingress, before JSON/base64 is buffered. Release in HTTP finally. */
 admit(){
  if(this.closed)throw stopped();if(this.admissions>=this.config.workers+this.config.queue)throw busy();this.admissions++;
  let released=false;return ()=>{if(!released){released=true;this.admissions--;}};
 }
 stats(){return {...this.counts,workers:this.slots.size,active:[...this.slots].filter(s=>s.current).length,queued:this.queue.length,queuedBytes:this.queuedBytes,admissions:this.admissions,closed:this.closed};}
 run<T>(task:FileTask,options:{signal?:AbortSignal}={}):Promise<{value:T;timing:FileTiming}>{
  if(this.closed)return Promise.reject(stopped());if(options.signal?.aborted)return Promise.reject(options.signal.reason instanceof FileJobError?options.signal.reason:fileCancelled());
  const available=[...this.slots].some(s=>!s.retiring&&!s.current)||this.slots.size<this.config.workers;
  if(!available&&this.queue.length>=this.config.queue)return Promise.reject(busy());
  const created=performance.now(),serialized=serialize(task);
  if(serialized.byteLength>MAX_JOB_BYTES)return Promise.reject(new FileJobError('FILE_INPUT_LIMIT',413,'文件任务载荷过大，请减少任务或内容'));
  if(!available&&this.queuedBytes+serialized.byteLength>this.config.queuedBytes)return Promise.reject(busy());
  // Own an exact ArrayBuffer; transfer does not detach application buffers or leak pooled backing bytes.
  const bytes=new Uint8Array(serialized);
  return new Promise((resolve,reject)=>{
   const job:Job={id:++this.sequence,kind:task.kind,bytes,size:bytes.byteLength,created,started:0,cold:false,signal:options.signal,abort:()=>this.cancel(job,options.signal?.reason instanceof FileJobError?options.signal.reason:fileCancelled()),resolve,reject,done:false};
   job.timer=setTimeout(()=>this.cancel(job,timedOut()),Math.max(1,this.config.timeoutMs-(performance.now()-created)));job.timer.unref();
   job.signal?.addEventListener('abort',job.abort,{once:true});
   this.queue.push(job);this.queuedBytes+=job.size;this.pump();this.counts.peakQueue=Math.max(this.counts.peakQueue,this.queue.length);
  });
 }
 private pump(){
  if(this.closed)return;
  while(this.queue.length){
   if(performance.now()-this.queue[0].created>=this.config.timeoutMs){const job=this.queue.shift()!;this.queuedBytes-=job.size;this.finish(job,timedOut());continue;}
   let slot=[...this.slots].find(s=>!s.retiring&&!s.current);
   if(!slot){if(this.slots.size>=this.config.workers)return;try{slot=this.spawn();}catch{const job=this.queue.shift()!;this.queuedBytes-=job.size;this.finish(job,new FileJobError('FILE_WORKER_FAILED',503,'文件处理进程无法启动，请重试'));continue;}}
   const job=this.queue.shift()!;this.queuedBytes-=job.size;
   slot.current=job;job.started=performance.now();job.cold=slot.uses++===0;slot.worker.ref();
   try{slot.worker.postMessage({id:job.id,bytes:job.bytes},[job.bytes.buffer as ArrayBuffer]);}
   catch{this.finish(job,new FileJobError('FILE_WORKER_FAILED',503,'文件处理进程异常，未提交结果'));slot.current=undefined;void this.retire(slot);}
  }
 }
 private spawn():Slot{
  const worker=new Worker(this.workerUrl,{execArgv:['--experimental-strip-types'],env:{TZ:'UTC',NODE_NO_WARNINGS:'1'},resourceLimits:{maxOldGenerationSizeMb:this.config.heapMb,maxYoungGenerationSizeMb:16,stackSizeMb:4},stdout:true,stderr:true});
  // Worker diagnostics must never include the workbook key, input file or task content.
  worker.stdout.resume();worker.stderr.resume();
  let exited!:()=>void;const slot:Slot={worker,retiring:false,uses:0,exit:new Promise<void>(resolve=>exited=resolve)};
  this.slots.add(slot);this.counts.createdWorkers++;this.counts.peakWorkers=Math.max(this.counts.peakWorkers,this.slots.size);
  worker.on('message',(message:any)=>{
   const job=slot.current;if(!job||slot.retiring)return;
   if(performance.now()-job.created>=this.config.timeoutMs){this.cancel(job,timedOut());return;}
   if(message?.id!==job.id){this.finish(job,new FileJobError('FILE_WORKER_FAILED',503,'文件处理返回无效结果'));slot.current=undefined;void this.retire(slot);return;}
   if(message.error){
    const status=[400,413].includes(message.error.status)?message.error.status:503;
    this.finish(job,new FileJobError(status===503?'FILE_WORKER_FAILED':'FILE_INPUT',status,status===503?'文件处理失败，未提交结果；请重试':String(message.error.message).slice(0,300)));
    if(status===503)void this.retire(slot);
   }else{
    try{
     if(!(message.bytes instanceof Uint8Array)||message.bytes.byteLength>MAX_JOB_BYTES)throw Error('invalid result');
     const value=deserialize(Buffer.from(message.bytes));
     this.finish(job,undefined,{value,timing:{queueMs:job.started-job.created,executionMs:performance.now()-job.started,computeMs:message.computeMs,cold:job.cold,heapUsedBytes:message.heapUsedBytes}});
    }catch{this.finish(job,new FileJobError('FILE_WORKER_FAILED',503,'文件处理返回无效结果'));void this.retire(slot);}
   }
   slot.current=undefined;worker.unref();this.pump();
  });
  worker.on('error',()=>{if(slot.current){this.finish(slot.current,new FileJobError('FILE_WORKER_FAILED',503,'文件处理进程异常，未提交结果；请重试'));slot.current=undefined;}void this.retire(slot);});
  worker.on('exit',()=>{if(slot.current){this.finish(slot.current,new FileJobError('FILE_WORKER_FAILED',503,'文件处理进程已退出，未提交结果'));slot.current=undefined;}slot.retiring=true;this.slots.delete(slot);exited();this.pump();});
  return slot;
 }
 private finish(job:Job,error?:unknown,result?:{value:any;timing:FileTiming}){
  if(job.done)return;job.done=true;clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);
  if(error){this.counts.failed++;if((error as any).code==='FILE_CANCELLED')this.counts.cancelled++;if((error as any).code==='FILE_TIMEOUT')this.counts.timeouts++;job.reject(error);}else{this.counts.completed++;job.resolve(result);}
  // Deliberately whitelist numeric metadata only. No job bodies, secrets, URLs or exception messages.
  metrics.publish({kind:job.kind,ok:!error,code:error?(error as any).code:undefined,queueMs:(job.started||performance.now())-job.created,executionMs:job.started?performance.now()-job.started:0,...result?.timing,...this.stats()});
 }
 private cancel(job:Job,error:FileJobError){
  if(job.done)return;const index=this.queue.indexOf(job);
  if(index>=0){this.queue.splice(index,1);this.queuedBytes-=job.size;this.finish(job,error);return;}
  const slot=[...this.slots].find(s=>s.current===job);this.finish(job,error);
  if(slot){slot.current=undefined;void this.retire(slot);}
 }
 private async retire(slot:Slot){if(!slot.retiring){slot.retiring=true;void slot.worker.terminate();}await slot.exit;}
 async close(){
  this.closed=true;
  for(const job of this.queue.splice(0)){this.queuedBytes-=job.size;this.finish(job,stopped());}
  const slots=[...this.slots];for(const slot of slots){if(slot.current){this.finish(slot.current,stopped());slot.current=undefined;}void this.retire(slot);}
  await Promise.all(slots.map(s=>s.exit));
 }
}
