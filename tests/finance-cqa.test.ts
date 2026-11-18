import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../lib/database.ts';
import {financeService,financeDigest} from '../lib/finance.ts';
import {CqaWorkbook,decimalText,sharedFormula,buildCqaCandidate} from '../lib/finance-cqa.ts';
import {cqaImport,saveCqaPreview,loadCqaPreview} from '../lib/finance-cqa-import.ts';
import {sampleFinance} from './fixtures/finance-p04.ts';
import {syntheticCqa} from './fixtures/finance-cqa.ts';
import {accountService} from '../lib/accounts.ts';
import {policy} from '../lib/policy.ts';
import {inspectData,backupSnapshot,restoreSnapshot} from '../lib/snapshots.ts';
import {resolveCqaSource,runCqaCommand} from '../scripts/import-finance-cqa.ts';
const status=(n:number)=>(e:any)=>e.status===n;
function fixture() {
  process.env.ADMIN_PASSWORD='Synthetic-P05-Only-2026';
  const dir=mkdtempSync(join(tmpdir(),'station-p05-')),store=openStore(join(dir,'data')),actor=store.get('users','admin');
  for(const id of ['p','other'])store.put('projects',{id,title:'Synthetic CQA'});
  const context={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'p05-test'},finance=financeService(store),imports=cqaImport(store);
  const empty=sampleFinance();empty.products=[];empty.markets=[];empty.lines=[];empty.sources=[];empty.inputs=[];empty.events=[];
  const version=()=>finance.create(actor,'p',{requestKey:'empty-'+crypto.randomUUID(),reason:'Synthetic empty import target',snapshot:empty},context).id;
  return {dir,store,actor,context,finance,imports,version};
}
const validation=(r:any)=>({status:'passed',sourceSha256:r.preview.sourceSha256,candidateFileSha256:r.preview.candidateSha256,websiteCalculation:'not_implemented'});
const counts=(db:any)=>Object.fromEntries(['finance_versions','finance_sources','finance_inputs','finance_events','finance_project_state','finance_changes','finance_receipts','audit_events'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));
test('P05 exact decimal normalization and shared formulas preserve relative, absolute and quoted references',()=>{
  assert.deepEqual(decimalText('1.2345e-2',3,2),{coefficient:'1235',scale:2});
  assert.deepEqual(decimalText('-1.005',0,2),{coefficient:'-101',scale:2});
  assert.deepEqual(decimalText('0.000',0,2),{coefficient:'0',scale:2});
  assert.throws(()=>decimalText('NaN'));
  assert.equal(sharedFormula('N10+$O$10+S$10+$T10+"A1"+\'Sheet A1\'!B10+LOG10(A10)','Y10','Z11'),'O11+$O$10+T$10+$T11+"A1"+\'Sheet A1\'!C11+LOG10(B11)');
});
test('P05 reads literals, cached and shared formulas separately, keeps Year 0, eight BOMs, missing costs and unmeasured line assumptions',()=>{
  const {archive,matrix}=syntheticCqa('1',true),book=new CqaWorkbook(archive),candidate=buildCqaCandidate(book,matrix,sampleFinance());
  assert.equal(book.cell('PV cost','Y11').rawFormula,'');assert.equal(book.cell('PV cost','Y11').formula,'N11+$O$10+S$10+$T11');assert.equal(book.cell('PV cost','Y11').sharedAnchor,'Y10');
  assert.equal(book.external[0].index,1);assert.equal(book.external[0].part,'xl/externalLinks/externalLink2.xml');
  assert.equal(candidate.snapshot.sources.find(s=>s.key==='cqa:external:1')!.metadata.target,'file:///missing-synthetic-2.xlsx');
  assert.ok(candidate.snapshot.sources.some(s=>s.externalKey==='TARIFF_PM'&&s.metadata.definition==='[1]Rates!$A$1'));
  assert.equal(candidate.report.counts.products,4);assert.equal(candidate.report.counts.periods,11);assert.equal(candidate.report.counts.markets,8);
  assert.equal(candidate.snapshot.periods.find(p=>p.key==='year-0')!.metadata.calendarYear,null);
  const missing=candidate.report.annual.find(r=>r.productKey==='outboard'&&r.periodKey==='year-2019'&&r.metricKey==='labor'&&r.basis==='cqa_full');
  assert.equal(missing.excelState,'missing_cache');assert.equal(missing.normalizedValue,null);assert.equal(missing.websiteValue,null);
  assert.equal(candidate.report.inventory.find(i=>!i.active).classification,'excluded_template');
  assert.ok(candidate.snapshot.sources.filter(s=>s.sheet==='AME').every(s=>s.observation==='design'));
  const quantity=candidate.snapshot.inputs.find(i=>i.key==='bom:out_eu:8:quantity')!;
  assert.equal(quantity.value.coefficient,'2');
  const landed=candidate.snapshot.inputs.find(i=>i.key==='bom:out_eu:8:landed_contribution')!;
  assert.equal(landed.value.coefficient,'4'); // Already a line contribution. Never multiply this by quantity again.
  assert.equal(candidate.snapshot.events.length,0); // A forecast is not a bank payment or confirmed actual.
  const wrong={...matrix,sample:{...matrix.sample,sha256:'0'.repeat(64)}};
  assert.throws(()=>buildCqaCandidate(book,wrong,sampleFinance()),status(409));
});
test('P05 preview is private staging only; confirmation is atomic, frozen and idempotent by project/version/source/row identity',()=>{
  const f=fixture();try {
    const broken=join(f.dir,'broken');mkdirSync(broken);writeFileSync(join(broken,'project-station.sqlite'),'invalid test database');
    assert.throws(()=>runCqaCommand('preview',{data:broken,actor:'admin',project:'p',version:'none'}));
    assert.equal(existsSync(join(broken,'.station-lock')),false);
    const input=syntheticCqa(),id=f.version(),before=counts(f.store.db),r=f.imports.preview(f.actor,'p',id,input.archive,input.matrix);
    assert.deepEqual(counts(f.store.db),before);
    const directory=saveCqaPreview(f.store.directory,r),loaded=loadCqaPreview(f.store.directory,r.preview.id);
    assert.equal(loaded.preview.versionId,id);assert.equal(loaded.candidate.sourceSha256,input.matrix.sample.sha256);
    const receipt=f.imports.confirm(f.actor,r.preview,r.candidate,validation(r),r.previewDigest,f.context);
    assert.equal(receipt.status,'frozen');assert.equal(receipt.approvedBaselineId,id);assert.equal(receipt.currentVersionId,null);
    const after=counts(f.store.db);
    assert.deepEqual(f.imports.confirm(f.actor,r.preview,r.candidate,validation(r),r.previewDigest,f.context),receipt);
    assert.deepEqual(counts(f.store.db),after);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM finance_inputs WHERE project_id=? AND version_id=?').get('p',id)!.n,r.candidate.snapshot.inputs.length);
    assert.throws(()=>f.imports.preview(f.actor,'p',id,input.archive,input.matrix),status(409));
    assert.throws(()=>f.store.db.prepare("UPDATE finance_sources SET original_unit='tamper' WHERE version_id=?").run(id),/Frozen/);
    const bytes=readFileSync(join(directory,'candidate.json'));writeFileSync(join(directory,'candidate.json'),Buffer.concat([bytes,Buffer.from(' ')]));
    assert.throws(()=>loadCqaPreview(f.store.directory,r.preview.id),status(409));
    assert.doesNotThrow(()=>inspectData(f.store.directory));
  }finally{f.store.db.close();}
});
test('P05 same display name with different source revision stays separate; changed source/candidate/digest and stale project pointers cannot confirm',()=>{
  const f=fixture();try {
    const a=syntheticCqa('1'),b=syntheticCqa('2'),v1=f.version(),v2=f.version();
    const first=join(f.dir,'source-a'),second=join(f.dir,'source-b');mkdirSync(first);mkdirSync(second);
    const fileA=join(first,'same-name.xlsx'),fileB=join(second,'same-name.xlsx');writeFileSync(fileA,a.archive);writeFileSync(fileB,b.archive);
    const configured=process.env.CQA_SAMPLE_XLSX;
    try {
      delete process.env.CQA_SAMPLE_XLSX;
      assert.equal(resolveCqaSource(a.matrix,fileA),fileA);
      assert.throws(()=>resolveCqaSource(a.matrix,fileB),/fingerprint/);
      assert.equal(resolveCqaSource(b.matrix,fileB),fileB);
      process.env.CQA_SAMPLE_XLSX=fileA;assert.equal(resolveCqaSource(a.matrix,fileB),fileA);
    }finally{if(configured===undefined)delete process.env.CQA_SAMPLE_XLSX;else process.env.CQA_SAMPLE_XLSX=configured;}
    const p1=f.imports.preview(f.actor,'p',v1,a.archive,a.matrix),p2=f.imports.preview(f.actor,'p',v2,b.archive,b.matrix);
    assert.notEqual(p1.preview.sourceSha256,p2.preview.sourceSha256);assert.equal(p1.candidate.snapshot.name,p2.candidate.snapshot.name);
    assert.throws(()=>f.imports.confirm(f.actor,p1.preview,p2.candidate,validation(p2),p1.previewDigest,f.context),status(409));
    assert.throws(()=>f.imports.confirm(f.actor,p1.preview,p1.candidate,validation(p1),'wrong-digest',f.context),status(409));
    assert.throws(()=>f.imports.confirm(f.actor,p1.preview,p1.candidate,{...validation(p1),status:'failed'},p1.previewDigest,f.context),status(409));
    f.imports.confirm(f.actor,p1.preview,p1.candidate,validation(p1),p1.previewDigest,f.context);
    assert.throws(()=>f.imports.confirm(f.actor,p2.preview,p2.candidate,validation(p2),p2.previewDigest,f.context),status(409));
    const refreshed=f.imports.preview(f.actor,'p',v2,b.archive,b.matrix);
    f.imports.confirm(f.actor,refreshed.preview,refreshed.candidate,validation(refreshed),refreshed.previewDigest,f.context);
    assert.equal(f.finance.get(f.actor,'p',v1).snapshot.policy.rules.sourceSha256,p1.preview.sourceSha256);
    assert.equal(f.finance.get(f.actor,'p',v2).snapshot.policy.rules.sourceSha256,p2.preview.sourceSha256);
  }finally{f.store.db.close();}
});
test('P05 partial source-row failure and late audit failure roll back the entire import; unchanged preview retries after the fault is removed',()=>{
  const f=fixture();try {
    const input=syntheticCqa(),id=f.version(),r=f.imports.preview(f.actor,'p',id,input.archive,input.matrix),before=counts(f.store.db);
    let attempted=0;f.store.db.function('p05_fault',()=>{if(++attempted===50)throw Error('P05 source failure');return 1;});
    f.store.db.exec('CREATE TRIGGER fail_cqa_row BEFORE INSERT ON finance_sources BEGIN SELECT p05_fault(); END');
    assert.throws(()=>f.imports.confirm(f.actor,r.preview,r.candidate,validation(r),r.previewDigest,f.context));assert.equal(attempted,50);
    assert.deepEqual(counts(f.store.db),before);f.store.db.exec('DROP TRIGGER fail_cqa_row');
    f.store.db.exec("CREATE TRIGGER fail_cqa_audit BEFORE INSERT ON audit_events WHEN NEW.resource='finance' BEGIN SELECT RAISE(ABORT,'P05 late audit failure'); END");
    assert.throws(()=>f.imports.confirm(f.actor,r.preview,r.candidate,validation(r),r.previewDigest,f.context),/P05 late audit failure/);
    assert.deepEqual(counts(f.store.db),before);f.store.db.exec('DROP TRIGGER fail_cqa_audit');
    assert.equal(f.imports.confirm(f.actor,r.preview,r.candidate,validation(r),r.previewDigest,f.context).status,'frozen');
  }finally{f.store.db.close();}
});
test('P05 financial permissions, account revocation and cross-project preview binding apply at confirmation',()=>{
  const f=fixture();try {
    const u=accountService(f.store).create(f.actor,{id:'importer',role:'editor',password:'Synthetic-P05-Entry-2026'},f.context)!;
    policy(f.store).setMember(f.actor,'p',u.id,'finance-controller',f.context);
    const editor=f.store.get('users','importer'),input=syntheticCqa(),id=f.version(),r=f.imports.preview(editor,'p',id,input.archive,input.matrix);
    assert.throws(()=>f.imports.preview(editor,'other',id,input.archive,input.matrix));
    policy(f.store).setMember(f.actor,'p',u.id,'finance-reader',f.context);
    assert.throws(()=>f.imports.confirm(editor,r.preview,r.candidate,validation(r),r.previewDigest,f.context),status(403));
    assert.equal(f.finance.get(f.actor,'p',id).status,'draft');
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM finance_sources').get()!.n,0);
  }finally{f.store.db.close();}
});
test('P05 frozen imported source cells, exact amounts, receipts and baseline pointers survive existing backup/restore',()=>{
  const f=fixture();try {
    const input=syntheticCqa(),id=f.version(),r=f.imports.preview(f.actor,'p',id,input.archive,input.matrix);
    f.imports.confirm(f.actor,r.preview,r.candidate,validation(r),r.previewDigest,f.context);
    const before=inspectData(f.store.directory);f.store.db.close();
    const backup=join(f.dir,'backup'),restored=join(f.dir,'restored');backupSnapshot(f.store.directory,backup,'synthetic-P05');restoreSnapshot(backup,restored);
    assert.deepEqual(inspectData(restored),before);
  }finally{if(f.store.db.isOpen)f.store.db.close();}
});
