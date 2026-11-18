import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {applyFinanceChanges,previewImpact} from '../lib/finance-preview.ts';
import {Decimal} from '../lib/finance-decimal.ts';
import {cashScenario,laborScenario,laborChange} from './fixtures/finance-p06.ts';
import {createFinancePreviewCoordinator} from '../src/finance-preview-state.ts';

test('P06 T1 aggregates products before solving returns and preserves output provenance',()=>{
  const r=calculateFinance(cashScenario());
  assert.deepEqual(Object.fromEntries(['npv','irr','payback_period','peak_funding_requirement'].map(k=>[k,r.metrics[k].displayValue])),{npv:'4.13',irr:'13.07',payback_period:'1.67',peak_funding_requirement:'100.00'});
  assert.equal(r.metrics.peak_funding_requirement.details.firstPeriod,'year-0');
  assert.deepEqual(r.periodic.map(p=>p.cash_flow.displayValue),['-100.00','60.00','60.00']);
  assert.notEqual(Number(r.metrics.irr.value),Object.values(r.products).reduce((n,p)=>n+Number(p.metrics.irr.value),0));
  for(const v of Object.values(r.outputs))for(const key of ['basis','unit','periods','upstreamInputs','calculationVersion','dictionaryVersion','asOf','productScope','status','formula'])assert.ok(key in v,v.id+':'+key);
  for(const id of r.metrics.npv.upstreamInputs)assert.ok(r.inputs[id]);
});

test('P06 T2 calculates CT to unit labor, annual cost, operating profit, cash and NPV without mutating input',()=>{
  const s=laborScenario(),copy=structuredClone(s),a=calculateFinance(s),prepared=applyFinanceChanges(s,laborChange.changeSet,laborChange.effectivePeriod),b=calculateFinance(prepared.candidate);
  const diff=compareCalculations(a,b),impact=previewImpact(a,b,prepared.fields);
  assert.deepEqual(s,copy);assert.equal(a.products['product-a'].periodic[1].unit_labor.displayValue,'1.0000');
  assert.equal(b.products['product-a'].periodic[1].unit_labor.displayValue,'1.2000');
  assert.equal(diff.products['product-a'].periodic[1].labor.delta.displayValue,'2000.00');
  assert.equal(diff.metrics.operating_profit.delta.displayValue,'-2000.00');assert.equal(diff.periodic[1].cash_flow.delta.displayValue,'-2000.00');assert.equal(diff.metrics.npv.delta.displayValue,'-1818.18');
  assert.deepEqual(impact.affectedProducts,['product-a']);assert.deepEqual(impact.affectedPeriods,['year-1']);
  for(const key of ['unit_labor','labor','profit','cash_flow','npv'])assert.ok(impact.paths[0].nodes.some(n=>n.metricKey===key),key);
});

test('P06 cash edge states include negative/zero IRR, exact recovery, repeated lows, late deficits and recrossing',()=>{
  const cases=[
    {cash:['-100','80'],irr:'-20.00',payback:'not_recovered',years:null,peak:'100.00',first:'year-0'},
    {cash:['-100','0','100'],irr:'0.00',payback:'ok',years:'2.00',peak:'100.00',first:'year-0'},
    {cash:['-100','230','-132'],irr:null,payback:'recrossed',years:'0.43',peak:'100.00',first:'year-0'},
    {cash:['0','10','20'],irr:null,payback:'no_funding_required',years:'0.00',peak:'0.00',first:null},
    {cash:['0','0','0'],irr:null,payback:'no_funding_required',years:'0.00',peak:'0.00',first:null},
    {cash:['10','-30','40'],irr:null,payback:'ok',years:'1.50',peak:'20.00',first:'year-1'},
    {cash:['-100','0','20','100'],irr:'6.66',payback:'ok',years:'2.80',peak:'100.00',first:'year-0'}
  ];
  for(const c of cases){const r=calculateFinance(cashScenario([c.cash])).metrics;assert.equal(r.irr.displayValue,c.irr,c.cash.join(','));assert.equal(r.payback_period.status,c.payback);assert.equal(r.payback_period.displayValue,c.years);assert.equal(r.peak_funding_requirement.displayValue,c.peak);assert.equal(r.peak_funding_requirement.details.firstPeriod,c.first);}
  assert.equal(calculateFinance(cashScenario([['-100','230','-132']])).metrics.irr.status,'ambiguous_irr');
  assert.equal(calculateFinance(cashScenario([['0','10']])).metrics.irr.status,'no_irr');
});

