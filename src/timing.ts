import { DAY, iso, dateValue, nextWorkday, finish, workdays, isWorkday, previewTaskEdit } from '/schedule.js';
import { EditDraft } from '/drafts.js';
import type { Task } from '../lib/schedule.ts';
type Options={projectId:string;user:any;settings:any;login:()=>void;editProject:()=>void};
type Row={task:Task;wbs:string;depth:number};
const escape=(v:any='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const today=()=>new Date().toLocaleDateString('sv-SE');
let controller:AbortController|undefined;
const viewStates=new Map<string,{collapsed:Set<string>;zoom:string;start:number|null}>();
type TaskDraft=EditDraft<Task>&{inputs?:Record<string,string|string[]>};
const editors=new Map<string,TaskDraft>();
export async function mountTiming(options:Options){
 document.body.classList.add('timing-workspace');
 controller?.abort();controller=new AbortController();const signal=controller.signal;
 const root=document.querySelector('#app')!;
 const {projectId,user,settings,login,editProject}=options;
 const canEdit=user&&user.role!=='viewer';
 const editKey=(user?.id||'guest')+':'+projectId;
 let edit=editors.get(editKey);
 let snapshot:any, busy=false,selected:string|null=edit?.value.id||null;
 const setEdit=(value:TaskDraft|undefined)=>{edit=value;if(value)editors.set(editKey,value);else editors.delete(editKey);};
 let attachmentBusy=false, scroll={left:0,right:0,top:0};
 const state=viewStates.get(projectId)||{collapsed:new Set<string>(),zoom:'week',start:null};viewStates.set(projectId,state);
 const notify=(message:string)=>{const node=document.querySelector('#toast')!;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),3500);};
 const shell=(content:string)=>`<div class="timing-app"><header class="station-header"><a class="timing-brand" href="/"><span class="station-logo">P<span>.</span></span><span>Project Station<small>PLAN · ALIGN · DELIVER</small></span></a><nav class="station-nav"><a href="/">项目空间</a><a href="/#articles">Lesson Learn</a><a href="/#team">团队</a></nav><div class="station-account"><span class="green-dot"></span>${escape(user?.name||'访客')}<span class="role-chip">${user?({admin:'管理员',editor:'编辑者',viewer:'只读成员'}[user.role]):'尚未登录'}</span></div></header>${content}</div>`;
 if(!user){root.innerHTML=shell('<main class="timing-gate"><span class="gate-icon">▦</span><div class="eyebrow">PROJECT TIMING</div><h1>登录，进入项目工作空间。</h1><p>项目排期与附件仅对登录成员开放。</p><button class="primary" id="timing-login">登录并继续 →</button><a href="/">返回项目列表</a></main>');document.querySelector('#timing-login')!.addEventListener('click',login,{signal});return;}
 root.innerHTML=shell('<main class="timing-gate"><p>正在载入项目排期…</p></main>');
 async function request(path:string,body?:any,method='POST'){
  const response=await fetch('/api/'+path,body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}:{signal});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{status:response.status});return result;
 }
 async function load(){snapshot=await request(`projects/${projectId}/timing`);if(signal.aborted)return;
   if(edit&&!edit.dirty&&edit.value.id){const latest=snapshot.tasks.find((t:Task)=>t.id===edit!.value.id);if(latest)setEdit(new EditDraft(latest,snapshot.revision));}
   render();
 }
 function rows(all=false):Row[]{const result:Row[]=[];function visit(parent:string|null,depth:number,prefix:string){snapshot.tasks.filter((t:Task)=>t.parentId===parent).sort((a:Task,b:Task)=>a.order-b.order||a.id.localeCompare(b.id)).forEach((task:Task,i:number)=>{const wbs=prefix?prefix+'.'+(i+1):String(i+1);result.push({task,wbs,depth});if(all||!state.collapsed.has(task.id))visit(task.id,depth+1,wbs);});}visit(null,0,'');return result;}
 function rememberScroll(){const left=document.querySelector('.task-pane'),right=document.querySelector('.timeline-pane');if(left&&right)scroll={left:left.scrollLeft,right:right.scrollLeft,top:left.scrollTop};}
 type FocusState={selector:string;start:number|null;end:number|null};
 let pendingFocus:FocusState|null=null;
 function activeFocus():FocusState|null {
  const active=document.activeElement as HTMLInputElement|null;
  return active?.dataset.inline?{selector:'[data-inline="'+active.dataset.inline+'"][data-task="'+active.dataset.task+'"]',start:active.selectionStart,end:active.selectionEnd}:active?.closest('#task-form')&&active.name?{selector:'#task-form [name="'+active.name+'"]',start:active.selectionStart,end:active.selectionEnd}:null;
 }
 function lockEditing(){pendingFocus=activeFocus()||pendingFocus;root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,textarea,select,button').forEach(node=>node.disabled=true);}
 async function mutate(taskId:string|undefined,body:any,method='PATCH',source:'inline'|'drawer'='inline'){
  if(busy){notify('正在保存。本次操作未提交，请等待后重试。');return false;}
  const expected=source==='drawer'&&edit?edit.version:snapshot.revision;
  busy=true;rememberScroll();lockEditing();document.querySelector('.save-state')!.textContent='正在保存…';
  try{
   const result=await request(`projects/${projectId}/tasks${taskId?'/'+taskId:''}`,{...body,revision:expected},method);
   snapshot={...snapshot,tasks:result.tasks,revision:result.revision,project:result.project||snapshot.project};
   if(source==='drawer'){selected=method==='DELETE'?null:result.id||selected;setEdit(undefined);}
   try{await load();}catch{notify('排期已保存，但重新读取失败；可点击刷新确认。');return true;}
   notify('排期已保存，关联任务已同步');return true;
  }catch(error:any){
   if(error.name!=='AbortError'){
    if(source==='inline'){
     const task=snapshot.tasks.find((t:Task)=>t.id===taskId);
     if(task){selected=task.id;const pending=new EditDraft<Task>(task,expected);try{pending.set(previewTaskEdit(task,body));}catch{pending.set({...task,...body});}setEdit(pending);}
    }
    edit?.fail(error.message+'；草稿已保留。');notify(error.message+'；输入已保留，请查看任务草稿。');
   }
   return false;
  }finally{busy=false;render();}
 }
 function readTaskForm(form:HTMLFormElement):Partial<Task>{
  const values=Object.fromEntries(new FormData(form)) as any;
  values.parentId=values.parentId||null;
  values.predecessors=Array.from((form.elements.namedItem('predecessors') as HTMLSelectElement)?.selectedOptions||[]).map(x=>x.value);
  for(const field of ['start','end'])if(values[field]!==undefined)values[field]=values[field]||null;
  for(const field of ['duration','progress'])if(values[field]!==undefined)values[field]=Number(values[field]);
  return values;
 }
 function captureDraft(){
  const form=document.querySelector('#task-form') as HTMLFormElement|null;
  if(!canEdit||busy||!form)return;
  if(!edit&&selected){const current=snapshot.tasks.find((t:Task)=>t.id===selected);if(current)setEdit(new EditDraft(current,snapshot.revision));}
  if(edit){
   edit.set({...edit.value,...readTaskForm(form)});
   edit.inputs={};for(const node of Array.from(form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('[name]'))){
    if(node.disabled)continue;edit.inputs[node.name]=node instanceof HTMLSelectElement&&node.multiple?Array.from(node.selectedOptions).map(option=>option.value):node.value;
   }
   if(edit.inputs.duration===''||edit.inputs.progress==='')edit.dirty=true;
   const status=document.querySelector('.save-state');if(status)status.textContent=edit.dirty?'有未保存草稿':'已保存';
  }
 }
 function leaveEditor(){
  if(busy||attachmentBusy){notify('正在保存或上传，请等待结果');return false;}
  if(edit?.dirty&&!confirm('有未保存的任务草稿，确定舍弃？'))return false;
  setEdit(undefined);return true;
 }
 function bounds(){const dated=snapshot.tasks.filter((t:Task)=>t.start).map((t:Task)=>dateValue(t.start!));const first=dated.length?Math.min(...dated):dateValue(snapshot.project.startDate||today());let start=state.start??first-7*DAY;const weekday=new Date(start).getUTCDay();start-=((weekday+6)%7)*DAY;const days=state.zoom==='day'?90:state.zoom==='week'?180:365;const scale=state.zoom==='day'?32:state.zoom==='week'?12:5;return{start,days,scale,width:days*scale};}
 function labelDate(date:string|null){return date||'未排期';}
 function render(){
  if(signal.aborted)return;
  const focus=activeFocus()||pendingFocus;
  const project=snapshot.project, tasks:Task[]=snapshot.tasks, visible=rows(),allRows=rows(true),leaves=tasks.filter(t=>t.kind!=='summary');
  const complete=leaves.filter(t=>t.progress===100).length,late=leaves.filter(t=>t.end&&t.end<today()&&t.progress<100).length;
  const {start,days,scale,width}=bounds();
  const monthly:{name:string;count:number}[]=[];for(let i=0;i<days;i++){const date=new Date(start+i*DAY),name=`${date.getUTCFullYear()}年 ${String(date.getUTCMonth()+1).padStart(2,'0')}月`;const last=monthly.at(-1);if(last?.name===name)last.count++;else monthly.push({name,count:1});}
  const step=state.zoom==='day'?1:state.zoom==='week'?7:14;
  let ticks='';for(let i=0;i<days;i+=step){const date=new Date(start+i*DAY);ticks+=`<span style="width:${Math.min(step,days-i)*scale}px">${state.zoom==='day'?date.getUTCDate():`${date.getUTCMonth()+1}/${date.getUTCDate()}`}</span>`;}
  const x=(date:string)=>((dateValue(date)-start)/DAY)*scale;
  const nodePositions=new Map(visible.map((r,i)=>[r.task.id,i]));let arrows='';
  for(const row of visible){const target=row.task;if(!target.start)continue;for(const dep of target.predecessors){const source=tasks.find(t=>t.id===dep);if(!source?.end||!nodePositions.has(dep))continue;const x1=x(source.end)+scale,x2=x(target.start),y1=nodePositions.get(dep)!*44+22,y2=nodePositions.get(target.id)!*44+22;if(x1<0||x2>width)continue;const middle=Math.max(x1+10,Math.min(x2-9,x1+30));arrows+=`<path d="M ${x1} ${y1} H ${middle} V ${y2} H ${x2-3}" marker-end="url(#arrow)"/>`;}}
  const todayX=x(today());
  root.innerHTML=shell(`<main class="timing-main"><div class="timing-crumb"><a href="/">项目空间</a><span>/</span><span>${escape(project.title)}</span><span>/</span><b>Timing</b></div><section class="timing-heading"><div><div class="eyebrow">PROJECT TIMELINE <span> / ${escape(project.category)}</span></div><h1>${escape(project.title)}<span class="project-state" data-state="${escape(project.status)}">${escape(project.status)}</span></h1><p>${escape(project.description||'用清晰的计划，让每一次交付有迹可循。')}</p></div><div class="heading-actions">${canEdit?'<button class="small-btn" id="project-settings">编辑基础信息</button>':''}<span class="owner-bubble">${escape((project.owner||'P')[0])}</span><span>${escape(project.owner)}</span></div></section><div class="timing-metrics"><div><span>整体进度</span><strong>${project.progress||0}<small>%</small></strong><div class="mini-progress"><i style="width:${project.progress||0}%"></i></div></div><div><span>已完成任务</span><strong>${complete}<small> / ${leaves.length} 项</small></strong></div><div><span>项目阶段</span><strong>${tasks.filter(t=>!t.parentId).length}<small> 个</small></strong></div><div><span>逾期任务</span><strong class="${late?'metric-late':''}">${late}<small> 项</small></strong></div><div class="project-dates"><span>项目计划周期</span><strong>${escape(project.startDate||'未设置')}<small> → </small>${escape(project.date||'未设置')}</strong></div></div><section class="gantt-panel"><div class="gantt-tools"><div class="gantt-tool-left"><h2>项目排期 <small>TIMING PLAN</small></h2>${canEdit?'<button class="primary compact" id="add-task">＋ 新建任务</button>':''}<button class="tool-btn" id="expand-all">展开全部</button><button class="tool-btn" id="collapse-all">收起阶段</button></div><div class="gantt-tool-right"><span class="save-state"><i></i> ${busy?'正在保存…':edit?.dirty?'有未保存草稿':'已保存'}</span><button class="tool-btn" id="refresh-timing" aria-label="刷新排期">↻</button><div class="zoom-switch">${[['day','日'],['week','周'],['month','月']].map(([id,label])=>`<button data-zoom="${id}" class="${state.zoom===id?'chosen':''}">${label}</button>`).join('')}</div><button class="tool-btn" id="previous-window" aria-label="上一段时间">‹</button><button class="small-btn" id="today">今天</button><button class="tool-btn" id="next-window" aria-label="下一段时间">›</button></div></div><div class="gantt-workspace"><div class="task-pane"><table class="task-table"><thead><tr><th>WBS</th><th>任务名称</th><th>负责人</th><th>开始日期</th><th>结束日期</th><th>工期</th><th>完成度</th><th>前置任务</th><th>附件</th></tr></thead><tbody>${visible.map(row=>{
   const t=row.task,summary=t.kind==='summary',hasChildren=tasks.some(c=>c.parentId===t.id),files=snapshot.attachments.filter((a:any)=>a.task_id===t.id).length;
   const disabled=!canEdit||summary?'disabled':'';
   const input=(field:string,value:any,type='text',extra='')=>`<input aria-label="${escape(row.wbs+' '+({title:'任务名称',owner:'负责人',start:'开始日期',end:'结束日期',duration:'工期',progress:'完成度'}[field]||field))}" data-inline="${field}" data-task="${t.id}" type="${type}" value="${escape(value??'')}" ${extra}>`;
   return `<tr class="${summary?'summary-row':''} ${selected===t.id?'selected-row':''}" data-row="${t.id}"><td><span class="wbs-number">${row.wbs}</span></td><td><div class="task-title-cell" style="padding-left:${row.depth*16}px">${summary?`<button class="fold-task" data-fold="${t.id}" aria-label="${state.collapsed.has(t.id)?'展开':'折叠'} ${escape(t.title)}">${state.collapsed.has(t.id)?'▸':'▾'}</button>`:`<span class="task-kind-symbol">${t.kind==='milestone'?'◆':'▱'}</span>`}<button class="task-name" data-select="${t.id}" title="查看或编辑任务">${escape(t.title)}</button>${canEdit&&t.kind!=='milestone'?`<button class="add-child" data-child="${t.id}" aria-label="添加 ${escape(t.title)} 的子任务">＋</button>`:''}</div></td><td>${input('owner',t.owner,'text',canEdit?'':'disabled')}</td><td>${input('start',t.start,'date',disabled)}</td><td>${input('end',t.end,'date',disabled)}</td><td>${input('duration',t.duration,'number',`${disabled||t.kind==='milestone'?'disabled':''} min="1" max="2600"`)}<span class="unit">天</span></td><td>${input('progress',t.progress,'number',`${disabled} min="0" max="100"`)}<span class="unit">%</span></td><td><button class="predecessor-cell" data-select="${t.id}">${t.predecessors.map(dep=>allRows.find(r=>r.task.id===dep)?.wbs||'?').join(', ')||'—'}</button></td><td><button class="attachment-count" data-select="${t.id}" aria-label="${escape(t.title)} 附件">♧ ${files||'—'}</button></td></tr>`;
  }).join('')}</tbody></table></div><div class="timeline-pane"><div class="timeline-canvas" style="width:${width}px"><div class="time-header"><div class="month-bands">${monthly.map(m=>`<span style="width:${m.count*scale}px">${m.name}</span>`).join('')}</div><div class="time-ticks">${ticks}</div></div><div class="timeline-rows" style="height:${visible.length*44}px;--day-width:${scale}px">${Array.from({length:days},(_,i)=>!isWorkday(start+i*DAY)?`<div class="weekend-band" style="left:${i*scale}px;width:${scale}px"></div>`:'').join('')}${todayX>=0&&todayX<=width?`<div class="today-line" style="left:${todayX+scale/2}px"><span>今天</span></div>`:''}<svg class="dependency-lines" width="${width}" height="${visible.length*44}" aria-hidden="true"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6"/></marker></defs>${arrows}</svg>${visible.map((row,i)=>{const t=row.task;let bar='';if(t.start&&t.end){const left=x(t.start),right=x(t.end)+scale;const clampedLeft=Math.max(0,left),clampedRight=Math.min(width,right);if(clampedRight>clampedLeft){const summary=t.kind==='summary',milestone=t.kind==='milestone';bar=`<div class="gantt-bar ${summary?'summary-bar':milestone?'milestone-bar':'task-bar'} ${t.progress===100?'finished-bar':''} ${!summary&&t.end<today()&&t.progress<100?'late-bar':''}" data-bar="${t.id}" tabindex="0" role="button" aria-label="${escape(t.title)} ${t.start} 至 ${t.end}，完成 ${t.progress}%" title="${escape(t.title)} · ${t.start} → ${t.end}" style="left:${milestone?clampedLeft+scale/2-7:clampedLeft}px;width:${milestone?14:Math.max(4,clampedRight-clampedLeft-2)}px">${canEdit&&!summary&&!milestone?'<span class="resize-handle start-handle" data-handle="start"></span>':''}${!milestone?`<span class="bar-fill" style="width:${t.progress}%"></span><span class="bar-text">${escape(t.title)}${!summary?' · '+t.progress+'%':''}</span>`:''}${canEdit&&!summary&&!milestone?'<span class="resize-handle end-handle" data-handle="end"></span>':''}</div>`;}else bar=`<button class="offscreen-task" data-focus-date="${t.start}">${left<0?'←':'→'} ${escape(t.title)} · ${t.start}</button>`;}else bar=`<button class="unscheduled-task" data-select="${t.id}">${t.kind==='summary'?'添加子任务后自动汇总':'点击设置日期'} · 未排期</button>`;return `<div class="timeline-row ${t.kind==='summary'?'summary-timeline-row':''} ${selected===t.id?'selected-row':''}" data-timeline-row="${t.id}">${bar}</div>`;}).join('')}</div></div></div></div>${!visible.length?'<div class="no-tasks">暂无阶段或任务，点击「新建任务」开始排期。</div>':''}<div class="gantt-foot"><div><span class="legend summary-legend"></span>汇总阶段 <span class="legend task-legend"></span>普通任务 <span class="diamond-legend">◆</span>里程碑 <span class="legend done-legend"></span>已完成 <span class="legend late-legend"></span>逾期</div><span>周一至周五 · FS 完成后开始${canEdit?' · 拖动任务条排期，拖动两端调整工期':' · 只读视图'}</span></div></section><div class="timing-bottom"><span>把每一个节点，连接成确定的交付。</span><span>Project Station / 项目工作空间</span></div></main>${drawer(allRows)}`);
  if(edit?.inputs){const form=document.querySelector('#task-form') as HTMLFormElement|null;for(const [name,value] of Object.entries(edit.inputs)){
   const node=form?.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null;
   if(!node)continue;if(node instanceof HTMLSelectElement&&node.multiple){for(const option of node.options)option.selected=Array.isArray(value)&&value.includes(option.value);}else if(typeof value==='string')node.value=value;
  }}
  bind();if(busy)lockEditing();
  if(focus){const node=document.querySelector(focus.selector) as HTMLInputElement|null;if(node&&!node.disabled){node.focus({preventScroll:true});if(focus.start!==null&&['text','search','textarea'].includes(node.type))node.setSelectionRange(focus.start,focus.end);pendingFocus=null;}}
  const left=document.querySelector('.task-pane')!,right=document.querySelector('.timeline-pane')!;left.scrollLeft=scroll.left;right.scrollLeft=scroll.right;left.scrollTop=scroll.top;right.scrollTop=scroll.top;
 }
 function latestTaskText(task:Task,revision:number){
  const name=(id:string|null)=>id?(snapshot.tasks.find((t:Task)=>t.id===id)?.title||'原任务已不存在'):'一级目录';
  return ['最新排期版本：'+revision,'任务名称：'+task.title,'负责人：'+task.owner,'开始：'+(task.start||'未排期'),'结束：'+(task.end||'未排期'),'工期：'+task.duration,'完成度：'+task.progress+'%','目录：'+name(task.parentId),'前置任务：'+task.predecessors.map(name).join('、'),'备注：'+task.notes].join('\n');
 }
 function drawer(allRows:Row[]){
  const current=edit?.value||(selected?snapshot.tasks.find((t:Task)=>t.id===selected):null);if(!current)return '';
  const isNew=!!edit&&!edit.value.id,t=current as Task,summary=t.kind==='summary',files=snapshot.attachments.filter((a:any)=>a.task_id===t.id);
  const descendants=new Set<string>([t.id]);let previous=-1;while(previous!==descendants.size){previous=descendants.size;for(const row of allRows)if(row.task.parentId&&descendants.has(row.task.parentId))descendants.add(row.task.id);}
  const field=(label:string,name:string,value:any,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${escape(value??'')}" ${extra}></label>`;
  return `<div class="drawer-backdrop"></div><section class="task-drawer" role="dialog" aria-modal="true" aria-label="任务详情"><div class="drawer-top"><div><div class="eyebrow">${isNew?'NEW TASK':'TASK DETAILS'} ${!isNew?' / '+allRows.find(r=>r.task.id===t.id)?.wbs:''}</div><h2>${isNew?'创建子任务':escape(t.title)}</h2></div><div class="drawer-actions"><span class="drawer-mode">${canEdit?'可编辑':'只读'}</span><button class="drawer-close" aria-label="关闭任务详情">×</button></div></div><div class="drawer-scroll"><form id="task-form"><fieldset ${canEdit?'':'disabled'}><h3 class="drawer-section-title">任务信息</h3>${field('任务名称','title',t.title,'text','required maxlength="200"')}<div class="form-grid"><label>任务类型<select name="kind" ${summary&&!isNew?'disabled':''}>${[['task','普通任务'],['milestone','里程碑'],['summary','汇总阶段']].map(([value,label])=>`<option value="${value}" ${t.kind===value?'selected':''}>${label}</option>`).join('')}</select></label>${field('负责人','owner',t.owner,'text','list="member-list" maxlength="100"')}<datalist id="member-list">${snapshot.members.map((m:any)=>`<option value="${escape(m.name)}"></option>`).join('')}</datalist></div><label>所属目录<select name="parentId"><option value="">一级目录</option>${t.parentId&&!allRows.some(r=>r.task.id===t.parentId&&r.task.kind!=='milestone')?`<option value="${escape(t.parentId)}" selected>原目录已变更，请重新选择</option>`:''}${allRows.filter(r=>!descendants.has(r.task.id)&&r.task.kind!=='milestone').map(r=>`<option value="${r.task.id}" ${t.parentId===r.task.id?'selected':''}>${r.wbs} · ${escape(r.task.title)}</option>`).join('')}</select></label><h3 class="drawer-section-title">计划与依赖</h3>${summary&&!isNew?'<div class="summary-explanation">阶段日期、工期和完成度由子任务自动汇总。前置关系在普通任务和里程碑上设置。</div>':`<div class="form-grid">${field('开始日期','start',t.start,'date','min="2000-01-01" max="2100-12-31"')}${field('结束日期','end',t.end,'date','min="2000-01-01" max="2100-12-31"')}${field('工期 / 工作日','duration',t.duration??1,'number','min="0" max="2600" required')}${field('完成度 / %','progress',t.progress??0,'number','min="0" max="100" required')}</div><label>任务状态<select name="status"><option ${t.status==='计划中'?'selected':''}>计划中</option><option ${t.status==='进行中'?'selected':''}>进行中</option><option ${t.status==='已暂停'?'selected':''}>已暂停</option><option ${t.status==='已完成'?'selected':''}>已完成</option></select></label><label>前置任务 / FS<select name="predecessors" multiple size="4">${(t.predecessors||[]).filter(id=>!allRows.some(r=>r.task.id===id&&r.task.kind!=='summary')).map(id=>`<option value="${escape(id)}" selected>原前置任务已变更，请重新选择</option>`).join('')}${allRows.filter(r=>r.task.id!==t.id&&r.task.kind!=='summary').map(r=>`<option value="${r.task.id}" ${t.predecessors?.includes(r.task.id)?'selected':''}>${r.wbs} · ${escape(r.task.title)}</option>`).join('')}</select><small>按住 Ctrl / ⌘ 多选或取消；任务会顺延至前置任务完成后的工作日。</small></label>`}<h3 class="drawer-section-title">交付说明</h3><label>备注<textarea name="notes" rows="4" maxlength="20000" placeholder="交付要求、验收标准、工作记录…">${escape(t.notes)}</textarea></label></fieldset><p class="form-error" role="alert">${escape(edit?.message||'')}</p>${edit?.dirty&&t.id?`<div class="conflict-panel"><button type="button" class="small-btn" id="task-latest">查看最新数据（保留草稿）</button>${edit.latest?`<pre style="white-space:pre-wrap;max-height:200px;overflow:auto">${escape(latestTaskText(edit.latest.value,edit.latest.version))}</pre><button type="button" class="small-btn" id="task-retry">保留草稿，选择所示版本后重试</button>`:''}</div>`:''}</form><section class="attachment-section"><div class="attachment-heading"><h3>任务附件 <span>${files.length}</span></h3>${canEdit&&!isNew?'<label class="small-btn upload">↑ 上传附件<input type="file" id="task-upload" multiple hidden></label>':''}</div>${isNew?'<p class="muted">创建任务后即可上传附件。</p>':files.length?files.map((a:any)=>`<div class="attachment-row"><span class="file-icon">▤</span><div><a href="/api/attachments/${a.id}" download>${escape(a.name)}</a><small>${(a.size/1024).toFixed(1)} KB · ${escape(new Date(a.created_at).toLocaleDateString('sv-SE'))}</small></div><a class="download-icon" href="/api/attachments/${a.id}" download aria-label="下载 ${escape(a.name)}">↓</a>${canEdit?`<button class="delete-attachment" data-file-delete="${a.id}" aria-label="删除附件 ${escape(a.name)}">×</button>`:''}</div>`).join(''):'<div class="attachment-empty">将交付物留在任务旁。<small>文档、表格、图片或压缩包 · 单个文件最大 20 MB</small></div>'}<p id="upload-status" role="status"></p></section></div>${canEdit?`<div class="drawer-save"><button type="button" class="danger" id="delete-task" ${isNew?'hidden':''}>删除${summary?'阶段及子任务':'任务'}</button><button class="primary" type="submit" form="task-form">${isNew?'创建任务':'保存更改'}</button></div>`:''}</section>`;
 }
 function openTask(taskId:string){if(!leaveEditor())return;rememberScroll();selected=taskId;const task=snapshot.tasks.find((t:Task)=>t.id===taskId);if(task)setEdit(new EditDraft(task,snapshot.revision));render();(document.querySelector('.drawer-close') as HTMLElement)?.focus();}
 function newTask(parentId:string|null){if(!leaveEditor())return;rememberScroll();selected=null;setEdit(new EditDraft<Task>({id:'',projectId,title:'',parentId,order:0,kind:parentId?'task':'summary',owner:user.name,start:null,end:null,duration:1,progress:0,status:'计划中',notes:'',predecessors:[]},snapshot.revision));render();(document.querySelector('#task-form input') as HTMLInputElement)?.focus();}
 function bind(){
  const on=(selector:string,event:string,fn:(event:any)=>void)=>document.querySelectorAll(selector).forEach(node=>node.addEventListener(event,fn,{signal}));
  on('#project-settings','click',()=>{if(busy||attachmentBusy){notify('正在保存或上传，请等待结果');return;}editProject();});on('#add-task','click',()=>newTask(snapshot.tasks.find((t:Task)=>!t.parentId)?.id||null));
  on('[data-child]','click',e=>newTask(e.currentTarget.dataset.child));
  on('[data-select]','click',e=>openTask(e.currentTarget.dataset.select));
  on('[data-fold]','click',e=>{rememberScroll();const id=e.currentTarget.dataset.fold;if(state.collapsed.has(id))state.collapsed.delete(id);else state.collapsed.add(id);render();});
  on('#expand-all','click',()=>{rememberScroll();state.collapsed.clear();render();});on('#collapse-all','click',()=>{rememberScroll();snapshot.tasks.filter((t:Task)=>t.kind==='summary').forEach((t:Task)=>state.collapsed.add(t.id));render();});
  on('[data-zoom]','click',e=>{rememberScroll();state.zoom=e.currentTarget.dataset.zoom;scroll.right=0;render();});
  on('#today','click',()=>{rememberScroll();state.start=dateValue(today())-7*DAY;scroll.right=0;render();});
  on('#previous-window','click',()=>{rememberScroll();const b=bounds();state.start=b.start-Math.floor(b.days/2)*DAY;scroll.right=0;render();});
  on('#next-window','click',()=>{rememberScroll();const b=bounds();state.start=b.start+Math.floor(b.days/2)*DAY;scroll.right=0;render();});
  on('[data-focus-date]','click',e=>{rememberScroll();state.start=dateValue(e.currentTarget.dataset.focusDate)-7*DAY;scroll.right=0;render();});
  on('#refresh-timing','click',()=>{rememberScroll();load().catch(e=>notify(e.message));});
  on('[data-inline]','change',e=>{const input=e.currentTarget as HTMLInputElement;const field=input.dataset.inline!;let value:any=input.value;if(['duration','progress'].includes(field))value=Number(value);if(field==='start'&&!value)value=null;pendingFocus={selector:'[data-inline="'+field+'"][data-task="'+input.dataset.task+'"]',start:input.selectionStart,end:input.selectionEnd};mutate(input.dataset.task,{[field]:value});});
  const left=document.querySelector('.task-pane')!,right=document.querySelector('.timeline-pane')!;
  left.addEventListener('scroll',()=>{if(right.scrollTop!==left.scrollTop)right.scrollTop=left.scrollTop;},{signal});right.addEventListener('scroll',()=>{if(left.scrollTop!==right.scrollTop)left.scrollTop=right.scrollTop;},{signal});
  on('.drawer-close,.drawer-backdrop','click',()=>{if(!leaveEditor())return;selected=null;render();});
  on('#task-form','input',captureDraft);on('#task-form','change',captureDraft);
  on('#task-latest','click',async()=>{captureDraft();try{const latest=await request(`projects/${projectId}/timing`);const task=latest.tasks.find((t:Task)=>t.id===edit?.value.id);if(!task)throw Error('任务已删除，草稿仍保留，不能重新创建替代记录');snapshot=latest;edit?.review(task,latest.revision);render();}catch(error:any){edit?.fail(error.message);notify(error.message);render();}});
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
  on('#delete-task','click',async()=>{if(!confirm('删除此任务及其全部子任务和附件？此操作无法撤销。'))return;const taskId=selected!;await mutate(taskId,{},'DELETE','drawer');});
  on('#task-upload','change',async e=>{
   const files=Array.from((e.target as HTMLInputElement).files||[]);if(!files.length||attachmentBusy)return;const taskId=selected!;attachmentBusy=true;
   const status=document.querySelector('#upload-status')!;let count=0;
   try{for(const file of files){if(file.size>20*1024*1024)throw Error(`${file.name} 超过 20 MB`);status.textContent=`上传中 ${count+1}/${files.length}：${file.name}`;const response=await fetch(`/api/projects/${projectId}/tasks/${taskId}/attachments`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file,signal});const result=await response.json();if(!response.ok)throw Error(result.error);count++;}notify(`${count} 个附件已上传`);}catch(error:any){notify(error.message);}finally{attachmentBusy=false;try{await load();}catch(error:any){notify('附件请求已结束，但刷新失败：'+error.message);render();}}
  });
  on('[data-file-delete]','click',async e=>{if(!confirm('确定删除此附件？'))return;try{await request('attachments/'+e.currentTarget.dataset.fileDelete,{},'DELETE');await load();notify('附件已删除');}catch(error:any){notify(error.message);}});
  on('[data-bar]','keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openTask(e.currentTarget.dataset.bar);}});
  on('[data-bar]','pointerdown',startDrag);
 }
 function startDrag(event:PointerEvent){
  const element=event.currentTarget as HTMLElement,task:Task=snapshot.tasks.find((t:Task)=>t.id===element.dataset.bar);
  if(!canEdit||task.kind==='summary'){openTask(task.id);return;}if(busy||event.button!==0||!task.start||!task.end)return;
  const mode=(event.target as HTMLElement).dataset.handle||'move',startX=event.clientX,boundsAtStart=bounds(),scrollAtStart=document.querySelector('.timeline-pane')!.scrollLeft;
  const originalStart=task.start,originalEnd=task.end,initialLeft=parseFloat(element.style.left),initialWidth=parseFloat(element.style.width);let moved=false,delta=0;
  element.setPointerCapture(event.pointerId);element.classList.add('dragging');
  const move=(e:PointerEvent)=>{delta=Math.round((e.clientX-startX+document.querySelector('.timeline-pane')!.scrollLeft-scrollAtStart)/boundsAtStart.scale);moved=moved||Math.abs(e.clientX-startX)>4;if(!moved)return;const pixels=delta*boundsAtStart.scale;if(mode==='move')element.style.transform=`translateX(${pixels}px)`;else if(mode==='end')element.style.width=Math.max(6,initialWidth+pixels)+'px';else{element.style.left=(initialLeft+pixels)+'px';element.style.width=Math.max(6,initialWidth-pixels)+'px';}};
  const cleanup=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',cancel);element.classList.remove('dragging');};
  const cancel=()=>{cleanup();render();};
  const up=async()=>{cleanup();if(!moved){openTask(task.id);return;}try{if(mode==='move')await mutate(task.id,{start:nextWorkday(iso(dateValue(originalStart)+delta*DAY))});else if(mode==='end'){const end=iso(dateValue(originalEnd)+delta*DAY);await mutate(task.id,{duration:Math.max(1,workdays(originalStart,end))});}else{const start=nextWorkday(iso(dateValue(originalStart)+delta*DAY));await mutate(task.id,{start,duration:Math.max(1,workdays(start,originalEnd))});}}catch(error:any){notify(error.message);render();}};
  element.addEventListener('pointermove',move);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',cancel);
 }
 document.addEventListener('keydown',e=>{if(document.querySelector('#modal')?.childElementCount)return;if(e.key==='Escape'&&(selected||edit)){if(!leaveEditor())return;selected=null;render();}if(e.key==='Tab'){const drawer=document.querySelector('.task-drawer');if(!drawer)return;const focusable=Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')).filter(el=>!el.closest('[hidden]'));const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}},{signal});
 window.addEventListener('beforeunload',e=>{if(edit?.dirty||busy||attachmentBusy){e.preventDefault();e.returnValue='';}},{signal});
 root.addEventListener('click',e=>{const link=(e.target as HTMLElement).closest('a');if(link&&!link.hasAttribute('download')&&!link.href.includes('/api/attachments/')&&(edit?.dirty||busy||attachmentBusy)&&!leaveEditor()){e.preventDefault();e.stopPropagation();}},{signal,capture:true});
 try{await load();}catch(error:any){if(error.name==='AbortError')return;root.innerHTML=shell(`<main class="timing-gate"><h1>暂时无法打开项目</h1><p>${escape(error.message)}</p><a class="primary" href="/">返回项目空间</a></main>`);}
}
