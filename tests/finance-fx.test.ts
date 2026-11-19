import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../lib/database.ts';
import {financeDigest,financeService} from '../lib/finance.ts';
import {financeSnapshot} from '../lib/finance-contracts.ts';
import {Decimal} from '../lib/finance-decimal.ts';
import {convertFinanceAmount,financeCurrencyScales,readFxSnapshot} from '../lib/finance-fx.ts';
import {calculateFinance} from '../lib/finance-calculation.ts';
import {compareFinanceFx,displayFinance} from '../lib/finance-fx-report.ts';
import {FinanceBridgeInputs} from '../lib/finance-bridge-inputs.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {mixedFxScenario,testFx} from './fixtures/finance-fx.ts';
import {laborScenario} from './fixtures/finance-p06.ts';
import {engineeringCost} from './fixtures/finance-p10.ts';
import {capitalChange,t5Agreement,t5Asset} from './fixtures/finance-p11.ts';
import {budgetCommand,money,t6Confirm,t6Policy,t6Scope} from './fixtures/finance-p12.ts';
import {CqaWorkbook,buildCqaCandidate} from '../lib/finance-cqa.ts';
import {syntheticCqa} from './fixtures/finance-cqa.ts';
import {sampleFinance} from './fixtures/finance-p04.ts';

const revised={...testFx,rates:{...testFx.rates,EUR:'0.75'}};
const side=(snapshot:FinanceSnapshot)=>{const inputs=new FinanceBridgeInputs();return {snapshot,inputs,report:calculateFinance(snapshot,inputs)};};
const compare=(a:FinanceSnapshot,b:FinanceSnapshot,mode:'own'|'a'|'b'='a',currency='USD')=>
  compareFinanceFx(side(a),side(b),currency,mode,null,null);

test('test exchange rates convert every currency pair exactly, with configured precision and extensible currencies',()=>{
  const scales={...financeCurrencyScales,GBP:2};
  const fx=readFxSnapshot({...testFx,rates:{...testFx.rates,GBP:'0.80'}},scales);
  const equivalents={USD:'100',CNY:'720',EUR:'90',JPY:'15000',GBP:'80'};
  for(const [from,value] of Object.entries(equivalents))for(const [to,expected] of Object.entries(equivalents))
    assert.equal(convertFinanceAmount(Decimal.from(value),scales,fx,from,to)?.cmp(Decimal.from(expected)),0,from+' → '+to);
  assert.equal(convertFinanceAmount(Decimal.from('1.005'),scales,undefined,'USD','USD')?.text(2),'1.01');
  assert.equal(convertFinanceAmount(Decimal.from('-0.01'),scales,fx,'USD','JPY')?.text(0),'-2');
  assert.throws(()=>convertFinanceAmount(Decimal.from(1),scales,fx,'ZZZ','ZZZ'),/Invalid currency/);
  assert.throws(()=>Decimal.from(Infinity),/invalid_decimal/);
  for(const rate of ['0','-7','Infinity','NaN','1e2',NaN,7.2])
    assert.throws(()=>readFxSnapshot({...testFx,rates:{CNY:rate}},scales),/positive decimal/);
  assert.throws(()=>readFxSnapshot({...testFx,rates:{USD:'1'}},scales),/implicit rate/);
  assert.throws(()=>readFxSnapshot({...testFx,date:'2026-02-30'},scales),/reference date/);
  assert.equal(readFxSnapshot({...testFx,date:null,period:'2027 plan'},scales).period,'2027 plan');
});

