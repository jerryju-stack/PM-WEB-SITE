import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimingTransfer } from '../src/timing-io.ts';

test('D5 import actions stay visible and give specific feedback; changed mappings must be previewed again',async()=>{
 const ui:any=new TimingTransfer({projectId:'p',signal:new AbortController().signal,context:()=>({canEdit:true,historical:null,dirty:false}),reload:async()=>{},notify:()=>{},capture:()=>{}});
 ui.open=true;
 const preview={revision:1,source:null,comparison:{summary:{},differences:[]},matches:[{row:11,wbs:'1.1',title:'Excel 名称',id:'a',method:'wbs',existingTitle:'网站名称',nameMismatch:true}],existing:[{id:'a',wbs:'1.1',title:'网站名称'}],issues:[],dates:[],deletions:[],affectedDependencies:[],previewId:'checked-preview',requiresMapping:false};
 const visible=()=>{const html=ui.html();assert.equal((html.match(/id="confirm-import"/g)??[]).length,1);assert.match(html,/<button class="primary compact" id="confirm-import" >/);assert.ok(html.indexOf('id="preview-import"')<html.indexOf('id="confirm-import"'));assert.doesNotMatch(html,/id="ack-import"|import-ack/);};
 visible();assert.match(ui.importBlocker(),/尚未生成预览/);
 ui.preview=preview;visible();assert.match(ui.html(),/WBS 匹配，名称不同，请核对/);assert.match(ui.html(),/Excel 名称.*网站名称/);assert.equal(ui.importBlocker(),'');
 ui.preview={...preview,issues:[{sheet:'任务编辑',row:11,field:'WBS',message:'编号重复'}],previewId:null};visible();assert.match(ui.importBlocker(),/第 11 行.*WBS.*编号重复/);assert.match(ui.html(),/href="#import-row-11"/);
 ui.preview={...preview,requiresMapping:true,matches:[{...preview.matches[0],choiceRequired:true}]};assert.match(ui.importBlocker(),/第 11 行存在未解决的匹配/);
 ui.preview={...preview,previewId:null};assert.match(ui.importBlocker(),/预览需要刷新/);
 ui.preview=preview;
 // Bind the actual event handlers to a small DOM stub; no browser dependency is needed.
 const elements=new Map<string,any>();
 for(const id of ['toggle-transfer','export-version','import-mode','timing-import-file','preview-import','confirm-import'])elements.set('#'+id,{addEventListener:(event:string,handler:any)=>elements.get('#'+id)[event]=handler});
 const match:any={dataset:{importMatch:'11'},value:'new',addEventListener:(event:string,handler:any)=>match[event]=handler};
 const node:any={querySelector:(selector:string)=>elements.get(selector),querySelectorAll:(selector:string)=>selector==='[data-import-match]'?[match]:[]};
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:(selector:string)=>selector==='#timing-transfer'?node:null}});
 ui.redraw=()=>{};
 const originalConfirm=Object.getOwnPropertyDescriptor(globalThis,'confirm');
 let accepted=false,prompts=0,confirmed=0,received:any;
 Object.defineProperty(globalThis,'confirm',{configurable:true,value:(message:string)=>{prompts++;assert.match(message,/核对任务匹配、删除影响和网站最终排期/);assert.match(message,/仅更新共享草稿，采用后才更新执行计划/);return accepted;}});
 ui.request=async(path:string,body:any)=>{if(path==='import/confirm'){confirmed++;return {revision:2};}received=body;return {...preview,matches:[{...preview.matches[0],id:null,method:'manual'}],previewId:'new-preview'};};
 try{
  ui.bind();match.change();assert.equal(ui.mappingDirty,true);assert.match(ui.html(),/匹配已修改，请重新预览/);visible();
  await elements.get('#confirm-import').click();assert.equal(confirmed,0);assert.match(ui.error,/重新预览/);assert.equal(prompts,0);
  await elements.get('#preview-import').click();assert.equal(received.mapping[11],'new');assert.equal(ui.mapping[11],'new');assert.equal(ui.mappingDirty,false);assert.match(ui.html(),/value="new" selected/);
  await elements.get('#confirm-import').click();assert.equal(prompts,1);assert.equal(confirmed,0);assert.equal(ui.preview.previewId,'new-preview');assert.equal(ui.busy,false);
  accepted=true;await elements.get('#confirm-import').click();assert.equal(prompts,2);assert.equal(confirmed,1);
 }finally{if(originalConfirm)Object.defineProperty(globalThis,'confirm',originalConfirm);else Reflect.deleteProperty(globalThis,'confirm');if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');}
});

