import type {Store} from './database.ts';
import type {WriteContext} from './audit.ts';
import type {Task} from './schedule.ts';
import type {FilePool} from './file-pool.ts';
import type {FileTiming} from './file-job-types.ts';
import {fileCancelled} from './file-job-types.ts';
import {timingIO} from './timing-io.ts';
import type {computePreview} from './timing-file-compute.ts';
type Call={signal:AbortSignal;guard:()=>void;timing?:(timing:FileTiming)=>void};
const finalCheck=(call:Call)=>{if(call.signal.aborted)throw call.signal.reason??fileCancelled();call.guard();};
/** Every await ends before a synchronous authorization/state gate and final transaction. */
export function timingFileService(store:Store,pool:FilePool){
 const io=timingIO(store);
 return {
  async exportPlan(projectId:string,versionId:string,format:string,call:Call){
   const prepared=io.prepareExport(projectId,versionId,format),output=await pool.run<Uint8Array>(prepared.task,{signal:call.signal});
   finalCheck(call);call.timing?.(output.timing);
   return {filename:prepared.filename,buffer:Buffer.from(output.value)};
  },
  async preview(projectId:string,body:unknown,context:WriteContext,call:Call){
   const prepared=io.preparePreview(projectId,body,context),output=await pool.run<ReturnType<typeof computePreview>>(prepared.task,{signal:call.signal});
   finalCheck(call);call.timing?.(output.timing);
   return io.finishPreview(prepared,output.value,context,()=>finalCheck(call));
  },
  async confirm(projectId:string,body:unknown,context:WriteContext,call:Call){
   const prepared=io.prepareConfirm(projectId,body,context);
   if(prepared.receipt){finalCheck(call);return prepared.receipt;}
   const output=await pool.run<Task[]>(prepared.task!,{signal:call.signal});
   finalCheck(call);call.timing?.(output.timing);
   return io.finishConfirm(prepared.prepared!,output.value,context,()=>finalCheck(call));
  },
 };
}
