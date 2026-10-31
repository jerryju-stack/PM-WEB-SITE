import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../lib/database.ts';
import { schedule,template } from '../lib/schedule.ts';
import type { Task } from '../lib/schedule.ts';
import { timingVersions } from '../lib/timing-versions.ts';
import { timingIO } from '../lib/timing-io.ts';
import { timingDrafts } from '../lib/timing-drafts.ts';
import { exportWorkbook,readWorkbook,TEMPLATE,excelDate,orderedTasks } from '../lib/timing-workbook.ts';
import { exportTimingPdf } from '../lib/timing-pdf.ts';
import { unpack,pack,textPart,putPart,cells,strings,patchCells } from '../lib/timing-xml.ts';
import { httpFixture } from './http-fixture.ts';
export const leaf=(id:string,extra:Partial<Task>={}):Task=>({id,projectId:'p',parentId:null,order:0,title:id,kind:'task',owner:'张工',start:'2026-10-26',end:'2026-10-27',duration:2,progress:50,status:'进行中',notes:'保留备注',predecessors:[],...extra});
export function sample(){return schedule([
 leaf('phase',{title:'设计开发',kind:'summary',start:null,end:null}),
 leaf('a',{title:'需求与接口确认',parentId:'phase',progress:100}),
 leaf('b',{title:'结构方案及设计评审',parentId:'phase',order:1,predecessors:['a'],duration:5,progress:25}),
 leaf('c',{title:'客户认可',parentId:'phase',order:2,kind:'milestone',predecessors:['b'],progress:0}),
 leaf('phase2',{title:'试制验证',kind:'summary',order:1,start:null,end:null}),
 leaf('d',{title:'样件制造与试验',parentId:'phase2',predecessors:['c'],duration:10,progress:0}),
 leaf('e',{title:'量产移交',order:2,kind:'milestone',predecessors:['d'],progress:0})]);}
function fixture(){
 process.env.ADMIN_PASSWORD='Isolated-D23-Test-2026';const store=openStore(mkdtempSync(join(tmpdir(),'station-d23-')));store.put('projects',{id:'p',title:'动力总成支架开发',description:'D2/D3 联合验证项目',version:0,taskRevision:0});
 store.saveTasks('p',sample());const actor=store.get('users','admin'),context={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:randomUUID()},plans=timingVersions(store),rawIO=timingIO(store),drafts=timingDrafts(store),sessions=new Map<string,string>();
  const session=(p:string)=>{let token=sessions.get(p);if(!token){token=drafts.start(p,{},context).leaseToken;sessions.set(p,token!);}const d=drafts.state(p).draft!;return {leaseToken:token,draftId:d.id,revision:d.revision};};
  const io={...rawIO,preview:(p:string,b:any,c:typeof context)=>rawIO.preview(p,{...b,...session(p)},c),confirm:(p:string,b:any,c:typeof context)=>rawIO.confirm(p,{...b,...session(p)},c)};
 const saved=plans.save('p',{kind:'baseline',name:'设计评审基线',reason:'验证保留版本一致性',revision:store.revision('p'),projectVersion:store.get('projects','p').version,requestKey:randomUUID()},context);
 return {store,context,plans,io,saved,drafts,session};
}
export function editWorkbook(buffer:Buffer,values:Record<string,string|number>,transform?:(xml:string)=>string,dropIdentity=false){const parts=unpack(buffer),source=textPart(parts,'xl/worksheets/sheet2.xml'),map=cells(source,strings(parts));for(const [ref,value] of Object.entries(values)){const c=map.get(ref);assert.ok(c,ref);map.set(ref,{...c,value,formula:undefined});}let output=patchCells(source,map);if(transform)output=transform(output);if(dropIdentity)output=output.replace(/<hyperlinks>[\s\S]*?<\/hyperlinks>/,'');putPart(parts,'xl/worksheets/sheet2.xml',output);return pack(parts);}

