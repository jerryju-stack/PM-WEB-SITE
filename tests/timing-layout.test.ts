import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TimingLayout,readLayoutPreference,splitGeometry,DEFAULT_SPLIT} from '../src/timing-layout.ts';

test('D7 invalid or incompatible preferences fall back; restored ratios obey viewport limits',()=>{
 for(const raw of [null,'bad','{}','null','{"version":2,"mode":"split","ratio":0.5}','{"version":1,"mode":"other","ratio":0.5}','{"version":1,"mode":"split","ratio":null}','{"version":1,"mode":"split","ratio":"0.5"}','{"version":1,"mode":"split","ratio":0}','{"version":1,"mode":"split","ratio":1}'])assert.deepEqual(readLayoutPreference(raw),{version:1,mode:'split',ratio:DEFAULT_SPLIT});
 assert.deepEqual(readLayoutPreference('{"version":1,"mode":"gantt","ratio":0.7}'),{version:1,mode:'gantt',ratio:.7});
 for(const width of [612,640,900,1800])for(const ratio of [.01,.55,.99]){const g=splitGeometry(width,ratio);assert.ok(!g.narrow);assert.ok(g.left>=320);assert.ok(g.available-g.left>=280);}
 assert.ok(splitGeometry(611,.99).narrow);
});