test('test-data acceptance, original evidence, report currency sync and a missing exchange rate',()=>{
  const s=mixedFxScenario(),before=financeDigest(s),report=calculateFinance(s);
  assert.equal(report.metrics.revenue.displayValue,'500.00');
  assert.equal(report.metrics.total_cost.displayValue,'300.00');
  assert.equal(report.metrics.operating_profit.displayValue,'200.00');
  assert.equal(report.metrics.operating_margin.displayValue,'40.00');
  assert.equal(report.budget.approved_budget.displayValue,'100.00');
  const price=s.inputs.find(row=>row.metricKey==='p08.part_price'&&row.currency==='JPY')!;
  assert.equal(report.inputs['input:'+price.key].currency,'JPY');
  assert.equal(report.inputs['input:'+price.key].value,'15000.000000000000000000');
  const display=displayFinance(report,s,'JPY');
  assert.equal(display.metrics.revenue.displayValue,'75000');
  assert.equal(display.metrics.total_cost.displayValue,'45000');
  assert.equal(display.metrics.operating_profit.displayValue,'30000');
  assert.equal(display.metrics.operating_margin.displayValue,'40.00');
  assert.equal(display.periodic[1].cumulative_cash.currency,'JPY');
  assert.equal(display.budget.approved_budget.displayValue,'15000');
  assert.equal(display.products['product-a'].metrics.npv.currency,'JPY');
  assert.equal(financeDigest(s),before);
  delete s.policy.fx!.rates.JPY;
  const missing=calculateFinance(s);
  assert.equal(missing.metrics.operating_profit.value,null);
  assert.ok(missing.issues.some(issue=>issue.code==='missing_fx'&&issue.message.includes('JPY → USD')));
  const legacy=laborScenario();
  assert.equal(calculateFinance(legacy).metrics.operating_profit.displayValue,'110000.00');
  const unavailable=displayFinance(calculateFinance(legacy),legacy,'EUR');
  assert.equal(unavailable.metrics.operating_profit.status,'missing_fx');
  assert.equal(unavailable.metrics.operating_profit.displayValue,null);
});

test('constant rates revalue original BOM entries, with no writeback and additive exact differences',()=>{
  const a=mixedFxScenario(),b=mixedFxScenario(90,revised),both=financeDigest([a,b]);
  for(const mode of ['own','a','b'] as const){
    const result=compare(a,b,mode);
    const profit=result.metrics.operating_profit;
    assert.equal(profit.original.displayValue,'-20.00');
    assert.equal(profit.business?.displayValue,'0.00');
    assert.equal(profit.fxImpact.displayValue,'-20.00');
    assert.equal(result.metrics.operating_margin.fxImpact.unit,'percentage_point');
    const selected=result.data!.metrics.operating_profit;
    assert.equal(selected.before?.displayValue,mode==='b'?'180.00':'200.00');
    assert.equal(selected.after?.displayValue,mode==='a'?'200.00':'180.00');
  }
  const changed=compare(a,mixedFxScenario(99),'b','JPY').metrics.operating_profit;
  assert.equal(changed.original.displayValue,'-1500');
  assert.equal(changed.business?.displayValue,'-1500');
  assert.equal(changed.fxImpact.displayValue,'0');
  b.currency='CNY';b.currencyScale=2;
  assert.equal(compare(a,b).metrics.operating_profit.business?.displayValue,'0.00');
  b.currency='USD';
  assert.equal(financeDigest([a,b]),both);
});

test('development input keeps its selected original currency through exact contribution and later comparisons',()=>{
  const s=mixedFxScenario();
  const change={...engineeringCost,currency:'EUR'};
  const updated=applyFinanceChanges(s,[change],{from:'year-0',to:'year-0'}).candidate;
  const engineering=updated.inputs.find(row=>row.metricKey==='p10.cost')!;
  assert.equal(engineering.currency,'EUR');
  const report=calculateFinance(updated);
  assert.equal(report.periodic[0].development_gross.currency,'USD');
  assert.equal(report.periodic[0].development_gross.displayValue,'583.33');
  assert.equal(compare(updated,updated).metrics.operating_profit.business?.displayValue,'0.00');
});

