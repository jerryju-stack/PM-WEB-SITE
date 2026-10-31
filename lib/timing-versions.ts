import { randomUUID } from 'node:crypto';
import type { Store } from './database.ts';
import type { WriteContext } from './audit.ts';
import { audit } from './audit.ts';
import { invalid, objectInput, versionInput } from './contracts.ts';
import type { Project } from './contracts.ts';
import type { Task } from './schedule.ts';

export type VersionKind = 'baseline' | 'version' | 'final';
export type SaveVersionRequest = {kind:VersionKind;name:string;reason:string;revision:number;projectVersion:number;requestKey:string};
export type PlanSnapshot = {
  format: 1; project: Project; tasks: Task[];
  schedulePolicy: { id: string; workweek: number[]; dependency: string; durationUnit: string; dateBasis: string };
};
export type TimingVersion = {
  id: string; projectId: string; kind: VersionKind | 'unadopted' | 'previous'; sequence: number | null; name: string; reason: string;
  savedAt: string; actorUid: string; actorName: string; revision: number; projectVersion: number; sourceVersion?:string|null; sourceRevision?:number;
};
export const schedulePolicy = { id:'weekday-fs-v1', workweek:[1,2,3,4,5], dependency:'FS / next workday', durationUnit:'workday / inclusive', dateBasis:'YYYY-MM-DD / UTC calendar date' };
const metadata = (row:any):TimingVersion => ({ id:row.id,projectId:row.project_id,kind:row.kind,sequence:row.sequence,name:row.name,reason:row.reason,savedAt:row.saved_at,actorUid:row.actor_uid,actorName:row.actor_name,revision:row.revision,projectVersion:row.project_version,...(row.source_revision!=null?{sourceVersion:row.source_version,sourceRevision:row.source_revision}:{}) });


