import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schedule,finish,workdays} from '../lib/schedule.ts';
import {schedule as original,finish as oldFinish,workdays as oldWorkdays} from './fixtures/schedule-e0.ts';
import {computePreview as oldPreview} from './fixtures/file-compute-e0.ts';
import {computePreview} from '../lib/timing-file-compute.ts';
import {syntheticTasks} from '../scripts/e-a-fixtures.ts';
import {schedulePolicy,comparePlans} from '../lib/timing-versions.ts';
import {exportProjectXml} from '../lib/timing-project.ts';
import {taskIndex} from '../lib/task-index.ts';

test('E4 indexed schedule equals frozen E0 for depth20, chain/fanout/long, fractional progress and date boundaries',()=>{
 for(const n of [100,500,1000])for(const shape of ['chain','fanout','long'] as const){const tasks=syntheticTasks(n,shape,'p').map((t,i)=>({...t,progress:t.kind==='summary'?t.progress:(i%3?33.333333:1e-7)}));assert.deepEqual(schedule(tasks),original(tasks),`${n}/${shape}`);assert.deepEqual(comparePlans({format:1,project:{} as any,tasks:schedule(tasks),schedulePolicy},{format:1,project:{} as any,tasks:original(tasks),schedulePolicy}).summary,{added:0,removed:0,changed:0,unchanged:n});}
 for(const start of ['2000-01-01','2026-11-16','2026-11-20','2100-01-01'])for(const duration of [0,1,2,5,6,20,99,2600]){let expected:string;try{expected=oldFinish(start,duration);}catch{assert.throws(()=>finish(start,duration));continue;}assert.equal(finish(start,duration),expected);assert.equal(workdays(start,expected),oldWorkdays(start,expected));}
 const tasks=syntheticTasks(100,'fanout','p');const bad=[...tasks,{...tasks.at(-1)!}];assert.throws(()=>schedule(bad),/重复/);
 const cycle=tasks.map(t=>({...t}));cycle[0].parentId=cycle[1].id;assert.throws(()=>schedule(cycle),/循环/);
 const tree=taskIndex(tasks),moved=tasks.map(t=>t.id===tasks.at(-1)!.id?{...t,parentId:null}:t);assert.notDeepEqual(taskIndex(moved).rows().map(r=>r.wbs),tree.rows().map(r=>r.wbs));assert.equal(taskIndex(tasks.slice(0,50)).byId.size,50);
});

test('E4 indexed XML preview matches frozen E0 preview on the same 100/500/1000-task snapshot',()=>{
 for(const n of [100,500,1000]){
  const tasks=syntheticTasks(n,'fanout','p'),before={format:1 as const,project:{id:'p',title:'Synthetic',taskRevision:1,version:0} as any,tasks,schedulePolicy};
  const input={kind:'preview' as const,projectId:'p',before,body:{format:'xml' as const,draftId:'d',leaseToken:'lease',revision:1,file:exportProjectXml(before).toString('base64')}};
  assert.deepEqual(computePreview(input),oldPreview(input));
 }
});