test('manufacturing rate, capital and independently approved budget postings use their original currencies',()=>{
  let s=mixedFxScenario();
  s.periods[1].metadata.calendarYear=2027;
  const apply=(change:unknown,from='year-1',actor='maker',to=from)=>{
    const result=applyFinanceChanges(s,[change],{from,to},actor);s=result.candidate;return result.fields[0].key;
  };
  const operations=(record:Record<string,unknown>)=>({collection:'operations',productKey:'product-a',
    record:{...record,reviewer:'TEST calibration owner',reference:'TEST work study'}});
  const design=apply(operations({type:'design',revision:'FX1',
    lines:[{line:'fx-line',shifts:'1',hours:'8',days:'30',allocation:'1',oee:'1'}],
    stations:[{line:'fx-line',station:'S1',operation:'TEST work',people:'1',ct:'360',output:'1',repeats:'1',efficiency:'1'}]}));
  apply(operations({type:'rate',rate:'90',currency:'EUR'}));
  apply(operations({type:'selection',mode:'design',sourceKey:design}));
  const asset=apply({...capitalChange({...t5Asset,gross:'15000'}),currency:'JPY'},'year-0');
  const agreement=t5Agreement(asset);
  apply({...capitalChange({...agreement,amount:'720',receivable:{...agreement.receivable,amount:'720'}}),currency:'CNY'},'year-0');
  apply(t6Policy,'year-0');
  const scope=apply(t6Scope,'year-0');
  const allocation=apply(budgetCommand('allocation',{scope,period:'year-1',documentId:'FX-FUND',title:'TEST funding',
    currency:'EUR',amount:money(180),reference:'TEST approved allocation'}));
  apply(t6Confirm(allocation),'year-1','reviewer');
  const posting=apply(budgetCommand('cost',{scope,period:'year-1',documentId:'FX-COST',title:'TEST purchase',
    currency:'JPY',amount:money(15000,0),date:'2027-05-05',relatedKey:null,reference:'TEST purchase invoice'}));
  apply(t6Confirm(posting),'year-1','reviewer');
  assert.throws(()=>apply(budgetCommand('payment',{scope,period:'year-1',documentId:'FX-WRONG',title:'TEST payment',
    currency:'EUR',amount:money(90),date:'2027-05-06',relatedKey:posting,reference:'TEST wrong currency'})),/original cost currency/);
  apply(budgetCommand('payment',{scope,period:'year-1',documentId:'FX-PAID',title:'TEST payment',
    currency:'JPY',amount:money(7500,0),date:'2027-05-06',relatedKey:posting,reference:'TEST settlement'}));
  const report=calculateFinance(s);
  assert.equal(report.products['product-a'].periodic[1].unit_labor.displayValue,'10.0000');
  assert.equal(report.metrics.capital_gross.displayValue,'100.00');
  assert.equal(report.periodic[0].capital_payments.displayValue,'100.00');
  assert.equal(report.periodic[1].capital_receipts.displayValue,'100.00');
  assert.equal(report.budget.approved_budget.displayValue,'200.00');
  assert.equal(report.budget.confirmed_actual.displayValue,'100.00');
  assert.equal(report.budget.unpaid_confirmed.displayValue,'50.00');
  assert.equal(s.events.find(event=>event.key===posting)?.currency,'JPY');
});

test('archived workbook retains its original basis and marks unsupported or invalid FX explicitly',()=>{
  const {archive,matrix}=syntheticCqa('1',true);
  const archived=buildCqaCandidate(new CqaWorkbook(archive),matrix,sampleFinance()).snapshot;
  const result=compare(archived,archived,'a');
  assert.match(result.reason??'',/without complete original-currency detail/);
  assert.equal(result.data,null);
  assert.equal(result.beforeBasis.kind,'archived_workbook');
  const quote=archived.sources.find(source=>source.sheet==='Input'&&source.cell==='C8')!;
  quote.metadata.excel={...(quote.metadata.excel as object),value:'-6.7'};
  const report=calculateFinance(archived);
  assert.ok(report.issues.some(issue=>issue.code==='invalid_rate'&&issue.message.includes('CQA C8')));
  assert.equal(report.periodic[0].cash_flow.value,null);
});

