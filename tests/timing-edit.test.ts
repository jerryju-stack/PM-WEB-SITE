import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { EditDraft,EditTransition,TimingRecovery } from '../src/drafts.ts';

// Execute the current mounted controller with deterministic I/O. This is controller coverage,
// NOT browser/layout evidence; the separate fault-proxy workflow exercises real Chrome.
const source=stripTypeScriptTypes(readFileSync(new URL('../src/timing.ts',import.meta.url),'utf8'))
 .replace("'/task-index.js'",JSON.stringify(new URL('../lib/task-index.ts',import.meta.url).href))
 .replace("'/schedule.js'",JSON.stringify(new URL('../lib/schedule.ts',import.meta.url).href))
 .replace("'/drafts.js'",JSON.stringify(new URL('../src/drafts.ts',import.meta.url).href))
 .replace("'/timing-layout.js'",JSON.stringify(new URL('../src/timing-layout.ts',import.meta.url).href))
 .replace("import { TimingHistory } from '/timing-history.js';",'class TimingHistory { constructor(options){globalThis.__history=options;} html(){return "";} bind(){} invalidate(){} }')
 .replace(' try{await load();}catch(error',` globalThis.__editor={flushInputs,exitEditing,enterEditing,adoptDraft,closeEditor,openTask,loseSession,load,status:saveStatusText,
  inline:(id,body)=>{pendingInline.set(id,body);preserveInputs();},
  drawer:(value)=>{selected=value.id;drawerHidden=false;setEdit(Object.assign(new EditDraft(value,snapshot.revision),{dirty:true,inputs:{title:value.title}}));preserveInputs();},
  state:()=>({edit,selected,drawerHidden,leaseToken,pending:[...pendingInline],recoveryRequired,refreshRequired,adoptionUncertain,snapshot,busy}),
  save:(id,body)=>mutate(id,body),setSelection:id=>{selected=id;drawerHidden=false;}};
 try{await load();}catch(error`);
const timing=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const task={id:'t',projectId:'p',parentId:null,order:0,title:'Server',kind:'task',owner:'PM',start:'2026-11-02',end:'2026-11-02',duration:1,progress:0,status:'计划中',notes:'',predecessors:[]};

