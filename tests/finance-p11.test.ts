import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {capitalWorkspace} from '../lib/finance-capital-workspace.ts';
import {capitalQuoteRows} from '../lib/finance-capital.ts';
import {p08Scenario,fixedValue} from './fixtures/finance-p08.ts';
import {p10Scenario} from './fixtures/finance-p10.ts';
import {p11Scenario,capitalRange,capitalChange,t5Asset,t5Agreement} from './fixtures/finance-p11.ts';

function seed(){
  const first=applyFinanceChanges(p11Scenario(),[capitalChange(t5Asset)],capitalRange);
  const asset=first.fields[0].key,agreement=t5Agreement(asset);
  const second=applyFinanceChanges(first.candidate,[capitalChange(agreement)],capitalRange);
  return {snapshot:second.candidate,asset,agreement,key:second.fields[0].key};
}
const change=(s:ReturnType<typeof p11Scenario>,edit:unknown)=>applyFinanceChanges(s,[edit],capitalRange).candidate;
test('P11 T5 receipt timing and isolated purchase change reconcile to cash, profit, recovery and NPV',()=>{
  const {snapshot,asset,key,agreement}=seed(),before=calculateFinance(snapshot);
  const delayed=change(snapshot,capitalChange({...agreement,receiptPeriod:'year-2'},key)),after=calculateFinance(delayed),delta=compareCalculations(before,after);
  assert.equal(delta.metrics.npv.delta.displayValue,'-826.45');
  assert.equal(delta.metrics.payback_period.delta.displayValue,'1.00');
  for(const metric of ['capital_gross','capital_payments','capital_agreed','capital_net','capital_receipts','peak_funding_requirement','operating_profit','incremental_profit'])
    assert.equal(delta.metrics[metric].delta.displayValue,'0.00',metric);
  assert.deepEqual(delta.periodic.map(row=>row.cash_flow.delta.displayValue),['0.00','-10000.00','10000.00']);
  assert.equal(after.metrics.peak_funding_requirement.details.firstPeriod,'year-0');
  assert.equal(after.metrics.payback_period.details.recoveryPeriod,'year-2');
  const view=capitalWorkspace(delayed,after,null,null,true);
  assert.deepEqual(view.events.map(row=>[row.period,row.kind,row.key]),[['year-0','payment',asset],['year-2','receipt',key]]);

  const more=calculateFinance(change(snapshot,capitalChange({...t5Asset,gross:'12000'},asset))),difference=compareCalculations(before,more);
  for(const metric of ['capital_gross','capital_payments','capital_net','peak_funding_requirement'])assert.equal(difference.metrics[metric].delta.displayValue,'2000.00');
  for(const metric of ['npv','operating_profit','incremental_profit'])assert.equal(difference.metrics[metric].delta.displayValue,'-2000.00');
  assert.equal(difference.metrics.capital_agreed.delta.displayValue,'0.00');
  assert.equal(difference.metrics.capital_receipts.delta.displayValue,'0.00');
  assert.deepEqual(difference.periodic.map(row=>row.cash_flow.delta.displayValue),['-2000.00','0.00','0.00']);
  assert.equal(more.metrics.payback_period.status,'not_recovered');
});

test('P11 existing shared allocation affects full-cost profit and does not create acquisition cash or incremental depreciation',()=>{
  const s=p10Scenario(),before=calculateFinance(s);
  const asset={...t5Asset,assetId:'SHARED-LINE',mode:'existing_shared',gross:'1000',life:'1',payments:[],allocations:[{productKey:'product-a',share:'0.25'}]};
  const after=calculateFinance(change(s,capitalChange(asset))),delta=compareCalculations(before,after);
  assert.equal(delta.metrics.capital_gross.delta.displayValue,'1000.00');
  assert.equal(delta.metrics.capital_allocated.delta.displayValue,'250.00');
  assert.equal(delta.metrics.capital_new.delta.displayValue,'0.00');
  assert.equal(delta.metrics.operating_profit.delta.displayValue,'-250.00');
  assert.equal(delta.metrics.incremental_profit.delta.displayValue,'0.00');
  assert.equal(delta.metrics.npv.delta.displayValue,'0.00');
});

