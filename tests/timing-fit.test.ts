import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DAY,dateValue} from '../lib/schedule.ts';

// Run the real renderer with a small DOM fixture; no browser/layout engine is implied.
const source=stripTypeScriptTypes(readFileSync(new URL('../src/timing.ts',import.meta.url),'utf8'))
 .replace("'/schedule.js'",JSON.stringify(new URL('../lib/schedule.ts',import.meta.url).href))
 .replace("'/drafts.js'",JSON.stringify(new URL('../src/drafts.ts',import.meta.url).href))
 .replace("'/timing-layout.js'",JSON.stringify(new URL('../src/timing-layout.ts',import.meta.url).href))
 .replace("import { TimingHistory } from '/timing-history.js';",'class TimingHistory { html(){return "";} bind(){} }');
const timing=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('D6 ranges include both endpoints and diamonds; invalid, empty, single-day and century spans stay finite with sparse ticks',()=>{
 for(const tasks of [[],[{start:'bad',end:'bad'}],[{start:'2026-10-30',end:null}],[{start:'2026-10-30',end:'2026-10-30'}],[{start:'2000-01-01',end:'2100-12-31'}]]){
  for(const width of [240,500,1100]){
   const b=timing.fitProjectBounds(tasks,width,'2026-10-30');
   assert.equal(b.width,width);assert.ok(Number.isFinite(b.scale)&&b.scale>0);
   const ticks=timing.projectTicks(b);assert.ok(ticks.ticks.length<width/30+3);
   assert.ok(Math.abs(ticks.ticks.reduce((n,t)=>n+t.width,0)-width)<.001);
   if(tasks[0]?.end&&tasks[0].start!=='bad'){
    assert.ok((dateValue(tasks[0].start!)-b.start)/DAY*b.scale>=16);
    assert.ok((dateValue(tasks[0].end)+DAY-b.start)/DAY*b.scale<=width-16);
   }
  }
 }
});

test('D7 day/week/month keep their scale, span every task, fill wide windows and include navigation targets',()=>{
 const tasks=[{start:'2025-05-15',end:'2025-05-15'},{start:'2027-12-15',end:'2028-02-01'}];
 for(const [zoom,scale] of [['day',32],['week',12],['month',5]] as const)for(const width of [280,3372,5000]){
  const b=timing.scrollableProjectBounds(tasks,zoom,width,'2026-10-31');
  assert.equal(b.scale,scale);assert.ok(b.width>width);assert.ok(b.start<dateValue(tasks[0].start));assert.ok(b.start+b.days*DAY>dateValue(tasks[1].end));
  const short=timing.scrollableProjectBounds([{start:'2026-10-01',end:'2026-10-05'}],zoom,width,'2026-10-31');assert.ok(short.width>width);
  for(const anchor of [dateValue('2020-01-01'),dateValue('2030-01-01')]){const target=timing.scrollableProjectBounds(tasks,zoom,width,'2026-10-31',anchor);assert.ok(target.start<=anchor);assert.ok(target.start+target.days*DAY>=anchor+Math.ceil(width/scale)*DAY);}
 }
 for(const tasks of [[],[{start:'bad',end:'bad'}]])assert.ok(Number.isFinite(timing.scrollableProjectBounds(tasks,'month',3372,'bad').width));
});