export function timingVersions(store:Store) {
  const row = (projectId:string,id:string) => store.db.prepare('SELECT v.*,a.source_version,a.source_revision FROM timing_versions v LEFT JOIN timing_adoptions a ON a.version_id=v.id WHERE v.project_id=? AND v.id=?').get(projectId,id) ?? store.db.prepare('SELECT * FROM timing_archives WHERE project_id=? AND id=?').get(projectId,id);
  const isDeleted=(projectId:string,id:string)=>!!store.db.prepare('SELECT 1 FROM timing_version_deletions WHERE project_id=? AND version_id=?').get(projectId,id);
  function remove(projectId:string,id:string,context:WriteContext){
    return store.transaction(()=>{
      const found=row(projectId,id);if(!found)invalid('计划版本不存在',404);
      if(!context.actorUid)invalid('请先登录',401);
      if(isDeleted(projectId,id))return {deleted:id,replayed:true};
      store.db.prepare('INSERT INTO timing_version_deletions VALUES(?,?,?,?)').run(id,projectId,new Date().toISOString(),context.actorUid!);
      audit(store.db,context,'timing-versions',id,metadata(found),null,{projectId,historyOnly:true});
      return {deleted:id,replayed:false};
    });
  }
  function restore(projectId:string,id:string,context:WriteContext){
    return store.transaction(()=>{
      const found=row(projectId,id);if(!found)invalid('计划版本不存在',404);
      if(!context.actorUid)invalid('请先登录',401);
      if(!isDeleted(projectId,id))return {restored:id,replayed:true};
      store.db.prepare('DELETE FROM timing_version_deletions WHERE project_id=? AND version_id=?').run(projectId,id);
      audit(store.db,context,'timing-versions',id,null,metadata(found),{projectId,historyOnly:true});
      return {restored:id,replayed:false};
    });
  }
  function get(projectId:string,id:string) {
    const found=row(projectId,id);if(!found||isDeleted(projectId,id))invalid('计划版本不存在或已删除',404);
    return {version:metadata(found),plan:JSON.parse(String(found!.snapshot)) as PlanSnapshot};
  }
  function current(projectId:string):PlanSnapshot {
    const project=store.get('projects',projectId);if(!project)invalid('项目不存在',404);
    // Persist the calculated values as-is; neither capture nor historical reads call schedule().
    return {format:1,project,tasks:store.tasks(projectId),schedulePolicy};
  }
  function save(projectId:string,value:unknown,context:WriteContext) {
    const body=objectInput(value), revision=versionInput(body.revision,'排期'), projectVersion=versionInput(body.projectVersion,'项目');
    const kind=body.kind as VersionKind;
    if(!['baseline','version','final'].includes(kind))invalid('请选择基线、V 序列或最终版本');
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120)invalid('版本名称须为 1–120 字');
    if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000)invalid('请填写修改原因（最多 2000 字）');
    if(typeof body.requestKey!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestKey))invalid('保存请求标识无效');
    if(!context.actorUid)invalid('请先登录',401);
    const name=(body.name as string).trim(),reason=(body.reason as string).trim(),key=body.requestKey as string;
    const requestData=JSON.stringify({kind,name,reason,revision,projectVersion,actorUid:context.actorUid});
    return store.transaction(()=>{
      const previous=store.db.prepare('SELECT * FROM timing_versions WHERE project_id=? AND request_key=?').get(projectId,key);
      if(previous){if(previous.request_data!==requestData)invalid('此保存请求已用于其他内容，请重新提交',409);return {version:metadata(previous),replayed:true};}
      const plan=current(projectId);
      if(store.revision(projectId)!==revision||plan.project.version!==projectVersion)invalid('当前计划已更新，请刷新当前计划、核对后再保存版本；输入已保留',409);
      const sequence=kind==='version'?Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM timing_versions WHERE project_id=?').get(projectId)!.n):null;
      const id=randomUUID(),savedAt=new Date().toISOString();
      store.db.prepare('INSERT INTO timing_versions(id,project_id,kind,sequence,name,reason,saved_at,actor_uid,actor_name,revision,project_version,request_key,request_data,snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,projectId,kind,sequence,name,reason,savedAt,context.actorUid!,context.actorName,revision,projectVersion,key,requestData,JSON.stringify(plan));
      const version=metadata(row(projectId,id));
      audit(store.db,context,'timing-versions',id,null,{id,projectId,kind,name},{revision,projectVersion});
      return {version,replayed:false};
    });
  }
  function compare(projectId:string,from:string,to:string) {
    const select=(id:string)=>id==='current'?{version:null,plan:current(projectId)}:get(projectId,id);
    const left=select(from),right=select(to);
    return {from:{...left,plan:undefined,revision:left.plan.project.taskRevision},to:{...right,plan:undefined,revision:right.plan.project.taskRevision},...comparePlans(left.plan,right.plan)};
  }
  return {current,get,save,compare,remove,restore,list:(projectId:string)=>[...store.db.prepare('SELECT v.*,a.source_version,a.source_revision FROM timing_versions v LEFT JOIN timing_adoptions a ON a.version_id=v.id WHERE v.project_id=?').all(projectId),...store.db.prepare('SELECT * FROM timing_archives WHERE project_id=?').all(projectId)].filter((v:any)=>!isDeleted(projectId,v.id)).sort((a:any,b:any)=>String(b.saved_at).localeCompare(String(a.saved_at))).map(metadata)};
}

