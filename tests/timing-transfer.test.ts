import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimingTransfer } from '../src/timing-io.ts';

test('D5 import actions stay visible and give specific feedback; changed mappings must be previewed again',async()=>{
 const ui:any=new TimingTransfer({projectId:'p',signal:new AbortController().signal,context:()=>({canEdit:true,historical:null,dirty:false}),reload:async()=>{},notify:()=>{},capture:()=>{}});
 ui.open=true;
 const preview={revision:1,source:null,comparison:{summary:{},differences:[]},matches:[{row:11,wbs:'1.1',title:'Excel 名称',id:'a',method:'wbs',existingTitle:'网站名称',nameMismatch:true}],existing:[{id:'a',wbs:'1.1',title:'网站名称'}],issues:[],dates:[],deletions:[],affectedDependencies:[],previewId:'checked-preview',requiresMapping:false};
 const visible=()=>{const html=ui.html();assert.equal((html.match(/id="confirm-import"/g)??[]).length,1);assert.match(html,/<button class="primary compact" id="confirm-import" >/);assert.ok(html.indexOf('id="preview-import"')<html.indexOf('id="confirm-import"'));assert.ok(html.indexOf('id="ack-import"')<html.indexOf('class="import-preview"')||!ui.preview);};
 visible();assert.match(ui.importBlocker(),/尚未生成预览/);
 ui.preview=preview;visible();assert.match(ui.html(),/WBS 匹配，名称不同，请核对/);assert.match(ui.html(),/Excel 名称.*网站名称/);assert.match(ui.importBlocker(),/尚未勾选确认/);
 ui.acknowledged=true;assert.equal(ui.importBlocker(),'');
 ui.preview={...preview,issues:[{sheet:'任务编辑',row:11,field:'WBS',message:'编号重复'}],previewId:null};visible();assert.match(ui.importBlocker(),/第 11 行.*WBS.*编号重复/);assert.match(ui.html(),/href="#import-row-11"/);
 ui.preview={...preview,requiresMapping:true,matches:[{...preview.matches[0],choiceRequired:true}]};assert.match(ui.importBlocker(),/第 11 行存在未解决的匹配/);
 ui.preview={...preview,previewId:null};assert.match(ui.importBlocker(),/预览需要刷新/);
 ui.preview=preview;
 // Bind the actual event handlers to a small DOM stub; no browser dependency is needed.
 const elements=new Map<string,any>();
 for(const id of ['toggle-transfer','export-version','import-mode','timing-import-file','preview-import','ack-import','confirm-import'])elements.set('#'+id,{addEventListener:(event:string,handler:any)=>elements.get('#'+id)[event]=handler});
 const match:any={dataset:{importMatch:'11'},value:'new',addEventListener:(event:string,handler:any)=>match[event]=handler};
 const node:any={querySelector:(selector:string)=>elements.get(selector),querySelectorAll:(selector:string)=>selector==='[data-import-match]'?[match]:[]};
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:(selector:string)=>selector==='#timing-transfer'?node:null}});
 ui.redraw=()=>{};
 let confirmed=0,received:any;
 ui.request=async(path:string,body:any)=>{if(path==='import/confirm'){confirmed++;return {revision:2};}received=body;return {...preview,matches:[{...preview.matches[0],id:null,method:'manual'}],previewId:'new-preview'};};
 try{
  ui.bind();match.change();assert.equal(ui.acknowledged,false);assert.equal(ui.mappingDirty,true);assert.match(ui.html(),/匹配已修改，请重新预览/);visible();
  ui.acknowledged=true;await elements.get('#confirm-import').click();assert.equal(confirmed,0);assert.match(ui.error,/重新预览/);
  await elements.get('#preview-import').click();assert.equal(received.mapping[11],'new');assert.equal(ui.mapping[11],'new');assert.equal(ui.mappingDirty,false);assert.equal(ui.acknowledged,false);assert.match(ui.html(),/value="new" selected/);
  elements.get('#ack-import').change({target:{checked:true}});assert.equal(ui.importBlocker(),'');await elements.get('#confirm-import').click();assert.equal(confirmed,1);
 }finally{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');}
});
