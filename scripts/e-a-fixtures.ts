import { schedule } from '../lib/schedule.ts';
import type { Task } from '../lib/schedule.ts';

/** Deterministic, format-valid synthetic plans. Never read the workspace data directory. */
export function syntheticTasks(count:number,shape:'chain'|'fanout'|'long'='fanout',projectId='p'):Task[]{
 const tasks:Task[]=[];
 for(let i=0;i<count;i++)tasks.push({id:`${projectId}-t${i}`,projectId,parentId:i===0?null:i<19?`${projectId}-t${i-1}`:`${projectId}-t18`,order:i,title:`Synthetic ${shape} task ${i} — 长名称容量样本`,kind:i<19?'summary':'task',owner:'Synthetic PM',start:'2000-01-03',end:null,duration:shape==='long'?2600:1,progress:i%101,status:'计划中',notes:'Isolated capacity fixture',predecessors:i<=19||shape==='long'?[]:[`${projectId}-t${shape==='chain'?i-1:19}`]});
 return schedule(tasks);
}
