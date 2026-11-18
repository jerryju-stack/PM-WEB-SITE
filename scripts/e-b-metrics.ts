// Benchmark preload only; workers do not inherit this module or the parent's environment.
import {isMainThread} from 'node:worker_threads';
import {subscribe} from 'node:diagnostics_channel';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
if(isMainThread){
 const delay=monitorEventLoopDelay({resolution:10});delay.enable();let last=performance.now(),maxDrift=0;
 subscribe('project-station.file-task',(value:any)=>process.send?.({type:'file-task',...value}));
 setInterval(()=>{const now=performance.now();maxDrift=Math.max(maxDrift,now-last-25);last=now;process.send?.({type:'memory',rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed,maxRss:process.resourceUsage().maxRSS*1024,loopMaxMs:delay.max/1e6,loopP95Ms:delay.percentile(95)/1e6,maxTimerDriftMs:maxDrift});},25).unref();
}