test('E2 transfer cancellation retains file, mapping and preview, and reports uncertain confirmation without retry',async()=>{
 const ui:any=new TimingTransfer({projectId:'p',signal:new AbortController().signal,context:()=>({canEdit:true,historical:null,dirty:false}),reload:async()=>{},notify:()=>{},capture:()=>{}});
 ui.open=true;ui.file='synthetic-file';ui.mapping={11:'new'};ui.preview={previewId:'preserved-preview',comparison:{summary:{},differences:[]},matches:[],existing:[],issues:[],dates:[],deletions:[],affectedDependencies:[]};
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null}});ui.redraw=()=>{};
 try{
  let calls=0;const pending=ui.run(async()=>{calls++;assert.match(ui.html(),/取消文件处理/);await new Promise((_,reject)=>ui.requestSignal().addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})),{once:true}));});
  ui.operation.abort();await pending;assert.equal(calls,1);assert.equal(ui.file,'synthetic-file');assert.deepEqual(ui.mapping,{11:'new'});assert.equal(ui.preview.previewId,'preserved-preview');assert.equal(ui.busy,false);assert.match(ui.error,/请求已取消.*刷新核对.*不会自动重试/);
 }finally{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');}
});

for(const failure of ['transport','truncated-response','server-conflict'])test(`E2 confirmation ${failure} preserves its preview and distinguishes an unknown result from a rejected commit`,async()=>{
 const notifications:string[]=[];let reloads=0,requests=0;
 const ui:any=new TimingTransfer({projectId:'p',signal:new AbortController().signal,context:()=>({canEdit:true,historical:null,dirty:false}),reload:async()=>{reloads++;},notify:s=>notifications.push(s),capture:()=>{},session:()=>({leaseToken:'new-lease',draftId:'draft',revision:0})});
 ui.open=true;ui.file='synthetic-file';ui.mapping={11:'new'};
 const preview={previewId:'same-receipt-key',comparison:{summary:{},differences:[]},matches:[],existing:[],issues:[],dates:[],deletions:[],affectedDependencies:[]};ui.preview=preview;
 const button:any={addEventListener:(_event:string,listener:any)=>button.click=listener};
 const node:any={querySelector:(s:string)=>s==='#confirm-import'?button:null,querySelectorAll:()=>[]};
 const originals=['document','confirm','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:(s:string)=>s==='#timing-transfer'?node:null}});
 Object.defineProperty(globalThis,'confirm',{configurable:true,value:()=>true});
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_url:string,init:RequestInit)=>{
  requests++;assert.equal(JSON.parse(String(init.body)).previewId,'same-receipt-key');
  if(failure==='transport')throw TypeError('Failed to fetch');
  if(failure==='truncated-response')return {ok:true,json:async()=>{throw SyntaxError('Unexpected end of JSON');}};
  return {ok:false,json:async()=>({error:'草稿已更新',requestId:'synthetic-trace'})};
 }});ui.redraw=()=>{};
 try{
  ui.bind();await button.click();assert.equal(requests,1);assert.equal(reloads,0);assert.deepEqual(notifications,[]);
  assert.equal(ui.preview,preview);assert.equal(ui.file,'synthetic-file');assert.deepEqual(ui.mapping,{11:'new'});assert.equal(ui.busy,false);
  if(failure==='server-conflict'){assert.match(ui.error,/草稿已更新.*synthetic-trace/);assert.doesNotMatch(ui.error,/结果尚未确定/);}
  else assert.match(ui.error,/结果尚未确定.*刷新核对共享草稿.*预览已保留.*不会自动重试/);
 }finally{for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
});
