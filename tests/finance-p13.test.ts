import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FinanceBridgeInputs} from '../lib/finance-bridge-inputs.ts';
import {financeBridges} from '../lib/finance-bridges.ts';
import {calculateFinance} from '../lib/finance-calculation.ts';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {businessInputs} from '../lib/finance-business.ts';
import {developmentCosts} from '../lib/finance-development.ts';
import {httpFixture} from './http-fixture.ts';
import {addInput,cashScenario} from './fixtures/finance-p06.ts';
import {fixedValue,p08Scenario} from './fixtures/finance-p08.ts';
import {p10Scenario,engineeringCost} from './fixtures/finance-p10.ts';
import {p11Scenario,capitalRange,capitalChange,t5Asset,t5Agreement} from './fixtures/finance-p11.ts';
import {p12Scenario,p12Range,t6Policy,t6Scope,t6Allocation,t6Cost,t6Forecast,t6Confirm} from './fixtures/finance-p12.ts';

const year={from:'year-1',to:'year-1'};
const edit=(key:string,value:number,scale=0)=>({collection:'inputs',key,value:fixedValue(value,scale)});
const key=(s:FinanceSnapshot,field:string)=>businessInputs(s).find(row=>row.metricKey==='p08.'+field&&row.periodKey==='year-1')!.key;
const side=(snapshot:FinanceSnapshot)=>{const inputs=new FinanceBridgeInputs();return {snapshot,inputs,report:calculateFinance(snapshot,inputs)};};
const model=(before:FinanceSnapshot,after:FinanceSnapshot,through:string|null=null,product:string|null=null)=>
  financeBridges(side(before),side(after),through,product);
function verify(data:NonNullable<ReturnType<typeof model>['data']>){
  assert.ok(data.npv?.reconciled&&!data.npv.unexplained);
  if(data.profit)assert.ok(data.profit.reconciled&&!data.profit.unexplained);
}
const drivers=(bridge:NonNullable<NonNullable<ReturnType<typeof model>['data']>['profit']>)=>
  Object.fromEntries(bridge.byDriver.map(row=>[row.key,row.value.displayValue]));

test('P13 shows volume, price, hours, rate and joint effects with exact money reconciliation and re-solved IRR',()=>{
  const before=p08Scenario();
  const changes=[edit(key(before,'vehicles'),1100),edit(key(before,'sales_price'),22),edit('cycle_time',36),edit('hourly_rate',72)];
  const single=applyFinanceChanges(before,[changes[1]],year).candidate;
  const after=applyFinanceChanges(before,changes,year).candidate;
  const original=model(before,single).data!,all=model(before,after).data!;
  verify(original);verify(all);
  assert.deepEqual(drivers(original.profit!),{sales_rate:'2000.00'});
  assert.deepEqual(drivers(all.profit!),{sales_volume:'2000.00',sales_rate:'2000.00',sales_joint:'200.00',
    material:'-800.00',labor_volume:'-320.00',labor_rate:'-200.00',labor_joint:'-64.00',factory_variable:'-100.00'});
  assert.equal(all.metrics.operating_profit.delta.displayValue,'2716.00');
  assert.equal(all.metrics.npv.delta.displayValue,'2469.09');
  assert.equal(all.metrics.irr.before!.displayValue,'-1.00');
  assert.equal(all.metrics.irr.after!.displayValue,'26.16');
  assert.equal(all.metrics.irr.delta.displayValue,'27.16');
  assert.equal(all.metrics.operating_margin.delta.unit,'percentage_point');
  assert.deepEqual(model(before,applyFinanceChanges(before,changes.toReversed(),year).candidate),model(before,after));
  const inverse=model(after,before).data!;verify(inverse);assert.equal(inverse.metrics.npv.delta.displayValue,'-2469.09');
  const neutral=model(before,structuredClone(before)).data!;verify(neutral);assert.equal(neutral.npv!.byDriver.length,0);
});

test('P13 values cash timing separately at the original rate and isolates a new discount rate',()=>{
  let before=applyFinanceChanges(p11Scenario(),[capitalChange(t5Asset)],capitalRange).candidate;
  const asset=before.inputs.find(row=>row.metricKey==='p11.asset')!.key;
  const terms=t5Agreement(asset);
  before=applyFinanceChanges(before,[capitalChange(terms)],capitalRange).candidate;
  const recovery=before.inputs.find(row=>row.metricKey==='p11.recovery')!.key;
  const delayed=applyFinanceChanges(before,[capitalChange({...terms,receiptPeriod:'year-2'},recovery)],capitalRange).candidate;
  const full=model(before,delayed).data!;verify(full);
  assert.deepEqual(drivers(full.npv!),{timing:'-826.45'});
  assert.equal(full.metrics.operating_profit.delta.displayValue,'0.00');
  assert.deepEqual(full.periodic.map(row=>row.metrics.cash_flow.delta.displayValue),['0.00','-10000.00','10000.00']);
  assert.equal(full.metrics.payback_period.after!.displayValue,'2.00');
  const truncated=model(before,delayed,'year-1').data!;verify(truncated);
  assert.deepEqual(drivers(truncated.npv!),{timing:'-9090.91'});
  assert.equal(truncated.metrics.irr.after!.status,'no_irr');
  assert.equal(truncated.metrics.payback_period.after!.status,'not_recovered');
  const rate=applyFinanceChanges(delayed,[capitalChange({kind:'valuation',discount:'0.25',reference:'Synthetic WACC'})],capitalRange).candidate;
  const repriced=model(before,rate).data!;verify(repriced);
  assert.deepEqual(drivers(repriced.npv!),{timing:'-826.45',discount:'-1864.46'});
  assert.equal(repriced.metrics.discount_rate.delta.displayValue,'15.00');
  assert.equal(repriced.metrics.discount_rate.delta.unit,'percentage_point');
  assert.equal(repriced.metrics.irr.after!.displayValue,full.metrics.irr.after!.displayValue);
});