async function fixture(run:(f:any)=>Promise<void>,incremental=false){
 let html='',renders=0,status=0,startStatus=0,identityChanged=false,readFail=false,failAfterStart=false,adoptError:Error|undefined,wait:Promise<void>|undefined,releaseWait:(()=>void)|undefined,choice='restore',latest={...task};
 const calls:{url:string;body:any}[]=[],events=new Map<string,Function>(),storage=new Map<string,string>();
 const registrations=new Map<string,{fn:Function;signal?:AbortSignal}[]>();
 const node=(selector:string)=>({contains:()=>true,addEventListener:(event:string,fn:Function,options?:{signal?:AbortSignal})=>{const key=selector+':'+event,entries=registrations.get(key)??[];entries.push({fn,signal:options?.signal});registrations.set(key,entries);events.set(key,(value:any)=>{const results=entries.filter(entry=>!entry.signal?.aborted).map(entry=>entry.fn(value));return Promise.all(results);});options?.signal?.addEventListener('abort',()=>{if(entries.every(entry=>entry.signal?.aborted))events.delete(key);},{once:true});}});
 const pane={...node('pane'),scrollLeft:0,scrollTop:0,clientWidth:600,hidden:false,querySelectorAll:()=>[]};
 let rowReplacements=0;const ownerInput={value:'PM'},rowNode={querySelector:()=>ownerInput,set outerHTML(_value:string){rowReplacements++;}},region={set outerHTML(_value:string){}};
 const root={...node('root'),set innerHTML(v:string){html=v;renders++;},querySelectorAll:()=>[],querySelector:(selector:string):any=>!incremental?null:selector==='.task-table'?{}:selector.startsWith('[data-row=')?rowNode:selector==='.timeline-pane'?pane:selector==='.timing-metrics'||selector==='#timing-draft-workflow'?region:null};
 const toast={textContent:'',classList:{add(){},remove(){}}};
 const dialog:any={...node('dialog'),className:'',innerHTML:'',close(){},remove(){},querySelectorAll:()=>['restore','discard','cancel'].map(value=>({dataset:{recovery:value},addEventListener:(_:string,fn:Function)=>{if(value===choice)dialog.pick=fn;}})),showModal:()=>{queueMicrotask(()=>dialog.pick());}};
 const globals:any={CSS:{escape:(value:string)=>value},document:{body:{classList:{add(){},remove(){}},append(){}},activeElement:null,...node('document'),querySelector:(s:string)=>s==='#app'?root:s==='.task-pane'||s==='.timeline-pane'?pane:s==='#toast'?toast:null,querySelectorAll:(s:string)=>[node(s)],createElement:()=>dialog},window:node('window'),ResizeObserver:class{observe(){}disconnect(){}},sessionStorage:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)},requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},fetch:async(url:string,options:any={})=>{
   const body=options.body?JSON.parse(options.body):undefined;calls.push({url,body});
   if(url.endsWith('/session'))return identityChanged?{ok:false,status:401,json:async()=>({error:'actor changed',identityChanged:true})}:{ok:true,json:async()=>({user:{id:'stable-uid'}})};
   if(url.includes('/release'))return {ok:true,json:async()=>({ok:true})};
   if(url.endsWith('/start')){if(failAfterStart)readFail=true;return startStatus?{ok:false,status:startStatus,json:async()=>({error:'second page or revoked'})}:{ok:true,json:async()=>({leaseToken:'new-lease',editor:{expiresAt:Date.now()+30000},draft:{id:'d',revision:2}})};}
   if(url.includes('/tasks')){if(wait)await wait;if(status===-1)throw new TypeError('offline');if(status)return {ok:false,status,json:async()=>({error:'injected '+status})};latest={...latest,...body};return {ok:true,json:async()=>({tasks:[latest],revision:3,draft:{id:'d',revision:3}})};}
   if(url.endsWith('/adopt')){if(adoptError)throw adoptError;return {ok:true,json:async()=>({changed:true,sequence:1})};}
   if(readFail)throw new TypeError('read failed');
   return {ok:true,json:async()=>({tasks:[latest],project:{title:'Fixture',owner:'PM',startDate:'2026-11-02'},revision:2,executionRevision:1,draft:{id:'d',revision:2},attachments:[],capabilities:['timingEdit'],members:[]})};
 }};
 const descriptors=Object.fromEntries(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true});
 try{
  await timing.mountTiming({projectId:'fixture-'+Math.random(),user:{id:'stable-uid'},settings:{}});
  const editor=(globalThis as any).__editor,history=(globalThis as any).__history;
  await editor.enterEditing();calls.length=0;
  await run({editor,history,calls,events,storage,ownerInput,get rowReplacements(){return rowReplacements;},get html(){return html;},get renders(){return renders;},fail:(value:number)=>status=value,startFail:(value:number)=>startStatus=value,adoptFail:(error:Error)=>adoptError=error,changeIdentity:()=>identityChanged=true,readFail:(value:boolean)=>readFail=value,failLatestAfterStart:()=>failAfterStart=true,choice:(value:string)=>choice=value,setLatest:(value:any)=>latest=value,pause:()=>{wait=new Promise<void>(ok=>releaseWait=ok);},resume:()=>{releaseWait?.();wait=undefined;}});
 }finally{timing.unmountTiming();for(const key of Object.keys(globals)){const d=descriptors[key];if(d)Object.defineProperty(globalThis,key,d);else Reflect.deleteProperty(globalThis,key);}delete (globalThis as any).__editor;delete (globalThis as any).__history;}
}

for(const status of [-1,400,401,403,409])for(const input of ['inline','drawer'])test(`E1 ${input} failure ${status} blocks exit/history/Escape and preserves local input`,async()=>{
 await fixture(async f=>{
  const e=f.editor;f.fail(status);e.setSelection('t');
  if(input==='inline')e.inline('t',{owner:'UNSENT'});else e.drawer({...task,title:'UNSENT'});
  const before=e.state();assert.equal(await e.exitEditing(),false);
  assert.equal(e.state().selected,before.selected);assert.equal(e.state().drawerHidden,false);
  await f.history.showPlan('v1');
  await f.events.get('document:keydown')({key:'Escape',preventDefault(){}});
  assert.equal(e.state().selected,'t');assert.equal(e.state().drawerHidden,false);
  if(input==='inline')assert.equal(e.state().pending[0][1].owner,'UNSENT');else assert.equal(e.state().edit.value.title,'UNSENT');
  assert.ok(f.storage.size);assert.equal(f.calls.some((c:any)=>c.url.endsWith('/versions/v1')),false);
  if(status===400)assert.equal(e.state().leaseToken,'new-lease');else assert.equal(e.state().leaseToken,'');
 });
});

test('E1 pending Escape leaves selection untouched; repeated Escape closes exactly once after confirmed save',async()=>{
 await fixture(async f=>{const e=f.editor;e.drawer({...task,title:'pending'});f.pause();const before=f.renders;
  const first=f.events.get('document:keydown')({key:'Escape',preventDefault(){}});await Promise.resolve();await Promise.resolve();
  await f.events.get('document:keydown')({key:'Escape',preventDefault(){}});
  assert.equal(e.state().selected,'t');assert.equal(e.state().drawerHidden,false);assert.equal(f.renders,before);
  f.resume();await first;assert.equal(e.state().selected,null);assert.equal(e.state().drawerHidden,true);
  assert.equal(f.calls.filter((c:any)=>c.url.includes('/tasks')).length,1);
 });
});

