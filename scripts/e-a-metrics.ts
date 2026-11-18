// Benchmark-only preload in the isolated child process; no product endpoint added.
import { monitorEventLoopDelay } from 'node:perf_hooks';
const delay=monitorEventLoopDelay({resolution:10});delay.enable();
setInterval(()=>{process.send?.({rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed,eventLoopMaxMs:delay.max/1e6,eventLoopP95Ms:delay.percentile(95)/1e6});delay.reset();},50).unref();