test('P11 working capital carries forward, can release, and taxes incremental positive profit',()=>{
  const s=p10Scenario(),terms={kind:'terms',productKey:'product-a',period:'year-1',receivableDays:'36',payableDays:'36',inventoryDays:'18',
    days:360,tax:'0.2',release:false,reference:'Synthetic credit terms'};
  const active=change(s,capitalChange(terms)),carried=calculateFinance(active);
  assert.equal(carried.periodic[1].receivables.displayValue,'20000.00');
  assert.equal(carried.periodic[1].payables.displayValue,'-8000.00');
  assert.equal(carried.periodic[1].inventory.displayValue,'4000.00');
  assert.equal(carried.periodic[1].nwc.displayValue,'16000.00');
  assert.equal(carried.periodic[2].nwc_change.displayValue,'0.00');
  const released=calculateFinance(change(active,capitalChange({...terms,period:'year-2',release:true})));
  for(const key of ['receivables','payables','inventory','nwc'])assert.equal(released.periodic[2][key].displayValue,'0.00');
  assert.equal(released.periodic[2].nwc_change.displayValue,'16000.00');
  assert.equal(released.periodic[1].signed_tax.displayValue,'-22000.00');
  assert.deepEqual(released.periodic.map(row=>row.cash_flow.displayValue),['-10000.00','72000.00','104000.00']);
});

test('P11 customer receipt facts consume forecast balance and quoted piece-price is excluded from additional cash',()=>{
  const base=change(p10Scenario(),capitalChange(t5Asset)),scope=capitalWorkspace(base,calculateFinance(base),null,null,true);
  const agreement={...t5Agreement(scope.assets[0].key),receiptPeriod:'year-2',amount:'5000',receivable:null,receipts:[
    {id:'forecast',amount:'1000',period:'year-2',date:'2028-12-08',reference:'Synthetic actual receipt'}
  ],piece:{productKey:'product-a',rate:'0.3',first:'year-1',last:'year-2',included:false}};
  const report=calculateFinance(change(base,capitalChange(agreement)));
  const values=(report:ReturnType<typeof calculateFinance>,key:string)=>report.periodic.map(row=>row[key].displayValue);
  assert.deepEqual(values(report,'capital_piece_earned'),['0.00','3000.00','2000.00']);
  assert.deepEqual(values(report,'capital_piece_cash'),['0.00','0.00','5000.00']);
  assert.equal(Object.values(report.outputs).filter(row=>row.metricKey==='capital_cash_event'&&
    row.periods[0]==='year-2'&&row.details.capitalEvent).length,2);
  const referenceOnly=calculateFinance(change(base,capitalChange({...agreement,piece:{...agreement.piece,included:true}})));
  assert.deepEqual(values(referenceOnly,'capital_piece_cash'),['0.00','0.00','0.00']);
  assert.deepEqual(values(referenceOnly,'capital_actual_receipts'),['0.00','0.00','1000.00']);
  assert.throws(()=>change(change(base,capitalChange(agreement)),capitalChange({...agreement,agreementId:'DUPLICATE'})),/receipt identity/);
});

test('P11 links the P08 supplier quote once and flows subsequent quote edits through the asset schedule',()=>{
  const s=p08Scenario(),quote=capitalQuoteRows(s)[0],range={from:'year-0',to:'year-1'};
  const asset={...t5Asset,assetId:quote.conversion.assetKey,category:'supplier_tooling',gross:null};
  const saved=applyFinanceChanges(s,[capitalChange(asset)],range).candidate;
  assert.equal(calculateFinance(saved).metrics.capital_payments.displayValue,'700.00');
  assert.throws(()=>applyFinanceChanges(saved,[capitalChange(asset)],range),/existing source row/);
  const adjusted=applyFinanceChanges(saved,[{collection:'inputs',key:quote.key,value:fixedValue(80000,2)}],{from:'year-1',to:'year-1'}).candidate;
  assert.equal(calculateFinance(adjusted).metrics.capital_payments.displayValue,'800.00');
});

