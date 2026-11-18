import {parentPort} from 'node:worker_threads';
import {serialize,deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {computeFile} from './timing-file-compute.ts';
import {MAX_JOB_BYTES} from './file-job-types.ts';
import type {FileTask} from './file-job-types.ts';

if(!parentPort)throw Error('File worker requires a parent port');
parentPort.on('message',async(message:{id:number;bytes:Uint8Array})=>{
 let task:FileTask|undefined;
 try{
  if(!(message.bytes instanceof Uint8Array)||message.bytes.byteLength>MAX_JOB_BYTES)throw Object.assign(Error('文件任务过大'),{status:413});
  task=deserialize(Buffer.from(message.bytes)) as FileTask;
  const started=performance.now(),value=await computeFile(task),computeMs=performance.now()-started;
  const serialized=serialize(value);if(serialized.byteLength>MAX_JOB_BYTES)throw Object.assign(Error('文件结果过大，请缩小计划或内容'),{status:413});
  const bytes=new Uint8Array(serialized);
  parentPort!.postMessage({id:message.id,bytes,computeMs,heapUsedBytes:process.memoryUsage().heapUsed},[bytes.buffer]);
 }catch(error:any){
  const input=[400,413].includes(error?.status);
  let text=input?String(error.message):'文件处理失败';
  const secret=task&&'signingKey' in task?task.signingKey:undefined;if(secret)text=text.split(secret).join('[redacted]');
  parentPort!.postMessage({id:message.id,error:{status:input?error.status:503,message:text.slice(0,300)}});
 }finally{task=undefined;}
});
