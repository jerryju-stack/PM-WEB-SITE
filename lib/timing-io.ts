import { randomBytes,randomUUID } from 'node:crypto';
import type { Store } from './database.ts';
import type { WriteContext } from './audit.ts';
import type { Task } from './schedule.ts';
import { timingVersions } from './timing-versions.ts';
import { timingDrafts } from './timing-drafts.ts';
import { invalid,objectInput } from './contracts.ts';
import { exportWorkbook } from './timing-workbook.ts';
import {computePreview} from './timing-file-compute.ts';
import {MAX_FILE_BYTES,MAX_JOB_BYTES} from './file-job-types.ts';
import type {FileTask} from './file-job-types.ts';
import { exportTimingPdf } from './timing-pdf.ts';
import { exportProjectXml } from './timing-project.ts';
export function timingIO(store:Store){
 const plans=timingVersions(store),drafts=timingDrafts(store);
 function boundedSnapshot(projectId:string,versionId='current'){
  // Reject oversized source JSON before materializing/parsing it in the request thread.
  const sizes=versionId==='current'?[
   store.db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM tasks WHERE project_id=? AND archived=0').get(projectId)?.bytes,
   store.db.prepare('SELECT length(CAST(payload AS BLOB)) AS bytes FROM timing_drafts WHERE project_id=?').get(projectId)?.bytes,
   store.db.prepare('SELECT length(CAST(data AS BLOB)) AS bytes FROM projects WHERE id=?').get(projectId)?.bytes,
  ]:[store.db.prepare('SELECT length(CAST(snapshot AS BLOB)) AS bytes FROM timing_versions WHERE project_id=? AND id=? UNION ALL SELECT length(CAST(snapshot AS BLOB)) AS bytes FROM timing_archives WHERE project_id=? AND id=?').get(projectId,versionId,projectId,versionId)?.bytes];
  if(sizes.some(n=>Number(n??0)>MAX_JOB_BYTES))invalid('计划快照超出文件任务容量，请减少内容',413);
 }
 // Starting a server on a restored snapshot must not change its data digest.
 // Initialize this internal key only when Excel is actually exported/imported.
 function signingKey(){
  const existing=store.db.prepare('SELECT value FROM meta WHERE key=?').get('timing-workbook-key');
  if(existing)return String(existing.value);
  store.db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('timing-workbook-key',randomBytes(32).toString('hex'));
  return String(store.db.prepare('SELECT value FROM meta WHERE key=?').get('timing-workbook-key')!.value);
 }
 function prepareExport(projectId:string,versionId:string,format:string){
  if(!['xlsx','pdf','xml'].includes(format))invalid('请选择 Excel、PDF 或 Project XML');
  boundedSnapshot(projectId,versionId);
  const {plan,version}=versionId==='current'?{plan:plans.current(projectId),version:null}:plans.get(projectId,versionId);
  const label=version?`${version.kind==='version'?'V'+version.sequence:version.kind==='baseline'?'基线':version.kind==='unadopted'?'未采用':version.kind==='previous'?'原执行计划':'最终版本'}-${version.name}-r${version.revision}`:`当前-r${plan.project.taskRevision}`;
  return {filename:`${plan.project.title}-${label}.${format}`.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_'),task:{kind:'export',format,plan,version,...(format==='xlsx'?{signingKey:signingKey()}:{})} as Extract<FileTask,{kind:'export'}>};
 }
 /** Synchronous/offline facade. HTTP uses prepare -> worker -> finish exclusively. */
 function exportPlan(projectId:string,versionId:string,format:string){
  const {filename,task}=prepareExport(projectId,versionId,format);
  return {filename,buffer:format==='xlsx'?exportWorkbook(task.plan,task.version,task.signingKey!).buffer:format==='xml'?exportProjectXml(task.plan):exportTimingPdf(task.plan,task.version)};
 }
 function preparePreview(projectId:string,value:unknown,context:WriteContext){
  const body=objectInput(value);if(typeof body.file!=='string'||body.file.length>12*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(body.file))invalid('请上传 Excel 或 Project XML 文件（最大 8 MB）');
  if(body.format!==undefined&&!['xlsx','xml'].includes(String(body.format)))invalid('请选择 Excel 或 Project XML；不支持原生 .mpp');
  if(body.mode!==undefined&&!['update','new'].includes(String(body.mode)))invalid('导入模式无效');
  if(Buffer.byteLength(body.file as string,'base64')>MAX_FILE_BYTES)invalid('文件不能超过 8 MB',413);
  boundedSnapshot(projectId);
  const before=drafts.view(projectId,body,context),captured={executionRevision:store.revision(projectId),projectVersion:before.project.version,actorUid:context.actorUid};
  return {projectId,body:structuredClone(body),captured,task:{kind:'preview',projectId,body:structuredClone(body),before,...(body.format!=='xml'?{signingKey:signingKey()}:{})} as Extract<FileTask,{kind:'preview'}>};
 }
 function unchanged(prepared:{projectId:string;body:any;captured:{executionRevision:number;projectVersion:number;actorUid?:string}},context:WriteContext){
  const latest=drafts.view(prepared.projectId,prepared.body,context);
  if(context.actorUid!==prepared.captured.actorUid||latest.project.version!==prepared.captured.projectVersion||store.revision(prepared.projectId)!==prepared.captured.executionRevision)invalid('文件处理期间项目或执行计划已更新，请重新预览核对',409);
 }
 function importRow(projectId:string,previewId:string,actorUid:string){
  const size=store.db.prepare('SELECT length(CAST(payload AS BLOB)) AS bytes FROM timing_imports WHERE id=? AND project_id=? AND actor_uid=?').get(previewId,projectId,actorUid);
  if(Number(size?.bytes??0)>MAX_JOB_BYTES)invalid('预览超出文件任务容量，请重新生成预览',413);
  return store.db.prepare('SELECT * FROM timing_imports WHERE id=? AND project_id=? AND actor_uid=?').get(previewId,projectId,actorUid) as any;
 }
 function finishPreview(prepared:ReturnType<typeof preparePreview>,computed:ReturnType<typeof computePreview>,context:WriteContext,beforeCommit?:()=>void){
  return store.transaction(()=>{
   unchanged(prepared,context);
   const {result,tasks}=computed;
   if(!result.issues.length&&!result.requiresMapping){
    const id=randomUUID(),expires=new Date(Date.now()+24*3600000).toISOString(),{projectId,body}=prepared,payload=JSON.stringify(tasks);beforeCommit?.();
    drafts.check(projectId,body,context);
    store.db.prepare('DELETE FROM timing_imports WHERE result IS NULL AND expires_at<?').run(new Date().toISOString());
    store.db.prepare('INSERT INTO timing_imports(id,project_id,actor_uid,revision,project_version,expires_at,payload,draft_id,lease_token) VALUES(?,?,?,?,?,?,?,?,?)').run(id,projectId,context.actorUid!,result.revision,result.projectVersion,expires,payload,body.draftId as string,body.leaseToken as string);result.previewId=id;
   }
   return result;
  });
 }
 function preview(projectId:string,value:unknown,context:WriteContext){
  const body=objectInput(value);
  const prepared=preparePreview(projectId,body,context),computed=computePreview(prepared.task);
  return finishPreview(prepared,computed,context);
 }
 function confirm(projectId:string,value:unknown,context:WriteContext,precomputed?:Task[],beforeCommit?:()=>void){
  const body=objectInput(value);if(typeof body.previewId!=='string')invalid('请先生成并核对导入预览');
  const row=importRow(projectId,body.previewId as string,context.actorUid!);if(!row)invalid('预览不存在，请重新上传核对',404);
  drafts.check(projectId,body,context);
  if(row.lease_token!==body.leaseToken||row.draft_id!==body.draftId)invalid('预览不属于当前编辑会话，请重新生成预览',409);
  if(row.result)return {...JSON.parse(row.result),replayed:true,removed:[]};
  if(row.expires_at<new Date().toISOString())invalid('导入预览已过期，请重新上传核对',409);
  const before=drafts.view(projectId,body,context);
  if(before.project.taskRevision!==row.revision||before.project.version!==row.project_version)invalid('预览后草稿已更新，请重新生成预览并核对',409);
  let result:any;
  const committed=()=>{
   result={revision:drafts.state(projectId).draft!.revision,replayed:false};
   store.db.prepare("UPDATE timing_imports SET result=?,payload='[]' WHERE id=?").run(JSON.stringify(result),row.id);
  };
  const commitCheck=()=>{beforeCommit?.();if(row.expires_at<new Date().toISOString())invalid('导入预览已过期，请重新上传核对',409);};
  if(precomputed)drafts.savePrepared(projectId,precomputed,body,context,committed,commitCheck);else drafts.save(projectId,JSON.parse(row.payload) as Task[],body,context,committed);
  return {...result,removed:[]};
 }
 function prepareConfirm(projectId:string,value:unknown,context:WriteContext){
  boundedSnapshot(projectId);
  const body=structuredClone(objectInput(value));if(typeof body.previewId!=='string')invalid('请先生成并核对导入预览');
  const row=importRow(projectId,body.previewId as string,context.actorUid!);
  if(!row)invalid('预览不存在，请重新上传核对',404);
  drafts.check(projectId,body,context);
  if(row.lease_token!==body.leaseToken||row.draft_id!==body.draftId)invalid('预览不属于当前编辑会话，请重新生成预览',409);
  if(row.result)return {receipt:confirm(projectId,body,context)};
  if(Buffer.byteLength(String(row.payload))>MAX_JOB_BYTES)invalid('预览超出文件任务容量，请重新生成预览',413);
  if(row.expires_at<new Date().toISOString())invalid('导入预览已过期，请重新上传核对',409);
  const before=drafts.view(projectId,body,context);
  if(before.project.taskRevision!==row.revision||before.project.version!==row.project_version)invalid('预览后草稿已更新，请重新生成预览并核对',409);
  return {prepared:{projectId,body,payload:String(row.payload),captured:{executionRevision:store.revision(projectId),projectVersion:before.project.version,actorUid:context.actorUid}},task:{kind:'confirm',tasks:JSON.parse(row.payload)} as Extract<FileTask,{kind:'confirm'}>};
 }
 function finishConfirm(prepared:NonNullable<ReturnType<typeof prepareConfirm>['prepared']>,tasks:Task[],context:WriteContext,beforeCommit?:()=>void){
  const row=importRow(prepared.projectId,prepared.body.previewId as string,context.actorUid!);
  if(!row)invalid('预览不存在，请重新上传核对',404);
  // A concurrent identical confirmation may have committed while this job was running.
  if(!row.result){unchanged(prepared,context);if(row.payload!==prepared.payload)invalid('预览内容已变化，请重新生成预览',409);}
  return confirm(prepared.projectId,prepared.body,context,tasks,beforeCommit);
 }
 return {exportPlan,preview,confirm,prepareExport,preparePreview,finishPreview,prepareConfirm,finishConfirm};
}