test('D2 preserves template package features and calculates all caches; saved data is unchanged after current edits',async()=>{
 const {store,plans,io,saved}=fixture();try{
  assert.equal(store.db.prepare("SELECT value FROM meta WHERE key='timing-workbook-key'").get(),undefined,'service initialization must not modify restored data');
  const history=plans.get('p',saved.version.id),out=await io.exportPlan('p',saved.version.id,'xlsx').buffer,parts=unpack(out),original=unpack(TEMPLATE),ss=strings(parts);
  for(const name of ['xl/styles.xml','xl/theme/theme1.xml','xl/printerSettings/printerSettings1.bin','xl/printerSettings/printerSettings2.bin'])assert.deepEqual(parts[name],original[name],name);
  for(let i=1;i<=3;i++)for(const tag of ['sheetViews','sheetFormatPr','cols','mergeCells','sheetProtection','pageMargins','pageSetup']){
   const re=new RegExp(`<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`);assert.equal(re.exec(textPart(parts,`xl/worksheets/sheet${i}.xml`))?.[0],re.exec(textPart(original,`xl/worksheets/sheet${i}.xml`))?.[0],`sheet${i} ${tag}`);
  }
  assert.match(textPart(parts,'xl/workbook.xml'),/name="排期计算"[^>]*state="veryHidden"/);assert.match(textPart(parts,'xl/tables/table1.xml'),/ref="A9:P29"/);
  const edit=cells(textPart(parts,'xl/worksheets/sheet2.xml'),ss),view=cells(textPart(parts,'xl/worksheets/sheet1.xml'),ss);
  for(let i=0;i<history.plan.tasks.length;i++){const t=orderedTasks(history.plan.tasks)[i].task,r=i+10;assert.equal(edit.get('M'+r)!.value,t.start?excelDate(t.start):'');assert.equal(edit.get('O'+r)!.value,t.progress/100);assert.ok(edit.get('F'+r)!.formula);assert.equal(view.get('E'+r)!.value,t.start?t.duration:'');}
  assert.equal(view.get('B4')!.formula,undefined);assert.equal(view.get('A2')!.value,'动力总成支架开发 项目排期');assert.ok(!textPart(parts,'xl/worksheets/sheet3.xml').includes('DEMO'));
  const key=String(store.db.prepare("SELECT value FROM meta WHERE key='timing-workbook-key'").get()!.value),parsed=readWorkbook(out,key);assert.equal(parsed.issues.length,0);assert.equal(parsed.rows[1].identity,'a');
  const modified=store.tasks('p');modified[1].title='当前新名称';store.saveTasks('p',modified);const again=await io.exportPlan('p',saved.version.id,'xlsx').buffer;assert.equal(cells(textPart(unpack(again),'xl/worksheets/sheet2.xml'),ss).get('B11')!.value,'需求与接口确认');
  const longPlan={...history.plan,tasks:schedule([leaf('p1',{kind:'summary'}),...Array.from({length:10},(_,i)=>leaf('n'+i,{parentId:'p1',order:i}))])};const ten=exportWorkbook(longPlan,null,key);assert.equal(readWorkbook(ten.buffer,key).rows[10].wbs,'1.10');
  assert.throws(()=>exportWorkbook({...history.plan,tasks:Array.from({length:101},(_,i)=>leaf('limit'+i,{order:i}))},null,key),/100/);
  const hundred=exportWorkbook({...history.plan,tasks:schedule(Array.from({length:100},(_,i)=>leaf('capacity'+i,{order:i})))},null,key);const full=readWorkbook(hundred.buffer,key);assert.equal(full.rows.length,100);assert.equal(full.rows[99].title,'capacity99');const expanded=unpack(hundred.buffer),expandedCells=cells(textPart(expanded,'xl/worksheets/sheet2.xml'),strings(expanded));assert.equal(/s="(\d+)"/.exec(expandedCells.get('D109')!.attrs)![1],/s="(\d+)"/.exec(expandedCells.get('D10')!.attrs)![1]);assert.match(textPart(expanded,'xl/worksheets/sheet2.xml'),/<row r="109"[^>]*ht="24.95"/);
  const sampleDir=join(process.cwd(),'docs','samples');mkdirSync(sampleDir,{recursive:true});writeFileSync(join(sampleDir,'timing-d2-d3-baseline.xlsx'),out);writeFileSync(join(sampleDir,'timing-d2-d3-baseline.pdf'),await exportTimingPdf(history.plan,history.version));
 }finally{store.db.close();}
});
test('D3 round trip uses signed cell identity across row/WBS changes, schedules dependencies, preserves notes/files and history; retry is atomic',async()=>{
 const {store,context,plans,io,drafts,session}=fixture();try{
  store.db.prepare('INSERT INTO attachments(id,task_id,name,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?)').run('kept-attachment','b','既有附件.txt',0,'admin',new Date().toISOString());
  const file=await io.exportPlan('p','current','xlsx').buffer;
  const edit=editWorkbook(file,{A11:'1.2',B11:'修改名称',G11:.5,A12:'1.1',D12:excelDate('2026-10-26'),E12:excelDate('2026-10-30'),H12:'1.2',J13:'删除',A17:'2.2',B17:'新增验证任务',D17:excelDate('2026-11-02'),E17:excelDate('2026-11-03'),G17:.2,I17:'普通任务',J17:'保留'});
  let preview=io.preview('p',{file:edit.toString('base64'),mapping:{17:'new'}},context);assert.deepEqual(preview.issues,[]);assert.ok(preview.previewId);assert.equal(preview.matches.find(m=>m.row===11)!.id,'a');assert.equal(preview.dates.find(d=>d.id==='b')!.shifted,true);assert.ok(preview.affectedDependencies.find(d=>d.id==='d'));
   const revisions=store.revision('p'),versions=plans.list('p').length,result=io.confirm('p',{previewId:preview.previewId},context);assert.equal(result.revision,1);assert.equal(io.confirm('p',{previewId:preview.previewId},context).replayed,true);assert.equal(store.revision('p'),revisions);assert.equal(plans.list('p').length,versions);assert.equal(drafts.plan('p').tasks.find(t=>t.id==='a')!.title,'修改名称');assert.equal(drafts.plan('p').tasks.find(t=>t.id==='b')!.notes,'保留备注');assert.ok(store.db.prepare("SELECT * FROM attachments WHERE id='kept-attachment'").get());assert.ok(!drafts.plan('p').tasks.find(t=>t.id==='c'));assert.equal(drafts.plan('p').tasks.filter(t=>t.title==='新增验证任务').length,1);
   const sessionToken=session('p').leaseToken;drafts.adopt('p',session('p'),context);drafts.start('p',{leaseToken:sessionToken},context);

  const again=await io.exportPlan('p','current','xlsx').buffer;assert.ok(again.length);const repeat=io.preview('p',{file:again.toString('base64')},context);assert.equal(repeat.issues.length,0);assert.equal(repeat.comparison.summary.changed,0);
  const conflict=io.preview('p',{file:again.toString('base64')},context);drafts.save('p',drafts.plan('p').tasks.map(t=>t.id==='a'?{...t,owner:'changed after preview'}:t),session('p'),context);assert.throws(()=>io.confirm('p',{previewId:conflict.previewId},context),{status:409});
  preview=io.preview('p',{file:editWorkbook(again,{B11:'Atomic retry'}).toString('base64')},context);const before=drafts.plan('p').tasks,rev=drafts.state('p').draft!.revision;store.db.exec("CREATE TRIGGER fail_import_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'import audit failure'); END");assert.throws(()=>io.confirm('p',{previewId:preview.previewId},context),/import audit failure/);assert.deepEqual(drafts.plan('p').tasks,before);assert.equal(drafts.state('p').draft!.revision,rev);assert.equal(store.db.prepare('SELECT result FROM timing_imports WHERE id=?').get(preview.previewId!)!.result,null);store.db.exec('DROP TRIGGER fail_import_audit');io.confirm('p',{previewId:preview.previewId},context);
 }finally{store.db.close();}
});
test('D3 raw template, missing identity, explicit matching, deletion subtree and invalid fields are previewed without writes',async()=>{
 const {store,context,io,plans,drafts}=fixture();try{
  const before=store.revision('p'),raw=io.preview('p',{file:TEMPLATE.toString('base64')},context);assert.equal(raw.source,null);assert.equal(raw.requiresMapping,false);assert.ok(raw.matches.every(m=>!m.trusted));assert.equal(store.revision('p'),before);
  const file=await io.exportPlan('p','current','xlsx').buffer,missing=editWorkbook(file,{},undefined,true),unmatched=io.preview('p',{file:missing.toString('base64')},context);assert.equal(unmatched.requiresMapping,false);
  const mapping=Object.fromEntries(unmatched.matches.map((m,i)=>[m.row,orderedTasks(store.tasks('p'))[i].task.id]));assert.ok(io.preview('p',{file:missing.toString('base64'),mapping},context).previewId);
  const bad=editWorkbook(file,{A12:'1.1',D11:'not-a-date',G11:50,H12:'999.1',D13:excelDate('2026-10-29'),E13:excelDate('2026-10-30')});const invalid=io.preview('p',{file:bad.toString('base64')},context);for(const field of ['WBS','输入开始','输入完成度','前置任务 WBS','叶子类型'])assert.ok(invalid.issues.some(i=>i.field===field),field);assert.equal(invalid.previewId,null);
  const deleted=io.preview('p',{file:editWorkbook(file,{J10:'删除'}).toString('base64')},context);assert.ok(['phase','a','b','c'].every(id=>deleted.deletions.some(d=>d.id===id)));assert.ok(deleted.affectedDependencies.some(t=>t.id==='d'));
  const omitted=editWorkbook(file,{A11:'',B11:'',C11:'',D11:'',E11:'',G11:'',H11:'',I11:'',J11:''});const keep=io.preview('p',{file:omitted.toString('base64')},context);assert.ok(!keep.deletions.some(t=>t.id==='a'));
  store.put('projects',{id:'new',title:'新计划'});store.saveTasks('new',template('new'));const fresh=io.preview('new',{file:TEMPLATE.toString('base64'),mode:'new'},context);assert.equal(fresh.requiresMapping,false);assert.deepEqual(fresh.issues,[]);assert.ok(fresh.previewId);io.confirm('new',{previewId:fresh.previewId},context);assert.equal(timingDrafts(store).plan('new').tasks.length,20);assert.equal(plans.list('new').length,0);
 }finally{store.db.close();}
});
test('D5 identity priority, WBS defaults, name warnings, manual overrides and conflicting rows',async()=>{
 const {store,context,io,plans,drafts}=fixture();try{
  const file=await io.exportPlan('p','current','xlsx').buffer;
  const signed=io.preview('p',{file:editWorkbook(file,{A11:'1.2',A12:'1.1'}).toString('base64')},context);
  assert.equal(signed.matches.find(m=>m.row===11)!.id,'a');assert.equal(signed.matches.find(m=>m.row===11)!.method,'identity');
  const missing=editWorkbook(file,{A10:1,A11:' 1.1 ',B11:'Excel 新名称',A16:4},undefined,true).toString('base64');
  const pre=io.preview('p',{file:missing},context),match=pre.matches.find(m=>m.row===11)!;
  assert.equal(match.id,'a');assert.equal(match.method,'wbs');assert.equal(match.nameMismatch,true);assert.equal(match.existingTitle,'需求与接口确认');
  assert.equal(pre.matches.find(m=>m.row===10)!.method,'wbs');assert.equal(pre.matches.find(m=>m.row===10)!.nameMismatch,false);
  assert.equal(pre.matches.find(m=>m.row===16)!.method,'new');assert.equal(pre.matches.find(m=>m.row===16)!.id,null);
  assert.deepEqual(pre.issues,[]);assert.ok(pre.previewId);assert.equal(pre.requiresMapping,false);
  const manual=io.preview('p',{file:missing,mapping:{11:'new'}},context);assert.equal(manual.matches.find(m=>m.row===11)!.method,'manual');assert.equal(manual.matches.find(m=>m.row===11)!.id,null);assert.ok(manual.previewId);assert.ok(!manual.deletions.some(t=>t.id==='a'));
  const conflict=io.preview('p',{file:missing,mapping:{12:'a'}},context);assert.equal(conflict.previewId,null);assert.ok(conflict.issues.some(i=>i.row===12&&i.message.includes('第 11 行')));
  const other=io.preview('p',{file:missing,mapping:{11:'foreign-task'}},context);assert.equal(other.previewId,null);assert.ok(other.issues.some(i=>i.row===11&&i.field==='身份匹配'));
  const count=plans.list('p').length;io.confirm('p',{previewId:pre.previewId},context);assert.equal(drafts.plan('p').tasks.find(t=>t.id==='a')!.title,'Excel 新名称');assert.ok(drafts.plan('p').tasks.find(t=>t.id==='e'));assert.equal(plans.list('p').length,count);
  // A signed workbook from another project may only fall back to this project's WBS.
  store.put('projects',{id:'foreign',title:'其他项目'});store.saveTasks('foreign',sample().map(t=>({...t,id:'foreign-'+t.id,projectId:'foreign',parentId:t.parentId?'foreign-'+t.parentId:null,predecessors:t.predecessors.map(id=>'foreign-'+id)})));
  const foreign=await io.exportPlan('foreign','current','xlsx').buffer,local=io.preview('p',{file:foreign.toString('base64')},context);assert.ok(local.matches.every(m=>!m.trusted));assert.ok(local.matches.every(m=>!m.id?.startsWith('foreign-')));
 }finally{store.db.close();}
});