// Exercise the real layout controller and listeners. Browser geometry is checked separately.
class Node extends EventTarget {
 hidden=false;scrollLeft=0;scrollTop=0;clientWidth=1012;dataset:Record<string,string>={};attributes=new Map<string,string>();capture=false;
 children=new Map<string,Node>();buttons:Node[]=[];classes=new Set<string>();textContent='';
 style={setProperty:(_key:string,_value:string)=>{}};
 classList={add:(s:string)=>this.classes.add(s),remove:(s:string)=>this.classes.delete(s),toggle:(s:string,enabled:boolean)=>{if(enabled)this.classes.add(s);else this.classes.delete(s);}};
 querySelector(s:string){return this.children.get(s)!;}querySelectorAll(){return this.buttons;}
 setAttribute(k:string,v:string){this.attributes.set(k,v);}
 setPointerCapture(){this.capture=true;}hasPointerCapture(){return this.capture;}releasePointerCapture(){this.capture=false;}
 emit(type:string,props:Record<string,unknown>={}){const e=new Event(type,{cancelable:true});Object.assign(e,props);this.dispatchEvent(e);return e;}
}
test('D7 real controller: modes retain DOM/scroll, drag batching, keyboard, reset, narrow recovery and cleanup',()=>{
 const original=new Map(['document','window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const workspace=new Node(),left=new Node(),right=new Node(),separator=new Node(),tools=new Node(),hint=new Node(),body=new Node(),win=new Node(),doc=new Node();
 workspace.children=new Map([['.task-pane',left],['.timeline-pane',right],['.schedule-separator',separator]]);tools.children.set('.layout-hint',hint);
 tools.buttons=['details','split','gantt'].map(mode=>{const b=new Node();b.dataset.layoutMode=mode;return b;});
 let resize=()=>{},disconnected=false,writes=0,reflows=0,frameId=0;const frames=new Map<number,FrameRequestCallback>();
 const globals={document:Object.assign(doc,{body}),window:win,ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){disconnected=true;}},requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:(id:number)=>frames.delete(id)};
 for(const [k,value] of Object.entries(globals))Object.defineProperty(globalThis,k,{configurable:true,value});
 const flush=()=>{const batch=[...frames];frames.clear();batch.forEach(([,fn])=>fn(0));};
 const preference=readLayoutPreference(null),positions={left:0,right:0,top:0};let controller:TimingLayout|undefined;
 try{
  controller=new TimingLayout(workspace as any,tools as any,preference,()=>writes++,()=>reflows++,positions);
  assert.equal(workspace.dataset.layout,'split');assert.equal(separator.attributes.get('aria-valuenow'),'55');
  left.scrollLeft=120;right.scrollLeft=220;left.scrollTop=right.scrollTop=176;
  assert.ok(tools.buttons[0].emit('pointerdown').defaultPrevented);
  tools.buttons[0].emit('click');assert.ok(right.hidden);assert.equal(left.hidden,false);assert.equal(separator.hidden,true);
  left.scrollTop=264;tools.buttons[2].emit('click');assert.ok(left.hidden);assert.equal(right.scrollLeft,220);assert.equal(right.scrollTop,264);
  right.scrollTop=352;tools.buttons[1].emit('click');assert.equal(left.scrollLeft,120);assert.equal(left.scrollTop,352);assert.equal(right.scrollTop,352);assert.equal(workspace.querySelector('.task-pane'),left);
  const before=writes;assert.ok(separator.emit('pointerdown',{button:0,pointerId:1,clientX:550}).defaultPrevented);
  separator.emit('pointermove',{pointerId:1,clientX:600});separator.emit('pointermove',{pointerId:1,clientX:650});assert.equal(frames.size,1);assert.equal(writes,before);
  flush();assert.equal(preference.ratio,.65);assert.equal(writes,before);assert.ok(body.classes.has('resizing-schedule'));
  separator.emit('pointerup',{pointerId:1,clientX:650});assert.equal(writes,before+1);assert.ok(!separator.capture);assert.ok(!body.classes.has('resizing-schedule'));
  separator.emit('pointermove',{pointerId:1,clientX:0});flush();assert.equal(preference.ratio,.65);
  tools.buttons[2].emit('click');tools.buttons[1].emit('click');assert.equal(preference.ratio,.65);
  separator.emit('keydown',{key:'ArrowLeft',shiftKey:false});assert.equal(preference.ratio,.64);
  separator.emit('keydown',{key:'ArrowRight',shiftKey:true});assert.equal(preference.ratio,.69);
  separator.emit('keydown',{key:'Home'});assert.equal(preference.ratio,.55);
  separator.emit('keydown',{key:'ArrowLeft',shiftKey:true});separator.emit('dblclick');assert.equal(preference.ratio,.55);
  for(const end of ['pointercancel','lostpointercapture','blur','Escape','visibilitychange']){
   separator.emit('pointerdown',{button:0,pointerId:2,clientX:550});separator.emit('pointermove',{pointerId:2,clientX:600});
   if(end==='blur')win.emit('blur');else if(end==='Escape')win.emit('keydown',{key:'Escape'});else if(end==='visibilitychange'){doc.hidden=true;doc.emit('visibilitychange');doc.hidden=false;}else separator.emit(end,{pointerId:2});
   assert.equal(frames.size,0);assert.ok(!body.classes.has('resizing-schedule'));assert.ok(!separator.capture);
  }
  const ratio=preference.ratio,count=writes;workspace.clientWidth=500;resize();assert.equal(workspace.dataset.layout,'details');assert.match(hint.textContent,/窗口较窄/);assert.equal(writes,count);assert.equal(preference.mode,'split');assert.equal(preference.ratio,ratio);
  tools.buttons[2].emit('click');assert.equal(workspace.dataset.layout,'gantt');tools.buttons[1].emit('click');workspace.clientWidth=1012;resize();assert.equal(workspace.dataset.layout,'split');assert.equal(preference.ratio,ratio);
  separator.emit('pointerdown',{button:0,pointerId:3,clientX:550});separator.emit('pointermove',{pointerId:3,clientX:9999});flush();assert.equal(preference.ratio,.72);
  controller.destroy();assert.ok(disconnected);assert.ok(!body.classes.has('resizing-schedule'));assert.equal(frames.size,0);
  const final=preference.ratio;separator.emit('keydown',{key:'ArrowLeft'});tools.buttons[0].emit('click');assert.equal(preference.ratio,final);assert.equal(preference.mode,'split');assert.ok(reflows>5);
  // A page redraw (for example date zoom in single-side mode) retains the hidden pane context too.
  preference.mode='gantt';left.scrollLeft=right.scrollLeft=left.scrollTop=right.scrollTop=0;
  controller=new TimingLayout(workspace as any,tools as any,preference,()=>writes++,()=>reflows++,positions);
  assert.equal(right.scrollLeft,220);assert.equal(right.scrollTop,352);
  tools.buttons[1].emit('click');assert.equal(left.scrollLeft,120);assert.equal(left.scrollTop,352);
 }finally{controller?.destroy();for(const [k,value] of original){if(value)Object.defineProperty(globalThis,k,value);else Reflect.deleteProperty(globalThis,k);}}
});
