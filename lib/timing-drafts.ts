import { randomUUID } from 'node:crypto';
import type { Store } from './database.ts';
import type { WriteContext } from './audit.ts';
import type { Task } from './schedule.ts';
import { schedule, projectProgress } from './schedule.ts';
import { invalid, objectInput, versionInput } from './contracts.ts';
import { timingVersions, comparePlans } from './timing-versions.ts';
import type { PlanSnapshot } from './timing-versions.ts';
import { writeTasks } from './task-writes.ts';
import { audit } from './audit.ts';

export const EDIT_LEASE_MS=30_000;
export function timingDrafts(store:Store,now=()=>Date.now()) {
 const plans=timingVersions(store);
 const row=(p:string)=>store.db.prepare('SELECT * FROM timing_drafts WHERE project_id=?').get(p) as any;
 const lease=(p:string)=>store.db.prepare('SELECT * FROM timing_edit_leases WHERE project_id=? AND expires_at>?').get(p,now()) as any;
 const metadata=(d:any)=>d?{id:d.id,sourceVersion:d.source_version,sourceRevision:d.source_revision,sourceLabel:d.source_label,revision:d.revision,actorUid:d.actor_uid,actorName:d.actor_name,savedAt:d.saved_at}:null;
 function state(p:string) {const d=row(p),l=lease(p);return {draft:metadata(d),editor:l?{actorUid:l.actor_uid,actorName:l.actor_name,expiresAt:l.expires_at}:null};}
 function check(p:string,value:unknown,context:WriteContext) {
  const b=objectInput(value),l=lease(p);
  if(!l||l.token!==b.leaseToken||l.actor_uid!==context.actorUid)invalid('编辑占用已失效，请重新进入编辑并读取最新草稿',409);
  return l;
 }
 function checkedDraft(p:string,value:unknown,c:WriteContext) {
  check(p,value,c);const b=objectInput(value),d=row(p);
  if(!d||d.id!==b.draftId||d.revision!==versionInput(b.revision,'草稿'))invalid('草稿已更新，请重新读取；本地输入仍保留',409);
  return d;
 }
 function plan(p:string,d=row(p)):PlanSnapshot {
  if(!d)invalid('草稿不存在',404);
  const current=plans.current(p),tasks=JSON.parse(d.payload) as Task[],leaves=tasks.filter(t=>t.kind!=='summary');
  const progress=projectProgress(tasks);
  return {...current,project:{...current.project,taskRevision:d.revision,...(leaves.length?{progress,status:progress===100?'已完成':progress>0?'进行中':'计划中'}:{})},tasks};
 }
 function archive(p:string,snapshot:PlanSnapshot,kind:'unadopted'|'previous',c:WriteContext,sourceVersion:string|null,sourceRevision:number) {
  const id=randomUUID();store.db.prepare('INSERT INTO timing_archives(id,project_id,kind,name,reason,saved_at,actor_uid,actor_name,revision,project_version,snapshot,source_version,source_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,p,kind,kind==='unadopted'?'未采用草稿':'原执行计划',kind==='unadopted'?'切换历史起点前保留，未曾采用为执行计划':'采用新计划前保留',new Date(now()).toISOString(),c.actorUid!,c.actorName,snapshot.project.taskRevision,snapshot.project.version,JSON.stringify(snapshot),sourceVersion,sourceRevision);
  audit(store.db,c,'timing-archives',id,null,{projectId:p,kind});return id;
 }
 function create(p:string,source:string|undefined,c:WriteContext) {
  const current=plans.current(p),saved=source?plans.get(p,source):null;
  const latest=new Map(current.tasks.map(t=>[t.id,t]));
  const tasks=saved?schedule(saved.plan.tasks.map(t=>{const live=latest.get(t.id);return live?{...t,progress:live.progress,status:live.status}:t;})):current.tasks;
  store.db.prepare('INSERT INTO timing_drafts(project_id,id,source_version,source_revision,source_label,base_revision,payload,actor_uid,actor_name,saved_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(p,randomUUID(),source??null,saved?saved.version.revision:current.project.taskRevision,saved?(saved.version.kind==='version'?'V'+saved.version.sequence:saved.version.kind==='baseline'?'基线':saved.version.kind==='final'?'最终版本':saved.version.kind==='unadopted'?'未采用':'原执行计划')+' · '+saved.version.name:'当前执行计划',current.project.taskRevision,JSON.stringify(tasks),c.actorUid!,c.actorName,new Date(now()).toISOString());
 }
 function start(p:string,value:unknown,c:WriteContext) {
  const b=objectInput(value);if(!c.actorUid)invalid('请先登录',401);
  if(b.sourceVersion!==undefined&&typeof b.sourceVersion!=='string')invalid('来源版本无效');
  return store.transaction(()=>{
   plans.current(p);let l=lease(p);
   if(l){if(l.token!==b.leaseToken||l.actor_uid!==c.actorUid)invalid(l.actor_name+' 正在编辑，请等待退出或占用到期',409);check(p,b,c);}else{
    if(b.leaseToken)invalid('原编辑会话已失效，请重新进入编辑',409);
    store.db.prepare('INSERT INTO timing_edit_leases VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET token=excluded.token,actor_uid=excluded.actor_uid,actor_name=excluded.actor_name,expires_at=excluded.expires_at')
     .run(p,randomUUID(),c.actorUid!,c.actorName,now()+EDIT_LEASE_MS);l=lease(p);
   }
   const old=row(p);
   if(b.sourceVersion&&old){
    if(b.expectedDraftId!==old.id||b.revision!==old.revision||!['archive','discard'].includes(String(b.decision)))invalid('已有待采用草稿，请选择保留为未采用历史、放弃或取消',409);
    if(b.decision==='archive')archive(p,plan(p,old),'unadopted',c,old.source_version,old.source_revision);
    store.db.prepare('DELETE FROM timing_drafts WHERE project_id=?').run(p);
   }
   if(!row(p))create(p,b.sourceVersion as string|undefined,c);
   return {leaseToken:l.token,...state(p),plan:plan(p)};
  });
 }
 function heartbeat(p:string,b:unknown,c:WriteContext) {check(p,b,c);store.db.prepare('UPDATE timing_edit_leases SET expires_at=? WHERE project_id=?').run(now()+EDIT_LEASE_MS,p);return state(p);}
 function release(p:string,b:unknown,c:WriteContext) {const value=objectInput(b);store.db.prepare('DELETE FROM timing_edit_leases WHERE project_id=? AND token=? AND actor_uid=?').run(p,typeof value.leaseToken==='string'?value.leaseToken:'',c.actorUid??'');return {ok:true};}
 function view(p:string,b:unknown,c:WriteContext) {checkedDraft(p,b,c);return plan(p);}
 function save(p:string,tasks:Task[],b:unknown,c:WriteContext,committed?:()=>void) {
  return store.transaction(()=>{
   const d=checkedDraft(p,b,c),normalized=schedule(tasks);
   if(normalized.some(t=>t.projectId!==p))invalid('任务必须属于本项目');
   if(JSON.stringify(normalized)!==d.payload){
    store.db.prepare('UPDATE timing_drafts SET payload=?,revision=revision+1,actor_uid=?,actor_name=?,saved_at=? WHERE project_id=?')
     .run(JSON.stringify(normalized),c.actorUid!,c.actorName,new Date(now()).toISOString(),p);
    audit(store.db,c,'timing-drafts',d.id,{revision:d.revision},{revision:d.revision+1});
   }
   committed?.();return {...state(p),plan:plan(p)};
  });
 }
 function mutate(p:string,id:string|undefined,method:string,b:unknown,c:WriteContext) {
  const d=checkedDraft(p,b,c);let result:any;
  // Reuse task validation/calculation with a draft-backed store; no live task SQL runs.
  const scoped={...store,tasks:()=>JSON.parse(d.payload),revision:()=>Number(row(p).revision),get:(table:string,key:string)=>table==='projects'?plan(p).project:store.get(table,key),
   saveTasks:(_p:string,tasks:Task[])=>{result=save(p,tasks,b,c);return result.plan.tasks;}};
  const changed=writeTasks(scoped,p,id,method,b,c);
  return {tasks:result.plan.tasks,project:result.plan.project,revision:result.draft.revision,draft:result.draft,id:changed.id,removed:[]};
 }
 const same=(a:PlanSnapshot,b:PlanSnapshot)=>{const diff=comparePlans(a,b);return !diff.summary.added&&!diff.summary.removed&&!diff.summary.changed&&!diff.projectChanges.length;};
 function adopt(p:string,value:unknown,c:WriteContext) {
  const b=objectInput(value);check(p,b,c);
  const receipt=store.db.prepare('SELECT * FROM timing_adoptions WHERE project_id=? AND draft_id=?').get(p,String(b.draftId));
  if(receipt){if(receipt.actor_uid!==c.actorUid||receipt.lease_token!==b.leaseToken)invalid('此采用请求属于其他编辑会话',409);return {...JSON.parse(String(receipt.result)),replayed:true};}
  const d=checkedDraft(p,b,c),before=plans.current(p),proposed=plan(p,d);
  if(store.revision(p)!==d.base_revision)invalid('执行计划已更新，请重新进入编辑',409);
  const finish=(result:any,versionId:string|null)=>{
   check(p,b,c);
   store.db.prepare('INSERT INTO timing_adoptions VALUES(?,?,?,?,?,?,?,?)').run(d.id,p,c.actorUid!,b.leaseToken as string,JSON.stringify(result),versionId,d.source_version,d.source_revision);
   store.db.prepare('DELETE FROM timing_drafts WHERE project_id=? AND id=?').run(p,d.id);
  };
  if(same(before,proposed))return store.transaction(()=>{const result={changed:false,revision:store.revision(p)};finish(result,null);return result;});
  let result:any;
  store.saveTasks(p,proposed.tasks,d.base_revision,c,()=>{
   if(!plans.list(p).some(v=>v.kind!=='unadopted'&&same(plans.get(p,v.id).plan,before)))archive(p,before,'previous',c,null,before.project.taskRevision);
   const sequence=Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM timing_versions WHERE project_id=?').get(p)!.n),id=randomUUID(),current=plans.current(p);
   store.db.prepare('INSERT INTO timing_versions(id,project_id,kind,sequence,name,reason,saved_at,actor_uid,actor_name,revision,project_version,request_key,request_data,snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,p,'version',sequence,'执行计划','采用共享草稿',new Date(now()).toISOString(),c.actorUid!,c.actorName,store.revision(p),current.project.version,d.id,JSON.stringify({draftId:d.id}),JSON.stringify(current));
   audit(store.db,c,'timing-versions',id,null,{projectId:p,sequence,sourceVersion:d.source_version,sourceRevision:d.source_revision});
   result={changed:true,revision:store.revision(p),versionId:id,sequence};finish(result,id);
  },true);
  return result;
 }
 return {state,start,heartbeat,release,check,view,save,mutate,adopt,plan};
}