test('D5 WBS hierarchy text preserves 1.10 separately from 1.1 and blank WBS defaults to new with field validation',async()=>{
 const {store,context,io}=fixture();try{
  store.saveTasks('p',schedule([leaf('parent',{kind:'summary'}),...Array.from({length:10},(_,i)=>leaf('child'+(i+1),{parentId:'parent',order:i}))]));
  const file=await io.exportPlan('p','current','xlsx').buffer,missing=editWorkbook(file,{A11:1.1,A20:' 1.10 '},undefined,true);
  const pre=io.preview('p',{file:missing.toString('base64')},context);assert.equal(pre.matches.find(m=>m.row===11)!.id,'child1');assert.equal(pre.matches.find(m=>m.row===20)!.id,'child10');assert.ok(pre.previewId);
  const blank=io.preview('p',{file:editWorkbook(file,{A20:''},undefined,true).toString('base64')},context);assert.equal(blank.matches.find(m=>m.row===20)!.method,'new');assert.ok(blank.issues.some(i=>i.row===20&&i.field==='WBS'));assert.equal(blank.previewId,null);
 }finally{store.db.close();}
});

test('HTTP Excel/PDF selection, upload/preview/confirm reuse project permissions and retain D1 versions',async()=>{
 const f=await httpFixture();try{
  const {call,cookie,base}=f,p=(await call('projects',{title:'HTTP D23'},cookie)).data.id;
  const read=await call(`projects/${p}/timing`,undefined,cookie);const version=(await call(`projects/${p}/timing/versions`,{kind:'baseline',name:'导出基线',reason:'联合验证',revision:0,projectVersion:read.data.project.version,requestKey:randomUUID()},cookie)).data.version;
  const download=await fetch(`${base}/api/projects/${p}/timing/export?version=${version.id}&format=xlsx`,{headers:{Cookie:cookie}});assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());
  const started=(await call(`projects/${p}/timing/draft/start`,{},cookie)).data,session={leaseToken:started.leaseToken,draftId:started.draft.id,revision:started.draft.revision};
  const pre=await call(`projects/${p}/timing/import/preview`,{...session,file:bytes.toString('base64')},cookie);assert.equal(pre.status,200);assert.ok(pre.data.previewId);const confirm=await call(`projects/${p}/timing/import/confirm`,{...session,previewId:pre.data.previewId},cookie);assert.equal(confirm.status,200);assert.equal((await call(`projects/${p}/timing/import/confirm`,{...session,previewId:pre.data.previewId},cookie)).data.replayed,true);assert.equal((await call(`projects/${p}/timing/versions`,undefined,cookie)).data.versions.length,1);
  const pdf=await fetch(`${base}/api/projects/${p}/timing/export?version=${version.id}&format=pdf`,{headers:{Cookie:cookie}});assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  assert.equal((await fetch(`${base}/api/projects/${p}/timing/export?format=xlsx`)).status,401);
  const account=await call('users',{id:'readonly',name:'只读',role:'viewer',password:'Readonly-D23-2026'},cookie),login=await call('login',{id:'readonly',password:'Readonly-D23-2026'});assert.equal(account.status,200);assert.equal((await call(`projects/${p}/timing/import/preview`,{file:bytes.toString('base64')},login.cookie)).status,403);assert.equal((await fetch(`${base}/api/projects/${p}/timing/export?format=xlsx`,{headers:{Cookie:login.cookie}})).status,200);
 }finally{await f.stop();}
});