test('P13 shows engineering hours and rate, then actual cost and dated payment replacing the forecast',()=>{
  const create=applyFinanceChanges(p10Scenario(),[engineeringCost],capitalRange);
  const before=create.candidate,cost=developmentCosts(before)[0];
  const after=applyFinanceChanges(before,[{collection:'development',action:'edit',module:'engineering',costRef:cost.conversion.cost.costRef,
    key:cost.key,record:{...engineeringCost.record,quantity:'6',components:{rate:'120',travel:'25'}}}],capitalRange).candidate;
  const hours=model(before,after).data!;verify(hours);
  assert.deepEqual(drivers(hours.profit!),{engineering_volume:'-100.00',engineering_rate:'-100.00',engineering_joint:'-20.00'});
  const paid=applyFinanceChanges(after,[{collection:'development',action:'actual',key:cost.key,record:{
    incurred:{amount:'745',period:'year-1',date:'2027-02-01',reference:'Synthetic acceptance'},
    payment:{amount:'745',period:'year-2',date:'2028-01-15',reference:'Synthetic remittance'},receipt:null}}],capitalRange).candidate;
  const execution=model(after,paid).data!;verify(execution);
  assert.equal(execution.metrics.operating_profit.delta.displayValue,'0.00');
  assert.deepEqual(drivers(execution.npv!),{timing:'129.30'});
  assert.deepEqual(execution.periodic.map(row=>row.metrics.cash_flow.delta.displayValue),['745.00','0.00','-745.00']);
});

test('P13 keeps each product contribution, selects a cutoff and refuses unlike currency or calendar',()=>{
  const before=cashScenario(),after=applyFinanceChanges(before,[edit('cash-0-1',5000,2),edit('cash-1-1',2700,2)],year).candidate;
  const project=model(before,after).data!,product=model(before,after,'year-1','product-0').data!;
  verify(project);verify(product);
  assert.deepEqual(project.npv!.byDriver[0].products.map(row=>[row.key,row.value.displayValue]),[['product-0','9.09'],['product-1','6.36']]);
  assert.equal(project.npv!.metric.delta.displayValue,'15.45');
  assert.equal(product.npv!.metric.delta.displayValue,'9.09');
  assert.equal(project.profit,null);
  const added=cashScenario([['-80','40','50'],['-20','20','10'],['-100','110','0']]);
  const addedScope=model(before,added).data!;verify(addedScope);
  assert.equal(addedScope.npv!.metric.delta.displayValue,'0.00');
  assert.deepEqual(addedScope.npv!.byDriver[0].products.map(row=>row.key),['product-2']);
  const usd=structuredClone(after);usd.currency='USD';
  assert.equal(model(before,usd).data,null);
  const calendar=structuredClone(after);calendar.periods[1].metadata.calendarYear=2035;
  assert.equal(model(before,calendar).cutoff,'year-0');
});

test('P13 native FX connects to recurring material, and T6 actual confirmation consumes only the matching ledger ETC',()=>{
  const base=p08Scenario();
  assert.throws(()=>applyFinanceChanges(base,[edit(base.inputs.find(row=>row.metricKey==='volume'&&row.periodKey==='year-1')!.key,1200)],year),/active Commercial or BOM/);
  const rate=addInput(base,'usd-1','fx_to_base','3','year-1','product-a','CNY/USD');
  rate.productKey=null;rate.currency=null;rate.valueKind='rate';rate.module='returns';
  const quote=applyFinanceChanges(base,[{...edit(key(base,'part_price'),2),currency:'USD'}],year).candidate;
  const adjusted=applyFinanceChanges(quote,[edit('usd-1',4)],year).candidate;
  const converted=model(quote,adjusted).data!;verify(converted);
  assert.deepEqual(drivers(converted.profit!),{material:'-4000.00'});
  assert.throws(()=>applyFinanceChanges(quote,[edit('usd-1',0)],year),/FX rate must be positive/);

  let snapshot=p12Scenario();
  const submit=(command:unknown,actor='maker')=>{
    const result=applyFinanceChanges(snapshot,[command],p12Range,actor);snapshot=result.candidate;return result.fields[0].key;
  };
  submit(t6Policy);const scope=submit(t6Scope);
  submit(t6Confirm(submit(t6Allocation(scope))),'reviewer');
  submit(t6Confirm(submit(t6Cost(scope,400,'ACTUAL-BASE','Synthetic base'))),'reviewer');
  submit(t6Forecast(scope));
  const pending=submit(t6Cost(scope,50,'ACTUAL-NEW','Synthetic later recognition')),before=snapshot;
  submit(t6Confirm(pending),'reviewer');
  const execution=model(before,snapshot).data!;verify(execution);
  assert.equal(execution.budget.confirmed_actual.delta.displayValue,'50.00');
  assert.equal(execution.budget.etc.delta.displayValue,'-50.00');
  assert.equal(execution.budget.eac.delta.displayValue,'0.00');
  assert.equal(execution.npv!.metric.delta.displayValue,'0.00');
});

