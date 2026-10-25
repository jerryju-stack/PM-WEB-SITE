import { randomBytes } from 'node:crypto';
import type { Store } from './database.ts';
import { dateValue, workdays, nextWorkday } from './schedule.ts';
import type { Task } from './schedule.ts';
import type { TaskResult } from './contracts.ts';
import { taskInput, invalid as fail } from './contracts.ts';
import type { WriteContext } from './audit.ts';
export type Attachment = { id: string; task_id: string; [key: string]: unknown };
export function writeTasks(store: Store, projectId: string, taskId: string | undefined, method: string, value: unknown, context?: WriteContext): TaskResult & { removed: Attachment[] } {
 const project=store.get('projects',projectId);if(!project)fail('项目不存在',404);
 const body=taskInput(value),id=()=>randomBytes(16).toString('hex');
 const attached=(projectId:string)=>store.db.prepare('SELECT a.* FROM attachments a JOIN tasks t ON a.task_id=t.id WHERE t.project_id=?').all(projectId) as Attachment[];
 let tasks=store.tasks(project.id);let target=taskId?tasks.find(t=>t.id===taskId):undefined;let removed:Attachment[]=[];
        if(taskId&&!target)fail('任务不存在',404);
        if(method==='DELETE') {
          if(!target)fail('请选择任务');const doomed=new Set([target!.id]);let count=-1;while(count!==doomed.size){count=doomed.size;for(const t of tasks)if(t.parentId&&doomed.has(t.parentId))doomed.add(t.id);}
          removed=(attached(project.id) as any[]).filter(a=>doomed.has(a.task_id));tasks=tasks.filter(t=>!doomed.has(t.id)).map(t=>({...t,predecessors:t.predecessors.filter(p=>!doomed.has(p))}));
        }else {
          if(!target){if(method!=='POST')fail('任务不存在',404);target={id:id(),projectId:project.id,parentId:body.parentId||null,order:tasks.filter(t=>t.parentId===(body.parentId||null)).length,title:'新任务',kind:'task',owner:'',start:null,end:null,duration:1,progress:0,status:'计划中',notes:'',predecessors:[]};tasks.push(target);}
          if(body.parentId!==undefined){if(body.parentId!==null&&typeof body.parentId!=='string')fail('父任务无效');target.parentId=body.parentId;}
          if(target.parentId){const parent=tasks.find(t=>t.id===target!.parentId);if(!parent)fail('父任务不存在');if(parent!.kind==='milestone')fail('里程碑不能包含子任务');if(parent!.predecessors.length||tasks.some(t=>t.predecessors.includes(parent!.id)))fail('请先清除父任务的依赖关系，再添加子任务');}
          const isSummary=target.kind==='summary'||tasks.some(t=>t.parentId===target!.id);
          for(const key of ['title','owner','notes','status'] as const)if(body[key]!==undefined)target[key]=body[key]!;
          if(body.kind!==undefined){if(!['summary','task','milestone'].includes(body.kind))fail('任务类型无效');if(isSummary&&body.kind!=='summary')fail('汇总阶段不能直接改为普通任务');target.kind=body.kind;}
          if(body.order!==undefined){if(!Number.isInteger(body.order)||body.order<0)fail('排序值无效');target.order=body.order;}
          if(!isSummary&&target.kind!=='summary') {
            if(body.start!==undefined){if(body.start!==null&&typeof body.start!=='string')fail('开始日期无效');target.start=body.start?nextWorkday(body.start):null;}
            if(body.duration!==undefined)target.duration=Number(body.duration);
            if(body.end!==undefined&&body.end){dateValue(body.end);if(target.kind==='milestone')target.start=nextWorkday(body.end);else if(target.start)target.duration=workdays(target.start,body.end);}
            if(body.progress!==undefined)target.progress=Number(body.progress);
            if(body.predecessors!==undefined){if(!Array.isArray(body.predecessors)||!body.predecessors.every((x:any)=>typeof x==='string'))fail('前置任务格式无效');target.predecessors=[...new Set<string>(body.predecessors)];}
          }
        }
        const updated=store.saveTasks(project.id,tasks,body.revision,context);return {tasks:updated,revision:store.revision(project.id),id:target?.id,project:store.get('projects',project.id),removed};
}
