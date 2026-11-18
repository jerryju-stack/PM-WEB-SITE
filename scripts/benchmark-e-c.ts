import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir,cpus,release} from 'node:os';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {openStore} from '../lib/database.ts';
import {syntheticTasks} from './e-a-fixtures.ts';
import {timingVersions,schedulePolicy} from '../lib/timing-versions.ts';
import {timingDrafts} from '../lib/timing-drafts.ts';
import {httpFixture} from '../tests/http-fixture.ts';
import {indexMissingHistory} from '../lib/history-index.ts';

// Run unchanged before/after E-C. No caller DATA_DIR is consumed.
const output=resolve(process.argv[2]??'docs/validation/batch-e-c/after.json');
process.env.ADMIN_PASSWORD='Isolated-EC-Capacity-2026';
const directory=mkdtempSync(join(tmpdir(),'station-e-c-')),store=openStore(directory),results:any[]=[];
const actor=store.get('users','admin'),context={actorId:actor.uid,actorUid:actor.uid,actorName:'Synthetic',requestId:'benchmark'};
const stats=(v:number[])=>{const s=[...v].sort((a,b)=>a-b);return {samples:s.length,p95Ms:s[Math.ceil(s.length*.95)-1],maxMs:Math.max(...s)};};
const measure=(fn:()=>unknown)=>{const run=()=>{const at=performance.now();fn();return performance.now()-at;};const coldMs=run();return {coldMs,...stats(Array.from({length:30},run))};};
for(const n of [100,1000])for(const count of [100,1000]){
 const id=`p-${n}-${count}`,tasks=syntheticTasks(n,'fanout',id);
 store.put('projects',{id,title:id,description:'Synthetic',category:'capacity',progress:0,status:'计划中'});store.saveTasks(id,tasks);
 const snapshot=JSON.stringify({format:1,project:store.get('projects',id),tasks:store.tasks(id),schedulePolicy});
 const insert=store.db.prepare('INSERT INTO timing_versions(id,project_id,kind,sequence,name,reason,saved_at,actor_uid,actor_name,revision,project_version,request_key,request_data,snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 store.transaction(()=>{for(let i=0;i<count;i++)insert.run(`${id}-v${String(i).padStart(4,'0')}`,id,'version',i+1,'Synthetic','capacity','2026-11-03T00:00:00Z',actor.uid,'Synthetic',1,0,randomUUID(),'{}',snapshot);});
 let queries=0,snapshotBytes=0;
 const traced={...store,db:{prepare(sql:string){queries++;const statement=store.db.prepare(sql);return {get:(...a:any[])=>statement.get(...a),all:(...a:any[])=>{const rows=statement.all(...a);for(const row of rows)if(typeof row.snapshot==='string')snapshotBytes+=Buffer.byteLength(row.snapshot);return rows;}};}}};
 const service:any=timingVersions(traced as any),list=()=>('page' in service?service.page(id,{}):service.list(id));
 const first=list();const trace={queries,snapshotBytes,responseBytes:Buffer.byteLength(JSON.stringify(first))};
 const timing=measure(list);
 // Application writes/migration maintain this index; direct synthetic inserts must do so too.
 if(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='timing_history_index'").get())indexMissingHistory(store.db,id);
 const draft=timingDrafts(store),start=draft.start(id,{},context),session={leaseToken:start.leaseToken,draftId:start.draft!.id,revision:start.draft!.revision};
 const changed=draft.plan(id).tasks.map(t=>t.kind==='summary'?t:{...t,owner:'Changed'});draft.save(id,changed,session,context);
 const at=performance.now();draft.adopt(id,{...session,revision:1},context);const adoptMs=performance.now()-at;
 results.push({tasks:n,versions:count,...trace,...timing,adoptMs,rssBytes:process.memoryUsage().rss});
}
for(let i=0;i<500;i++)store.put('articles',{id:`a${String(i).padStart(4,'0')}`,title:`Synthetic ${i}`,description:'Card summary',category:i%2?'A':'B',date:'2026-11-03',content:'正文canary'.repeat(1000)});
store.db.close();
const f=await httpFixture({directory,password:process.env.ADMIN_PASSWORD});let http:any;
try{const values:number[]=[],bytes:number[]=[];let coldMs=0;for(let i=-1;i<30;i++){const at=performance.now(),r=await fetch(f.base+'/api/data',{headers:{Cookie:f.cookie}});if(r.status!==200)throw Error('aggregate failed');const b=await r.arrayBuffer(),elapsed=performance.now()-at;if(i<0)coldMs=elapsed;else{values.push(elapsed);bytes.push(b.byteLength);}}http={coldMs,...stats(values),maxResponseBytes:Math.max(...bytes)};}finally{await f.stop();}
mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify({at:new Date().toISOString(),directory,environment:{node:process.version,os:release(),cpu:cpus()[0]?.model},method:'Same synthetic tasks, 100/1000 history counts; cold +30 warm metadata reads. Adoption one measured transaction per matrix cell, not P95. 500 articles with fixed 12000-byte bodies; cold +30 HTTP aggregate reads. SQLite/HTTP isolated.',results,http,maxRssBytes:process.resourceUsage().maxRSS*1024},null,2));console.log(output);
