import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DAY,dateValue} from '../lib/schedule.ts';

// Run the real renderer with a small DOM fixture; no browser/layout engine is implied.
const source=stripTypeScriptTypes(readFileSync(new URL('../src/timing.ts',import.meta.url),'utf8'))
 .replace("'/schedule.js'",JSON.stringify(new URL('../lib/schedule.ts',import.meta.url).href))
 .replace("'/drafts.js'",JSON.stringify(new URL('../src/drafts.ts',import.meta.url).href))
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

test('D6 actual zoom handlers, collapse, date refresh and ResizeObserver preserve fitting and original scales',async()=>{
 let html='',timeline='',width=640,resize=()=>{},renders=0;
 const events=new Map<string,Function>();
 const node=(selector:string)=>({addEventListener:(event:string,fn:Function)=>events.set(selector+':'+event,fn)});
 const left={...node('left'),scrollLeft:0,scrollTop:88};
 const right={...node('right'),scrollLeft:0,scrollTop:88,get clientWidth(){return width;},set innerHTML(v:string){timeline=v;},querySelectorAll:()=>[]};
 const root={...node('root'),set innerHTML(v:string){html=v;renders++;timeline=v.slice(v.indexOf('<div class="timeline-canvas'));},querySelectorAll:()=>[]};
 const globals=['document','window','ResizeObserver','fetch'];
 const originals=globals.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 const task=(id:string,start:string,end:string,parentId:string|null=null,kind='task')=>({id,parentId,start,end,kind,order:0,title:id,progress:0,predecessors:[]});
 const tasks=[task('summary','2025-01-01','2028-12-31',null,'summary'),task('first','2025-01-01','2025-01-01','summary','milestone'),task('last','2028-12-31','2028-12-31','summary','milestone')];
 const values={document:{body:{classList:{add(){}}},activeElement:null,addEventListener(){},querySelector:(s:string)=>s==='#app'?root:s==='.task-pane'?left:s==='.timeline-pane'?right:null,querySelectorAll:(s:string)=>[node(s)]},window:{addEventListener(){}},ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){}},fetch:async()=>({ok:true,json:async()=>({tasks,project:{title:'fixture',owner:'test',startDate:'2025-01-01'},attachments:[],capabilities:[],members:[],revision:0})})};
 for(const k of globals)Object.defineProperty(globalThis,k,{configurable:true,value:values[k]});
 const click=async(s:string,dataset={})=>events.get(s+':click')!({currentTarget:{dataset}});
 try{
  await timing.mountTiming({projectId:'d6-test',user:{id:'test'},settings:{}});
  assert.match(timeline,/width:2160px/);
  await click('[data-zoom]',{zoom:'project'});
  assert.match(html,/data-zoom="project" aria-pressed="true"/);assert.match(timeline,/width:640px/);assert.doesNotMatch(timeline,/offscreen-task/);
  const original=timeline.match(/data-bar="summary"[^>]*style="([^"]+)/)![1];
  await click('#collapse-all');assert.equal(timeline.match(/data-bar="summary"[^>]*style="([^"]+)/)![1],original);
  right.scrollTop=88;const count=renders;width=360;resize();assert.equal(renders,count);assert.match(timeline,/width:360px/);assert.equal(right.scrollTop,88);
  await click('#expand-all');tasks[2].start=tasks[2].end='2035-12-31';await click('#refresh-timing');await new Promise(resolve=>setImmediate(resolve));assert.match(timeline,/203[56]年/);assert.doesNotMatch(timeline,/offscreen-task/);
  for(const [zoom,pixels] of [['day',2880],['week',2160],['month',1825]]){await click('[data-zoom]',{zoom});assert.match(timeline,new RegExp('width:'+pixels+'px'));assert.doesNotMatch(timeline,/project-timeline/);}
 }finally{globals.forEach((k,i)=>{if(originals[i])Object.defineProperty(globalThis,k,originals[i]!);else Reflect.deleteProperty(globalThis,k);});}
});