test('P06 missing cash blocks complete-horizon returns; missing/invalid rate blocks only discounted values',()=>{
  const missing=cashScenario();missing.inputs.pop();const r=calculateFinance(missing);
  for(const key of ['npv','irr','payback_period','peak_funding_requirement']){assert.equal(r.metrics[key].value,null);assert.equal(r.metrics[key].status,'missing_input');}
  for(const value of [null,{coefficient:'-100',scale:2}]) {const s=cashScenario();s.policy.rules.discountRate=value;const m=calculateFinance(s).metrics;assert.equal(m.npv.value,null);assert.equal(m.irr.displayValue,'13.07');assert.equal(m.npv.status,value?'invalid_rate':'missing_input');}
  const s=cashScenario();s.policy.rules.discountRate={coefficient:'-10',scale:2};assert.equal(calculateFinance(s).metrics.npv.displayValue,'40.74');
});

test('P06 manufacturing missing data, zero denominator and unapproved mappings remain distinct from zero',()=>{
  const s=laborScenario();s.inputs=s.inputs.filter(r=>r.metricKey!=='hourly_rate');assert.equal(calculateFinance(s).metrics.npv.status,'missing_input');
  const zero=laborScenario();zero.inputs.find(r=>r.metricKey==='labor_efficiency')!.value.coefficient='0';assert.equal(calculateFinance(zero).metrics.npv.status,'zero_denominator');
  const pending=laborScenario();delete pending.policy.rules.operatingMapping;assert.equal(calculateFinance(pending).metrics.operating_profit.status,'pending_finance');
  const revenue=laborScenario();revenue.inputs.filter(r=>r.metricKey==='unit_sales').forEach(r=>r.value.coefficient='0');assert.equal(calculateFinance(revenue).metrics.operating_margin.status,'zero_denominator');
});

test('P06 decimal precision, half-away display, original-precision deltas and weighted margins',()=>{
  assert.equal(Decimal.from('-1.005').text(2),'-1.01');assert.equal(Decimal.from('9007199254740993.01').add(Decimal.from('0.01')).text(2),'9007199254740993.02');
  const a=calculateFinance(cashScenario([['-100','60','60']])),s=cashScenario([['-100','60','60']]);s.policy.rules.discountRate={coefficient:'100001',scale:6};
  const b=calculateFinance(s),d=compareCalculations(a,b);assert.notEqual(d.metrics.npv.delta.value,'0.000000000000000000');assert.equal(d.metrics.irr.delta.unit,'percentage_point');
  assert.equal(d.metrics.payback_period.delta.unit,'year');
  const weighted=laborScenario();weighted.products.push({...weighted.products[0],key:'product-b'});weighted.lines.push({key:'line-b',label:'B',metadata:{productKey:'product-b'}});
  weighted.inputs.push(...weighted.inputs.map(r=>({...structuredClone(r),key:'b-'+r.key,productKey:'product-b',lineKey:r.lineKey?'line-b':null,value:r.metricKey==='unit_sales'?{coefficient:'50',scale:0}:r.value})));
  const w=calculateFinance(weighted);assert.equal(w.metrics.operating_margin.displayValue,'74.29');
  assert.notEqual(Number(w.metrics.operating_margin.value),(Number(w.products['product-a'].metrics.operating_margin.value)+Number(w.products['product-b'].metrics.operating_margin.value))/2);
});

test('P06 combined driver changes are deterministic and solver failure never yields a fabricated IRR',()=>{
  const s=laborScenario(),changes=[...laborChange.changeSet,{collection:'inputs' as const,key:'hourly_rate',value:{coefficient:'72',scale:0}}];
  const a=calculateFinance(applyFinanceChanges(s,changes,laborChange.effectivePeriod).candidate),b=calculateFinance(applyFinanceChanges(s,[...changes].reverse(),laborChange.effectivePeriod).candidate);
  assert.deepEqual(a,b);assert.equal(compareCalculations(calculateFinance(s),a).metrics.npv.delta.displayValue,'-4000.00');
  const failed=calculateFinance(cashScenario([['-1000000000000000000','600000000000000000','600000000000000000']])).metrics.irr;
  assert.equal(failed.status,'solver_failed');assert.equal(failed.value,null);
  s.calculationVersion='future-unknown';assert.throws(()=>calculateFinance(s),/Unsupported stored/);
});

