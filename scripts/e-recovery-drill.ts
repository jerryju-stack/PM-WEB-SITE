/** Actual D9 runtime seed -> migration8 snapshot -> latest migration -> whole snapshot restore.
 * All data/code copies are newly-created temporary directories. No DATA_DIR input is read.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,relative,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../lib/database.ts';
import {migrations as supportedMigrations} from '../lib/migrations.ts';
import {financeTables} from '../lib/finance-schema.ts';
import {inspectData,backupSnapshot,restoreSnapshot,verifySnapshot} from '../lib/snapshots.ts';
import {digest,reconcile} from '../lib/attachments.ts';
import {httpFixture} from '../tests/http-fixture.ts';
import {unlockDeadProcess} from '../lib/data-lock.ts';

export async function eRecoveryDrill(){
 const root=resolve(fileURLToPath(new URL('../',import.meta.url))),parent=mkdtempSync(join(tmpdir(),'station-e-recovery-'));
 const runtime=join(parent,'d9-runtime'),source=join(parent,'d9-data'),d9Snapshot=join(parent,'d9-snapshot'),upgraded=join(parent,'upgraded'),eSnapshot=join(parent,'e-snapshot'),restored=join(parent,'restored');
 mkdirSync(runtime);process.env.ADMIN_PASSWORD='Isolated-E-Recovery-2026';
 const git=['-c','safe.directory='+root],oldCommit=execFileSync('git',[...git,'rev-parse','0b3f05f'],{cwd:root,encoding:'utf8'}).trim(),codeVersion=execFileSync('git',[...git,'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(execFileSync('git',[...git,'diff','--name-only',oldCommit,codeVersion,'--','package.json','pnpm-lock.yaml'],{cwd:root,encoding:'utf8'}).trim(),'','Historical runtime requires the same locked dependencies');
 const archive=execFileSync('git',[...git,'archive','--format=zip',oldCommit,'lib','assets'],{cwd:root,maxBuffer:64*1024*1024});
 for(const [name,bytes] of Object.entries(unzipSync(archive))){const path=resolve(runtime,name),rel=relative(runtime,path);if(rel==='..'||rel.startsWith('..'+sep))throw Error('Unsafe code archive');if(name.endsWith('/'))mkdirSync(path,{recursive:true});else{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}}
 // The temporary historical modules resolve the existing locked workspace packages through
 // a temporary link; no install, old checkout/reset or production writes are involved.
 const {symlinkSync}=await import('node:fs');symlinkSync(join(root,'node_modules'),join(runtime,'node_modules'),'junction');
 const old=async(name:string)=>import(pathToFileURL(join(runtime,'lib',name+'.ts')).href);
 const [{openStore:oldOpen},{timingDrafts:oldDrafts},{timingVersions:oldVersions},{timingIO:oldIO},{exportProjectXml:oldXml},{attachmentService:oldFiles}]=await Promise.all(['database','timing-drafts','timing-versions','timing-io','timing-project','attachments'].map(old));
 const store=oldOpen(source),actor=store.get('users','admin'),context={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'e-recovery-synthetic'};
 store.put('projects',{id:'p',title:'Synthetic D9 recovery',progress:0,status:'计划中'});
 const task=(id:string,order:number)=>({id,projectId:'p',parentId:null,order,title:'Task '+id,kind:'task',owner:'Synthetic',start:'2026-11-16',end:null,duration:1,progress:0,status:'计划中',notes:'Preserve',predecessors:[]});
 store.saveTasks('p',[task('a',0),{...task('b',1),predecessors:['a']},{...task('c',2),predecessors:['a']}]);
 const drafts=oldDrafts(store),plans=oldVersions(store),io=oldIO(store),baseline=plans.save('p',{kind:'baseline',name:'D9 baseline',reason:'Recovery fixture',revision:store.revision('p'),projectVersion:0,requestKey:'d9-recovery-baseline'},context).version;
 const bytes=Buffer.from('Actual archived-task attachment bytes\nE recovery test only');
 const attached=await oldFiles(store).upload('b','retained.txt',(async function*(){yield bytes;})(),context);
 let session:any,start=drafts.start('p',{},context);const token=start.leaseToken;
 const body=()=>({leaseToken:token,draftId:drafts.state('p').draft.id,revision:drafts.state('p').draft.revision});
 const plan=plans.current('p'),file=oldXml({...plan,tasks:plan.tasks.map((t:any)=>t.id==='a'?{...t,title:'D9 imported A'}:t)}).toString('base64');
 const preview=io.preview('p',{...body(),file,format:'xml'},context);assert.ok(preview.previewId);
 const confirmBody={...body(),previewId:preview.previewId};io.confirm('p',confirmBody,context);
 drafts.mutate('p','b','DELETE',body(),context);const adoptedBody=body(),adopted=drafts.adopt('p',adoptedBody,context);assert.equal(adopted.sequence,1);
 plans.remove('p',baseline.id,context);plans.restore('p',baseline.id,context);plans.remove('p',adopted.versionId,context);
 drafts.start('p',{leaseToken:token},context);drafts.mutate('p','a','PATCH',{...body(),owner:'Unadopted local seed'},context);
 drafts.start('p',{...body(),expectedDraftId:body().draftId,sourceVersion:baseline.id,decision:'archive'},context);session=body();
 const preserved={execution:store.tasks('p'),draft:store.db.prepare('SELECT * FROM timing_drafts').all(),leases:store.db.prepare('SELECT * FROM timing_edit_leases').all(),imports:store.db.prepare('SELECT * FROM timing_imports').all(),adoptions:store.db.prepare('SELECT * FROM timing_adoptions').all(),deletions:store.db.prepare('SELECT * FROM timing_version_deletions').all(),archived:store.db.prepare('SELECT * FROM tasks WHERE archived=1').all()};
 const originalGroups=store.db.prepare('SELECT * FROM permission_groups').all();
 assert.equal(store.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,8);store.db.close();
 const oldEvidence=inspectData(source);backupSnapshot(source,d9Snapshot,oldCommit,undefined,codeVersion);restoreSnapshot(d9Snapshot,upgraded);
 const oldRestored=oldOpen(upgraded);oldRestored.db.close();assert.deepEqual(inspectData(upgraded),oldEvidence);
 const current=openStore(upgraded);
 const restoredBusiness={execution:current.tasks('p'),draft:current.db.prepare('SELECT * FROM timing_drafts').all(),leases:current.db.prepare('SELECT * FROM timing_edit_leases').all(),imports:current.db.prepare('SELECT * FROM timing_imports').all(),adoptions:current.db.prepare('SELECT * FROM timing_adoptions').all(),deletions:current.db.prepare('SELECT * FROM timing_version_deletions').all(),archived:current.db.prepare('SELECT * FROM tasks WHERE archived=1').all()};
 assert.deepEqual(restoredBusiness,preserved);assert.equal(current.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,supportedMigrations.at(-1)!.version);
 for(const group of originalGroups)assert.deepEqual(current.db.prepare('SELECT * FROM permission_groups WHERE id=?').get(group.id),group,'existing permission group changed');
 for(const table of financeTables)assert.equal(current.db.prepare('SELECT COUNT(*) AS n FROM '+table).get()!.n,0,'historical project must have empty finance');
 assert.ok(current.db.prepare("SELECT 1 FROM permission_groups WHERE id='finance-controller'").get());
 assert.ok(current.db.prepare('SELECT COUNT(*) AS n FROM timing_history_index').get()!.n as number);assert.equal(current.db.prepare('SELECT COUNT(*) AS n FROM projects_cards').get()!.n,1);
 assert.equal(digest(readFileSync(join(upgraded,'uploads',attached.id))),digest(bytes));assert.deepEqual(reconcile(current).missing,[]);current.db.close();
 const migratedEvidence=inspectData(upgraded);for(const [table,state] of Object.entries(oldEvidence.tables))if(!['schema_migrations','permission_groups'].includes(table))assert.deepEqual(migratedEvidence.tables[table],state,'migration changed D9 table '+table);
 assert.throws(()=>oldOpen(upgraded),/数据库版本高于/,'old code must reject an upgraded DB');
 const beforeBackup=await httpFixture({directory:upgraded,password:process.env.ADMIN_PASSWORD}),oldCookie=beforeBackup.cookie;
 try{assert.equal((await beforeBackup.call('projects/p/timing',undefined,oldCookie)).status,200);}finally{await beforeBackup.stop();if(existsSync(join(upgraded,'.station-lock')))unlockDeadProcess(upgraded);}
 const eManifest=backupSnapshot(upgraded,eSnapshot,codeVersion);verifySnapshot(eSnapshot);restoreSnapshot(eSnapshot,restored);assert.deepEqual(inspectData(restored),eManifest.database);
 const service=await httpFixture({directory:restored,password:process.env.ADMIN_PASSWORD});let restoredLeaseStartStatus=0;
 try{
  const p=await service.call('projects/p/timing',undefined,service.cookie);assert.equal(p.status,200);assert.deepEqual(p.data.tasks,preserved.execution);
  assert.equal((await service.call('projects/p/timing',undefined,oldCookie)).status,401);
  // A restored unexpired lease may block a new tab, but cannot confer an HTTP login.
  const beforeStart=Date.now(),first=await service.call('projects/p/timing/draft/start',{},service.cookie);restoredLeaseStartStatus=first.status;
  const expires=Number(preserved.leases[0].expires_at);
  if(expires>Date.now())assert.equal(first.status,409,'unexpired restored lease must block a new page');
  else if(expires<=beforeStart)assert.equal(first.status,200,'expired restored lease permits a freshly authenticated page');
  else assert.ok([200,409].includes(first.status),'lease expired during the HTTP request');
  const db=new DatabaseSync(join(restored,'project-station.sqlite'));db.prepare('UPDATE timing_edit_leases SET expires_at=0').run();db.close();
  const fresh=await service.call('projects/p/timing/draft/start',{},service.cookie);assert.equal(fresh.status,200);assert.notEqual(fresh.data.leaseToken,token);
  assert.equal((await service.call('projects/p/timing/draft/heartbeat',{leaseToken:token},service.cookie)).status,409);
  assert.equal((await service.call('projects/p/timing/import/confirm',confirmBody,service.cookie)).status,409);
  assert.equal((await service.call('projects/p/timing/draft/adopt',adoptedBody,service.cookie)).status,409);
  const fileResponse=await fetch(service.base+'/api/attachments/'+attached.id,{headers:{Cookie:service.cookie}});assert.equal(fileResponse.status,200);assert.equal(digest(Buffer.from(await fileResponse.arrayBuffer())),digest(bytes));
  const versions=await service.call('projects/p/timing/versions',undefined,service.cookie);assert.ok(!versions.data.versions.some((v:any)=>v.id===adopted.versionId));
  assert.equal((await service.call('projects/p/timing/versions/'+adopted.versionId+'/restore',{},service.cookie)).status,200);
  assert.equal((await service.call('projects/p/timing/versions/'+adopted.versionId,undefined,service.cookie)).status,200);
 }finally{await service.stop();if(existsSync(join(restored,'.station-lock')))unlockDeadProcess(restored);}
 return {at:new Date().toISOString(),kind:'actual-D9-runtime-to-E-whole-snapshot-recovery',oldCode:oldCommit,pairedECode:codeVersion,parent,migrations:[8,...supportedMigrations.filter(m=>m.version>8).map(m=>m.version)],sameLockedDependencies:true,restoredLeaseStartStatus,historyAndDraftPreserved:true,importAndAdoptionReceiptsPreserved:true,softDeleteUndoPassed:true,archivedTaskAndAttachmentBytesPreserved:true,sessionsNotRestored:true,staleLeaseAndReceiptWritesRejected:true,oldCodeRejectsNewSchema:true,allFixturePortsClosed:true,counts:Object.fromEntries(Object.entries(eManifest.database.tables).map(([name,value])=>[name,value.count]))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await eRecoveryDrill(),output=resolve(process.argv[2]??'docs/validation/batch-e/recovery.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(output);
}
