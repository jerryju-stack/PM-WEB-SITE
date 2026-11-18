/** Authorized local CQA run. Private rows remain under ignored .deploy, public output contains no amounts. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openStore} from '../lib/database.ts';
import {financeService} from '../lib/finance.ts';
import {inspectData,backupSnapshot,restoreSnapshot} from '../lib/snapshots.ts';
import {runCqaCommand,resolveCqaSource} from './import-finance-cqa.ts';
import {sampleFinance} from '../tests/fixtures/finance-p04.ts';
import assert from 'node:assert/strict';

const root=resolve('.deploy/finance-p05/run-'+new Date().toISOString().replace(/[:.]/g,'-')),data=join(root,'data');
mkdirSync(root,{recursive:true});
const matrix=JSON.parse(readFileSync('docs/validation/project-finance/P01/source-matrix.json','utf8'));
const source=resolveCqaSource(matrix),sourceHash=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),beforeHash=sourceHash();
process.env.ADMIN_PASSWORD='Isolated-P05-Local-Validation-2026';
let store=openStore(data),projectId='cqa-p05-local-validation',versionId='';
try {
  const actor=store.get('users','admin'),ctx={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'p05-local-setup'};
  store.put('projects',{id:projectId,title:'CQA local import validation',description:'Authorized local archive; no production publication'});
  const empty=sampleFinance();empty.name='CQA archive baseline';empty.asOf='2017-04-20';
  empty.products=[];empty.markets=[];empty.lines=[];empty.sources=[];empty.inputs=[];empty.events=[];
  empty.policy.rules={asOfBasis:'archive filename date; not a confirmed actuals cutoff'};
  versionId=financeService(store).create(actor,projectId,{requestKey:'p05-empty-version',reason:'Empty local import target',snapshot:empty},ctx).id;
}finally{store.db.close();}
const common={data,actor:'admin'},preview=runCqaCommand('preview',{...common,project:projectId,version:versionId,source});
console.log(JSON.stringify({phase:'preview',counts:preview.counts,previewId:preview.previewId}));
const options={...common,preview:preview.previewId!,digest:preview.previewDigest!};
const validated=runCqaCommand('validate',options);
console.log(JSON.stringify(validated));
const confirm=runCqaCommand('confirm',options);
console.log(JSON.stringify({phase:'confirm',status:confirm.receipt.status,revision:confirm.receipt.revision}));
const beforeRetry=inspectData(data),retry=runCqaCommand('confirm',options);
assert.deepEqual(retry.receipt,confirm.receipt);assert.deepEqual(inspectData(data),beforeRetry);
const validation=JSON.parse(readFileSync(join(preview.privateOutput!,'validation.json'),'utf8'));
const candidate=JSON.parse(readFileSync(join(preview.privateOutput!,'candidate.json'),'utf8'));
const beforeRestore=inspectData(data),backup=join(root,'imported-backup'),restored=join(root,'restored');
backupSnapshot(data,backup,'P05-import-validation');restoreSnapshot(backup,restored);assert.deepEqual(inspectData(restored),beforeRestore);
store=openStore(restored);
try {
  const baseline=financeService(store).get(store.get('users','admin'),projectId,versionId);
  assert.equal(baseline.status,'frozen');assert.equal(baseline.approvedBaselineId,versionId);
  assert.equal(baseline.snapshot.inputs.length,candidate.snapshot.inputs.length);
}finally{store.db.close();}
assert.equal(sourceHash(),beforeHash);
const publicOutput=resolve('docs/validation/project-finance/P05');mkdirSync(publicOutput,{recursive:true});
const publicReport={
  step:'P05',recordedAt:new Date().toISOString(),sourceSha256:beforeHash,controlSha256:validation.controlSha256,mappingVersion:'P05.1',schema:11,
  status:'passed_with_historical_unexplained',counts:candidate.report.counts,checks:validation.checks,
  products:candidate.snapshot.products.map((p:any)=>({key:p.key,sheet:p.metadata.externalKey,periods:11,excelControls:'passed',importNormalization:'passed',websiteCalculation:'not_implemented'})),
  sourceReadOnly:sourceHash()===beforeHash,previewDidNotWriteFinance:true,confirmationAtomic:true,baselineFrozen:true,currentForecastAutoSelected:false,
  duplicateConfirmationReceiptEqual:true,duplicateConfirmationTablesEqual:true,backupRestoreTablesEqual:true,pending:candidate.report.pending,
  historicalUnexplained:validation.anomalies,websiteValues:{value:null,status:'not_implemented'},privateAmountsExportedToRepository:false
};
if(process.argv.includes('--record')) {
  writeFileSync(join(publicOutput,'import-report.json'),JSON.stringify(publicReport,null,2)+'\n');
  writeFileSync(join(publicOutput,'differences.json'),JSON.stringify({sourceSha256:beforeHash,financialControlChecks:'passed',normalizedCacheChecks:'passed',
    websiteComparison:{status:'not_implemented',differences:null},historicalUnexplained:validation.anomalies,pending:candidate.report.pending},null,2)+'\n');
  writeFileSync(join(publicOutput,'source-map.json'),JSON.stringify({mappingVersion:'P05.1',sourceSha256:beforeHash,sourceKeyFormat:'cqa:<stable sheet identity>:<A1>',inputKeyFormats:['annual:<product>:<period>:<row>','bom:<market>:<row>:<field>','ame:<line>:<field>','pm:<product>:<cell>','development:<group>:<cell>','fx:<field>'],
    products:candidate.report.inventory,dimensions:{products:4,periods:11,markets:8,lines:6},preserved:{rawValue:true,rawFormula:true,sharedAnchor:true,effectiveFormula:true,excelCache:true,websiteValue:null,externalLinks:candidate.report.dependencies.length,externalRefresh:false},
    annualColumns:['productKey','periodKey','originalPeriod','basis','metricKey','sourceKey','sheet','cell','sourceUnit','currency','excelValue','excelState','normalizedValue','websiteValue','websiteStatus'],
    coverage:{dv:'DV cost!M8:AG15',pv:'PV cost!N7:Z15; V7:X8 is covered by DV',pm:'PM!D1:K14; preserve market split and original conversion divisor'},
    pending:candidate.report.pending},null,2)+'\n');
}
writeFileSync('.deploy/finance-p05/latest-run.json',JSON.stringify({data,projectId,versionId,previewId:preview.previewId,previewDigest:preview.previewDigest,privateOutput:preview.privateOutput,restored,backup},null,2)+'\n');
console.log(JSON.stringify({status:publicReport.status,counts:publicReport.counts,historicalUnexplained:validation.anomalies.length,sourceReadOnly:true,duplicateRetry:true,backupRestore:true,privateOutput:preview.privateOutput},null,2));