test('version FX preview, audit, freeze restrictions, cloning, rate isolation and reload',()=>{
  process.env.ADMIN_PASSWORD='Isolated-finance-FX-test-2026';
  const directory=mkdtempSync(join(tmpdir(),'station-fx-'));
  const store=openStore(directory),user=store.get('users','admin'),service=financeService(store);
  const ctx={actorId:user.uid,actorUid:user.uid,actorName:user.name,requestId:'finance-fx-test'};
  store.put('projects',{id:'fx-project',title:'TEST · FX acceptance'});
  const p='fx-project';
  let childId='',expected='';
  try{
    const parent=service.create(user,p,{requestKey:'new',reason:'TEST source',snapshot:mixedFxScenario()},ctx);
    service.freeze(user,p,parent.id,{requestKey:'freeze',reason:'TEST baseline',revision:0,stateRevision:0},ctx);
    const child=service.create(user,p,{requestKey:'clone',reason:'TEST copy',parentId:parent.id,parentRevision:1},ctx);
    childId=child.id;
    const a=service.get(user,p,parent.id);
    const b=service.get(user,p,child.id);
    assert.deepEqual(a.snapshot.policy.fx,b.snapshot.policy.fx);
    const imported=structuredClone(b.snapshot);
    delete imported.policy.fx;
    const importCopy=service.create(user,p,{requestKey:'import-parent',reason:'TEST JSON-based copy',parentId:parent.id,parentRevision:1,snapshot:imported},ctx);
    assert.deepEqual(service.get(user,p,importCopy.id).snapshot.policy.fx,a.snapshot.policy.fx);
    const settings={requestKey:'edit-fx',reason:'TEST change EUR rate',revision:0,fxSettings:{currency:'USD',snapshot:revised}};
    assert.throws(()=>service.previewFx(user,p,parent.id,{...settings,revision:1}),/Frozen/);
    const preview=service.previewFx(user,p,child.id,settings);
    assert.equal(preview.after.operating_profit.displayValue,'180.00');
    assert.equal(service.get(user,p,child.id).revision,0);
    assert.throws(()=>service.save(user,p,child.id,{...settings,candidateSha256:'stale'},ctx),/Preview this revision/);
    const saved=service.save(user,p,child.id,{...settings,candidateSha256:preview.candidateSha256},ctx);
    assert.equal(saved.revision,1);
    assert.deepEqual(service.save(user,p,child.id,{...settings,candidateSha256:preview.candidateSha256},ctx),saved);
    assert.equal(service.changes(user,p,child.id).changes.at(-1)?.operation,'save_fx');
    assert.deepEqual(service.get(user,p,parent.id),a);
    const exported=JSON.parse(JSON.stringify(service.get(user,p,child.id).snapshot));
    assert.deepEqual(financeSnapshot(exported),service.get(user,p,child.id).snapshot);
    assert.equal(calculateFinance(exported).metrics.operating_profit.displayValue,'180.00');
    assert.deepEqual(exported.inputs,b.snapshot.inputs);
    const compared=service.workspace(user,p,new URLSearchParams({module:'compare',from:parent.id,to:child.id,fxMode:'a',displayCurrency:'JPY'}));
    assert.equal(compared.fxComparison?.metrics.operating_profit.fxImpact.displayValue,'-3000');
    assert.equal(service.get(user,p,child.id).revision,1);
    const incomplete={...settings,revision:1,requestKey:'missing-fx',fxSettings:{currency:'USD',snapshot:{...testFx,rates:{CNY:'7.2',EUR:'0.9'}}}};
    const missing=service.previewFx(user,p,child.id,incomplete);
    assert.ok(missing.missingFx.some(issue=>issue.includes('JPY → USD')));
    assert.throws(()=>service.save(user,p,child.id,{...incomplete,candidateSha256:missing.candidateSha256},ctx),/JPY → USD/);
    expected=service.calculation(user,p,child.id).calculationSha256;
  }finally{store.db.close();}
  const reopened=openStore(directory);
  try{assert.equal(financeService(reopened).calculation(reopened.get('users','admin'),p,childId).calculationSha256,expected);}
  finally{reopened.db.close();}
});