test('E5 retrying a failed drawer save reports pending until the asynchronous result arrives',async()=>{
 await fixture(async f=>{
  const e=f.editor;e.drawer({...task,title:'preserved retry'});f.fail(400);assert.equal(await e.flushInputs(),false);assert.match(e.status(),/保存失败/);
  f.fail(0);f.pause();const pending=e.flushInputs();await Promise.resolve();await Promise.resolve();
  assert.equal(e.state().busy,true);assert.equal(e.status(),'正在保存…');assert.equal(e.state().edit.value.title,'preserved retry');
  f.resume();assert.equal(await pending,true);assert.match(e.status(),/共享草稿已保存/);
 });
});

test('E4 owner-only save updates the existing input without replacing its row; a displayed progress change still refreshes the row',async()=>{
 await fixture(async f=>{
  f.editor.inline('t',{owner:'Saved owner'});assert.equal(await f.editor.flushInputs(),true);assert.equal(f.ownerInput.value,'Saved owner');assert.equal(f.rowReplacements,0);
  f.editor.inline('t',{progress:65});assert.equal(await f.editor.flushInputs(),true);assert.equal(f.rowReplacements,1);
 },true);
});

test('E1 new lease reads latest before explicit recovery and never replays old requests',async()=>{
 await fixture(async f=>{const e=f.editor;e.inline('t',{owner:'local'});e.drawer({...task,title:'local drawer'});e.loseSession('expired');f.setLatest({...task,owner:'other page'});f.calls.length=0;
  await e.enterEditing();assert.ok(f.calls.findIndex((c:any)=>c.url.endsWith('/start'))<f.calls.length-1);
  assert.equal(f.calls.some((c:any)=>c.url.includes('/tasks')),false);assert.equal(e.state().pending[0][1].owner,'local');assert.equal(e.state().edit.value.title,'local drawer');assert.equal(e.state().snapshot.tasks[0].owner,'other page');
  assert.equal(e.state().recoveryRequired,false);assert.ok(f.storage.size);
 });
});
for(const choice of ['cancel','discard'])test(`E1 explicit recovery ${choice} controls local data deletion`,async()=>{
 await fixture(async f=>{const e=f.editor;e.inline('t',{owner:'local'});e.loseSession('old lease');f.choice(choice);await e.enterEditing();
  assert.equal(e.state().pending.length,choice==='discard'?0:1);assert.equal(f.storage.size,choice==='discard'?0:1);assert.equal(f.calls.some((c:any)=>c.url.includes('/tasks')),false);
 });
});

test('E1 failed latest read after reacquisition retains recovery and releases unusable lease',async()=>{
 await fixture(async f=>{const e=f.editor;e.inline('t',{owner:'local'});e.loseSession('offline');f.calls.length=0;f.failLatestAfterStart();await e.enterEditing();assert.ok(f.calls.some((c:any)=>c.url.endsWith('/start')));assert.ok(f.calls.some((c:any)=>c.url.endsWith('/release')));assert.equal(e.state().pending.length,1);assert.equal(e.state().leaseToken,'');assert.ok(f.storage.size);});
});

test('E1 confirmed save with failed reread is distinct from failed write and never resubmits it',async()=>{
 await fixture(async f=>{const e=f.editor;e.inline('t',{owner:'saved'});f.readFail(true);assert.equal(await e.flushInputs(),false);assert.equal(e.state().pending.length,0);assert.equal(e.state().refreshRequired,true);assert.equal(f.storage.size,0);await e.flushInputs();assert.equal(f.calls.filter((c:any)=>c.url.includes('/tasks')).length,1);f.readFail(false);await e.load();assert.equal(e.state().snapshot.tasks[0].owner,'saved');});
});

test('E1 adoption confirmed but reread failed does not claim adoption failed or replay it',async()=>{
 await fixture(async f=>{f.readFail(true);await f.editor.adoptDraft();assert.equal(f.editor.state().refreshRequired,true);assert.equal(f.editor.state().leaseToken,'new-lease');assert.equal(f.calls.filter((c:any)=>c.url.endsWith('/adopt')).length,1);});
});

