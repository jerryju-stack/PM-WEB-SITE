// D7: browser-only preferences; never part of a plan or its revision.
export type LayoutMode='details'|'split'|'gantt';
export type LayoutPreference={version:1;mode:LayoutMode;ratio:number};
export const DEFAULT_SPLIT=.55;
const HANDLE=12,MIN_DETAILS=320,MIN_GANTT=280;
export function readLayoutPreference(raw:string|null):LayoutPreference {
 const fallback:LayoutPreference={version:1,mode:'split',ratio:DEFAULT_SPLIT};
 try{const p=JSON.parse(raw||'null');return p?.version===1&&['details','split','gantt'].includes(p.mode)&&typeof p.ratio==='number'&&Number.isFinite(p.ratio)&&p.ratio>0&&p.ratio<1?{version:1,mode:p.mode,ratio:p.ratio}:fallback;}catch{return fallback;}
}
export function splitGeometry(width:number,ratio:number){
 const available=Math.max(0,width-HANDLE),narrow=available<MIN_DETAILS+MIN_GANTT;
 return {available,narrow,left:narrow?available:Math.max(MIN_DETAILS,Math.min(available-MIN_GANTT,available*ratio)),min:MIN_DETAILS,max:available-MIN_GANTT};
}
export class TimingLayout {
 private events=new AbortController();
 private observer:ResizeObserver;
 private frame=0;
 private endDrag:(()=>void)|undefined;
 private positions:{left:number;right:number;top:number};
 private left:HTMLElement;
 private right:HTMLElement;
 private separator:HTMLElement;
 private workspace:HTMLElement;
 private tools:HTMLElement;
 private preference:LayoutPreference;
 private save:()=>void;
 private resized:()=>void;
 constructor(workspace:HTMLElement,tools:HTMLElement,preference:LayoutPreference,save:()=>void,resized:()=>void,positions={left:0,right:0,top:0}){
  this.workspace=workspace;this.tools=tools;this.preference=preference;this.save=save;this.resized=resized;this.positions=positions;
  this.left=workspace.querySelector('.task-pane')!;this.right=workspace.querySelector('.timeline-pane')!;this.separator=workspace.querySelector('.schedule-separator')!;
  const signal=this.events.signal;
  // Preserve active inline input: layout controls must not blur it into an autosave.
  tools.querySelectorAll<HTMLElement>('[data-layout-mode]').forEach(button=>{
   button.addEventListener('pointerdown',e=>e.preventDefault(),{signal});
   button.addEventListener('click',()=>{this.endDrag?.();this.preference.mode=button.dataset.layoutMode as LayoutMode;this.apply();this.save();},{signal});
  });
  this.separator.addEventListener('pointerdown',e=>this.startDrag(e),{signal});
  this.separator.addEventListener('dblclick',e=>{e.preventDefault();this.reset();},{signal});
  this.separator.addEventListener('keydown',e=>{
   if(e.key==='Home'){e.preventDefault();this.reset();return;}
   if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
   e.preventDefault();const g=splitGeometry(workspace.clientWidth,preference.ratio);if(g.narrow)return;
   const pixels=(e.shiftKey?50:10)*(e.key==='ArrowLeft'?-1:1);
   this.preference.ratio=Math.max(g.min,Math.min(g.max,g.left+pixels))/g.available;this.apply();this.save();
  },{signal});
  this.observer=new ResizeObserver(()=>this.apply());this.observer.observe(workspace);this.apply(false);
 }
 private remember(){
  if(!this.left.hidden){this.positions.left=this.left.scrollLeft;this.positions.top=this.left.scrollTop;}
  if(!this.right.hidden){this.positions.right=this.right.scrollLeft;this.positions.top=this.right.scrollTop;}
 }
 private reset(){this.endDrag?.();this.preference.ratio=DEFAULT_SPLIT;this.apply();this.save();}
 private apply(remember=true){
  if(remember)this.remember();const g=splitGeometry(this.workspace.clientWidth,this.preference.ratio);
  const mode=this.preference.mode==='split'&&g.narrow?'details':this.preference.mode;
  if(mode!=='split')this.endDrag?.();
  this.workspace.dataset.layout=mode;
  this.workspace.style.setProperty('--detail-width',g.left+'px');
  this.left.hidden=mode==='gantt';this.right.hidden=mode==='details';this.separator.hidden=mode!=='split';
  const percent=g.available?Math.round(g.left/g.available*100):55;
  this.separator.setAttribute('aria-valuenow',String(percent));
  this.separator.setAttribute('aria-valuemin',String(Math.round(g.min/Math.max(1,g.available)*100)));
  this.separator.setAttribute('aria-valuemax',String(Math.round(g.max/Math.max(1,g.available)*100)));
  this.separator.setAttribute('aria-valuetext',`详细信息 ${percent}%，甘特图 ${100-percent}%`);
  this.tools.querySelectorAll<HTMLElement>('[data-layout-mode]').forEach(button=>{const chosen=button.dataset.layoutMode===this.preference.mode;button.setAttribute('aria-pressed',String(chosen));button.classList.toggle('chosen',chosen);});
  const hint=this.tools.querySelector<HTMLElement>('.layout-hint')!;
  hint.textContent=g.narrow&&this.preference.mode==='split'?'窗口较窄，暂仅显示详细信息；可切换甘特图':'双击分隔栏恢复默认比例';
  this.resized();
  if(!this.left.hidden){this.left.scrollLeft=this.positions.left;this.left.scrollTop=this.positions.top;}
  if(!this.right.hidden){this.right.scrollLeft=this.positions.right;this.right.scrollTop=this.positions.top;}
 }
 private startDrag(event:PointerEvent){
  if(event.button!==0||this.endDrag)return;
  event.preventDefault();event.stopPropagation();
  const g=splitGeometry(this.workspace.clientWidth,this.preference.ratio);if(g.narrow)return;
  const startX=event.clientX,startLeft=g.left;
  const dragEvents=new AbortController(),signal=dragEvents.signal;
  let latest=event.clientX,applied=event.clientX,changed=false;
  const flush=()=>{
   this.frame=0;if(latest===applied)return;applied=latest;
   const current=splitGeometry(this.workspace.clientWidth,this.preference.ratio);if(current.narrow)return;
   const left=Math.max(current.min,Math.min(current.max,startLeft+latest-startX));
   this.preference.ratio=left/current.available;changed=true;this.apply();
  };
  const finish=()=>{
   if(this.frame)cancelAnimationFrame(this.frame);flush();
   this.endDrag=undefined;dragEvents.abort();
   this.workspace.classList.remove('resizing-layout');document.body.classList.remove('resizing-schedule');
   if(this.separator.hasPointerCapture(event.pointerId))this.separator.releasePointerCapture(event.pointerId);
   if(changed)this.save();
  };
  this.endDrag=finish;
  this.workspace.classList.add('resizing-layout');document.body.classList.add('resizing-schedule');
  this.separator.setPointerCapture(event.pointerId);
  this.separator.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;latest=e.clientX;if(!this.frame)this.frame=requestAnimationFrame(flush);},{signal});
  this.separator.addEventListener('pointerup',e=>{if(e.pointerId===event.pointerId){latest=e.clientX;finish();}},{signal});
  this.separator.addEventListener('pointercancel',e=>{if(e.pointerId===event.pointerId)finish();},{signal});
  this.separator.addEventListener('lostpointercapture',e=>{if(e.pointerId===event.pointerId)finish();},{signal});
  window.addEventListener('blur',finish,{signal});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish();}},{signal,capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish();},{signal});
 }
 destroy(){this.endDrag?.();if(this.frame)cancelAnimationFrame(this.frame);this.observer.disconnect();this.events.abort();}
}
