// Test-only preload: hold delivery of actual computed worker results, before the final DB gate.
// FilePool explicitly sets execArgv, so this preload is never inherited by worker threads.
import workers from 'node:worker_threads';
import {syncBuiltinESMExports} from 'node:module';
import {subscribe} from 'node:diagnostics_channel';
const NativeWorker=workers.Worker;
let next:{mode:string;sequence:number}|undefined;
const held=new Map<number,()=>void>();
process.on('message',(m:any)=>{
 if(m.gate==='arm'){next={mode:m.mode,sequence:m.sequence};process.send?.({gate:'armed',sequence:m.sequence});}
 if(m.gate==='release'){held.get(m.sequence)?.();held.delete(m.sequence);}
 if(m.gate==='shutdown')process.emit('SIGTERM');
});
class ControlledWorker extends NativeWorker{
 private pendingGate:number|undefined;
 override on(event:string|symbol,listener:(...args:any[])=>void):this{
  if(event==='message')return super.on(event,(value:any)=>{
   const sequence=this.pendingGate;
   if(sequence===undefined)return listener(value);
   this.pendingGate=undefined;held.set(sequence,()=>listener(value));process.send?.({gate:'held',sequence});
  });
  return super.on(event,listener);
 }
 override postMessage(value:any,transferList?:Parameters<InstanceType<typeof NativeWorker>['postMessage']>[1]){
  if(!next||!value?.bytes)return super.postMessage(value,transferList);
  const {mode,sequence}=next;next=undefined;
  this.once('exit',()=>{held.delete(sequence);process.send?.({gate:'worker-exit',sequence});});
  if(mode==='crash'){process.send?.({gate:'held',sequence});void this.terminate();return;}
  this.pendingGate=sequence;super.postMessage(value,transferList);
 }
}
workers.Worker=ControlledWorker;syncBuiltinESMExports();
subscribe('project-station.file-task',(metric:any)=>process.send?.({gate:'metric',...metric}));
