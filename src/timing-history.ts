import type { TimingVersion, VersionKind, PlanChange, TaskDifference, SaveVersionRequest, timingVersions } from '../lib/timing-versions.ts';
import { TimingTransfer } from '/timing-io.js';
type Comparison=ReturnType<ReturnType<typeof timingVersions>['compare']>;
type Context={revision:number;projectVersion:number;canSave:boolean;historical:string|null;version?:TimingVersion;dirty:boolean;canDelete?:boolean};
type Options={projectId:string;signal:AbortSignal;context:()=>Context;capture:()=>void;showPlan:(id:string|null)=>Promise<void>;notify:(message:string)=>void;session?:()=>Record<string,unknown>;canImport?:()=>boolean;flush?:()=>Promise<boolean>};
const esc=(value:unknown='')=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const category=(v:TimingVersion)=>v.kind==='version'?`V${v.sequence}`:v.kind==='baseline'?'基线':v.kind==='unadopted'?'未采用':v.kind==='previous'?'原执行计划':'最终版本';
const label=(v:TimingVersion)=>`${category(v)} · ${v.name}`;
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});

export class TimingHistory {
  private transfer:TimingTransfer;
  private options:Options;
  private open=false;
  private versions:TimingVersion[]=[];
  private loaded=false;
  private busy=false;
  private error='';
  private message='';
  private lastDeleted?:{id:string;name:string};
  private draft={kind:'baseline' as VersionKind,name:'基线',reason:''};
  private attempt?:SaveVersionRequest;
  private from='';
  private to='current';
  private comparison?:Comparison;
  constructor(options:Options){this.options=options;this.transfer=new TimingTransfer({...options,context:()=>({canEdit:options.canImport?.()??options.context().canSave,historical:options.context().historical,dirty:options.context().dirty}),reload:()=>options.showPlan(null),onStateChange:()=>this.syncToolbar()});}
  invalidate(){this.loaded=false;void this.loadList().then(()=>this.redraw()).catch(()=>{});}
  async openPanel(){if(this.busy||this.transfer.isBusy())return;this.transfer.closePanel();this.open=true;this.redraw();if(!this.loaded)await this.run(async()=>{await this.loadList();});}
  panelState(){return {versions:this.open,files:this.transfer.isOpen()};}
  async togglePanel(){if(this.busy||this.transfer.isBusy())return;if(this.open){this.open=false;this.redraw();}else await this.openPanel();}
  async toggleTransfer(){if(this.busy||this.transfer.isBusy())return;this.open=false;this.redraw();await this.transfer.togglePanel();this.syncToolbar();}
  async showCurrent(){await this.run(()=>this.options.showPlan(null));}
  private syncToolbar(){
    const state=this.panelState(),busy=this.busy||this.transfer.isBusy();
    for(const [id,expanded] of [['preview-versions',state.versions],['preview-files',state.files]] as const){const button=document.querySelector<HTMLButtonElement>('#'+id);if(button){button.setAttribute('aria-expanded',String(expanded));button.classList.toggle('chosen',expanded);}}
    document.querySelectorAll<HTMLButtonElement>('#timing-draft-workflow button').forEach(button=>button.disabled=busy);
  }
  private async request(path:string,body?:unknown,method='POST'){
    const response=await fetch(`/api/projects/${this.options.projectId}/timing/${path}`,{signal:this.options.signal,...(body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error+(data.requestId?`（请求 ${data.requestId}）`:'')),{status:response.status});return data;
  }
  private redraw(){if(this.options.signal.aborted)return;const node=document.querySelector('#timing-history');if(node){node.outerHTML=this.historyHtml();this.bind();this.syncToolbar();}}
  html(){return this.historyHtml()+this.transfer.html();}
  private historyHtml(){
    const ctx=this.options.context(),v=ctx.version;
    return `<section id="timing-history" class="timing-history plan-tool-panel" aria-label="排期版本管理" ${this.open?'':'hidden'}>${v?`<p class="history-reason">${v.kind==='unadopted'?'未采用草稿 · 未曾执行。':''}${v.sourceRevision!==undefined?'草稿来源：'+esc(v.sourceVersion||'执行计划')+' · 修订 '+v.sourceRevision+'。':''}修改原因：${esc(v.reason)}</p><p class="history-note">任务表与甘特图均为保存时数据，不重新排期。附件不属于计划版本；返回当前计划后查看附件${ctx.dirty?'。当前计划的任务草稿已保留':''}。</p>`:''}${this.open?`<div class="history-content"><h3 class="plan-panel-title">版本管理</h3><p class="history-note">采用草稿自动生成 V 序列；基线和最终版本仍可单独保留。未采用记录不代表执行过。已有项目不补造历史；版本只读，比较当前计划使用正式执行数据。</p>${ctx.canSave&&!ctx.historical?`<form id="save-plan-version" class="version-form"><label>版本类型<select name="kind"><option value="baseline" ${this.draft.kind==='baseline'?'selected':''}>基线</option><option value="version" ${this.draft.kind==='version'?'selected':''}>V 序列（自动编号）</option><option value="final" ${this.draft.kind==='final'?'selected':''}>最终版本</option></select></label><label>版本名称<input name="name" value="${esc(this.draft.name)}" maxlength="120" required></label><label class="version-reason">修改原因<textarea name="reason" rows="2" maxlength="2000" required placeholder="记录本次保留版本的原因…">${esc(this.draft.reason)}</textarea></label><button type="submit" class="primary compact">${this.busy?'处理中…':'保存版本'}</button><button type="button" class="small-btn" data-history-action="refresh">刷新当前计划以核对</button></form>`:''}<p class="form-error" role="alert">${esc(this.error)}</p><p class="history-note" role="status">${esc(this.message)}${this.lastDeleted?'<button type="button" class="small-btn" data-history-restore="'+this.lastDeleted.id+'">撤销删除</button>':''}</p><div class="version-list-wrap"><table class="version-list"><thead><tr><th>已保存版本</th><th>保存人 / 时间</th><th>修改原因</th><th>操作</th></tr></thead><tbody>${this.versions.map(v=>`<tr><td><b>${esc(label(v))}</b><small>修订 ${v.revision} · ${v.id.slice(0,8)}</small></td><td>${esc(v.actorName)}<small>${esc(time(v.savedAt))}</small></td><td class="version-reason-cell">${esc(v.reason)}</td><td><div class="version-row-actions"><button class="small-btn" data-history-open="${v.id}">预览计划</button>${ctx.canDelete?`<button class="small-btn danger" data-history-delete="${v.id}" aria-label="删除 ${esc(label(v))}">删除版本</button>`:''}</div></td></tr>`).join('')||`<tr><td colspan="4" class="history-note">${this.loaded?'尚无保留版本。保存第一个基线后将在这里显示。':'正在读取版本列表…'}</td></tr>`}</tbody></table></div>${this.versions.length?`<form id="compare-plan-versions" class="version-compare-form"><label>来源<select name="from">${this.selectOptions(this.from)}</select></label><span>→</span><label>目标<select name="to">${this.selectOptions(this.to)}</select></label><button class="small-btn" type="submit">比较计划</button></form>${this.comparison?this.comparisonHtml(this.comparison):''}`:''}</div>`:''}</section>`;
  }
  private selectOptions(selected:string){return `<option value="current" ${selected==='current'?'selected':''}>当前计划（服务器已保存）</option>`+this.versions.map(v=>`<option value="${v.id}" ${selected===v.id?'selected':''}>${esc(label(v))} · ${esc(time(v.savedAt))}</option>`).join('');}
  private changesHtml(changes:PlanChange[]){return changes.map(c=>`<div class="plan-change"><b>${esc(c.label)}</b><span>${esc(c.before||'空')} → ${esc(c.after||'空')}${c.delta!==undefined?` <em>${c.delta===null?'无日期偏移':`${c.delta>0?'+':''}${c.delta} 日历天`}</em>`:''}</span></div>`).join('');}
  private differenceHtml(d:TaskDifference){
    const t=d.after??d.before!;
    return `<article class="task-difference"><header><b>${esc(d.title)}</b><span class="history-badge">${{added:'新增',removed:'删除',changed:'修改'}[d.type]}</span><small>${esc(d.id)}</small></header>${d.changes.length?this.changesHtml(d.changes):`<p>${esc(t.start||'未排期')} → ${esc(t.end||'未排期')} · ${t.duration} 工作日 · ${esc(t.owner||'无负责人')} · ${{task:'普通任务',summary:'汇总阶段',milestone:'里程碑'}[t.kind]} · 父任务 ${esc(t.parentId||'一级目录')} · 前置 ${esc(t.predecessors.join('、')||'无')}</p>`}</article>`;
  }
  private comparisonHtml(c:Comparison){
    const name=(v:TimingVersion|null,revision:number)=>v?label(v):`当前计划 / 修订 ${revision}`;
    return `<section class="plan-comparison" aria-label="计划比较结果"><h3>${esc(name(c.from.version,c.from.revision))} → ${esc(name(c.to.version,c.to.revision))}</h3><p class="history-note">${esc(c.dateBasis)}</p><p class="comparison-counts">新增 ${c.summary.added} · 删除 ${c.summary.removed} · 修改 ${c.summary.changed} · 未变 ${c.summary.unchanged}</p>${c.projectChanges.length?`<article class="task-difference"><h4>项目信息变化</h4>${this.changesHtml(c.projectChanges)}</article>`:''}${c.differences.map(d=>this.differenceHtml(d)).join('')||'<p class="history-note">任务无变化。</p>'}</section>`;
  }
  bind(){
    this.transfer.bind();this.syncToolbar();
    const node=document.querySelector('#timing-history');if(!node)return;
    node.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,textarea,select,button').forEach(el=>el.disabled=this.busy);
    node.addEventListener('click',async event=>{
      const button=(event.target as HTMLElement).closest<HTMLElement>('[data-history-action],[data-history-open],[data-history-delete],[data-history-restore]');if(!button||this.busy)return;
      this.options.capture();const action=button.dataset.historyAction;
      if(button.dataset.historyDelete){
        const id=button.dataset.historyDelete,version=this.versions.find(v=>v.id===id);if(!version||!this.options.context().canDelete)return;
        if(!confirm('删除“'+label(version)+'”？将从历史列表移除，可撤销删除；当前执行计划、共享草稿和附件不受影响。'))return;
        await this.run(async()=>{await this.request('versions/'+id,{},'DELETE');this.lastDeleted={id,name:label(version)};this.comparison=undefined;this.message='已删除 '+label(version)+'。';await this.loadList();if(this.options.context().historical===id)await this.options.showPlan(null);});return;
      }
      if(button.dataset.historyRestore){
        const id=button.dataset.historyRestore;await this.run(async()=>{await this.request('versions/'+id+'/restore',{});this.lastDeleted=undefined;this.message='历史版本已恢复。';this.comparison=undefined;await this.loadList();});return;
      }
      if(action==='toggle'){this.open=!this.open;this.redraw();if(this.open&&!this.loaded)await this.run(async()=>{await this.loadList();});return;}
      if(action==='current'||action==='refresh'||button.dataset.historyOpen)await this.run(async()=>{
        await this.options.showPlan(button.dataset.historyOpen??null);
        if(action==='refresh'){this.attempt=undefined;this.message='已载入当前计划，请核对任务表和版本信息后，再点击保存版本。';}
      });
    },{signal:this.options.signal});
    node.querySelector('#save-plan-version')?.addEventListener('input',event=>{
      const form=event.currentTarget as HTMLFormElement,values=Object.fromEntries(new FormData(form));
      this.draft={kind:values.kind as VersionKind,name:String(values.name),reason:String(values.reason)};this.attempt=undefined;
    },{signal:this.options.signal});
    node.querySelector('#save-plan-version select')?.addEventListener('change',()=>{
      if(['基线','V 版本','最终版本'].includes(this.draft.name)){this.draft.name={baseline:'基线',version:'V 版本',final:'最终版本'}[this.draft.kind];const input=node.querySelector<HTMLInputElement>('[name="name"]');if(input)input.value=this.draft.name;}
    },{signal:this.options.signal});
    node.querySelector('#save-plan-version')?.addEventListener('submit',async event=>{
      event.preventDefault();if(this.busy)return;this.options.capture();const ctx=this.options.context();
      if(ctx.dirty){this.error='请先保存当前任务草稿，再保存完整计划版本。';this.redraw();return;}
      if(!this.attempt)this.attempt={...this.draft,revision:ctx.revision,projectVersion:ctx.projectVersion,requestKey:crypto.randomUUID()};
      await this.run(async()=>{const result=await this.request('versions',this.attempt);this.attempt=undefined;this.draft.reason='';this.message=`已保存 ${label(result.version)}。排期编辑通过共享草稿进行。`;this.options.notify(this.message);await this.loadList();});
    },{signal:this.options.signal});
    node.querySelector('#compare-plan-versions')?.addEventListener('change',event=>{
      const values=Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement));this.from=String(values.from);this.to=String(values.to);this.comparison=undefined;
      node.querySelector('.plan-comparison')?.remove();
    },{signal:this.options.signal});
    node.querySelector('#compare-plan-versions')?.addEventListener('submit',async event=>{
      event.preventDefault();if(this.busy)return;this.options.capture();
      if(this.from===this.to){this.error='请选择两个不同的计划。';this.redraw();return;}
      await this.run(async()=>{this.comparison=await this.request(`compare?from=${encodeURIComponent(this.from)}&to=${encodeURIComponent(this.to)}`);});
    },{signal:this.options.signal});
  }
  private async loadList(){const result=await this.request('versions');const hadVersions=this.versions.length>0;this.versions=result.versions;this.loaded=true;if(!this.versions.some(v=>v.id===this.to))this.to='current';if(!this.from||!hadVersions||!this.versions.some(v=>v.id===this.from))this.from=this.versions[0]?.id??'current';}
  private async run(action:()=>Promise<void>){
    if(this.busy)return;this.busy=true;this.error='';this.redraw();
    try{await action();}catch(error:any){if(error.name!=='AbortError')this.error=error.message;}finally{this.busy=false;this.redraw();}
  }
}