test('Capital life prorates the final service period and settles residual once across shared products',()=>{
  const start=p11Scenario();
  start.products.push({key:'product-b',label:'Product B',metadata:{active:true}});
  for(let ordinal=3;ordinal<=12;ordinal++){
    start.periods.push({key:'year-'+ordinal,label:'Year '+ordinal,metadata:{ordinal}});
  }
  const shared={
    ...t5Asset,gross:'8200',residual:'1000',life:'7.2',
    allocations:[{productKey:'product-a',share:'0.6'},{productKey:'product-b',share:'0.4'}]
  };
  const candidate=change(start,capitalChange(shared));
  const r=calculateFinance(candidate);
  const charges=(report:typeof r)=>report.periodic.map(row=>row.capital_depreciation.displayValue);
  assert.deepEqual(charges(r),['0.00',...Array(7).fill('1000.00'),'200.00',...Array(4).fill('0.00')]);
  assert.equal(r.products['product-a'].periodic[8].capital_depreciation.displayValue,'120.00');
  assert.equal(r.products['product-b'].periodic[8].capital_depreciation.displayValue,'80.00');
  assert.equal(r.periodic[8].capital_salvage.displayValue,'1000.00');
  assert.equal(r.periodic[9].capital_salvage.displayValue,'0.00');
  assert.equal(r.metrics.capital_payments.displayValue,'8200.00');
  const full=calculateFinance(change(start,capitalChange({...shared,life:'10'})));
  assert.deepEqual(charges(full),['0.00',...Array(10).fill('720.00'),'0.00','0.00']);
  assert.equal(full.periodic[10].capital_salvage.displayValue,'1000.00');
  assert.throws(()=>change(start,capitalChange({...shared,life:'0.2'})),/at least one year/);
});

test('Tooling estimate consumes the original forecast once and keeps unbooked amounts source-linked',()=>{
  const snapshot=p08Scenario(),quote=capitalQuoteRows(snapshot)[0],range={from:'year-0',to:'year-1'};
  const estimate={kind:'estimate',estimateId:'QUOTE-SUMMARY',title:'Tooling quotation',category:'supplier_tooling',
    productKey:'product-a',period:'year-0',gross:'1000',life:'7.2',reference:'Quote schedule D299',
    cashInputKey:'cash_adjustment-0',quoteKeys:[quote.key]};
  const pending=applyFinanceChanges(snapshot,[capitalChange(estimate)],range);
  const key=pending.fields[0].key;
  const asset={...t5Asset,assetId:quote.conversion.assetKey,category:'supplier_tooling',gross:null,life:'7.2'};
  assert.throws(()=>applyFinanceChanges(pending.candidate,[capitalChange(asset)],range),/already contains its supplier quote/);
  assert.throws(()=>applyFinanceChanges(pending.candidate,[capitalChange({...asset,estimate:{key,amount:'1001'}})],range),/exceed the original estimate/);
  const booked=applyFinanceChanges(pending.candidate,[capitalChange({...asset,estimate:{key,amount:'700'}})],range).candidate;
  const before=calculateFinance(pending.candidate),after=calculateFinance(booked);
  assert.deepEqual(after.periodic.map(row=>row.cash_flow.displayValue),before.periodic.map(row=>row.cash_flow.displayValue));
  assert.equal(after.periodic[0].capital_payments.displayValue,'700.00');
  assert.equal(after.products['product-a'].periodic[0].capital_quote_cash_replacement.displayValue,'700.00');
  const view=capitalWorkspace(booked,after,null,null,true);
  assert.equal(view.estimateDetails[0].balance,'300.00');
  assert.equal(view.toolingQuotes[0].estimate,key);
  assert.equal(view.toolingQuotes[0].asset,view.assets[0].key);
  assert.throws(()=>applyFinanceChanges(booked,[capitalChange({...asset,estimate:{key,amount:'700'}})],range),/existing source row/);
});
