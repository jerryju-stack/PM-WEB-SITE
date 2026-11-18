/** Rehearse the published backup process on the same P14 database that Chrome exercised. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {digest} from '../lib/attachments.ts';
import {loadPolicy} from '../lib/backup-policy.ts';
import {unlockDeadProcess} from '../lib/data-lock.ts';
import {calculateFinance} from '../lib/finance-calculation.ts';
import {financeDigest,readFinanceSnapshot} from '../lib/finance.ts';
import {inspectData} from '../lib/snapshots.ts';
import {httpFixture} from '../tests/http-fixture.ts';

const run=JSON.parse(readFileSync('.deploy/finance-p14/latest-run.json','utf8'));
const roles=JSON.parse(readFileSync(run.credentials,'utf8'));
const controls=JSON.parse(readFileSync(join(run.directory,'recovery-controls.json'),'utf8'));
const source=resolve(run.data),restored=join(run.directory,'restored'),backup=join(run.directory,'managed-backups');
assert.equal(source,resolve(run.directory,'data'));
if(existsSync(restored))throw Error('Start a fresh P14 review run before repeating whole recovery.');
const command=(script:string,operation:string,args:string[])=>JSON.parse(execFileSync(process.execPath,
  ['--experimental-strip-types','scripts/'+script+'.ts',operation,...args],{encoding:'utf8',maxBuffer:10*1024*1024,stdio:['ignore','pipe','pipe']}));
const metrics=['revenue','operating_profit','operating_margin','cqa.mpbitri','npv','irr','payback_period','peak_funding_requirement'];
const readVersions=(directory:string)=>{
  const db=new DatabaseSync(join(directory,'project-station.sqlite'),{readOnly:true});
  try{
    const versions=db.prepare('SELECT project_id,id,status,revision FROM finance_versions ORDER BY project_id,id').all();
    const projectState=db.prepare('SELECT * FROM finance_project_state ORDER BY project_id').all();
    const reports=versions.map(version=>{
      const snapshot=readFinanceSnapshot(db,String(version.project_id),String(version.id));
      const report=calculateFinance(snapshot);
      const cash=report.periodic.map(row=>row.cash_flow.exact);
      const keyValues=Object.fromEntries(metrics.filter(key=>report.metrics[key]).map(key=>{
        const row=report.metrics[key];return [key,{exact:row.exact,status:row.status,display:row.displayValue}];
      }));
      return {version,snapshotDigest:financeDigest(snapshot),calculationDigest:financeDigest(report),keyValues,cash,
        budget:financeDigest(report.budget),productScope:report.productScope,periods:report.periods};
    });
    return {projectState,reports};
  }finally{db.close();}
};

const initial=inspectData(source),finance=readVersions(source);
for(const table of ['projects','tasks','articles','attachments','audit_events','project_members','finance_versions','finance_sources','finance_inputs',
  'finance_events','finance_changes','finance_receipts'])assert.ok(initial.tables[table].count>0,table);
const backupResult=command('backup-policy','run',['--data',source,'--root',backup,'--manual','yes','--offline-confirmed','yes']).result;
const manifest=backupResult.manifest;
assert.deepEqual(manifest.targets,loadPolicy());
assert.deepEqual(manifest.database,initial);
const discovery=command('data-maintenance','verify',['--snapshot',backupResult.snapshot]);
assert.deepEqual(discovery.result,manifest);
const restoreStart=performance.now();
const copy=command('data-maintenance','restore',['--snapshot',backupResult.snapshot,'--target',restored]);
assert.deepEqual(inspectData(restored),initial);
assert.deepEqual(readVersions(restored),finance);
assert.ok(manifest.files.some((row:{path:string})=>row.path.startsWith('uploads/')));

function reportFor(project:string,version:string){
  const report=finance.reports.find(item=>item.version.project_id===project&&item.version.id===version);
  assert.ok(report);return report;
}
function stateFor(project:string){
  const state=finance.projectState.find(row=>row.project_id===project);
  assert.ok(state);return state;
}
function current(project:string){
  const id=String(stateFor(project).current_version_id);
  return reportFor(project,id);
}
const cqa=reportFor(run.projectId,run.baselineId);
assert.equal(cqa.version.status,'frozen');assert.equal(cqa.productScope.length,4);assert.equal(cqa.periods.length,11);
const me=current(run.scenarios.p09),dev=current(run.scenarios.p10),capital=current(run.scenarios.p11);
assert.equal(me.keyValues.npv.display,'88181.82');
assert.equal(dev.keyValues.npv.display,'172384.09');
assert.equal(capital.keyValues.npv.display,'-1735.54');
assert.equal(capital.keyValues.payback_period.display,'2.00');

let replay;
try{
  replay=await httpFixture({directory:restored,password:roles.admin.password});
  const call=async(path:string,body?:unknown,cookie=replay!.cookie)=>{
    const response=await replay!.call(path,body,cookie);assert.equal(response.status,200,path);return response.data;
  };
  const project=controls.attachProject;
  const timing=await call('projects/'+project+'/timing');
  assert.ok(timing.tasks.length>0&&timing.attachments.some((item:{id:string})=>item.id===controls.attachment));
  const article=await call('articles/'+controls.article);assert.equal(article.title,'P14 Recovery Lesson');
  const file=await fetch(replay.base+'/api/attachments/'+controls.attachment,{headers:{Cookie:replay.cookie}});
  assert.equal(file.status,200);
  const synthetic=Buffer.from('P14 synthetic review attachment, byte checked before and after recovery.\n');
  assert.equal(digest(Buffer.from(await file.arrayBuffer())),digest(synthetic));
  const archive=await call('projects/'+run.projectId+'/finance/versions/'+run.baselineId+'/calculation');
  assert.equal(archive.calculationSha256,cqa.calculationDigest);
  const stage=await call('projects/'+run.scenarios.p11+'/finance/workspace?module=compare');
  assert.equal(stage.comparisonReport.data.npv.byDriver.find((row:{key:string})=>row.key==='timing').value.displayValue,'-826.45');
  const reader=await replay.call('login',roles.reader,'');assert.equal(reader.status,200);
  assert.equal((await replay.call('projects/'+run.projectId+'/finance/workspace',undefined,reader.cookie)).status,200);
  assert.equal((await replay.call('projects/'+run.scenarios.p12+'/finance/workspace',undefined,reader.cookie)).status,404);
  const approver=await replay.call('login',roles.reviewer,'');assert.equal(approver.status,200);
  const t6=await call('projects/'+run.scenarios.p12+'/finance/versions/'+run.cases.p12.workflow+'/calculation',undefined,approver.cookie);
  assert.deepEqual(Object.fromEntries(['confirmed_actual','recorded_payments','etc','eac','completion_variance']
    .map(key=>[key,t6.calculation.budget[key].displayValue])),
    {confirmed_actual:'430.00',recorded_payments:'125.00',etc:'700.00',eac:'1130.00',completion_variance:'-130.00'});
  assert.ok(performance.now()-restoreStart<=manifest.targets.rtoMinutes*60000);
}finally{
  if(replay){await replay.stop();if(existsSync(join(restored,'.station-lock')))unlockDeadProcess(restored);}
}
assert.deepEqual(inspectData(restored),initial);
const result={step:'P14',codeVersion:manifest.codeVersion,migrations:initial.migrations,
  verifiedTables:Object.fromEntries(Object.entries(initial.tables).map(([key,row])=>[key,row.count])),
  sameTablesAndDigests:true,attachmentFiles:manifest.files.filter((row:{path:string})=>row.path.startsWith('uploads/')).length,
  financeVersionsRecomputed:finance.reports.length,frozenVersions:finance.reports.filter(item=>item.version.status==='frozen').length,
  frozenCqa:{products:4,periods:11,fullPrecisionAndSourceSnapshotMatch:true},
  sameVersionPointersAndRevisions:true,samePeriodAmountsBudgetAndReturns:true,
  restoredApi:{login:true,timingAndLesson:true,attachmentBytes:true,financeCalculation:true,timingBridge:true,budgetAfterApproval:true,projectIsolation:true},
  elapsedMs:{managedBackup:backupResult.state.elapsedMs,verify:discovery.elapsedMs,restoreCopy:copy.elapsedMs,restoreThroughApi:Math.round(performance.now()-restoreStart)},
  policyTargets:manifest.targets};
writeFileSync('docs/validation/project-finance/P14/recovery-checks.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({tables:Object.keys(initial.tables).length,versions:result.financeVersionsRecomputed,attachments:result.attachmentFiles,
  elapsedMs:result.elapsedMs,code:manifest.codeVersion}));
