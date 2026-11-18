import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {cpus,release} from 'node:os';
import {resolve} from 'node:path';
import {schedule} from '../lib/schedule.ts';
import {schedule as original} from '../tests/fixtures/schedule-e0.ts';
import {computePreview as oldPreview} from '../tests/fixtures/file-compute-e0.ts';
import {computePreview} from '../lib/timing-file-compute.ts';
import {syntheticTasks} from './e-a-fixtures.ts';
import {exportProjectXml} from '../lib/timing-project.ts';
import {schedulePolicy} from '../lib/timing-versions.ts';
const output=resolve(process.argv[2]??'docs/validation/batch-e-c/algorithm.json');
const stats=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:Math.max(...values)};};
const measure=(fn:()=>unknown)=>{const once=()=>{const at=performance.now();fn();return performance.now()-at;};const coldMs=once();return {coldMs,...stats(Array.from({length:30},once))};};
const results:any[]=[],previews:any[]=[];
for(const n of [100,500,1000])for(const shape of ['chain','fanout','long'] as const){const input=syntheticTasks(n,shape,'p');results.push({tasks:n,shape,old:measure(()=>original(input)),indexed:measure(()=>schedule(input))});}
for(const n of [100,500,1000]){const tasks=syntheticTasks(n,'fanout','p'),before={format:1 as const,project:{id:'p',title:'Synthetic',taskRevision:1,version:0} as any,tasks,schedulePolicy},input={kind:'preview' as const,projectId:'p',before,body:{format:'xml' as const,draftId:'d',leaseToken:'l',revision:1,file:exportProjectXml(before).toString('base64')}};previews.push({tasks:n,old:measure(()=>oldPreview(input)),indexed:measure(()=>computePreview(input))});}
mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify({at:new Date().toISOString(),environment:{node:process.version,cpu:cpus()[0]?.model,os:release()},method:'Frozen ac2b273/E0 reference and new algorithm in same process, same valid input; first +30 warm calls each; same current parser/comparator in both preview runs. No browser claim.',results,previews,maxRssBytes:process.resourceUsage().maxRSS*1024},null,2));console.log(output);
