// Read-only source probes and synthetic in-memory fixtures; no production data.
// Run: node --experimental-strip-types docs/validation/d9-engineering-review/probe.mjs
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { timingVersions, schedulePolicy } from '../../../lib/timing-versions.ts';
import { schedule } from '../../../lib/schedule.ts';
import { exportWorkbook } from '../../../lib/timing-workbook.ts';
import { exportTimingPdf } from '../../../lib/timing-pdf.ts';

const source=readFileSync(new URL('../../../src/timing.ts',import.meta.url),'utf8');
const functionSource=(start,end)=>stripTypeScriptTypes(source.slice(source.indexOf(start),source.indexOf(end)));
const results={scope:'Control-flow probes execute extracted current source with injected dependencies; these are not browser tests.',ui:{},performance:[]};

const exitSource=functionSource(' async function exitEditing(', ' function chooseDraft(');
results.ui.failedExit=await new Function('return (async()=>{let projectId="p",leaseToken="active",leaseUntil=1,canEdit=true,autoTimer,edit={dirty:true},calls=[];const flushInputs=async()=>false,request=async()=>calls.push("release"),load=async()=>calls.push("reload"),setEdit=()=>{};'+exitSource+';await exitEditing();return {calls,leaseToken,canEdit};})()')();

const enterSource=functionSource(' async function enterEditing(', ' async function adoptDraft(');
results.ui.reenter=await new Function('return (async()=>{let projectId="p",transition=false,busy=false,leaseToken="",sharedDraft,editorInfo,editRequests,leaseUntil,saveError="offline",selected="t",drawerHidden=false,edit={dirty:true,value:"unsent"};const pendingInline=new Map([["t",{owner:"unsent"}]]),flushInputs=async()=>false,chooseDraft=async()=>undefined,request=async path=>path.endsWith("start")?{leaseToken:"new",draft:{id:"d"},editor:{expiresAt:999}}:{draft:{id:"d"}},setEdit=value=>edit=value,load=async()=>{},history={invalidate(){}},notify=()=>{},loseSession=()=>{};'+enterSource+';await enterEditing();return {pendingInline:pendingInline.size,localDraftRetained:!!edit};})()')();

const escapeStart=source.indexOf("document.addEventListener('keydown',e=>");
const escapeEnd=source.indexOf(" window.addEventListener('beforeunload'",escapeStart);
const escapeSource=stripTypeScriptTypes(source.slice(escapeStart,escapeEnd));
results.ui.escape=await new Function('return (async()=>{let handler,selected="t",edit={dirty:true},renders=0;const document={addEventListener:(_,h)=>handler=h,querySelector:()=>null},signal=new AbortController().signal,leaveEditor=async()=>false,render=()=>renders++;'+escapeSource+';handler({key:"Escape"});await Promise.resolve();return {selected,renders};})()')();

const task=(i)=>({id:'t'+i,projectId:'p',parentId:null,order:i,title:'Review task '+i,kind:'task',owner:'PM',start:'2026-11-02',end:'2026-11-02',duration:1,progress:0,status:'计划中',notes:'',predecessors:[]});
const project={id:'p',title:'Synthetic review',version:0,taskRevision:1,startDate:'2026-11-02',date:'2026-11-30',progress:0,status:'计划中'};
for(const n of [100,500,1000]){
 const tasks=Array.from({length:n},(_,i)=>task(i));
 schedule(tasks);const samples=[];
 for(let i=0;i<5;i++){const start=performance.now();schedule(tasks);samples.push(performance.now()-start);}
 results.performance.push({operation:'schedule',tasks:n,medianMs:+samples.sort((a,b)=>a-b)[2].toFixed(2)});
}
const plan={format:1,project,tasks:Array.from({length:100},(_,i)=>task(i)),schedulePolicy};
for(const [name,fn] of [['xlsx',()=>exportWorkbook(plan,null,'synthetic-review-key').buffer],['pdf',()=>exportTimingPdf(plan,null)]]){
 let timerAt=0;const start=performance.now();const timer=new Promise(resolve=>setTimeout(()=>{timerAt=performance.now();resolve();},0));
 const buffer=await fn();await timer;
 results.performance.push({operation:name,tasks:100,totalMs:+(performance.now()-start).toFixed(2),timerDelayMs:+(timerAt-start).toFixed(2),bytes:buffer.length});
}

assert.deepEqual(results.ui.failedExit.calls,['release','reload']);
assert.equal(results.ui.reenter.pendingInline,0);
assert.equal(results.ui.reenter.localDraftRetained,false);
assert.deepEqual(results.ui.escape,{selected:null,renders:1});

const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE timing_versions(id TEXT,project_id TEXT,saved_at TEXT,snapshot TEXT); CREATE TABLE timing_archives(id TEXT,project_id TEXT,saved_at TEXT,snapshot TEXT); CREATE TABLE timing_adoptions(version_id TEXT,source_version TEXT,source_revision INTEGER); CREATE TABLE timing_version_deletions(project_id TEXT,version_id TEXT);');
const snapshot=JSON.stringify(plan);
for(let i=0;i<100;i++)db.prepare('INSERT INTO timing_versions VALUES(?,?,?,?)').run('v'+i,'p','2026-11-03',snapshot);
let prepares=0,snapshotBytes=0;
const traced={db:{prepare(sql){prepares++;const statement=db.prepare(sql);return {get:(...args)=>statement.get(...args),all:(...args)=>{const rows=statement.all(...args);for(const row of rows)if(typeof row.snapshot==='string')snapshotBytes+=Buffer.byteLength(row.snapshot);return rows;}};}}};
const listStart=performance.now(),versions=timingVersions(traced).list('p');
results.performance.push({operation:'versions.list',versions:versions.length,tasksPerVersion:100,sqlPrepares:prepares,snapshotBytesRead:snapshotBytes,ms:+(performance.now()-listStart).toFixed(2)});
db.close();
console.log(JSON.stringify(results,null,2));
