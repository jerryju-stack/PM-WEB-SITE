// Pure file/plan computation. This module never opens SQLite or authorizes a request.
import {randomUUID} from 'node:crypto';
import type {Task} from '../../lib/schedule.ts';
import {schedule,workdays,nextWorkday,template} from '../../lib/schedule.ts';
import {comparePlans} from '../../lib/timing-versions.ts';
import {objectInput,invalid} from '../../lib/contracts.ts';
import {exportWorkbook,readWorkbook,orderedTasks} from '../../lib/timing-workbook.ts';
import type {InputIssue} from '../../lib/timing-workbook.ts';
import {exportTimingPdf} from '../../lib/timing-pdf.ts';
import {exportProjectXml,readProjectXml} from '../../lib/timing-project.ts';
import type {FileTask} from '../../lib/file-job-types.ts';
export function computePreview(input:Extract<FileTask,{kind:'preview'}>){
 const {body,before,projectId}=input,signingKey=input.signingKey??'';
  const parsed=body.format==='xml'?readProjectXml(Buffer.from(body.file as string,'base64')):readWorkbook(Buffer.from(body.file as string,'base64'),signingKey),old=before.tasks,byId=new Map(old.map(t=>[t.id,t])),issues:InputIssue[]=[...parsed.issues],isNew=body.mode==='new';
  if(isNew&&old.length&&JSON.stringify(old)!==JSON.stringify(template(projectId)))invalid('建立新计划仅适用于空计划或未编辑的默认八阶段；请选择更新现有计划');
  const issue=(row:number,field:string,message:string)=>issues.push({sheet:'任务编辑',row,field,message});
  const existing=orderedTasks(old).map(r=>({id:r.task.id,wbs:r.wbs,title:r.task.title}));
  const mapping=body.mapping===undefined?{}:objectInput(body.mapping),matches:{row:number;wbs:string;title:string;id:string|null;trusted:boolean;choiceRequired:boolean;method:string;existingTitle:string|null;nameMismatch:boolean}[]=[],ids=new Map<string,number>();
  const rowId=new Map<number,string>(),byWbs=new Map<string,typeof parsed.rows[number]>();
  for(const row of parsed.rows){
   if(byWbs.has(row.wbs))issue(row.row,'WBS','编号重复（另一行 '+byWbs.get(row.wbs)!.row+'）');else byWbs.set(row.wbs,row);
   const trusted=!isNew&&parsed.source?.projectId===projectId&&!!row.identity&&byId.has(row.identity);
   const candidates=isNew?[]:existing.filter(t=>t.wbs===row.wbs);
   let chosen=trusted?row.identity:candidates.length===1?candidates[0].id:undefined;
   let method=trusted?'identity':candidates.length===1?'wbs':candidates.length>1?'ambiguous':'new';
   const explicit=mapping[String(row.row)];
   if(explicit!==undefined){method='manual';if(explicit!=='new'&&(typeof explicit!=='string'||!byId.has(explicit)))issue(row.row,'身份匹配','所选任务不存在，请选择当前项目任务或新增任务');else chosen=explicit==='new'?undefined:explicit;}
   const choiceRequired=explicit===undefined&&method==='ambiguous';
   if(choiceRequired)issue(row.row,'身份匹配',`WBS ${row.wbs} 对应多个任务，请明确选择已有任务或新增任务`);
   const existingTitle=chosen?byId.get(chosen)?.title??null:null;
   matches.push({row:row.row,wbs:row.wbs,title:row.title,id:chosen??null,trusted,choiceRequired,method,existingTitle,nameMismatch:method==='wbs'&&existingTitle!==row.title});
   const id=chosen??randomUUID();if(ids.has(id))issue(row.row,'身份匹配',`与第 ${ids.get(id)} 行映射到同一任务，请修改匹配或清除复制的身份`);else ids.set(id,row.row);rowId.set(row.row,id);
  }
  const tasks:Task[]=isNew?[]:structuredClone(old),deletions=new Set<string>(),inputDates:any[]=[];
  if(isNew)for(const t of old)deletions.add(t.id);
  for(const row of parsed.rows){
   const id=rowId.get(row.row)!,original=byId.get(id),parentWbs=row.wbs.includes('.')?row.wbs.slice(0,row.wbs.lastIndexOf('.')):null,parent=parentWbs?byWbs.get(parentWbs):null;
   if(parentWbs&&!parent)issue(row.row,'WBS',`缺少父任务 ${parentWbs}`);
   const children=parsed.rows.filter(r=>r.wbs.startsWith(row.wbs+'.'));
   const summary=body.format==='xml'?row.raw.projectSummary===true||children.length>0:children.length>0||(original?.kind==='summary'&&!row.start&&!row.end)||(!parentWbs&&!row.start&&!row.end&&row.kind!=='milestone');
   const predecessors:string[]=[];
   for(const wbs of row.predecessors){const p=byWbs.get(wbs);if(!p)issue(row.row,'前置任务 WBS',`无法解析 ${wbs}（须指向文件中的任务）`);else predecessors.push(rowId.get(p.row)!);}
   const siblings=parsed.rows.filter(r=>(r.wbs.includes('.')?r.wbs.slice(0,r.wbs.lastIndexOf('.')):null)===parentWbs).sort((a,b)=>+a.wbs.split('.').at(-1)!-+b.wbs.split('.').at(-1)!);
   let duration=original?.duration??1;
   if(!summary&&row.operation!=='删除'){
    if(!row.start||!row.end)issue(row.row,'输入开始 / 输入结束','未排期：请补全开始和结束日期');
    if(row.kind==='milestone'&&row.start!==row.end)issue(row.row,'叶子类型','里程碑的开始和结束须为同一天');
    if(row.start&&row.end&&row.end>=row.start){try{duration=row.kind==='milestone'?0:workdays(nextWorkday(row.start),row.end);if(row.kind!=='milestone'&&duration<1)issue(row.row,'输入结束','日期范围内没有工作日');}catch(e:any){issue(row.row,'输入日期',e.message);}}
   }
   if(summary&&predecessors.length)issue(row.row,'前置任务 WBS','汇总阶段不能设置前置任务');
   const task:Task={...(original??{notes:'',status:'计划中'}),...(body.format==='xml'&&typeof row.raw.notes==='string'?{notes:row.raw.notes}:{}),id,projectId,parentId:parent?rowId.get(parent.row)!:null,order:siblings.indexOf(row),title:row.title,owner:row.owner,kind:summary?'summary':row.kind,start:row.start,end:row.end,duration,progress:row.progress,predecessors};
   const index=tasks.findIndex(t=>t.id===id);if(index>=0)tasks[index]=task;else tasks.push(task);
   if(row.operation==='删除')deletions.add(id);
   inputDates.push({row:row.row,id,wbs:row.wbs,title:row.title,inputStart:row.start,inputEnd:row.end});
  }
  // Include descendants in both original and proposed trees in deletion impact.
  let size=-1;while(size!==deletions.size){size=deletions.size;for(const t of [...old,...tasks])if(t.parentId&&deletions.has(t.parentId))deletions.add(t.id);}
  const affectedDependencies=tasks.filter(t=>!deletions.has(t.id)&&t.predecessors.some(p=>deletions.has(p))).map(t=>({id:t.id,title:t.title,removed:t.predecessors.filter(p=>deletions.has(p))}));
  const retained=tasks.filter(t=>!deletions.has(t.id)).map(t=>({...t,predecessors:t.predecessors.filter(p=>!deletions.has(p))}));
  const rowFor=(id:string)=>parsed.rows.find(r=>rowId.get(r.row)===id)?.row??10;
  const visited=new Set<string>(),visiting=new Set<string>(),retainedById=new Map(retained.map(t=>[t.id,t]));
  function visit(id:string){if(visiting.has(id)){issue(rowFor(id),'前置任务 WBS','前置关系形成循环，请修改依赖');return;}if(visited.has(id))return;visiting.add(id);for(const p of retainedById.get(id)?.predecessors??[])visit(p);visiting.delete(id);visited.add(id);}
  for(const t of retained)visit(t.id);
  for(const t of retained)for(const id of t.predecessors)if(retained.find(t=>t.id===id)?.kind==='summary')issue(parsed.rows.find(r=>rowId.get(r.row)===t.id)?.row??10,'前置任务 WBS','前置任务不能为汇总阶段');
  let normalized=retained;
  if(!issues.length){try{normalized=schedule(retained);}catch(e:any){issue(10,'层级 / 依赖 / 排期',e.message);}}
  const comparison=comparePlans(before,{...before,tasks:normalized});
  const dates=inputDates.map(r=>{const t=normalized.find(t=>t.id===r.id);return {...r,finalStart:t?.start??null,finalEnd:t?.end??null,deleted:deletions.has(r.id),shifted:!!t&&(t.start!==r.inputStart||t.end!==r.inputEnd)};});
  for(const t of normalized)if(![...rowId.values()].includes(t.id)){const b=byId.get(t.id);if(b&&(b.start!==t.start||b.end!==t.end))dates.push({row:0,id:t.id,wbs:'保留项',title:t.title,inputStart:b.start,inputEnd:b.end,finalStart:t.start,finalEnd:t.end,deleted:false,shifted:true});}
  const result={issues,matches,warnings:'warnings' in parsed?parsed.warnings:[],source:parsed.source??null,mode:isNew?'new':'update',comparison,dates,deletions:[...deletions].map(id=>({id,title:byId.get(id)?.title??tasks.find(t=>t.id===id)?.title??id})),affectedDependencies,revision:before.project.taskRevision,projectVersion:before.project.version,existing,requiresMapping:matches.some(m=>m.choiceRequired),previewId:null as string|null};

 return {result,tasks:normalized};
}
export async function computeFile(task:FileTask){
 if(task.kind==='preview')return computePreview(task);
 if(task.kind==='confirm')return schedule(task.tasks);
 if(task.kind==='export')return task.format==='xlsx'?exportWorkbook(task.plan,task.version,task.signingKey!).buffer:task.format==='xml'?exportProjectXml(task.plan):await exportTimingPdf(task.plan,task.version);
 throw Error('Unsupported file task');
}
