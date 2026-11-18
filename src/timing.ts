import {taskIndex} from '/task-index.js';
import { DAY, iso, dateValue, nextWorkday, finish, workdays, isWorkday } from '/schedule.js';
import { EditDraft, ReadGuard, EditTransition, TimingRecovery } from '/drafts.js';
import { TimingHistory } from '/timing-history.js';
import { TimingLayout, readLayoutPreference } from '/timing-layout.js';
import type { TimingVersion } from '../lib/timing-versions.ts';
import type { Task } from '../lib/schedule.ts';
import type {TimingSnapshot,TaskMutationResponse,DraftMetadata,EditorLease} from './timing-types.ts';
type Options={projectId:string;user:any;settings:any;login:()=>void;editProject:()=>void;manageMembers:(editable:boolean)=>void};
type Row={task:Task;wbs:string;depth:number};
const escape=(v:any='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const today=()=>new Date().toLocaleDateString('sv-SE');
let controller:AbortController|undefined;
export function unmountTiming(){controller?.abort();controller=undefined;}
const viewStates=new Map<string,{collapsed:Set<string>;zoom:string;start:number|null}>();

type TimeBounds={start:number;days:number;scale:number;width:number};
export function scrollableProjectBounds(tasks:Pick<Task,'start'|'end'>[],zoom:string,availableWidth:number,fallback:string,anchor:number|null=null):TimeBounds {
 const scale=zoom==='day'?32:zoom==='week'?12:5,minimum=zoom==='day'?90:zoom==='week'?180:365;
 const viewportDays=Math.ceil(Math.max(1,Number.isFinite(availableWidth)?availableWidth:1)/scale);
 let first=Infinity,last=-Infinity;
 for(const task of tasks){const range=taskRange(task);if(range){first=Math.min(first,range[0]);last=Math.max(last,range[1]);}}
 if(!Number.isFinite(first)){try{first=dateValue(fallback);}catch{first=dateValue(today());}last=first;}
 const focus=anchor!==null&&Number.isFinite(anchor)?anchor:first-7*DAY;
 let start=Math.min(first-7*DAY,focus);start-=((new Date(start).getUTCDay()+6)%7)*DAY;
 // Keep day spacing unchanged, include the full plan and an end-day margin.
 // A small scrollable margin also keeps navigation usable on very wide displays.
 const days=Math.max(minimum,viewportDays+14,Math.ceil((last-start)/DAY)+8,Math.ceil((focus-start)/DAY)+viewportDays+7);
 return {start,days,scale,width:days*scale};
}
function taskRange(task:Pick<Task,'start'|'end'>):[number,number]|null {
 try{if(task.start&&task.end){const start=dateValue(task.start),end=dateValue(task.end);if(end>=start)return [start,end];}}catch{/* Invalid or incomplete dates remain unscheduled. */}
 return null;
}
export function fitProjectBounds(tasks:Pick<Task,'start'|'end'>[],availableWidth:number,fallback:string):TimeBounds {
 let first=Infinity,last=-Infinity;
 for(const task of tasks){const range=taskRange(task);if(range){first=Math.min(first,range[0]);last=Math.max(last,range[1]);}}
 if(!Number.isFinite(first)){try{first=dateValue(fallback);}catch{first=dateValue(today());}last=first;}
 const width=Math.max(1,Math.floor(Number.isFinite(availableWidth)?availableWidth:1));
 // Include the entire end day; reserve both date padding and room for a milestone diamond.
 const span=(last-first)/DAY+1,inset=Math.min(16,width/4);
 const padding=Math.max(1,Math.ceil(span*.025),Math.ceil(span*inset/(width-inset*2)));
 const days=span+padding*2,scale=width/days;
 return {start:first-padding*DAY,days,scale,width};
}
export function projectTicks({start,days,scale}:TimeBounds){
 const choices=[{unit:'day',step:1,days:1,min:40},{unit:'week',step:1,days:7,min:56},{unit:'month',step:1,days:28,min:48},{unit:'month',step:3,days:90,min:56}];
 const choice=choices.find(c=>c.days*scale>=c.min)||{unit:'year',step:[1,2,5,10,20,50,100,200].find(n=>n*365*scale>=72)||200,days:365,min:64};
 const date=new Date(start),end=start+days*DAY;
 let cursor:number;
 if(choice.unit==='year')cursor=Date.UTC(Math.floor(date.getUTCFullYear()/choice.step)*choice.step,0,1);
 else if(choice.unit==='month')cursor=Date.UTC(date.getUTCFullYear(),Math.floor(date.getUTCMonth()/choice.step)*choice.step,1);
 else{cursor=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate());if(choice.unit==='week')cursor-=((date.getUTCDay()+6)%7)*DAY;}
 const ticks:{left:number;width:number;label:string}[]=[];
 while(cursor<end){
  const d=new Date(cursor);
  const next=choice.unit==='year'?Date.UTC(d.getUTCFullYear()+choice.step,0,1):choice.unit==='month'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+choice.step,1):cursor+(choice.unit==='week'?7:1)*DAY;
  const left=(Math.max(start,cursor)-start)/DAY*scale,width=(Math.min(end,next)-Math.max(start,cursor))/DAY*scale;
  const label=choice.unit==='year'?`${d.getUTCFullYear()}年`:choice.unit==='month'?(choice.step===3?`Q${Math.floor(d.getUTCMonth()/3)+1}`:`${d.getUTCMonth()+1}月`):`${d.getUTCMonth()+1}/${d.getUTCDate()}`;
  ticks.push({left,width,label:width>=choice.min?label:''});cursor=next;
 }
 const firstYear=new Date(start).getUTCFullYear(),lastYear=new Date(end-1).getUTCFullYear();
 return {yearLabel:firstYear===lastYear?`${firstYear}年`:`${firstYear}年 — ${lastYear}年`,ticks};
}
type TaskDraft=EditDraft<Task>&{inputs?:Record<string,string|string[]>};
const editors=new Map<string,TaskDraft>();
export async function mountTiming(options:Options){
 document.body.classList.add('timing-workspace');
 controller?.abort();controller=new AbortController();const signal=controller.signal;
 const root=document.querySelector('#app')!;
 const {projectId,user,settings,login,editProject}=options;
 let canEdit=false,canUpload=false,canDeleteFile=false,canProjectEdit=false,canManage=false,canViewMembers=false;
 const editKey=(user?.id||'guest')+':'+projectId;
 let edit=editors.get(editKey);
 let storage:Storage|undefined;try{storage=sessionStorage;}catch{/* Recovery still survives remounts in memory. */}
 const recovery=new TimingRecovery<Task>(user?.id||'guest',projectId,storage),navigation=new EditTransition();
 const recovered=user?recovery.read():undefined;
 if(recovered?.drawer){edit=Object.assign(new EditDraft(recovered.drawer.value,recovered.drawer.version).requireSave(),{inputs:recovered.drawer.inputs});editors.set(editKey,edit);}
 let snapshot:TimingSnapshot, busy=false,selected:string|null=edit?.value.id||null;
 let historical:string|null=null, savedVersion:TimingVersion|undefined;
 let editRequests=new AbortController();
 let leaseToken='',leaseUntil=0,hasEditPermission=false,sharedDraft:DraftMetadata|null|undefined,editorInfo:EditorLease|null|undefined;
 let saveError='',autoTimer:ReturnType<typeof setTimeout>|undefined,activeWrite:Promise<boolean>|undefined,transition=false;
 const pendingInline=new Map<string,Record<string,any>>(recovered?.inline||[]);
 let recoveryRequired=!!recovered||!!edit?.dirty,refreshRequired=false,adoptionUncertain=false;
 let drawerHidden=false;
 const setEdit=(value:TaskDraft|undefined)=>{edit=value;if(value)editors.set(editKey,value);else editors.delete(editKey);};
 function preserveInputs(){
  if(!user)return;
  if(edit?.dirty||pendingInline.size)recovery.write({savedAt:new Date().toISOString(),inline:[...pendingInline],...(edit?.dirty?{drawer:{value:edit.value,version:edit.version,inputs:edit.inputs}}:{})});
  else recovery.clear();
 }
 const reads=new ReadGuard();
 let attachmentBusy=false, scroll={left:0,right:0,top:0};
 let fitWidth=1,dragActive=false;
 let endPan:(()=>void)|undefined;
 const layoutKey='project-station:timing-layout:v1:'+encodeURIComponent(editKey);
 let storedLayout:string|null=null;try{storedLayout=localStorage.getItem(layoutKey);}catch{/* Storage may be unavailable. */}
 const layoutPreference=readLayoutPreference(storedLayout);
 const saveLayout=()=>{try{localStorage.setItem(layoutKey,JSON.stringify(layoutPreference));}catch{/* Keep the session preference when storage is blocked. */}};
 let layout:TimingLayout|undefined;
 let timelineEvents:AbortController|undefined;
 let renderEvents:AbortController|undefined,boundWorkflow:Element|null=null;
 const resizeObserver=new ResizeObserver(()=>adaptTimeline());
 signal.addEventListener('abort',()=>{endPan?.();resizeObserver.disconnect();layout?.destroy();timelineEvents?.abort();renderEvents?.abort();},{once:true});
 const state=viewStates.get(projectId)||{collapsed:new Set<string>(),zoom:'week',start:null};viewStates.set(projectId,state);
 const notify=(message:string)=>{const node=document.querySelector('#toast')!;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),3500);};
 const shell=(content:string)=>`<div class="timing-app"><header class="station-header"><a class="timing-brand" href="/"><span class="station-logo">P<span>.</span></span><span>Project Station<small>PLAN · ALIGN · DELIVER</small></span></a><nav class="station-nav"><a href="/">项目空间</a><a href="/#articles">Lesson Learn</a><a href="/#team">团队</a></nav><div class="station-account"><span class="green-dot"></span>${escape(user?.name||'访客')}<span class="role-chip">${user?({admin:'管理员',editor:'编辑者',viewer:'只读成员'}[user.role]):'尚未登录'}</span></div></header>${content}</div>`;
 if(!user){root.innerHTML=shell('<main class="timing-gate"><span class="gate-icon">▦</span><div class="eyebrow">PROJECT TIMING</div><h1>登录，进入项目工作空间。</h1><p>项目排期与附件仅对登录成员开放。</p><button class="primary" id="timing-login">登录并继续 →</button><a href="/">返回项目列表</a></main>');document.querySelector('#timing-login')!.addEventListener('click',login,{signal});return;}
 root.innerHTML=shell('<main class="timing-gate"><p>正在载入项目排期…</p></main>');
 async function request(path:string,body?:any,method='POST'){
  const requestSignal=body&&(path.includes('/tasks')||path.endsWith('/adopt'))?AbortSignal.any([signal,editRequests.signal]):signal;
  const actorHeaders={'X-Timing-Actor':user.id,...(leaseToken?{'X-Timing-Lease':leaseToken}:{})};
  const response=await fetch('/api/'+path,body?{method,headers:{'Content-Type':'application/json',...actorHeaders},body:JSON.stringify(body),signal:requestSignal}:{headers:actorHeaders,signal});
  const result=await response.json();
  if(result.identityChanged&&!signal.aborted){
   // Retain the old UID's recovery, but remove its values from a tab now using another account's cookies.
   captureDraft();preserveInputs();controller?.abort();
   root.innerHTML='<main class="timing-gate"><h1>登录账号已变化</h1><p>原账号的本地输入已单独保留。请刷新页面，使用当前账号继续。</p><a href="'+escape(location.pathname)+'">刷新页面</a></main>';
  }
  if(!response.ok)throw Object.assign(Error(result.error+(result.requestId?`（请求 ${result.requestId}）`:"")),{status:response.status});return result;
 }
 const history=new TimingHistory({projectId,signal,notify,capture:captureDraft,session:()=>({leaseToken,draftId:sharedDraft?.id,revision:snapshot?.revision}),canImport:()=>canEdit,flush:async()=>{await ensureDraft();return flushInputs();},
   context:()=>({revision:snapshot?.executionRevision??snapshot?.revision??0,projectVersion:snapshot?.project.version??0,canSave:hasEditPermission&&!leaseToken,canDelete:hasEditPermission,historical,version:savedVersion,dirty:!!edit?.dirty}),
   showPlan:async target=>{
    await navigation.run(async()=>{
     if(transition||busy||attachmentBusy)return false;
     captureDraft();if(!await flushInputs())return false;
     // Read before releasing ownership or changing selection; a failed read leaves the view intact.
     await load(target);if(target)await releaseLease();return true;
    });
   },
 });
 async function load(target=historical,previous?:any){const current=reads.begin(()=>!signal.aborted);const result=await request(`projects/${projectId}/timing${target?'/versions/'+target:''}`);if(!current())return;
   const latest=target?{project:result.plan.project,tasks:result.plan.tasks,schedulePolicy:result.plan.schedulePolicy,attachments:[],revision:result.version.revision,members:[],capabilities:[]}:result;
   if(target!==historical){selected=target?null:edit?.value.id||null;drawerHidden=!!target;scroll={left:0,right:0,top:0};state.start=null;state.collapsed.clear();}
   historical=target;savedVersion=target?result.version:undefined;snapshot=latest;
   if(!target){sharedDraft=result.draft;editorInfo=result.editor;refreshRequired=false;if(adoptionUncertain)saveError='';adoptionUncertain=false;}
   if(!target)hasEditPermission=latest.capabilities.includes('timingEdit');canEdit=!target&&hasEditPermission&&!!leaseToken&&!recoveryRequired;canUpload=latest.capabilities.includes('attachmentUpload');canDeleteFile=latest.capabilities.includes('attachmentDelete');canProjectEdit=latest.capabilities.includes('projectEdit');canManage=latest.capabilities.includes('membersManage');canViewMembers=latest.capabilities.includes('membersRead');
   if(!historical&&edit&&!edit.dirty&&edit.value.id){const latest=snapshot.tasks.find((t:Task)=>t.id===edit!.value.id);if(latest)setEdit(new EditDraft(latest,snapshot.revision));}
   if(!previous||!patchSavedSnapshot(previous))render();
 }
 function rows(all=false):Row[]{return taskTree().rows(all?undefined:state.collapsed);}
 function rememberScroll(){const left=document.querySelector<HTMLElement>('.task-pane'),right=document.querySelector<HTMLElement>('.timeline-pane');if(left&&!left.hidden){scroll.left=left.scrollLeft;scroll.top=left.scrollTop;}if(right&&!right.hidden){scroll.right=right.scrollLeft;scroll.top=right.scrollTop;}}
 type FocusState={selector:string;start:number|null;end:number|null};
 let pendingFocus:FocusState|null=null;
 function activeFocus():FocusState|null {
  const active=document.activeElement as HTMLInputElement|null;
  return active?.dataset.inline?{selector:'[data-inline="'+active.dataset.inline+'"][data-task="'+active.dataset.task+'"]',start:active.selectionStart,end:active.selectionEnd}:active?.closest('#task-form')&&active.name?{selector:'#task-form [name="'+active.name+'"]',start:active.selectionStart,end:active.selectionEnd}:null;
 }
 function saveStatusText(){return historical?'':adoptionUncertain?'采用结果未确认 · 请刷新核对执行计划':refreshRequired?'写入已确认 · 最新数据读取失败，请刷新核对':recoveryRequired?'本地未提交输入已保留 · 重新进入编辑后比较恢复':busy?'正在保存…':saveError?'保存失败 · 输入已保留':edit?.dirty||pendingInline.size?'本地输入待保存':leaseToken?(sharedDraft?'共享草稿已保存'+(sharedDraft.savedAt?' · '+new Date(sharedDraft.savedAt).toLocaleTimeString('zh-CN'):''):'执行计划已保存'):'';}
 function updateSaveStatus(){const status=document.querySelector<HTMLElement>('.save-state');if(status){status.textContent=saveStatusText();status.hidden=!status.textContent;}}
 const lockedNodes=new Map<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement,{disabled:boolean;readOnly:boolean}>();
 function unlockEditing(){for(const [node,before] of lockedNodes)if(node.isConnected){node.disabled=before.disabled;if('readOnly' in node)node.readOnly=before.readOnly;}lockedNodes.clear();}
 function lockEditing(){
  pendingFocus=activeFocus()||pendingFocus;
  // Capture guards block all edits/actions while pending. Mutating thousands of readonly/
  // disabled attributes made Chrome recalculate the whole table on each save.
  // Only the focused text control needs readonly to retain its caret and native selection.
  const active=document.activeElement as HTMLInputElement|null;
  if(active&&root.contains(active)&&'readOnly' in active){if(!lockedNodes.has(active))lockedNodes.set(active,{disabled:active.disabled,readOnly:active.readOnly});active.readOnly=true;}
 }
 function mutate(taskId:string|undefined,body:any,method='PATCH',source:'inline'|'drawer'='inline'):Promise<boolean>{
  if(activeWrite)return Promise.resolve(false);
  const operation=performMutation(taskId,body,method,source);activeWrite=operation;
  void operation.finally(()=>{if(activeWrite===operation)activeWrite=undefined;});return operation;
 }
 async function ensureDraft(){
  if(!leaseToken||Date.now()>=leaseUntil){loseSession('编辑占用已过期，请重新进入编辑');throw Error('请重新进入编辑');}
  if(!sharedDraft){const result=await request('projects/'+projectId+'/timing/draft/start',{leaseToken});sharedDraft=result.draft;snapshot.revision=result.draft.revision;snapshot.tasks=result.plan.tasks;}
 }
 async function performMutation(taskId:string|undefined,body:any,method='PATCH',source:'inline'|'drawer'='inline'){
  if(historical||!canEdit)return false;
  if(busy){notify('正在保存。本次操作未提交，请等待后重试。');return false;}
  const beforeWrite=snapshot;let viewUpdated=false;busy=true;reads.invalidate();rememberScroll();lockEditing();updateSaveStatus();
  try{
   await ensureDraft();
   const result:TaskMutationResponse=await request(`projects/${projectId}/tasks${taskId?'/'+taskId:''}`,{...body,revision:snapshot.revision,draftId:sharedDraft!.id,leaseToken},method);
   if(signal.aborted)return false;
   snapshot={...snapshot,tasks:result.tasks,revision:result.revision,project:result.project||snapshot.project};sharedDraft=result.draft;saveError='';
   if(source==='inline'&&taskId)pendingInline.delete(taskId);
   if(source==='drawer'){selected=method==='DELETE'?null:result.id||selected;setEdit(undefined);}
   preserveInputs();
   try{await load(historical,beforeWrite);viewUpdated=true;refreshRequired=false;}catch{refreshRequired=true;notify('共享草稿已保存，但重新读取失败；请刷新核对。');return true;}
   return true;
  }catch(error:any){
   if(error.name!=='AbortError'){
    saveError=error.message;
    if(error.status===409||error.status===401||error.status===403||error instanceof TypeError)loseSession(error.message);
    if(source==='drawer')edit?.fail(error.message+'；本地输入已保留。');
    preserveInputs();notify(error.message+'；本地输入已保留。');
   }
   return false;
  }finally{busy=false;if(viewUpdated){unlockEditing();updateSaveStatus();}else{unlockEditing();render();}}
 }
 function queueAutosave(){
  clearTimeout(autoTimer);if(canEdit&&!busy&&!saveError&&!refreshRequired)autoTimer=setTimeout(()=>void flushInputs(),800);
 }
 async function flushInputs():Promise<boolean>{
  clearTimeout(autoTimer);if(activeWrite)await activeWrite;
  if(recoveryRequired||refreshRequired||adoptionUncertain)return false;
  if(!canEdit)return !edit?.dirty&&!pendingInline.size;
  captureDraft();clearTimeout(autoTimer);
  // Validate all changed inputs before any partial batch. Unchanged server values were
  // already validated; asking Chrome to validate thousands of untouched controls here
  // blocks typing while the next autosave starts.
  const changedInputs:HTMLInputElement[]=[];
  for(const [id,fields] of pendingInline)for(const field of Object.keys(fields)){const input=root.querySelector<HTMLInputElement>('[data-inline="'+field+'"][data-task="'+CSS.escape(id)+'"]');if(input)changedInputs.push(input);}
  const invalidInput=changedInputs.find(input=>!input.disabled&&!input.checkValidity());
  const form=document.querySelector<HTMLFormElement>('#task-form');
  if(invalidInput||(edit?.dirty&&form&&!form.checkValidity())){saveError='请补全任务输入';updateSaveStatus();preserveInputs();return false;}
  for(const [,raw] of pendingInline)for(const field of ['duration','progress'])if(field in raw&&(raw[field]===''||!Number.isFinite(Number(raw[field])))){
   saveError='请补全任务输入';preserveInputs();updateSaveStatus();return false;
  }
  for(const [id,raw] of [...pendingInline]){
   const body={...raw};for(const field of ['duration','progress'])if(field in body)body[field]=Number(body[field]);
   for(const field of ['start','end'])if(field in body&&!body[field])body[field]=null;
   if(!await mutate(id,body))return false;
  }
  if(edit?.dirty){const form=document.querySelector<HTMLFormElement>('#task-form');if(form&&!form.reportValidity()){saveError='请补全任务输入';updateSaveStatus();return false;}
   const values:Partial<Task>=form?readTaskForm(form):{...edit.value};delete values.end;if(!edit.value.id)delete values.order;
   if(!await mutate(edit.value.id||undefined,values,edit.value.id?'PATCH':'POST','drawer'))return false;
  }
  return !saveError&&!refreshRequired;
 }
 function loseSession(message:string){
  captureDraft();preserveInputs();recoveryRequired=!!edit?.dirty||!!pendingInline.size;
  const old=leaseToken;editRequests.abort();leaseToken='';leaseUntil=0;canEdit=false;clearTimeout(autoTimer);reads.invalidate();
  if(old)void fetch('/api/projects/'+projectId+'/timing/draft/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leaseToken:old}),keepalive:true}).catch(()=>{});
  saveError=message;notify(message+'；本地输入已保留，重新进入编辑后比较恢复。');if(!busy)render();
 }
 function releaseOnLeave(){
  captureDraft();preserveInputs();
  clearTimeout(autoTimer);if(!leaseToken)return;
  const old=leaseToken;leaseToken='';canEdit=false;
  void fetch('/api/projects/'+projectId+'/timing/draft/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leaseToken:old}),keepalive:true}).catch(()=>{});
 }
 async function releaseLease(){
  const old=leaseToken;leaseToken='';leaseUntil=0;canEdit=false;clearTimeout(autoTimer);
  if(old)try{await request('projects/'+projectId+'/timing/draft/release',{leaseToken:old});}catch{/* Expiry releases a request that cannot reach the server. */}
 }
 async function exitEditing(){
  return navigation.run(async()=>{
   if(transition||busy||attachmentBusy||!await flushInputs())return false;
   await releaseLease();if(!edit?.dirty)setEdit(undefined);await load(null);return true;
  });
 }
 function chooseDraft():Promise<'archive'|'discard'|undefined>{
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='timing-draft-choice';
   dialog.innerHTML='<h3>已有待采用草稿</h3><p>切换历史起点前，请选择如何处理当前共享草稿。</p><div class="history-actions"><button class="small-btn" data-choice="archive">保留草稿为历史版本并切换</button><button class="small-btn" data-choice="discard">放弃草稿并切换</button><button class="small-btn" data-choice="cancel">取消</button></div>';
   const done=(value?:'archive'|'discard')=>{dialog.close();dialog.remove();resolve(value);};
   dialog.addEventListener('cancel',e=>{e.preventDefault();done();},{once:true});
   dialog.querySelectorAll<HTMLElement>('[data-choice]').forEach(b=>b.addEventListener('click',()=>done(b.dataset.choice==='cancel'?undefined:b.dataset.choice as 'archive'|'discard'),{once:true}));
   document.body.append(dialog);dialog.showModal();
  });
 }
 function compareRecovery():Promise<'restore'|'discard'|undefined>{
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='timing-draft-choice timing-recovery';
   const local={inline:[...pendingInline],drawer:edit?.dirty?{value:edit.value,inputs:edit.inputs}:undefined};
   const ids=new Set([...pendingInline.keys(),...(edit?.value.id?[edit.value.id]:[])]);
   const latest=snapshot.tasks.filter((task:Task)=>ids.has(task.id));
   const missing=[...ids].filter(id=>!latest.some((task:Task)=>task.id===id));
   const labels:Record<string,string>={title:'任务名称',kind:'任务类型',parentId:'所属阶段',owner:'负责人',start:'开始日期',end:'结束日期',duration:'工期',progress:'完成度',status:'状态',notes:'备注',predecessors:'前置任务'};
   const display=(field:string,value:any):string=>{
    if(value==null||value==='')return '（空）';
    if(field==='parentId'||field==='predecessors'){const name=(id:string)=>snapshot.tasks.find((task:Task)=>task.id===id)?.title||'原任务已不存在';return Array.isArray(value)?value.map(name).join('、')||'无':name(value);}
    if(field==='kind')return ({summary:'汇总阶段',task:'普通任务',milestone:'里程碑'} as any)[value]||String(value);
    return String(value);
   };
   const comparisons=[...ids,...(local.drawer&&!local.drawer.value.id?['']:[])].map(id=>{
    const task=latest.find((task:Task)=>task.id===id),drawer=local.drawer?.value.id===id?local.drawer:undefined;
    const values={...(drawer?{...drawer.value,...drawer.inputs}:{}),...pendingInline.get(id)} as Record<string,any>;
    return '<section><h4>'+escape(task?.title||drawer?.value.title||'新建任务')+'</h4><table><thead><tr><th>字段</th><th>本地未提交输入</th><th>最新共享草稿</th></tr></thead><tbody>'+Object.entries(values).filter(([field])=>field in labels).map(([field,value])=>'<tr><th>'+labels[field]+'</th><td>'+escape(display(field,value))+'</td><td>'+escape(task?display(field,task[field]):'任务不存在')+'</td></tr>').join('')+'</tbody></table></section>';
   }).join('');
   dialog.innerHTML='<h3>比较本地未提交输入</h3><p>已取得新的编辑占用并读取最新共享草稿（修订 '+escape(snapshot.revision)+'）。共享草稿尚未采用为正式执行计划。恢复只填回本地输入，请核对后手动保存。</p><div class="recovery-comparisons">'+comparisons+'</div>'+(missing.length?'<p role="alert">原任务已删除，不能恢复覆盖或自动新建。请复制需要保留的输入后再选择放弃。</p>':'')+'<div class="history-actions"><button class="small-btn" data-recovery="restore" '+(missing.length?'disabled':'')+'>恢复到本地输入，稍后手动保存</button><button class="small-btn" data-recovery="discard">放弃本地输入，使用最新数据</button><button class="small-btn" data-recovery="cancel">暂不处理，保留输入</button></div>';
   let done=false;const finish=(choice?:'restore'|'discard')=>{if(done)return;done=true;dialog.close();dialog.remove();signal.removeEventListener('abort',abort);resolve(choice);};
   const abort=()=>finish();signal.addEventListener('abort',abort,{once:true});
   dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
   dialog.querySelectorAll<HTMLElement>('[data-recovery]').forEach(button=>button.addEventListener('click',()=>finish(button.dataset.recovery==='cancel'?undefined:button.dataset.recovery as 'restore'|'discard')));
   document.body.append(dialog);dialog.showModal();
  });
 }
 async function enterEditing(sourceVersion?:string){
  if(transition||busy||navigation.pending)return;transition=true;
  try{
   // Cookies are shared by tabs. Re-authentication in another tab must not expose this UID's recovery.
   const identity=await request('session');
   if(identity.user?.id!==user.id){loseSession('登录账号已变化，请刷新页面后使用当前账号');location.reload();return;}
   captureDraft();preserveInputs();
   if(leaseToken&&!recoveryRequired&&!await flushInputs())return;
   const needsRecovery=recoveryRequired||!!edit?.dirty||!!pendingInline.size;
   const status=await request('projects/'+projectId+'/timing');sharedDraft=status.draft;editorInfo=status.editor;
   const source=needsRecovery?undefined:sourceVersion;
   const decision=source&&sharedDraft?await chooseDraft():undefined;if(source&&sharedDraft&&!decision)return;
   const result=await request('projects/'+projectId+'/timing/draft/start',{...(leaseToken?{leaseToken}:{}),...(source?{sourceVersion:source,decision,expectedDraftId:sharedDraft?.id,revision:sharedDraft?.revision}:{})});
   editRequests=new AbortController();leaseToken=result.leaseToken;leaseUntil=result.editor.expiresAt;sharedDraft=result.draft;editorInfo=result.editor;
   // Keep local values through both acquisition and the mandatory latest read.
   recoveryRequired=needsRecovery;await load(null);
   if(needsRecovery){
    const choice=await compareRecovery();
    if(!choice||!leaseToken||Date.now()>=leaseUntil){await releaseLease();render();return;}
    if(choice==='discard'){pendingInline.clear();setEdit(undefined);recovery.clear();selected=null;drawerHidden=true;}
    else{if(edit){edit.requireSave();edit.version=snapshot.revision;edit.latest=undefined;edit.message='已比较最新共享草稿；本地输入未提交，请核对后手动保存。';}drawerHidden=false;selected=edit?.value.id||selected;}
    recoveryRequired=false;canEdit=hasEditPermission;saveError='';preserveInputs();render();
    if(sourceVersion)notify('请先处理已恢复输入；本次没有切换历史起点。');
   }else{saveError='';setEdit(undefined);selected=null;drawerHidden=true;render();}
   if(source)history.invalidate();
  }catch(e:any){notify(e.message);if(leaseToken)loseSession(e.message);}finally{transition=false;}
 }
 async function adoptDraft(){
  if(adoptionUncertain){notify('上次采用结果未确认，请先刷新核对执行计划；不会自动重试。');return;}
  if(transition||navigation.pending||!leaseToken)return;transition=true;
  let submitted=false;
  try{
   if(!await flushInputs())return;
   if(!sharedDraft){notify('执行计划无变化');return;}
   busy=true;lockEditing();updateSaveStatus();
   submitted=true;const result=await request('projects/'+projectId+'/timing/draft/adopt',{leaseToken,draftId:sharedDraft.id,revision:snapshot.revision});
   sharedDraft=null;saveError='';setEdit(undefined);pendingInline.clear();preserveInputs();
   history.invalidate();
   try{await load(null);notify(result.changed?'已保存为执行计划 · V'+result.sequence:'执行计划无变化，未新增版本');}
   catch{refreshRequired=true;notify('采用已确认，但重新读取失败；请刷新核对执行计划。');}
  }catch(e:any){
   adoptionUncertain=submitted&&!Number.isInteger(e.status);saveError=e.message;
   if([401,403,409].includes(e.status)||adoptionUncertain)loseSession(e.message);
   if(adoptionUncertain)notify('采用响应未完整收到，结果未确认。请刷新核对执行计划；不会自动重试。');
   else notify(e.message+'；采用未成功，请核对当前状态后重试。');
  }finally{busy=false;transition=false;render();}
 }
 const heartbeatTimer=setInterval(async()=>{
  const token=leaseToken;if(!token){
   if(!busy&&!transition)try{const status=await request('projects/'+projectId+'/timing/draft');if(leaseToken)return;
    const changed=editorInfo?.actorUid!==status.editor?.actorUid||sharedDraft?.id!==status.draft?.id||sharedDraft?.savedAt!==status.draft?.savedAt;
    editorInfo=status.editor;sharedDraft=status.draft;
    if(changed){const node=document.querySelector('#timing-draft-workflow');if(node){node.outerHTML=workflowHtml();bindWorkflow();}}
   }catch{/* A read-only viewer can refresh after reconnecting. */}return;
  }
  if(Date.now()>=leaseUntil){loseSession('编辑占用已过期');return;}
  try{const result=await request('projects/'+projectId+'/timing/draft/heartbeat',{leaseToken:token});if(leaseToken===token){leaseUntil=result.editor.expiresAt;editorInfo=result.editor;}}
  catch(e:any){if(leaseToken===token)loseSession(e.message);}
 },8000);
 signal.addEventListener('abort',()=>{clearInterval(heartbeatTimer);releaseOnLeave();},{once:true});
 window.addEventListener('pagehide',releaseOnLeave,{signal});
 window.addEventListener('offline',()=>{if(leaseToken)loseSession('网络已断开，编辑占用将释放');},{signal});
 window.addEventListener('online',()=>{if(!leaseToken)void load(null).catch(()=>{});},{signal});
 function workflowHtml(){
  const source=sharedDraft?escape(sharedDraft.sourceLabel)+' · 修订 '+sharedDraft.sourceRevision:'最新执行计划';
  const panels=history.panelState?.()??{versions:false,files:false};
  const title=historical?escape(savedVersion?.name||'历史计划'):leaseToken?'正在编辑草稿':'当前执行计划';
  const detail=historical?escape(savedVersion?.actorName||'')+' · '+escape(new Date(savedVersion!.savedAt).toLocaleString('zh-CN')):leaseToken?'来源：'+source:editorInfo&&editorInfo.expiresAt>Date.now()?escape(editorInfo.actorName)+' 正在编辑':sharedDraft?'共享草稿可继续 · '+escape(sharedDraft.actorName)+' · '+escape(new Date(sharedDraft.savedAt).toLocaleString('zh-CN')):'进入编辑后自动保存共享草稿';
  const primary=historical?(hasEditPermission?'<button class="primary compact" id="edit-from-history">基于此版本编辑</button>':''):leaseToken?'<button class="small-btn" id="exit-editing">退出编辑</button><button class="primary compact" id="adopt-draft">保存为执行计划</button>':hasEditPermission?'<button class="primary compact" id="enter-editing">编辑计划</button>':'';
  return '<div id="timing-draft-workflow" class="history-heading plan-preview-bar"><div class="plan-preview-summary"><div class="plan-preview-title"><span class="plan-preview-label">计划预览</span><b>'+title+'</b><span class="history-badge">'+(historical?'历史 · 只读':leaseToken?'共享草稿':'修订 '+(snapshot?.executionRevision??snapshot?.revision??0))+'</span></div><div class="plan-preview-meta"><small>'+detail+'</small><span class="save-state" role="status" '+(saveStatusText()?'':'hidden')+'>'+escape(saveStatusText())+'</span></div></div><div class="plan-preview-controls"><div class="history-actions plan-preview-tools">'+(historical?'<button class="small-btn" id="preview-current">返回执行计划</button>':'')+'<button class="small-btn '+(panels.versions?'chosen':'')+'" id="preview-versions" aria-controls="timing-history" aria-expanded="'+panels.versions+'">版本管理</button><button class="small-btn '+(panels.files?'chosen':'')+'" id="preview-files" aria-controls="timing-transfer" aria-expanded="'+panels.files+'">导出 / 导入</button></div>'+(primary?'<div class="history-actions plan-preview-edit">'+((saveError||pendingInline.size||edit?.dirty)&&leaseToken?'<button class="small-btn" id="retry-autosave">保存本地输入</button>':'')+primary+'</div>':'')+'</div></div>';
 }
 function readTaskForm(form:HTMLFormElement):Partial<Task>{
  const values=Object.fromEntries(new FormData(form)) as any;
  values.parentId=values.parentId||null;
  values.predecessors=Array.from((form.elements.namedItem('predecessors') as HTMLSelectElement)?.selectedOptions||[]).map(x=>x.value);
  for(const field of ['start','end'])if(values[field]!==undefined)values[field]=values[field]||null;
  for(const field of ['duration','progress'])if(values[field]!==undefined)values[field]=Number(values[field]);
  return values;
 }
 function captureDraft(event?:Event){
  if(event)saveError='';
  const form=document.querySelector('#task-form') as HTMLFormElement|null;
  if(!canEdit||busy||!form)return;
  if(!edit&&selected){const current=snapshot.tasks.find((t:Task)=>t.id===selected);if(current)setEdit(new EditDraft(current,snapshot.revision));}
  if(edit){
   edit.set({...edit.value,...readTaskForm(form)});
   edit.inputs={};for(const node of Array.from(form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('[name]'))){
    if(node.disabled)continue;edit.inputs[node.name]=node instanceof HTMLSelectElement&&node.multiple?Array.from(node.selectedOptions).map(option=>option.value):node.value;
   }
   if(edit.inputs.duration===''||edit.inputs.progress==='')edit.dirty=true;
   preserveInputs();updateSaveStatus();queueAutosave();
  }
 }
 async function leaveEditor(){
  if(busy||attachmentBusy){notify('正在保存或上传，请等待结果');return false;}
  if(historical)return true;
  if((edit?.dirty||pendingInline.size)&&!await flushInputs())return false;
  setEdit(undefined);preserveInputs();return true;
 }
 async function changeSelection(action:()=>void){
  return navigation.run(async()=>{if(transition||!await leaveEditor())return false;action();return true;});
 }
 async function closeEditor(){return changeSelection(()=>{selected=null;drawerHidden=true;renderDrawer();});}
 function bounds(){return state.zoom==='project'?fitProjectBounds(snapshot.tasks,fitWidth,snapshot.project.startDate||today()):scrollableProjectBounds(snapshot.tasks,state.zoom,fitWidth,snapshot.project.startDate||today(),state.start);}
 function focusDate(date:number){
  rememberScroll();state.start=date;const b=bounds();scroll.right=Math.max(0,(date-b.start)/DAY*b.scale);render();
 }
 function timelineHtml(visible:Row[],tasks:Task[]){
  const {start,days,scale,width}=bounds();
  const monthly:{name:string;count:number}[]=[];for(let i=0;state.zoom!=='project'&&i<days;i++){const date=new Date(start+i*DAY),name=`${date.getUTCFullYear()}年 ${String(date.getUTCMonth()+1).padStart(2,'0')}月`;const last=monthly.at(-1);if(last?.name===name)last.count++;else monthly.push({name,count:1});}
  const fit=state.zoom==='project'?projectTicks({start,days,scale,width}):null;
  const step=state.zoom==='day'?1:state.zoom==='week'?7:14;
  let ticks='';for(let i=0;state.zoom!=='project'&&i<days;i+=step){const date=new Date(start+i*DAY);ticks+=`<span style="width:${Math.min(step,days-i)*scale}px">${state.zoom==='day'?date.getUTCDate():`${date.getUTCMonth()+1}/${date.getUTCDate()}`}</span>`;}
  if(fit)ticks=fit.ticks.map(t=>`<span style="width:${t.width}px">${t.label}</span>`).join('');
  const bands=fit?`<span style="width:${width}px">${fit.yearLabel}</span>`:monthly.map(m=>`<span style="width:${m.count*scale}px">${m.name}</span>`).join('');
  const x=(date:string)=>((dateValue(date)-start)/DAY)*scale;
  const nodePositions=new Map(visible.map((r,i)=>[r.task.id,i]));let arrows='';
  for(const row of visible){const target=row.task;if(!target.start||(fit&&!taskRange(target)))continue;for(const dep of target.predecessors){const source=taskTree().byId.get(dep);if(!source?.end||(fit&&!taskRange(source))||!nodePositions.has(dep))continue;const x1=x(source.end)+scale,x2=x(target.start),y1=nodePositions.get(dep)!*44+22,y2=nodePositions.get(target.id)!*44+22;if(x1<0||x2>width)continue;const middle=Math.max(x1+10,Math.min(x2-9,x1+30));arrows+=`<path d="M ${x1} ${y1} H ${middle} V ${y2} H ${x2-3}" marker-end="url(#arrow)"/>`;}}
  const todayX=x(today());
  return `<div class="timeline-canvas ${fit?'project-timeline':''}" style="width:${width}px"><div class="time-header"><div class="month-bands">${bands}</div><div class="time-ticks">${ticks}</div></div><div class="timeline-rows" style="height:${visible.length*44}px;--day-width:${scale}px">${Array.from({length:fit&&scale<3?0:days},(_,i)=>!(historical?snapshot.schedulePolicy!.workweek.includes(new Date(start+i*DAY).getUTCDay()):isWorkday(start+i*DAY))?`<div class="weekend-band" style="left:${i*scale}px;width:${scale}px"></div>`:'').join('')}${fit?fit.ticks.slice(1).map(t=>`<div class="project-grid-line" style="left:${t.left}px"></div>`).join(''):''}${todayX>=0&&todayX<=width?`<div class="today-line" style="left:${todayX+scale/2}px"><span ${fit&&todayX>width-48?'style="left:auto;right:4px"':''}>今天</span></div>`:''}<svg class="dependency-lines" width="${width}" height="${visible.length*44}" aria-hidden="true"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6"/></marker></defs>${arrows}</svg>${visible.map((row,i)=>{const t=row.task;let bar='';if(t.start&&t.end&&(!fit||taskRange(t))){const left=x(t.start),right=x(t.end)+scale;const clampedLeft=Math.max(0,left),clampedRight=Math.min(width,right);if(clampedRight>clampedLeft){const summary=t.kind==='summary',milestone=t.kind==='milestone';bar=`<div class="gantt-bar ${summary?'summary-bar':milestone?'milestone-bar':'task-bar'} ${t.progress===100?'finished-bar':''} ${!summary&&t.end<(savedVersion?savedVersion.savedAt.slice(0,10):today())&&t.progress<100?'late-bar':''}" data-bar="${t.id}" tabindex="0" role="button" aria-label="${escape(t.title)} ${t.start} 至 ${t.end}，完成 ${t.progress}%" title="${escape(t.title)} · ${t.start} → ${t.end}" style="left:${milestone?clampedLeft+scale/2-7:clampedLeft}px;width:${milestone?14:Math.max(4,clampedRight-clampedLeft-2)}px">${canEdit&&!summary&&!milestone?'<span class="resize-handle start-handle" data-handle="start"></span>':''}${!milestone?`<span class="bar-fill" style="width:${t.progress}%"></span><span class="bar-text" ${fit&&summary?`style="max-width:${width-clampedLeft}px"`:''}>${escape(t.title)}${!summary?' · '+t.progress+'%':''}</span>`:''}${canEdit&&!summary&&!milestone?'<span class="resize-handle end-handle" data-handle="end"></span>':''}</div>`;}else bar=`<button class="offscreen-task" data-focus-date="${t.start}">${left<0?'←':'→'} ${escape(t.title)} · ${t.start}</button>`;}else bar=`<button class="unscheduled-task" data-select="${t.id}">${t.kind==='summary'?'添加子任务后自动汇总':'点击设置日期'} · 未排期</button>`;return `<div class="timeline-row ${t.kind==='summary'?'summary-timeline-row':''} ${selected===t.id?'selected-row':''}" data-timeline-row="${t.id}">${bar}</div>`;}).join('')}</div></div>`;
 }
 function labelDate(date:string|null){return date||'未排期';}

 let indexedTasks:Task[]|undefined,indexed:ReturnType<typeof taskIndex>,indexedRows:Map<string,Row>;
 let indexedAttachments:any,attachmentCount=new Map<string,number>();
 function taskTree(){if(indexedTasks!==snapshot.tasks){indexedTasks=snapshot.tasks;indexed=taskIndex(snapshot.tasks);indexedRows=new Map(indexed.rows().map(row=>[row.task.id,row]));}return indexed;}
 function rowById(){taskTree();return indexedRows;}
 function attachmentCounts(){if(indexedAttachments!==snapshot.attachments){indexedAttachments=snapshot.attachments;attachmentCount=new Map();for(const file of snapshot.attachments)attachmentCount.set(file.task_id,(attachmentCount.get(file.task_id)??0)+1);}return attachmentCount;}
 function rowHtml(row:Row){
   const t=row.task,summary=t.kind==='summary',files=attachmentCounts().get(t.id)??0;
   const disabled=(!canEdit&&!pendingInline.has(t.id))||summary?'disabled':'';
   const input=(field:string,value:any,type='text',extra='')=>`<input aria-label="${escape(row.wbs+' '+({title:'任务名称',owner:'负责人',start:'开始日期',end:'结束日期',duration:'工期',progress:'完成度'}[field]||field))}" data-inline="${field}" data-task="${t.id}" type="${type}" value="${escape(value??'')}" ${extra}>`;
   return `<tr class="${summary?'summary-row':''} ${selected===t.id?'selected-row':''}" data-row="${t.id}"><td><span class="wbs-number">${row.wbs}</span></td><td><div class="task-title-cell" style="padding-left:${row.depth*16}px">${summary?`<button class="fold-task" data-fold="${t.id}" aria-label="${state.collapsed.has(t.id)?'展开':'折叠'} ${escape(t.title)}">${state.collapsed.has(t.id)?'▸':'▾'}</button>`:`<span class="task-kind-symbol">${t.kind==='milestone'?'◆':'▱'}</span>`}<button class="task-name" data-select="${t.id}" title="查看或编辑任务">${escape(t.title)}</button>${canEdit&&t.kind!=='milestone'?`<button class="add-child" data-child="${t.id}" aria-label="添加 ${escape(t.title)} 的子任务">＋</button>`:''}</div></td><td>${input('owner',t.owner,'text',(canEdit||pendingInline.has(t.id))?'':'disabled')}</td><td>${input('start',t.start,'date',disabled)}</td><td>${input('end',t.end,'date',disabled)}</td><td>${input('duration',t.duration,'number',`${disabled||t.kind==='milestone'?'disabled':''} min="1" max="2600"`)}<span class="unit">天</span></td><td>${input('progress',t.progress,'number',`${disabled} min="0" max="100"`)}<span class="unit">%</span></td><td><button class="predecessor-cell" data-select="${t.id}">${t.predecessors.map(dep=>rowById().get(dep)?.wbs||'?').join(', ')||'—'}</button></td><td><button class="attachment-count" data-select="${t.id}" aria-label="${escape(t.title)} 附件">♧ ${files||'—'}</button></td></tr>`;
  }
 function metricsHtml(){const project=snapshot.project,tasks:Task[]=snapshot.tasks,leaves=tasks.filter(t=>t.kind!=='summary'),complete=leaves.filter(t=>t.progress===100).length,late=leaves.filter(t=>t.end&&t.end<(savedVersion?savedVersion.savedAt.slice(0,10):today())&&t.progress<100).length;return `<div class="timing-metrics"><div><span>整体进度</span><strong>${project.progress||0}<small>%</small></strong><div class="mini-progress"><i style="width:${project.progress||0}%"></i></div></div><div><span>已完成任务</span><strong>${complete}<small> / ${leaves.length} 项</small></strong></div><div><span>项目阶段</span><strong>${tasks.filter(t=>!t.parentId).length}<small> 个</small></strong></div><div><span>逾期任务${historical?'（保存时）':''}</span><strong class="${late?'metric-late':''}">${late}<small> 项</small></strong></div><div class="project-dates"><span>项目计划周期</span><strong>${escape(project.startDate||'未设置')}<small> → </small>${escape(project.date||'未设置')}</strong></div></div>`;}
 function patchSavedSnapshot(previous:any){
  if(historical||edit?.dirty||recoveryRequired||!root.querySelector('.task-table'))return false;
  const before:Task[]=previous.tasks,after:Task[]=snapshot.tasks;
  if(before.length!==after.length||JSON.stringify(previous.capabilities)!==JSON.stringify(snapshot.capabilities))return false;
  for(const key of ['title','description','owner','category','startDate','date'])if(previous.project[key]!==snapshot.project[key])return false;
  const old=new Map(before.map(t=>[t.id,t]));
  if(after.some(t=>!old.has(t.id)||old.get(t.id)!.parentId!==t.parentId||old.get(t.id)!.order!==t.order||old.get(t.id)!.kind!==t.kind))return false;
  const focus=activeFocus()||pendingFocus,changed=after.filter(t=>JSON.stringify(old.get(t.id))!==JSON.stringify(t));
  for(const task of changed){
   const node=root.querySelector<HTMLElement>('[data-row="'+CSS.escape(task.id)+'"]');if(!node)continue;
   // Owner/notes do not affect row structure or derived cells. Keep the focused
   // native input and table row instead of invalidating the whole table layout.
   const displayed=['title','start','end','duration','progress','status','predecessors'] as const;
   if(displayed.every(key=>JSON.stringify(task[key])===JSON.stringify(old.get(task.id)![key]))){
    const owner=node.querySelector<HTMLInputElement>('input[data-inline="owner"]');if(owner&&owner.value!==task.owner)owner.value=task.owner;
   }else node.outerHTML=rowHtml(rowById().get(task.id)!);
  }
  root.querySelector('.timing-metrics')!.outerHTML=metricsHtml();
  const badge=root.querySelector<HTMLElement>('.project-state');if(badge){badge.textContent=snapshot.project.status;badge.dataset.state=snapshot.project.status;}
  const workflow=root.querySelector('#timing-draft-workflow');if(workflow){workflow.outerHTML=workflowHtml();bindWorkflow();}
  if(selected||edit)renderDrawer();
  // Owner/notes-only edits do not change the chart. Date/progress/title edits refresh its region.
  if(changed.some(t=>['start','end','progress','title','status','predecessors'].some(k=>JSON.stringify((t as any)[k])!==JSON.stringify((old.get(t.id) as any)[k])))){
   const pane=root.querySelector<HTMLElement>('.timeline-pane')!;pane.innerHTML=timelineHtml(rows(),snapshot.tasks);bindTimeline();pane.scrollLeft=scroll.right;pane.scrollTop=scroll.top;
  }
  for(const [id,body] of pendingInline)for(const [field,value] of Object.entries(body)){const input=root.querySelector<HTMLInputElement>('[data-inline="'+field+'"][data-task="'+CSS.escape(id)+'"]');if(input)input.value=value??'';}
  lockEditing();if(focus){const input=root.querySelector<HTMLInputElement>(focus.selector);if(input&&!input.disabled){input.focus({preventScroll:true});if(focus.start!==null)input.setSelectionRange(focus.start,focus.end);pendingFocus=null;}}
  return true;
 }
 function renderDrawer(){
  const shell=root.querySelector('.timing-app');if(!shell){render();return;}
  root.querySelectorAll('.task-drawer,.drawer-backdrop').forEach(node=>node.remove());shell.insertAdjacentHTML('beforeend',drawer(rows(true)));
  root.querySelectorAll<HTMLElement>('[data-row]').forEach(node=>node.classList.toggle('selected-row',node.dataset.row===selected&&!drawerHidden));
  if(!historical&&edit?.inputs){const form=root.querySelector<HTMLFormElement>('#task-form');for(const [name,value] of Object.entries(edit.inputs)){const node=form?.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|null;if(!node)continue;if(node instanceof HTMLSelectElement&&node.multiple){for(const option of node.options)option.selected=Array.isArray(value)&&value.includes(option.value);}else if(typeof value==='string')node.value=value;}}
  if(recoveryRequired)root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('#task-form input,#task-form textarea').forEach(node=>node.readOnly=true);
 }
 function delegated(target:Element,selector:string,event:string,fn:(e:any)=>void,eventSignal:AbortSignal){target.addEventListener(event,e=>{const node=(e.target as Element).closest(selector);if(!node||!target.contains(node))return;fn(new Proxy(e,{get(original,key){if(key==='currentTarget')return node;const value=Reflect.get(original,key,original);return typeof value==='function'?value.bind(original):value;}}));},{signal:eventSignal});}

 function render(){
  if(signal.aborted)return;
  endPan?.();renderEvents?.abort();renderEvents=new AbortController();
  layout?.destroy();layout=undefined;
  const focus=activeFocus()||pendingFocus;
  const project=snapshot.project, tasks:Task[]=snapshot.tasks, visible=rows(),allRows=rows(true),leaves=tasks.filter(t=>t.kind!=='summary');
  const complete=leaves.filter(t=>t.progress===100).length,late=leaves.filter(t=>t.end&&t.end<(savedVersion?savedVersion.savedAt.slice(0,10):today())&&t.progress<100).length;
  root.innerHTML=shell(`<main class="timing-main"><div class="timing-crumb"><a href="/">项目空间</a><span>/</span><span>${escape(project.title)}</span><span>/</span><b>Timing</b></div><section class="timing-heading"><div><div class="eyebrow">PROJECT TIMELINE <span> / ${escape(project.category)}</span></div><h1>${escape(project.title)}<span class="project-state" data-state="${escape(project.status)}">${escape(project.status)}</span></h1><p>${escape(project.description||'用清晰的计划，让每一次交付有迹可循。')}</p></div><div class="heading-actions">${canViewMembers?`<button class="small-btn" id="project-members">${canManage?'成员与可见性':'项目成员'}</button>`:''}${canProjectEdit?'<button class="small-btn" id="project-settings">编辑基础信息</button>':''}<span class="owner-bubble">${escape((project.owner||'P')[0])}</span><span>${escape(project.owner)}</span></div></section><section class="timing-history timing-plan-module" aria-label="计划预览">${workflowHtml()}${history.html()}</section>${metricsHtml()}<section class="gantt-panel"><div class="gantt-tools"><div class="gantt-tool-left"><h2>项目排期 <small>TIMING PLAN</small></h2>${!historical&&drawerHidden&&edit?'<button class="small-btn" id="resume-task-draft">返回任务草稿</button>':''}${canEdit?'<button class="primary compact" id="add-task">＋ 新建任务</button>':''}<button class="tool-btn" id="expand-all">展开全部</button><button class="tool-btn" id="collapse-all">收起阶段</button></div><div class="gantt-tool-right"><div class="gantt-controls-row"><div class="zoom-switch layout-switch" role="group" aria-label="排期显示模式">${([['details','仅详细信息'],['split','分栏显示'],['gantt','仅甘特图']] as const).map(([id,label])=>`<button type="button" data-layout-mode="${id}" aria-pressed="${layoutPreference.mode===id}" class="${layoutPreference.mode===id?'chosen':''}">${label}</button>`).join('')}</div><div class="zoom-switch date-zoom-switch">${[['day','日'],['week','周'],['month','月'],['project','全项目']].map(([id,label])=>`<button data-zoom="${id}" aria-pressed="${state.zoom===id}" class="${state.zoom===id?'chosen':''}">${label}</button>`).join('')}</div><div class="timeline-navigation" role="group" aria-label="时间导航"><button ${state.zoom==='project'?'disabled':''} class="tool-btn" id="previous-window" aria-label="上一段时间">‹</button><button ${state.zoom==='project'?'disabled':''} class="small-btn" id="today">今天</button><button ${state.zoom==='project'?'disabled':''} class="tool-btn" id="next-window" aria-label="下一段时间">›</button></div><button class="tool-btn" id="refresh-timing" aria-label="刷新排期" title="刷新排期">↻</button></div><div class="gantt-tool-note"><span class="layout-hint">双击分隔栏恢复默认比例</span></div></div></div><div class="gantt-workspace"><div class="task-pane" id="schedule-details"><table class="task-table"><thead><tr><th>WBS</th><th>任务名称</th><th>负责人</th><th>开始日期</th><th>结束日期</th><th>工期</th><th>完成度</th><th>前置任务</th><th>附件</th></tr></thead><tbody>${visible.map(row=>rowHtml(row)).join('')}</tbody></table></div><div class="schedule-separator" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整详细信息与甘特图宽度" aria-controls="schedule-details schedule-gantt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="55" title="左右拖动调整宽度；双击或按 Home 恢复默认比例；方向键调整，Shift 加速"></div><div class="timeline-pane" id="schedule-gantt" tabindex="0" role="region" aria-label="甘特图，拖动空白区域或底部滚动条横向浏览">${timelineHtml(visible,tasks)}</div></div>${!visible.length?'<div class="no-tasks">暂无阶段或任务，点击「新建任务」开始排期。</div>':''}<div class="gantt-foot"><div><span class="legend summary-legend"></span>汇总阶段 <span class="legend task-legend"></span>普通任务 <span class="diamond-legend">◆</span>里程碑 <span class="legend done-legend"></span>已完成 <span class="legend late-legend"></span>逾期</div><span>周一至周五 · FS 完成后开始 · 拖动空白或底部滚动条浏览时间${canEdit?' · 拖动任务条排期，拖动两端调整工期':' · 只读视图'}</span></div></section><div class="timing-bottom"><span>把每一个节点，连接成确定的交付。</span><span>Project Station / 项目工作空间</span></div></main>${drawer(allRows)}`);
  if(!historical&&edit?.inputs){const form=document.querySelector('#task-form') as HTMLFormElement|null;for(const [name,value] of Object.entries(edit.inputs)){
   const node=form?.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null;
   if(!node)continue;if(node instanceof HTMLSelectElement&&node.multiple){for(const option of node.options)option.selected=Array.isArray(value)&&value.includes(option.value);}else if(typeof value==='string')node.value=value;
  }}
  for(const [id,body] of pendingInline)for(const [field,value] of Object.entries(body)){const input=root.querySelector<HTMLInputElement>('[data-inline="'+field+'"][data-task="'+id+'"]');if(input)input.value=value??'';}
  bind();history.bind();if(busy)lockEditing();
  if(recoveryRequired)root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('[data-inline],#task-form input,#task-form textarea').forEach(node=>node.readOnly=true);
  if(focus){const node=document.querySelector(focus.selector) as HTMLInputElement|null;if(node&&!node.disabled){node.focus({preventScroll:true});if(focus.start!==null&&['text','search','textarea'].includes(node.type))node.setSelectionRange(focus.start,focus.end);pendingFocus=null;}}
  const workspace=document.querySelector<HTMLElement>('.gantt-workspace'),tools=document.querySelector<HTMLElement>('.gantt-tools');
  if(workspace&&tools)layout=new TimingLayout(workspace,tools,layoutPreference,saveLayout,adaptTimeline,scroll);
  const left=document.querySelector<HTMLElement>('.task-pane')!,right=document.querySelector<HTMLElement>('.timeline-pane')!;if(!left.hidden){left.scrollLeft=scroll.left;left.scrollTop=scroll.top;}if(!right.hidden){right.scrollLeft=scroll.right;right.scrollTop=scroll.top;}
  resizeObserver.disconnect();resizeObserver.observe(right);adaptTimeline();
 }
 function adaptTimeline(){
  const right=document.querySelector('.timeline-pane') as HTMLElement|null;
  if(signal.aborted||dragActive||!right||right.hidden||right.clientWidth<=0||right.clientWidth===fitWidth)return;
  endPan?.();const previous=bounds(),date=previous.start+right.scrollLeft/previous.scale*DAY,top=right.scrollTop;
  fitWidth=right.clientWidth;const next=bounds();
  right.innerHTML=timelineHtml(rows(),snapshot.tasks);bindTimeline();right.scrollLeft=state.zoom==='project'?0:Math.max(0,(date-next.start)/DAY*next.scale);right.scrollTop=top;
 }
 function bindTimeline(){
  timelineEvents?.abort();timelineEvents=new AbortController();
  const right=document.querySelector('.timeline-pane')!;
  const on=(selector:string,event:string,fn:(event:any)=>void)=>delegated(right,selector,event,fn,timelineEvents!.signal);
  on('[data-select]','click',e=>openTask(e.currentTarget.dataset.select));
  on('[data-focus-date]','click',e=>focusDate(dateValue(e.currentTarget.dataset.focusDate)-7*DAY));
  on('[data-bar]','keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openTask(e.currentTarget.dataset.bar);}});
  on('[data-bar]','pointerdown',startDrag);
 }
 function latestTaskText(task:Task,revision:number){
  const name=(id:string|null)=>id?(snapshot.tasks.find((t:Task)=>t.id===id)?.title||'原任务已不存在'):'一级目录';
  return ['最新排期版本：'+revision,'任务名称：'+task.title,'负责人：'+task.owner,'开始：'+(task.start||'未排期'),'结束：'+(task.end||'未排期'),'工期：'+task.duration,'完成度：'+task.progress+'%','目录：'+name(task.parentId),'前置任务：'+task.predecessors.map(name).join('、'),'备注：'+task.notes].join('\n');
 }
 function drawer(allRows:Row[]){
  if(drawerHidden)return '';
  const current=(!historical&&edit?.value)||(selected?snapshot.tasks.find((t:Task)=>t.id===selected):null);if(!current)return '';
  const isNew=!historical&&!!edit&&!edit.value.id,t=current as Task,summary=t.kind==='summary',files=snapshot.attachments.filter((a:any)=>a.task_id===t.id);
  const descendants=new Set<string>([t.id]);let previous=-1;while(previous!==descendants.size){previous=descendants.size;for(const row of allRows)if(row.task.parentId&&descendants.has(row.task.parentId))descendants.add(row.task.id);}
  const field=(label:string,name:string,value:any,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${escape(value??'')}" ${extra}></label>`;
  return `<div class="drawer-backdrop"></div><section class="task-drawer" role="dialog" aria-modal="true" aria-label="任务详情"><div class="drawer-top"><div><div class="eyebrow">${isNew?'NEW TASK':'TASK DETAILS'} ${!isNew?' / '+allRows.find(r=>r.task.id===t.id)?.wbs:''}</div><h2>${isNew?'创建子任务':escape(t.title)}</h2></div><div class="drawer-actions">${!historical&&canEdit?'<button class="small-btn" id="task-history">查看版本（保留草稿）</button>':''}${recoveryRequired&&hasEditPermission?'<button class="small-btn" id="recover-task-inputs">重新进入编辑并比较</button>':''}<span class="drawer-mode">${canEdit?'可编辑':'只读'}</span><button class="drawer-close" aria-label="关闭任务详情">×</button></div></div><div class="drawer-scroll"><form id="task-form"><fieldset ${canEdit||(!historical&&edit?.dirty)?'':'disabled'}><h3 class="drawer-section-title">任务信息</h3>${field('任务名称','title',t.title,'text','required maxlength="200"')}<div class="form-grid"><label>任务类型<select name="kind" ${summary&&!isNew?'disabled':''}>${[['task','普通任务'],['milestone','里程碑'],['summary','汇总阶段']].map(([value,label])=>`<option value="${value}" ${t.kind===value?'selected':''}>${label}</option>`).join('')}</select></label>${field('负责人','owner',t.owner,'text','list="member-list" maxlength="100"')}<datalist id="member-list">${snapshot.members.map((m:any)=>`<option value="${escape(m.user?.name)}"></option>`).join('')}</datalist></div><label>所属目录<select name="parentId"><option value="">一级目录</option>${t.parentId&&!allRows.some(r=>r.task.id===t.parentId&&r.task.kind!=='milestone')?`<option value="${escape(t.parentId)}" selected>原目录已变更，请重新选择</option>`:''}${allRows.filter(r=>!descendants.has(r.task.id)&&r.task.kind!=='milestone').map(r=>`<option value="${r.task.id}" ${t.parentId===r.task.id?'selected':''}>${r.wbs} · ${escape(r.task.title)}</option>`).join('')}</select></label><h3 class="drawer-section-title">计划与依赖</h3>${summary&&!isNew?'<div class="summary-explanation">阶段日期、工期和完成度由子任务自动汇总。前置关系在普通任务和里程碑上设置。</div>':`<div class="form-grid">${field('开始日期','start',t.start,'date','min="2000-01-01" max="2100-12-31"')}${field('结束日期','end',t.end,'date','min="2000-01-01" max="2100-12-31"')}${field('工期 / 工作日','duration',t.duration??1,'number','min="0" max="2600" required')}${field('完成度 / %','progress',t.progress??0,'number','min="0" max="100" required')}</div><label>任务状态<select name="status"><option ${t.status==='计划中'?'selected':''}>计划中</option><option ${t.status==='进行中'?'selected':''}>进行中</option><option ${t.status==='已暂停'?'selected':''}>已暂停</option><option ${t.status==='已完成'?'selected':''}>已完成</option></select></label><label>前置任务 / FS<select name="predecessors" multiple size="4">${(t.predecessors||[]).filter(id=>!allRows.some(r=>r.task.id===id&&r.task.kind!=='summary')).map(id=>`<option value="${escape(id)}" selected>原前置任务已变更，请重新选择</option>`).join('')}${allRows.filter(r=>r.task.id!==t.id&&r.task.kind!=='summary').map(r=>`<option value="${r.task.id}" ${t.predecessors?.includes(r.task.id)?'selected':''}>${r.wbs} · ${escape(r.task.title)}</option>`).join('')}</select><small>按住 Ctrl / ⌘ 多选或取消；任务会顺延至前置任务完成后的工作日。</small></label>`}<h3 class="drawer-section-title">交付说明</h3><label>备注<textarea name="notes" rows="4" maxlength="20000" placeholder="交付要求、验收标准、工作记录…">${escape(t.notes)}</textarea></label></fieldset><p class="form-error" role="alert">${escape(!historical?edit?.message||'':'')}</p>${!historical&&edit?.dirty&&t.id?`<div class="conflict-panel"><button type="button" class="small-btn" id="task-latest">查看最新数据（保留草稿）</button>${edit.latest?`<pre style="white-space:pre-wrap;max-height:200px;overflow:auto">${escape(latestTaskText(edit.latest.value,edit.latest.version))}</pre><button type="button" class="small-btn" id="task-retry">保留草稿，选择所示版本后重试</button>`:''}</div>`:''}</form><section class="attachment-section"><div class="attachment-heading"><h3>任务附件 <span>${files.length}</span></h3>${canUpload&&!isNew&&snapshot.executionTaskIds?.includes(t.id)?'<label class="small-btn upload">↑ 上传附件<input type="file" id="task-upload" multiple hidden></label>':''}</div>${historical?'<p class="muted">历史版本仅保留计划数据。请返回当前计划查看附件。</p>':isNew||!snapshot.executionTaskIds?.includes(t.id)?'<p class="muted">任务采用为执行计划后即可上传附件。</p>':files.length?files.map((a:any)=>`<div class="attachment-row"><span class="file-icon">▤</span><div><a href="/api/attachments/${a.id}" download>${escape(a.name)}</a><small>${(a.size/1024).toFixed(1)} KB · ${escape(new Date(a.created_at).toLocaleDateString('sv-SE'))}</small></div><a class="download-icon" href="/api/attachments/${a.id}" download aria-label="下载 ${escape(a.name)}">↓</a>${canDeleteFile?`<button class="delete-attachment" data-file-delete="${a.id}" aria-label="删除附件 ${escape(a.name)}">×</button>`:''}</div>`).join(''):'<div class="attachment-empty">将交付物留在任务旁。<small>文档、表格、图片或压缩包 · 单个文件最大 20 MB</small></div>'}<p id="upload-status" role="status"></p></section></div>${canEdit?`<div class="drawer-save"><button type="button" class="danger" id="delete-task" ${isNew?'hidden':''}>删除${summary?'阶段及子任务':'任务'}</button><button class="primary" type="submit" form="task-form">${isNew?'保存任务到草稿':'保存到草稿'}</button></div>`:''}</section>`;
 }
 async function openTask(taskId:string){return changeSelection(()=>{drawerHidden=false;rememberScroll();selected=taskId;const task=snapshot.tasks.find((t:Task)=>t.id===taskId);if(task&&!historical)setEdit(new EditDraft(task,snapshot.revision));renderDrawer();(document.querySelector('.drawer-close') as HTMLElement)?.focus();});}
 async function newTask(parentId:string|null){return changeSelection(()=>{drawerHidden=false;rememberScroll();selected=null;setEdit(new EditDraft<Task>({id:'',projectId,title:'',parentId,order:0,kind:parentId?'task':'summary',owner:user.name,start:null,end:null,duration:1,progress:0,status:'计划中',notes:'',predecessors:[]},snapshot.revision));renderDrawer();(document.querySelector('#task-form input') as HTMLInputElement)?.focus();});}
 function bindWorkflow(){
  const workflow=document.querySelector('#timing-draft-workflow');if(!workflow||workflow===boundWorkflow)return;boundWorkflow=workflow;
  const on=(selector:string,event:string,fn:(event:any)=>void)=>document.querySelectorAll(selector).forEach(node=>node.addEventListener(event,fn,{signal}));
  on('#preview-versions','click',()=>history.togglePanel());
  on('#preview-files','click',()=>history.toggleTransfer());
  on('#preview-current','click',()=>history.showCurrent());
  on('#enter-editing','click',()=>enterEditing());
  on('#edit-from-history','click',()=>enterEditing(historical!));
  on('#adopt-draft','click',adoptDraft);
  on('#exit-editing','click',()=>{if(!transition)void exitEditing().catch(e=>notify(e.message));});
  on('#retry-autosave','click',()=>{saveError='';void flushInputs();});
 }
 function bind(){
  const on=(selector:string,event:string,fn:(event:any)=>void)=>delegated(root,selector,event,fn,renderEvents!.signal);
  bindWorkflow();
  on('#recover-task-inputs','click',()=>enterEditing());
  on('#task-history','click',()=>changeSelection(()=>{drawerHidden=true;selected=null;renderDrawer();void history.openPanel();}));
  on('#resume-task-draft','click',()=>{drawerHidden=false;selected=edit?.value.id||null;renderDrawer();});
  on('#project-members','click',()=>{if(busy||attachmentBusy){notify('正在保存或上传，请等待结果');return;}options.manageMembers(canManage);});on('#project-settings','click',()=>{if(busy||attachmentBusy){notify('正在保存或上传，请等待结果');return;}editProject();});on('#add-task','click',()=>newTask(snapshot.tasks.find((t:Task)=>!t.parentId)?.id||null));
  on('[data-child]','click',e=>newTask(e.currentTarget.dataset.child));
  on('.task-pane [data-select]','click',e=>openTask(e.currentTarget.dataset.select));
  on('[data-fold]','click',e=>{rememberScroll();const id=e.currentTarget.dataset.fold;if(state.collapsed.has(id))state.collapsed.delete(id);else state.collapsed.add(id);render();});
  on('#expand-all','click',()=>{rememberScroll();state.collapsed.clear();render();});on('#collapse-all','click',()=>{rememberScroll();snapshot.tasks.filter((t:Task)=>t.kind==='summary').forEach((t:Task)=>state.collapsed.add(t.id));render();});
  on('[data-zoom]','click',e=>{rememberScroll();const b=bounds(),date=b.start+scroll.right/b.scale*DAY;state.zoom=e.currentTarget.dataset.zoom;if(state.zoom==='project'){scroll.right=0;render();}else focusDate(date);});
  on('#today','click',()=>focusDate(dateValue(today())-7*DAY));
  const moveWindow=(direction:number)=>{rememberScroll();const b=bounds();focusDate(b.start+scroll.right/b.scale*DAY+direction*Math.max(7,Math.floor(fitWidth/b.scale/2))*DAY);};
  on('#previous-window','click',()=>moveWindow(-1));
  on('#next-window','click',()=>moveWindow(1));
  on('#refresh-timing','click',()=>{if(busy||navigation.pending||transition)return;rememberScroll();load().catch(e=>notify(e.message));});
  on('[data-inline]','input',e=>{const input=e.currentTarget as HTMLInputElement;if(!canEdit||busy||recoveryRequired)return;const field=input.dataset.inline!,id=input.dataset.task!;pendingInline.set(id,{...pendingInline.get(id),[field]:input.value});saveError='';preserveInputs();updateSaveStatus();queueAutosave();});
  const left=document.querySelector<HTMLElement>('.task-pane')!,right=document.querySelector<HTMLElement>('.timeline-pane')!;
  left.addEventListener('scroll',()=>{if(!left.hidden&&!right.hidden&&right.scrollTop!==left.scrollTop)right.scrollTop=left.scrollTop;},{signal});right.addEventListener('scroll',()=>{if(!left.hidden&&!right.hidden&&left.scrollTop!==right.scrollTop)left.scrollTop=right.scrollTop;},{signal});
  right.addEventListener('pointerdown',startPan,{signal});
  on('.drawer-close,.drawer-backdrop','click',closeEditor);
  on('#task-form','input',captureDraft);on('#task-form','change',captureDraft);
  on('#task-latest','click',async()=>{captureDraft();const pending=edit;if(!pending)return;const current=reads.begin(()=>!signal.aborted&&!busy&&edit===pending);try{const latest=await request(`projects/${projectId}/timing`);if(!current())return;const task=latest.tasks.find((t:Task)=>t.id===pending.value.id);if(!task)throw Error('任务已删除，草稿仍保留，不能重新创建替代记录');snapshot=latest;pending.review(task,latest.revision);render();}catch(error:any){if(!current())return;pending.fail(error.message);notify(error.message);render();}});
  on('#task-retry','click',()=>{if(!edit)return;edit.useReviewedVersion();render();});
  on('#task-form','submit',async e=>{
   e.preventDefault();if(busy){notify('正在保存，请等待结果');return;}captureDraft();if(!edit)return;
   const values=readTaskForm(e.currentTarget as HTMLFormElement);delete values.end;const taskId=edit.value.id||undefined;
   await mutate(taskId,values,taskId?'PATCH':'POST','drawer');
  });
  on('#task-form select[name="status"]','change',e=>{
   const progress=(document.querySelector('#task-form') as HTMLFormElement).elements.namedItem('progress') as HTMLInputElement;
   if(!progress)return;
   if(e.target.value==='已完成')progress.value='100';
   else if(e.target.value==='计划中')progress.value='0';
   else if(e.target.value==='进行中'&&(!Number(progress.value)||Number(progress.value)===100))progress.value='1';
   captureDraft();
  });
  on('#task-form input[name="start"],#task-form input[name="end"],#task-form input[name="duration"],#task-form select[name="kind"]','change',e=>{
   const form=document.querySelector('#task-form') as HTMLFormElement,fields=form.elements;
   const start=fields.namedItem('start') as HTMLInputElement,end=fields.namedItem('end') as HTMLInputElement,duration=fields.namedItem('duration') as HTMLInputElement,kind=fields.namedItem('kind') as HTMLSelectElement;
   if(!start||!end||!duration)return;
   try{if(kind.value==='milestone'){duration.value='0';end.value=start.value;}else if(start.value){start.value=nextWorkday(start.value);if(e.target.name==='end'&&end.value)duration.value=String(workdays(start.value,end.value));else end.value=finish(start.value,Math.max(1,Number(duration.value)));}form.querySelector('.form-error')!.textContent='';}catch(error:any){form.querySelector('.form-error')!.textContent=error.message;}
   captureDraft();
  });
  on('#delete-task','click',async()=>{if(!confirm('从草稿移除此任务及其全部子任务？附件会保留。'))return;const taskId=selected!;await mutate(taskId,{},'DELETE','drawer');});
  on('#task-upload','change',async e=>{
   const files=Array.from((e.target as HTMLInputElement).files||[]);if(!files.length||attachmentBusy)return;const taskId=selected!;attachmentBusy=true;
   const status=document.querySelector('#upload-status')!;let count=0;
   try{for(const file of files){if(file.size>20*1024*1024)throw Error(`${file.name} 超过 20 MB`);status.textContent=`上传中 ${count+1}/${files.length}：${file.name}`;const response=await fetch(`/api/projects/${projectId}/tasks/${taskId}/attachments`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file,signal});const result=await response.json();if(!response.ok)throw Error(result.error+(result.requestId?`（请求 ${result.requestId}）`:""));count++;}notify(`${count} 个附件已上传`);}catch(error:any){notify(error.message);}finally{attachmentBusy=false;try{await load();}catch(error:any){notify('附件请求已结束，但刷新失败：'+error.message);render();}}
  });
  on('[data-file-delete]','click',async e=>{if(!confirm('确定删除此附件？'))return;try{await request('attachments/'+e.currentTarget.dataset.fileDelete,{},'DELETE');await load();notify('附件已删除');}catch(error:any){notify(error.message);}});
  bindTimeline();
 }
 function startPan(event:PointerEvent){
  const pane=event.currentTarget as HTMLElement;
  if(event.button!==0||event.pointerType==='touch'||dragActive||endPan||pane.scrollWidth<=pane.clientWidth||(event.target as HTMLElement).closest('[data-bar],button,input,select,a'))return;
  // Leave the native scrollbar track/thumb to the browser.
  const rect=pane.getBoundingClientRect();if(event.clientX>=rect.left+pane.clientWidth||event.clientY>=rect.top+pane.clientHeight)return;
  event.preventDefault();const startX=event.clientX,startLeft=pane.scrollLeft,events=new AbortController(),panSignal=events.signal;
  let latest=startX,frame=0;
  const flush=()=>{frame=0;pane.scrollLeft=startLeft+startX-latest;};
  const finish=()=>{if(frame)cancelAnimationFrame(frame);flush();endPan=undefined;events.abort();document.body.classList.remove('panning-timeline');if(pane.hasPointerCapture(event.pointerId))pane.releasePointerCapture(event.pointerId);};
  endPan=finish;document.body.classList.add('panning-timeline');pane.setPointerCapture(event.pointerId);
  pane.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;latest=e.clientX;if(!frame)frame=requestAnimationFrame(flush);},{signal:panSignal});
  pane.addEventListener('pointerup',e=>{if(e.pointerId===event.pointerId){latest=e.clientX;finish();}},{signal:panSignal});
  for(const name of ['pointercancel','lostpointercapture'])pane.addEventListener(name,e=>{if((e as PointerEvent).pointerId===event.pointerId)finish();},{signal:panSignal});
  window.addEventListener('blur',finish,{signal:panSignal});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish();}},{signal:panSignal,capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish();},{signal:panSignal});
 }
 function startDrag(event:PointerEvent){
  const element=event.currentTarget as HTMLElement,task=taskTree().byId.get(element.dataset.bar!);if(!task)return;
  if(!canEdit||task.kind==='summary'){openTask(task.id);return;}if(busy||event.button!==0||!task.start||!task.end)return;
  const mode=(event.target as HTMLElement).dataset.handle||'move',startX=event.clientX,boundsAtStart=bounds(),scrollAtStart=document.querySelector('.timeline-pane')!.scrollLeft;
  const originalStart=task.start,originalEnd=task.end,initialLeft=parseFloat(element.style.left),initialWidth=parseFloat(element.style.width);let moved=false,delta=0;
  element.setPointerCapture(event.pointerId);element.classList.add('dragging');dragActive=true;
  const move=(e:PointerEvent)=>{delta=Math.round((e.clientX-startX+document.querySelector('.timeline-pane')!.scrollLeft-scrollAtStart)/boundsAtStart.scale);moved=moved||Math.abs(e.clientX-startX)>4;if(!moved)return;const pixels=delta*boundsAtStart.scale;if(mode==='move')element.style.transform=`translateX(${pixels}px)`;else if(mode==='end')element.style.width=Math.max(6,initialWidth+pixels)+'px';else{element.style.left=(initialLeft+pixels)+'px';element.style.width=Math.max(6,initialWidth-pixels)+'px';}};
  const cleanup=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',cancel);element.classList.remove('dragging');dragActive=false;};
  const cancel=()=>{cleanup();render();};
  const up=async()=>{cleanup();if(!moved){openTask(task.id);return;}try{if(mode==='move')await mutate(task.id,{start:nextWorkday(iso(dateValue(originalStart)+delta*DAY))});else if(mode==='end'){const end=iso(dateValue(originalEnd)+delta*DAY);await mutate(task.id,{duration:Math.max(1,workdays(originalStart,end))});}else{const start=nextWorkday(iso(dateValue(originalStart)+delta*DAY));await mutate(task.id,{start,duration:Math.max(1,workdays(start,originalEnd))});}}catch(error:any){notify(error.message);render();}};
  element.addEventListener('pointermove',move);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',cancel);
 }
 document.addEventListener('keydown',async e=>{if(document.querySelector('#modal')?.childElementCount||document.querySelector('dialog[open]'))return;if(e.key==='Escape'&&(selected||edit)&&!drawerHidden){e.preventDefault();await closeEditor();return;}if(e.key==='Tab'){const drawer=document.querySelector('.task-drawer');if(!drawer)return;const focusable=Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')).filter(el=>!el.closest('[hidden]'));const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}},{signal});
 window.addEventListener('beforeunload',e=>{if(edit?.dirty||pendingInline.size||busy||attachmentBusy){e.preventDefault();e.returnValue='';}},{signal});
 root.addEventListener('beforeinput',e=>{if(busy||recoveryRequired)e.preventDefault();},{signal,capture:true});
 root.addEventListener('pointerdown',e=>{if(busy){e.preventDefault();e.stopImmediatePropagation();return;}if(recoveryRequired&&(e.target as HTMLElement).closest('select'))e.preventDefault();},{signal,capture:true});
 root.addEventListener('click',e=>{if(busy&&(e.target as HTMLElement).closest('button,input,textarea,select,[data-select],[data-bar]')){e.preventDefault();e.stopImmediatePropagation();}},{signal,capture:true});
 root.addEventListener('keydown',e=>{if(busy&&(e.target as HTMLElement).closest('input,textarea,select')&&!['Escape','Tab'].includes((e as KeyboardEvent).key)){e.preventDefault();return;}if((busy||recoveryRequired)&&(e.target as HTMLElement).closest('select')&&!['Escape','Tab'].includes((e as KeyboardEvent).key))e.preventDefault();},{signal,capture:true});
 root.addEventListener('click',async e=>{const link=(e.target as HTMLElement).closest('a');if(!link||link.hasAttribute('download')||link.href.includes('/api/attachments/'))return;
  if(edit?.dirty||pendingInline.size||busy||attachmentBusy){e.preventDefault();e.stopPropagation();await changeSelection(()=>{releaseOnLeave();location.assign(link.href);});}
 },{signal,capture:true});
 try{await load();}catch(error:any){if(error.name==='AbortError')return;root.innerHTML=shell(`<main class="timing-gate"><h1>暂时无法打开项目</h1><p>${escape(error.message)}</p><a class="primary" href="/">返回项目空间</a></main>`);}
}