test('P06 comparisons reject mismatched scopes and unavailable nonlinear metrics have null deltas',()=>{
  const a=calculateFinance(cashScenario()),s=cashScenario();s.products[1].metadata.active=false;const b=calculateFinance(s);
  assert.equal(compareCalculations(a,b).compatible,false);assert.equal(compareCalculations(a,b).metrics.npv.delta.status,'incompatible_scope');
  const c=compareCalculations(calculateFinance(cashScenario([['-100','50']])),calculateFinance(cashScenario([['-100','120']])));
  assert.equal(c.metrics.payback_period.delta.value,null);
});

test('P06 edits validate period bounds, duplicate keys, known drivers and money precision',()=>{
  const s=laborScenario();assert.throws(()=>applyFinanceChanges(s,laborChange.changeSet,{from:'year-0',to:'year-0'}));
  assert.throws(()=>applyFinanceChanges(s,[...laborChange.changeSet,...laborChange.changeSet],laborChange.effectivePeriod));
  assert.throws(()=>applyFinanceChanges(s,[{collection:'inputs',key:'other_cost-1',value:{coefficient:'1',scale:3}}],laborChange.effectivePeriod));
  s.inputs.find(r=>r.key==='cycle_time')!.metricKey='unconnected';assert.throws(()=>applyFinanceChanges(s,laborChange.changeSet,laborChange.effectivePeriod),/Unsupported calculation driver/);
  const gap=cashScenario();gap.periods[2].metadata.ordinal=4;assert.throws(()=>calculateFinance(gap),/contiguous/);
});

test('P06 budget shares exact event calculations and does not count payments or create actuals from empty data',()=>{
  const s=laborScenario();const event={module:'budget' as const,productKey:'product-a',marketKey:null,lineKey:null,periodKey:'year-1',sourceKey:s.sources[0].key,currency:'CNY',eventDate:null,relatedKey:null,evidenceKey:'synthetic'};
  s.events=[{...event,key:'b',kind:'budget',amount:{coefficient:'100000',scale:2}},{...event,key:'a',kind:'incurred',amount:{coefficient:'40000',scale:2}},{...event,key:'e',kind:'etc',amount:{coefficient:'50000',scale:2}},{...event,key:'p',kind:'payment',relatedKey:'a',amount:{coefficient:'40000',scale:2}}];
  s.policy.rules.budgetIncurredBasis='confirmed';
  const b=calculateFinance(s).budget;assert.equal(b.confirmed_actual.displayValue,'400.00');assert.equal(b.budget_balance.displayValue,'600.00');assert.equal(b.eac.displayValue,'900.00');assert.equal(b.completion_variance.displayValue,'100.00');
  const candidate=applyFinanceChanges(s,[{collection:'events',key:'e',value:{coefficient:'55000',scale:2}}],{from:'year-1',to:'year-1'}),impact=previewImpact(calculateFinance(s),calculateFinance(candidate.candidate),candidate.fields);
  assert.deepEqual(impact.affectedProducts,['product-a']);assert.deepEqual(impact.affectedPeriods,['year-1']);assert.equal(impact.comparison.budget.eac.delta.displayValue,'50.00');assert.equal(impact.comparison.metrics.npv.delta.displayValue,'0.00');
  assert.equal(calculateFinance(cashScenario()).budget.confirmed_actual.value,null);
  delete s.policy.rules.budgetIncurredBasis;assert.equal(calculateFinance(s).budget.confirmed_actual.value,null);
});

test('P06 asynchronous old success, old error, context mismatch and invalidation cannot replace the latest result',async()=>{
  const c=createFinancePreviewCoordinator(),context={projectId:'p',versionId:'v',revision:0,requestKey:'one'};
  let resolveOld:any,rejectOld:any;
  const old=c.run(context,t=>new Promise<typeof t>(resolve=>{resolveOld=()=>resolve(t);}));
  const current=await c.run({...context,requestKey:'two'},async t=>t);assert.equal(current.status,'accepted');resolveOld();assert.equal((await old).status,'stale');
  const error=c.run(context,t=>new Promise<typeof t>((_,reject)=>{rejectOld=reject;}));c.invalidate();rejectOld(new Error('old failure'));assert.equal((await error).status,'stale');
  assert.equal((await c.run(context,async t=>({...t,revision:1}))).status,'stale');
  assert.equal((await c.run(context,async()=>{throw Error('current failure');})).status,'failed');
});
