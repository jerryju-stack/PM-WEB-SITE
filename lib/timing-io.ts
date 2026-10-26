import { randomBytes,randomUUID } from 'node:crypto';
import type { Store } from './database.ts';
import type { WriteContext } from './audit.ts';
import type { Task } from './schedule.ts';
import { schedule,workdays,nextWorkday,template } from './schedule.ts';
import { timingVersions,comparePlans } from './timing-versions.ts';
import { invalid,objectInput } from './contracts.ts';
import { exportWorkbook,readWorkbook,orderedTasks } from './timing-workbook.ts';
import type { InputIssue } from './timing-workbook.ts';
import { exportTimingPdf } from './timing-pdf.ts';
export function timingIO(store:Store){
 store.db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('timing-workbook-key',randomBytes(32).toString('hex'));
 const key=String(store.db.prepare('SELECT value FROM meta WHERE key=?').get('timing-workbook-key')!.value),plans=timingVersions(store);
 function exportPlan(projectId:string,versionId:string,format:string){
  const {plan,version}=versionId==='current'?{plan:plans.current(projectId),version:null}:plans.get(projectId,versionId);
  const label=version?`${version.kind==='version'?'V'+version.sequence:version.kind==='baseline'?'基线':'最终版本'}-${version.name}-r${version.revision}`:`当前-r${plan.project.taskRevision}`;
  return {filename:`${plan.project.title}-${label}.${format}`.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_'),buffer:format==='xlsx'?exportWorkbook(plan,version,key).buffer:exportTimingPdf(plan,version)};
 }
 function preview(projectId:string,value:unknown,context:WriteContext){
  const body=objectInput(value);if(typeof body.file!=='string'||body.file.length>12*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(body.file))invalid('请上传原框架 .xlsx 文件（最大 8 MB）');
  if(body.mode!==undefined&&!['update','new'].includes(String(body.mode)))invalid('导入模式无效');
  const parsed=readWorkbook(Buffer.from(body.file as string,'base64'),key),before=plans.current(projectId),old=before.tasks,byId=new Map(old.map(t=>[t.id,t])),issues:InputIssue[]=[...parsed.issues],isNew=body.mode==='new';
  if(isNew&&old.length&&JSON.stringify(old)!==JSON.stringify(template(projectId)))invalid('建立新计划仅适用于空计划或未编辑的默认八阶段；请选择更新现有计划');
  const issue=(row:number,field:string,message:string)=>issues.push({sheet:'任务编辑',row,field,message});
  const mapping=body.mapping===undefined?{}:objectInput(body.mapping),matches:{row:number;wbs:string;title:string;id:string|null;trusted:boolean;choiceRequired:boolean}[]=[],ids=new Set<string>();
  const rowId=new Map<number,string>(),byWbs=new Map<string,typeof parsed.rows[number]>();
  for(const row of parsed.rows){
   if(byWbs.has(row.wbs))issue(row.row,'WBS','编号重复（另一行 '+byWbs.get(row.wbs)!.row+'）');else byWbs.set(row.wbs,row);
   const trusted=!isNew&&parsed.source?.projectId===projectId&&!!row.identity;
   let chosen=trusted&&byId.has(row.identity!)?row.identity!:undefined;const explicit=mapping[String(row.row)];
   if(explicit!==undefined){if(explicit!=='new'&&(typeof explicit!=='string'||!byId.has(explicit)))issue(row.row,'身份匹配','所选任务不存在');else chosen=explicit==='new'?undefined:explicit;}
   const choiceRequired=!isNew&&!trusted&&old.length>0&&explicit===undefined;
   matches.push({row:row.row,wbs:row.wbs,title:row.title,id:chosen??null,trusted,choiceRequired});
   if(trusted&&!byId.has(row.identity!)&&explicit===undefined)issue(row.row,'身份匹配','原任务已删除，请明确选择新增或匹配现有任务');
   const id=chosen??randomUUID();if(ids.has(id))issue(row.row,'身份匹配','多个 Excel 行映射到同一任务，请修改匹配或清除复制的身份');ids.add(id);rowId.set(row.row,id);
  }
  const tasks:Task[]=isNew?[]:structuredClone(old),deletions=new Set<string>(),inputDates:any[]=[];
  if(isNew)for(const t of old)deletions.add(t.id);
  for(const row of parsed.rows){
   const id=rowId.get(row.row)!,original=byId.get(id),parentWbs=row.wbs.includes('.')?row.wbs.slice(0,row.wbs.lastIndexOf('.')):null,parent=parentWbs?byWbs.get(parentWbs):null;
   if(parentWbs&&!parent)issue(row.row,'WBS',`缺少父任务 ${parentWbs}`);
   const children=parsed.rows.filter(r=>r.wbs.startsWith(row.wbs+'.'));
   const summary=children.length>0||(original?.kind==='summary'&&!row.start&&!row.end)||(!parentWbs&&!row.start&&!row.end&&row.kind!=='milestone');
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
   const task:Task={...(original??{notes:'',status:'计划中'}),id,projectId,parentId:parent?rowId.get(parent.row)!:null,order:siblings.indexOf(row),title:row.title,owner:row.owner,kind:summary?'summary':row.kind,start:row.start,end:row.end,duration,progress:row.progress,predecessors};
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
  const result={issues,matches,source:parsed.source??null,mode:isNew?'new':'update',comparison,dates,deletions:[...deletions].map(id=>({id,title:byId.get(id)?.title??tasks.find(t=>t.id===id)?.title??id})),affectedDependencies,revision:store.revision(projectId),projectVersion:before.project.version,existing:orderedTasks(old).map(r=>({id:r.task.id,wbs:r.wbs,title:r.task.title})),requiresMapping:matches.some(m=>m.choiceRequired),previewId:null as string|null};
  if(!issues.length&&!result.requiresMapping){
   const id=randomUUID(),expires=new Date(Date.now()+24*3600000).toISOString();store.db.prepare('DELETE FROM timing_imports WHERE result IS NULL AND expires_at<?').run(new Date().toISOString());
   store.db.prepare('INSERT INTO timing_imports(id,project_id,actor_uid,revision,project_version,expires_at,payload) VALUES(?,?,?,?,?,?,?)').run(id,projectId,context.actorUid!,result.revision,result.projectVersion,expires,JSON.stringify(normalized));result.previewId=id;
  }return result;
 }
 function confirm(projectId:string,value:unknown,context:WriteContext){
  const body=objectInput(value);if(typeof body.previewId!=='string')invalid('请先生成并核对导入预览');
  const row=store.db.prepare('SELECT * FROM timing_imports WHERE id=? AND project_id=? AND actor_uid=?').get(body.previewId as string,projectId,context.actorUid!) as any;if(!row)invalid('预览不存在，请重新上传核对',404);
  if(row.result)return {...JSON.parse(row.result),replayed:true,removed:[]};
  if(row.expires_at<new Date().toISOString())invalid('导入预览已过期，请重新上传核对',409);
  if(store.revision(projectId)!==row.revision||store.get('projects',projectId).version!==row.project_version)invalid('预览后服务器计划已更新，请重新生成预览并核对',409);
  const values=JSON.parse(row.payload) as Task[],ids=new Set(values.map(t=>t.id)),removed=store.db.prepare('SELECT a.* FROM attachments a JOIN tasks t ON a.task_id=t.id WHERE t.project_id=?').all(projectId).filter((a:any)=>!ids.has(a.task_id));
  const result={revision:row.revision+1,replayed:false};
  store.saveTasks(projectId,values,row.revision,context,()=>{
   if(store.get('projects',projectId).version!==row.project_version)invalid('项目已更新，请重新核对',409);
   store.db.prepare("UPDATE timing_imports SET result=?,payload='[]' WHERE id=?").run(JSON.stringify(result),row.id);
  });return {...result,removed};
 }
 return {exportPlan,preview,confirm};
}