test('D6 actual zoom handlers, collapse, date refresh and ResizeObserver preserve fitting and original scales',async()=>{
 let html='',timeline='',width=640,resize=()=>{},renders=0,captured=false,frameId=0;
 const frames=new Map<number,FrameRequestCallback>(),classes=new Set<string>();
 const events=new Map<string,Function>();
 const node=(selector:string)=>({addEventListener:(event:string,fn:Function,options?:{signal?:AbortSignal})=>{const key=selector+':'+event;events.set(key,fn);options?.signal?.addEventListener('abort',()=>{if(events.get(key)===fn)events.delete(key);},{once:true});}});
 const left={...node('left'),scrollLeft:0,scrollTop:88};
 const right={...node('right'),scrollLeft:0,scrollTop:88,scrollWidth:100000,clientHeight:350,get clientWidth(){return width;},set innerHTML(v:string){timeline=v;},querySelectorAll:()=>[],getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture:()=>captured=true,hasPointerCapture:()=>captured,releasePointerCapture:()=>captured=false};
 const root={...node('root'),set innerHTML(v:string){html=v;renders++;timeline=v.slice(v.indexOf('<div class="timeline-canvas'));},querySelectorAll:()=>[]};
 const globals=['document','window','ResizeObserver','fetch','requestAnimationFrame','cancelAnimationFrame'];
 const originals=globals.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 const task=(id:string,start:string,end:string,parentId:string|null=null,kind='task')=>({id,parentId,start,end,kind,order:0,title:id,progress:0,predecessors:[]});
 const tasks=[task('summary','2025-01-01','2028-12-31',null,'summary'),task('first','2025-01-01','2025-01-01','summary','milestone'),task('last','2028-12-31','2028-12-31','summary','milestone')];
 const values={document:{body:{classList:{add:(name:string)=>classes.add(name),remove:(name:string)=>classes.delete(name)}},activeElement:null,...node('document'),querySelector:(s:string)=>s==='#app'?root:s==='.task-pane'?left:s==='.timeline-pane'?right:null,querySelectorAll:(s:string)=>[node(s)]},window:node('window'),ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){}},fetch:async()=>({ok:true,json:async()=>({tasks,project:{title:'fixture',owner:'test',startDate:'2025-01-01'},attachments:[],capabilities:[],members:[],revision:0})}),requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:(id:number)=>frames.delete(id)};
 for(const k of globals)Object.defineProperty(globalThis,k,{configurable:true,value:values[k]});
 const click=async(s:string,dataset={})=>events.get(s+':click')!({currentTarget:{dataset}});
 try{
  await timing.mountTiming({projectId:'d6-test',user:{id:'test'},settings:{}});
  assert.match(timeline,new RegExp('width:'+timing.scrollableProjectBounds(tasks,'week',width,'2025-01-01').width+'px'));assert.doesNotMatch(timeline,/offscreen-task/);
  await click('[data-zoom]',{zoom:'project'});
  assert.match(html,/data-zoom="project" aria-pressed="true"/);assert.match(timeline,/width:640px/);assert.doesNotMatch(timeline,/offscreen-task/);
  const original=timeline.match(/data-bar="summary"[^>]*style="([^"]+)/)![1];
  await click('#collapse-all');assert.equal(timeline.match(/data-bar="summary"[^>]*style="([^"]+)/)![1],original);
  right.scrollTop=88;const count=renders;width=360;resize();assert.equal(renders,count);assert.match(timeline,/width:360px/);assert.equal(right.scrollTop,88);
  await click('#expand-all');tasks[2].start=tasks[2].end='2035-12-31';await click('#refresh-timing');await new Promise(resolve=>setImmediate(resolve));assert.match(timeline,/203[56]年/);assert.doesNotMatch(timeline,/offscreen-task/);
  for(const [zoom,scale] of [['day',32],['week',12],['month',5]]){await click('[data-zoom]',{zoom});assert.match(timeline,new RegExp('--day-width:'+scale+'px'));assert.doesNotMatch(timeline,/project-timeline|offscreen-task/);}
  right.scrollLeft=123;const before=renders;width=5000;resize();assert.equal(renders,before);assert.ok(Number(timeline.match(/style="width:(\d+)px/)![1])>=width);assert.equal(right.scrollLeft,123);
  const pan=(target:any={closest:()=>null})=>events.get('right:pointerdown')!({button:0,pointerId:1,clientX:200,clientY:100,currentTarget:right,target,preventDefault(){}});
  pan({closest:()=>({})});assert.equal(captured,false); // Tasks and controls retain their own actions.
  pan();assert.ok(captured);events.get('right:pointermove')!({pointerId:1,clientX:100});assert.equal(frames.size,1);
  const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(0));assert.equal(right.scrollLeft,223);assert.equal(renders,before);
  events.get('right:pointermove')!({pointerId:1,clientX:90});events.get('right:pointerup')!({pointerId:1,clientX:80});assert.equal(frames.size,0);assert.equal(right.scrollLeft,243);assert.ok(!captured);assert.ok(!classes.has('panning-timeline'));assert.equal(events.has('right:pointermove'),false);
  for(const ending of ['right:pointercancel','window:blur']){pan();events.get(ending)!({pointerId:1});assert.ok(!captured);assert.ok(!classes.has('panning-timeline'));}
  await click('#today');assert.ok(right.scrollLeft>0);const atToday=right.scrollLeft;await click('#next-window');assert.ok(right.scrollLeft>atToday);await click('#previous-window');assert.ok(right.scrollLeft<atToday+2500);
 }finally{timing.unmountTiming();globals.forEach((k,i)=>{if(originals[i])Object.defineProperty(globalThis,k,originals[i]!);else Reflect.deleteProperty(globalThis,k);});}
});
