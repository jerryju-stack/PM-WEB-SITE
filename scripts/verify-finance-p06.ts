/** P06 only. Real values remain in ignored .deploy; original P05 database and workbook stay untouched. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {calculateFinance} from '../lib/finance-calculation.ts';
import {financeService,financeDigest} from '../lib/finance.ts';
import {openStore} from '../lib/database.ts';
import {restoreSnapshot} from '../lib/snapshots.ts';
import {publicExamples} from './finance-p06-examples.ts';
import {pythonExecutable,resolveCqaSource} from './import-finance-cqa.ts';

const root=resolve('.deploy/finance-p06/run-'+new Date().toISOString().replace(/[:.]/g,'-')),publicDir=resolve('docs/validation/project-finance/P06');
mkdirSync(root,{recursive:true});
const write=(path:string,value:any)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const examples=publicExamples();write(join(root,'examples.json'),examples);
execFileSync(pythonExecutable(),['-X','utf8','scripts/verify-finance-p06-examples.py','--results',join(root,'examples.json'),'--output',join(root,'independent-examples.json')],{stdio:'pipe'});
if(process.argv.includes('--record')){mkdirSync(publicDir,{recursive:true});write(join(publicDir,'examples.json'),examples);write(join(publicDir,'independent-examples.json'),JSON.parse(readFileSync(join(root,'independent-examples.json'),'utf8')));}
if(!process.argv.includes('--public-only')) {
  const index=resolve('.deploy/finance-p05/latest-run.json');assert.ok(existsSync(index),'Run the authorized P05 baseline verification first; its private latest-run.json is required.');
  const p05=JSON.parse(readFileSync(index,'utf8')),matrix=JSON.parse(readFileSync('docs/validation/project-finance/P01/source-matrix.json','utf8'));
  const source=resolveCqaSource(matrix),hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),sourceBefore=hash();
  const data=join(root,'data');restoreSnapshot(p05.backup,data);
  const store=openStore(data),service=financeService(store),actor=store.get('users','admin'),projectId=p05.projectId;
  let report:any;
  try {
    const baseline=service.get(actor,projectId,p05.versionId);assert.equal(baseline.status,'frozen');
    assert.equal(baseline.snapshot.policy.rules.sourceSha256,sourceBefore);
    const reports={USD:calculateFinance(baseline.snapshot),CNY:calculateFinance({...baseline.snapshot,currency:'CNY'})};
    write(join(root,'calculated-reports.json'),reports);
    execFileSync(pythonExecutable(),['-X','utf8','scripts/validate-finance-p06.py','--source',source,'--reports',join(root,'calculated-reports.json'),'--output',join(root,'reconciliation.json')],{stdio:'pipe',maxBuffer:1024*1024});
    report=JSON.parse(readFileSync(join(root,'reconciliation.json'),'utf8'));
    // Deliberately poison terminal controls to prove they cannot feed the calculated statement/cash.
    const poisoned=structuredClone(baseline.snapshot),terminalRows=new Set(['186','188','212','286','343','344','349']);
    for(const src of poisoned.sources)if(src.sheet?.startsWith('Financials ')&&/^\w/.test(src.cell??'')&&terminalRows.has(src.cell!.replace(/^[A-Z]+/,''))) {
      const excel=src.metadata.excel as any;if(excel.state==='number')excel.value='999999999999';
    }
    assert.deepEqual(calculateFinance(poisoned),reports.USD);
    const ctx={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'p06-local-verification'};
    const draft=service.create(actor,projectId,{requestKey:'p06-clone',reason:'Isolated P06 replay verification',parentId:p05.versionId,parentRevision:baseline.revision,name:'P06 isolated candidate'},ctx);
    const input=baseline.snapshot.inputs.find(r=>r.key==='ame:35:cycle_time')!;assert.ok(input);
    const next={coefficient:(BigInt(input.value.coefficient)+6n*10n**BigInt(input.value.scale)).toString(),scale:input.value.scale};
    const body={requestKey:'p06-preview',reason:'One effective year; shared buckle operation CT +6s',revision:0,clientSequence:1,
      effectivePeriod:{from:'year-2020',to:'year-2020'},changeSet:[{collection:'inputs',key:input.key,value:next}]};
    const writesBefore=store.db.prepare('SELECT total_changes() AS n').get()!.n;
    const preview=service.preview(actor,projectId,draft.id,body);
    assert.equal(store.db.prepare('SELECT total_changes() AS n').get()!.n,writesBefore);
    assert.deepEqual(preview.affectedProducts,['double_buckle','single_buckle']);
    assert.equal(preview.comparison.periodic[1].cash_flow.delta.displayValue,'0.00');
    assert.notEqual(preview.comparison.periodic[2].cash_flow.delta.displayValue,'0.00');
    // The per-piece operation delta for double buckles is exactly twice that for single buckles.
    const d=preview.comparison.products.double_buckle.periodic[2].unit_labor_sop.delta;
    const u=preview.comparison.products.single_buckle.periodic[2].unit_labor_sop.delta;
    assert.ok(Math.abs(Number(d.value)-2*Number(u.value))<=0.000001);
    const save={requestKey:'p06-save',reason:body.reason,revision:0,changeSet:body.changeSet,effectivePeriod:body.effectivePeriod,candidateSha256:preview.candidateSha256,previewCalculationVersion:preview.calculationVersion};
    const receipt=service.save(actor,projectId,draft.id,save,ctx);assert.equal(receipt.calculationSha256,preview.calculationSha256);
    assert.deepEqual(service.save(actor,projectId,draft.id,save,ctx),receipt);
    assert.equal(service.calculation(actor,projectId,draft.id).calculationSha256,preview.calculationSha256);
    assert.equal(financeDigest(service.get(actor,projectId,p05.versionId).snapshot),financeDigest(baseline.snapshot));
    assert.throws(()=>service.preview(actor,projectId,draft.id,body),(e:any)=>e.status===409);
    write(join(root,'preview.json'),preview);write(join(root,'receipt.json'),receipt);
    write(join(root,'run.json'),{data,projectId,baselineId:p05.versionId,draftId:draft.id,calculationSha256:preview.calculationSha256});
    report.preview={status:'passed',rowsWritten:0,sharedLineProducts:preview.affectedProducts,effectivePeriod:body.effectivePeriod,otherInitialPeriodUnchanged:true,doubleBuckleOperationFactor:2,
      saveMatchesPreview:true,idempotentRetry:true,staleRevisionRejected:true,frozenBaselineUnchanged:true,terminalControlsIgnored:true};
  } finally {store.db.close();}
  const run=JSON.parse(readFileSync(join(root,'run.json'),'utf8')),reopened=openStore(run.data);
  try {assert.equal(financeService(reopened).calculation(reopened.get('users','admin'),run.projectId,run.draftId).calculationSha256,run.calculationSha256);report.preview.reopenedMatchesPreview=true;}finally{reopened.db.close();}
  assert.equal(hash(),sourceBefore);report.recordedAt=new Date().toISOString();
  const historical=JSON.parse(readFileSync('docs/validation/project-finance/P05/differences.json','utf8')).historicalUnexplained;
  report.historicalUnexplained=historical;
  write(join(root,'reconciliation.json'),report);
  if(process.argv.includes('--record'))write(join(publicDir,'reconciliation.json'),report);
  console.log(JSON.stringify({status:report.status,checks:report.checks,preview:report.preview,historicalUnexplained:historical.length}));
}
write('.deploy/finance-p06/latest-run.json',{root,publicOnly:process.argv.includes('--public-only')});
console.log(JSON.stringify({publicExamples:'passed',privateOutput:root}));
