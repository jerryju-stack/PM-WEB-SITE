// Deliberately adversarial worker fixture. Never referenced by server.ts or production configuration.
import {parentPort} from 'node:worker_threads';
import {serialize,deserialize} from 'node:v8';
parentPort!.on('message',async({id,bytes})=>{
 const task=deserialize(Buffer.from(bytes)),mode=task.tasks[0]?.title;
 if(mode==='hang')for(;;)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
 if(mode==='crash')process.exit(7);
 if(mode==='invalid'){parentPort!.postMessage({id:id+1});return;}
 if(mode==='delay')await new Promise(r=>setTimeout(r,task.tasks[0].duration));
 const output=new Uint8Array(serialize(task.tasks));parentPort!.postMessage({id,bytes:output,computeMs:1,heapUsedBytes:process.memoryUsage().heapUsed},[output.buffer]);
});