export type PlanChange = {field:string;label:string;before:string;after:string;delta?:number|null};
export type TaskDifference = {id:string;title:string;type:'added'|'removed'|'changed';before:Task|null;after:Task|null;changes:PlanChange[]};
function hierarchy(tasks:Task[]) {
  const result=new Map<string,{wbs:string;path:string[]}>();
  function visit(parent:string|null,prefix:string,path:string[]){
    tasks.filter(t=>t.parentId===parent).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)).forEach((t,i)=>{
      const wbs=prefix?`${prefix}.${i+1}`:String(i+1);result.set(t.id,{wbs,path});visit(t.id,wbs,[...path,t.id]);
    });
  }
  visit(null,'',[]);return result;
}
export function comparePlans(from:PlanSnapshot,to:PlanSnapshot) {
  const left=new Map(from.tasks.map(t=>[t.id,t])),right=new Map(to.tasks.map(t=>[t.id,t]));
  const leftTree=hierarchy(from.tasks),rightTree=hierarchy(to.tasks);
  const differences:TaskDifference[]=[];
  const summary={added:0,removed:0,changed:0,unchanged:0};
  const taskLabel=(id:string,tasks:Map<string,Task>)=>`${tasks.get(id)?.title??'未知任务'} [${id}]`;
  for(const id of new Set([...left.keys(),...right.keys()])){
    const before=left.get(id),after=right.get(id);
    if(!before||!after){const type=before?'removed':'added';summary[type]++;differences.push({id,title:(after??before)!.title,type,before:before??null,after:after??null,changes:[]});continue;}
    const changes:PlanChange[]=[];
    for(const [field,label] of [['title','任务名称'],['start','开始日期'],['end','结束日期'],['duration','工期（工作日）'],['owner','负责人'],['kind','任务类型 / 里程碑'],['progress','进度（%）'],['status','状态'],['notes','备注']] as const){
      if(before[field]!==after[field]){
        const kinds={task:'普通任务',summary:'汇总阶段',milestone:'里程碑'};
        const text=(t:Task)=>field==='kind'?kinds[t.kind]:String(t[field]??'未排期');
        const date=field==='start'||field==='end';
        // UTC midnight arithmetic avoids DST; null endpoints have no numeric offset.
        const delta=date?(before[field]&&after[field]?(Date.parse(after[field]+'T00:00:00Z')-Date.parse(before[field]+'T00:00:00Z'))/86400000:null):undefined;
        changes.push({field,label,before:text(before),after:text(after),...(date?{delta}:{})});
      }
    }
    if(JSON.stringify([...before.predecessors].sort())!==JSON.stringify([...after.predecessors].sort()))changes.push({field:'predecessors',label:'依赖 / FS',before:before.predecessors.map(id=>taskLabel(id,left)).join('、')||'无',after:after.predecessors.map(id=>taskLabel(id,right)).join('、')||'无'});
    if(before.parentId!==after.parentId||before.order!==after.order||JSON.stringify(leftTree.get(id))!==JSON.stringify(rightTree.get(id))){
      const text=(t:Task,tree:ReturnType<typeof hierarchy>,tasks:Map<string,Task>)=>`${tree.get(id)?.wbs??'—'} · ${t.parentId?taskLabel(t.parentId,tasks):'一级目录'} · 排序 ${t.order}`;
      changes.push({field:'hierarchy',label:'层级 / 顺序（WBS）',before:text(before,leftTree,left),after:text(after,rightTree,right)});
    }
    if(changes.length){summary.changed++;differences.push({id,title:after.title,type:'changed',before,after,changes});}else summary.unchanged++;
  }
  const projectChanges:PlanChange[]=[];
  for(const field of ['title','description','owner','category','startDate','date','status','progress','content'] as const)if(from.project[field]!==to.project[field])projectChanges.push({field,label:({title:'项目名称',description:'项目说明',owner:'项目负责人',category:'项目分类',startDate:'项目开始',date:'项目结束',status:'项目状态',progress:'项目进度',content:'项目正文'})[field],before:String(from.project[field]??''),after:String(to.project[field]??'')});
  return {summary,differences,projectChanges,dateBasis:'日期偏移 = 目标日期 − 来源日期，按 UTC 日历日计算；正数表示延后，负数表示提前，未排期不计算偏移。工期使用快照中的工作日数。层级包含 WBS、父任务和排序变化。比较当前计划时仅包含服务器已保存数据，不包含本地草稿。'};
}
