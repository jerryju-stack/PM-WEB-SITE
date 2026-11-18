import type {Task} from './schedule.ts';
export type TaskRow={task:Task;wbs:string;depth:number};
/** One immutable-by-convention index per data snapshot; rebuild after edits or reload. */
export function taskIndex(tasks:Task[]){
 const byId=new Map(tasks.map(t=>[t.id,t])),children=new Map<string|null,Task[]>();
 for(const task of tasks){let group=children.get(task.parentId);if(!group)children.set(task.parentId,group=[]);group.push(task);}
 const ordered=new Map([...children].map(([id,group])=>[id,[...group].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id))]));
 function rows(collapsed?:Set<string>,depth=0){const result:TaskRow[]=[];function visit(parent:string|null,prefix:string,level:number){for(const [i,task] of (ordered.get(parent)??[]).entries()){const wbs=prefix?prefix+'.'+(i+1):String(i+1);result.push({task,wbs,depth:level});if(!collapsed?.has(task.id))visit(task.id,wbs,level+1);}}visit(null,'',depth);return result;}
 function descendants(id:string){const found=new Set<string>(),pending=[id];for(let i=0;i<pending.length;i++){const next=pending[i];if(found.has(next))continue;found.add(next);for(const child of children.get(next)??[])pending.push(child.id);}return found;}
 return {byId,children,ordered,rows,descendants};
}