test('P13 compares saved stage and bulk-imported drafts, keeps sources on both sides, and observes discard and access boundaries',async()=>{
  const f=await httpFixture();
  try {
    const project=(await f.call('projects',{title:'P13 isolation'},f.cookie)).data.id;
    const api='projects/'+project+'/finance',base=p08Scenario();
    const request=async(url:string,payload?:unknown,method?:string)=>{
      const result=await f.call(api+url,payload,f.cookie,method);
      assert.ok(result.status<300,JSON.stringify(result.data));return result.data;
    };
    const original=await request('/versions',{requestKey:'p13-base',reason:'Synthetic starting stage',snapshot:base});
    const freeze=await request('/versions/'+original.id+'/freeze',{requestKey:'p13-freeze',reason:'Freeze synthetic stage',revision:0,stateRevision:0});
    const draft=await request('/versions',{requestKey:'p13-draft',reason:'Simulated later stage',name:'Simulated later stage',
      parentId:original.id,parentRevision:freeze.revision});
    const versions='/versions/'+draft.id,query='/workspace?module=compare&from='+original.id+'&to='+draft.id;
    const candidate=await request(versions+'/preview',{requestKey:'p13-discard',reason:'Discarded single part change',revision:0,
      effectivePeriod:year,changeSet:[edit(key(base,'part_price'),5)]});
    assert.equal(candidate.comparison.metrics.npv.delta.displayValue,'-1818.18');
    assert.equal((await request(query)).comparisonReport.data.npv.metric.delta.displayValue,'0.00');
    const payload={revision:0,reason:'Combined change',effectivePeriod:year,changeSet:[edit(key(base,'part_price'),5),edit(key(base,'sales_price'),22)]};
    const preview=await request(versions+'/preview',{...payload,requestKey:'p13-multi'});
    await request(versions,{...payload,requestKey:'p13-save',previewCalculationVersion:preview.calculationVersion,candidateSha256:preview.candidateSha256},'PUT');
    const reopened=(await request(query)).comparisonReport;
    assert.equal(reopened.after.revision,1);
    const material=reopened.data.profit.byDriver.find(item=>item.key==='material');
    for(const side of ['before','after']){
      const source=material.details[0][side].find(item=>item.key===key(base,'part_price'));
      assert.ok(source);
      const id=side==='before'?original.id:draft.id;
      const data=await request('/workspace?module=bom&version='+id+'&traceKind=input&traceKey='+source.key+'&tracePeriod=year-1&traceRevision='+
        (side==='before'?freeze.revision:1));
      assert.equal(data.sourceTrace.record.rowKey,source.key);
      assert.equal(data.sourceTrace.record.reference,'Supplier quote Q-01');
      assert.equal(data.sourceRevisionChanged,false);
    }
    const changed=structuredClone(base);
    changed.name='Bulk import · simulated';changed.sources[0].owner='Independent document steward';
    for(const field of ['vehicles','sales_price','part_price'])changed.inputs.find(row=>row.key===key(base,field))!.value=
      fixedValue({vehicles:1100,sales_price:24,part_price:5}[field]!);
    const bulk=await request('/versions',{requestKey:'p13-bulk',reason:'Bulk imported snapshot',snapshot:changed});
    const imported=(await request('/workspace?module=compare&from='+original.id+'&to='+bulk.id)).comparisonReport;
    assert.equal(imported.data.npv.reconciled,true);
    assert.equal(imported.data.npv.unexplained,false);
    assert.equal(imported.changes.filter(change=>change.scope==='driver').length,3);
    const metadata=structuredClone(base);metadata.name='Evidence-only revision';metadata.sources[0].owner='Different source steward';
    const evidence=await request('/versions',{requestKey:'p13-evidence',reason:'Evidence only',snapshot:metadata});
    const neutral=(await request('/workspace?module=compare&from='+original.id+'&to='+evidence.id)).comparisonReport;
    assert.equal(neutral.data.npv.metric.delta.displayValue,'0.00');
    assert.ok(neutral.changes.every(change=>change.scope==='evidence'));
    assert.equal((await f.call(api+query)).status,401);
  } finally {await f.stop();}
});