for(const error of [new TypeError('response lost'),new SyntaxError('truncated JSON')])test(`E5 adoption ${error.name} is unknown until a successful latest read, never reported as a failed save or replayed`,async()=>{
 await fixture(async f=>{
  const e=f.editor;f.adoptFail(error);await e.adoptDraft();
  assert.equal(e.state().adoptionUncertain,true);assert.equal(e.state().leaseToken,'');assert.match(e.status(),/采用结果未确认/);assert.doesNotMatch(e.status(),/保存失败/);
  assert.equal(await e.flushInputs(),false);await e.adoptDraft();assert.equal(f.calls.filter((c:any)=>c.url.endsWith('/adopt')).length,1);
  f.readFail(true);await assert.rejects(e.load());assert.equal(e.state().adoptionUncertain,true);
  f.readFail(false);await e.load();assert.equal(e.state().adoptionUncertain,false);assert.doesNotMatch(e.status(),/未确认|保存失败/);
  assert.equal(f.calls.filter((c:any)=>c.url.endsWith('/adopt')).length,1);
 });
});

test('E1 recovery is detached, stable UID/project scoped, survives remount, and isolates rebuilt login names',()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
 const old=new TimingRecovery('uid-old','p',storage),other=new TimingRecovery('uid-new','p',storage),project=new TimingRecovery('uid-old','q',storage);
 old.write({savedAt:'now',inline:[['t',{owner:'secret local'}]],drawer:{value:{title:'raw'},version:2,inputs:{duration:''}}});
 assert.equal(other.read(),undefined);assert.equal(project.read(),undefined);const reopened=new TimingRecovery('uid-old','p',storage);const value=reopened.read()!;assert.equal(value.drawer!.inputs!.duration,'');value.inline[0][1].owner='changed';assert.equal(old.read()!.inline[0][1].owner,'secret local');old.clear();assert.equal(reopened.read(),undefined);
});

test('E1 transition refusal and exceptions do not commit any destination and can be retried',async()=>{
 const gate=new EditTransition();let closed=0;assert.equal(await gate.run(async()=>false),false);assert.equal(closed,0);await assert.rejects(gate.run(async()=>{throw Error('read');}));assert.equal(gate.pending,false);await gate.run(async()=>{closed++;return true;});assert.equal(closed,1);
});

test('E1 raw empty numeric input is retained and validation blocks writes without changing selection',async()=>{
 await fixture(async f=>{f.editor.setSelection('t');f.editor.inline('t',{duration:''});assert.equal(await f.editor.flushInputs(),false);assert.equal(f.editor.state().selected,'t');assert.equal(f.editor.state().pending[0][1].duration,'');assert.equal(f.calls.some((c:any)=>c.url.includes('/tasks')),false);});
});

for(const status of [403,409])test(`E1 reacquisition ${status} never clears local inputs or starts recovery without authorization`,async()=>{
 await fixture(async f=>{f.editor.inline('t',{owner:'private'});f.editor.loseSession('old lease');f.startFail(status);await f.editor.enterEditing();assert.equal(f.editor.state().leaseToken,'');assert.equal(f.editor.state().pending[0][1].owner,'private');assert.ok(f.storage.size);assert.equal(f.calls.some((c:any)=>c.url.includes('/tasks')),false);});
});

test('E1 route link uses the same failed leave guard as Escape without navigating',async()=>{
 await fixture(async f=>{f.fail(400);f.editor.drawer({...task,title:'route local'});let blocked=false;const link={hasAttribute:()=>false,href:'http://isolated.invalid/'};await f.events.get('root:click')({target:{closest:(selector:string)=>selector==='a'?link:null},preventDefault(){blocked=true;},stopPropagation(){}});assert.equal(blocked,true);assert.equal(f.editor.state().selected,'t');assert.equal(f.editor.state().edit.value.title,'route local');});
});

test('E1 cookie identity change hides the old actor inputs while retaining its private recovery and sends no writes',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{pathname:'/projects/p/timing'}});
 try{await fixture(async f=>{f.editor.drawer({...task,title:'OLD-UID-PRIVATE'});f.changeIdentity();await f.editor.enterEditing();assert.match(f.html,/登录账号已变化/);assert.doesNotMatch(f.html,/OLD-UID-PRIVATE/);assert.ok([...f.storage.values()].some((v:any)=>v.includes('OLD-UID-PRIVATE')));assert.equal(f.calls.some((c:any)=>c.url.includes('/tasks')),false);});}
 finally{if(original)Object.defineProperty(globalThis,'location',original);else Reflect.deleteProperty(globalThis,'location');}
});

test('E1 hydrated/restored drawer remains dirty when form recaptures the same local values',()=>{
 const local={title:'unconfirmed after reload',duration:2};
 const draft=new EditDraft(local,1).requireSave();draft.set({...local});assert.equal(draft.dirty,true);
 draft.review({title:'latest server',duration:2},5);draft.useReviewedVersion();draft.set({...local});assert.equal(draft.dirty,true);
 const confirmed=new EditDraft(local,6);confirmed.set({...local});assert.equal(confirmed.dirty,false);
});
