import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {addBusinessRecord,businessInputs} from '../lib/finance-business.ts';
import {commercialWorkspace,factoryCostWorkspace} from '../lib/finance-commercial-workspace.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {openStore} from '../lib/database.ts';
import {financeService} from '../lib/finance.ts';
import {accountService} from '../lib/accounts.ts';
import {policy} from '../lib/policy.ts';
import {fixedValue,p08Scenario} from './fixtures/finance-p08.ts';
import {addInput} from './fixtures/finance-p06.ts';

const period={from:'year-1',to:'year-1'};
const row=(snapshot:ReturnType<typeof p08Scenario>,field:string,year='year-1')=>businessInputs(snapshot)
  .find(input=>input.metricKey==='p08.'+field&&input.periodKey===year)!;
const change=(snapshot:ReturnType<typeof p08Scenario>,field:string,value:number,scale=0)=>({collection:'inputs',key:row(snapshot,field).key,value:fixedValue(value,scale)});
const scenario=()=>p08Scenario();

test('Factory view distinguishes a recorded zero from a category with no forecast input',()=>{
  const snapshot=scenario();
  snapshot.inputs=snapshot.inputs.filter(input=>input.metricKey!=='p08.warranty');
  const report=calculateFinance(snapshot);
  const costs=factoryCostWorkspace(snapshot,report,businessInputs(snapshot),'year-1',null);
  assert.equal(report.products['product-a'].periodic[1].factory_warranty.displayValue,'0.00');
  assert.equal(costs.find(row=>row.field==='warranty')?.total,null);
  assert.equal(costs.find(row=>row.field==='warranty')?.unit,null);
  assert.equal(costs.find(row=>row.field==='packaging')?.total,'0.00');
  assert.equal(costs.find(row=>row.field==='packaging')?.unit,'0.0000');
});

test('Commercial schedule uses configured periods and preserves price evidence for a zero-volume market',()=>{
  const snapshot=scenario();
  addBusinessRecord(snapshot,{collection:'business',recordType:'commercial',productKey:'product-a',marketKey:'na',
    reference:'Zero-volume quote',currency:'CNY',values:{vehicles:fixedValue(0),units_per_vehicle:fixedValue(2),
      configuration:fixedValue(1),sales_price:fixedValue(33)}},['year-1']);
  const report=calculateFinance(snapshot),workspace=commercialWorkspace(snapshot,report,businessInputs(snapshot));
  assert.deepEqual(workspace.periods.map(item=>item.key),['year-1']);
  assert.equal(workspace.products[0].years[0].volume,'1000');
  assert.equal(workspace.products[0].years[0].unitPrice,'20.00');
  const market=workspace.markets.find(item=>item.market==='na');
  assert.equal(market?.volume,'0');
  assert.equal(market?.unitPrice,'33.00');
  assert.equal(market?.revenue,'0');
  assert.equal(report.products['product-a'].periodic[1].market_revenue_na.displayValue,'0.00');
});

test('P08 T3 applies quantity once, separates tooling and retains part price, period and source',()=>{
  const before=scenario(),part=row(before,'part_price');
  const edit=applyFinanceChanges(before,[change(before,'part_price',5)],period),after=edit.candidate;
  const original=calculateFinance(before),revised=calculateFinance(after),diff=compareCalculations(original,revised);
  const product=diff.products['product-a'].periodic[1];
  assert.equal(product.unit_material.delta.displayValue,'2.0000');
  assert.equal(product.material.delta.displayValue,'2000.00');
  assert.equal(diff.metrics.operating_profit.delta.displayValue,'-2000.00');
  assert.equal(diff.periodic[1].cash_flow.delta.displayValue,'-2000.00');
  assert.equal(diff.metrics.npv.delta.displayValue,'-1818.18');
  assert.equal(edit.fields[0].sourceKey,part.sourceKey);
  assert.equal(edit.fields[0].period,'year-1');
  assert.equal(part.conversion.partNumber,'T3-CLIP');
  assert.equal(row(after,'tooling').conversion.assetKey,'tool:T3-CLIP:01');
  assert.equal(original.periodic[1].cash_flow.displayValue,'9900.00','tooling and allocation are excluded from operating cash');
  assert.equal(original.metrics.operating_profit.displayValue,'9850.00');
});

test('P08 market demand, configuration, unit count and weighted selling price feed project totals',()=>{
  const before=scenario();
  addBusinessRecord(before,{collection:'business',recordType:'commercial',productKey:'product-a',marketKey:'na',reference:'North America quote',
    currency:'CNY',values:{vehicles:fixedValue(400),configuration:fixedValue(5,1),units_per_vehicle:fixedValue(2),sales_price:fixedValue(25)}},['year-1']);
  addBusinessRecord(before,{collection:'business',recordType:'bom',productKey:'product-a',marketKey:'na',reference:'North America material',partNumber:'NA-002',
    currency:'CNY',values:{part_quantity:fixedValue(1),part_price:fixedValue(10),landed_adjustment:fixedValue(0)}},['year-1']);
  const report=calculateFinance(before);
  assert.equal(report.products['product-a'].periodic[1].volume.displayValue,'1400');
  assert.equal(report.metrics.revenue.displayValue,'30000.00');
  assert.equal(report.products['product-a'].periodic[1].material.displayValue,'12000.00');
  const after=applyFinanceChanges(before,[change(before,'sales_price',22)],period).candidate;
  assert.equal(compareCalculations(report,calculateFinance(after)).metrics.revenue.delta.displayValue,'2000.00');
  const costs=applyFinanceChanges(before,[change(before,'variable',125,2)],period).candidate;
  assert.equal(compareCalculations(report,calculateFinance(costs)).metrics.operating_profit.delta.displayValue,'-350.00');
  const allocation=applyFinanceChanges(before,[change(before,'allocation',7500,2)],period).candidate;
  assert.equal(compareCalculations(report,calculateFinance(allocation)).metrics.operating_profit.delta.displayValue,'-25.00');
  assert.equal(compareCalculations(report,calculateFinance(allocation)).metrics.npv.delta.displayValue,'0.00');
});

test('P08 quote FX is period-specific, rejects missing rates and does not count the same tooling twice',()=>{
  const s=scenario(),price=row(s,'part_price');
  const quote={...change(s,'part_price',2),currency:'USD'};
  assert.throws(()=>applyFinanceChanges(s,[quote],period),/Missing approved FX/);
  addInput(s,'usd-1','fx_to_base','3','year-1','product-a','CNY/USD');
  const fx=s.inputs.at(-1)!;fx.productKey=null;fx.currency=null;fx.valueKind='rate';
  const revised=applyFinanceChanges(s,[quote],period);
  assert.equal(row(revised.candidate,'part_price').currency,'USD');
  assert.equal(revised.fields[0].beforeCurrency,price.currency);
  assert.equal(compareCalculations(calculateFinance(s),calculateFinance(revised.candidate)).products['product-a'].periodic[1].unit_material.delta.displayValue,'4.0000');
  assert.throws(()=>addBusinessRecord(s,{collection:'business',recordType:'bom',productKey:'product-a',marketKey:'eu',reference:'Duplicate tool',
    currency:'CNY',partNumber:'SECOND',assetKey:'tool:T3-CLIP:01',values:{part_quantity:fixedValue(1),part_price:fixedValue(2),landed_adjustment:fixedValue(0),tooling:fixedValue(700)}},['year-1']),/unique asset reference/);
  assert.throws(()=>addBusinessRecord(s,{collection:'business',recordType:'bom',productKey:'product-a',marketKey:null,reference:'Duplicate shared part',
    currency:'CNY',partNumber:'T3-CLIP',values:{part_quantity:fixedValue(1),part_price:fixedValue(2),landed_adjustment:fixedValue(0)}},['year-1']),/overlapping shared market/);
  assert.throws(()=>applyFinanceChanges(s,[change(s,'part_quantity',-1)],period),/nonnegative/);
  assert.throws(()=>applyFinanceChanges(s,[change(s,'part_quantity',1)],{from:'year-0',to:'year-1'}),/every selected period/);
});

test('P08 annual reduction carries from the previous quote with no retroactive change',()=>{
  const s=scenario();
  for(let ordinal=2;ordinal<=3;ordinal++){
    const periodKey='year-'+ordinal;
    s.periods.push({key:periodKey,label:String(2026+ordinal),metadata:{ordinal,calendarYear:2026+ordinal}});
    s.inputs.push(...s.inputs.filter(input=>input.periodKey==='year-1'&&!input.metricKey.startsWith('p08.')).map(input=>({...input,key:input.key+':'+ordinal,periodKey})));
    addBusinessRecord(s,{collection:'business',recordType:'commercial',productKey:'product-a',marketKey:'eu',reference:'Annual sales plan',
      currency:'CNY',values:{vehicles:fixedValue(1000),configuration:fixedValue(1),units_per_vehicle:fixedValue(1),annual_reduction:fixedValue(5,2)}},[periodKey]);
  }
  const changed=applyFinanceChanges(s,[{collection:'inputs',key:row(s,'annual_reduction','year-2').key,value:fixedValue(10,2)}],{from:'year-2',to:'year-3'}).candidate;
  const summary=calculateFinance(changed);
  assert.deepEqual(summary.products['product-a'].periodic.slice(1).map(p=>p.unit_sales.displayValue),['20.0000','18.0000','16.2000']);
  assert.deepEqual(compareCalculations(calculateFinance(s),summary).periodic.slice(1).map(p=>p.reported_revenue.delta.displayValue),['0.00','-1000.00','-1850.00']);
});

test('P08 supplier price, sales price and factory changes preview without writes, save atomically and reproduce after reopen',()=>{
  process.env.ADMIN_PASSWORD='Synthetic-P08-Verification';
  const directory=mkdtempSync(join(tmpdir(),'finance-p08-'));
  const store=openStore(directory),service=financeService(store),admin=store.get('users','admin');
  const context={actorId:admin.uid,actorUid:admin.uid,actorName:admin.name,requestId:'p08-tests'};
  store.put('projects',{id:'demo',title:'P08 Test'});
  const base=scenario();
  const version=service.create(admin,'demo',{requestKey:'p08-create',reason:'P08 synthetic baseline',snapshot:base},context);
  const entries=accountService(store);
  const buyer=entries.create(admin,{id:'p08buyer',password:'P08-Buyer-Verification',role:'editor'},context)!;
  policy(store).setMember(admin,'demo',buyer.id,'finance-bom',context);
  let expected='';
  try {
    const changes=[['part_price',5,0],['sales_price',22,0],['variable',125,2]] as const;
    for(const [revision,[field,value,scale]] of changes.entries()){
      const body={revision,requestKey:'preview-'+field,reason:'Isolated '+field,effectivePeriod:period,changeSet:[change(base,field,value,scale)]};
      const liveBuyer=store.get('users','p08buyer');
      const actor=field==='part_price'?liveBuyer:admin;
      if(field!=='part_price')assert.throws(()=>service.preview(liveBuyer,'demo',version.id,body),(error:any)=>error.status===403);
      const count=store.db.prepare('SELECT total_changes() AS count').get()!.count;
      const preview=service.preview(actor,'demo',version.id,body);
      assert.equal(preview.calculationVersion,'P08.1');assert.equal(preview.saveBlocked,false);
      assert.equal(store.db.prepare('SELECT total_changes() AS count').get()!.count,count);
      assert.equal(preview.comparison.metrics.operating_profit.delta.displayValue,field==='part_price'?'-2000.00':field==='sales_price'?'2000.00':'-250.00');
      const payload={...body,requestKey:'save-'+field,previewCalculationVersion:preview.calculationVersion,candidateSha256:preview.candidateSha256};
      const save=service.save(actor,'demo',version.id,payload,context);
      expected=preview.calculationSha256;
      assert.equal(save.calculationSha256,expected);
      assert.equal(service.calculation(actor,'demo',version.id).calculationSha256,expected);
      assert.deepEqual(service.save(actor,'demo',version.id,payload,context),save);
      assert.throws(()=>service.save(actor,'demo',version.id,{...payload,requestKey:'stale-'+field},context),/revision conflict/);
    }
  } finally {store.db.close();}
  const reopened=openStore(directory);
  try {
    assert.equal(financeService(reopened).calculation(reopened.get('users','admin'),'demo',version.id).calculationSha256,expected);
  } finally {reopened.db.close();}
});

test('P08 procurement can add a sourced BOM row without version-wide write privileges',()=>{
  process.env.ADMIN_PASSWORD='Synthetic-P08-New-Record';
  const store=openStore(mkdtempSync(join(tmpdir(),'finance-p08-add-'))),service=financeService(store),admin=store.get('users','admin');
  const context={actorId:admin.uid,actorUid:admin.uid,actorName:admin.name,requestId:'p08-add'};
  try {
    store.put('projects',{id:'demo',title:'P08 Record'});
    const draft=service.create(admin,'demo',{requestKey:'draft',reason:'Seed draft',snapshot:scenario()},context);
    const buyer=accountService(store).create(admin,{id:'p08entry',password:'P08-Entry-Verification',role:'editor'},context)!;
    policy(store).setMember(admin,'demo',buyer.id,'finance-bom',context);
    const actor=store.get('users','p08entry');
    const addition={collection:'business',recordType:'bom',productKey:'product-a',marketKey:'eu',currency:'CNY',partNumber:'ADDED-01',
      reference:'Supplier quote Q-02',values:{part_quantity:fixedValue(2),part_price:fixedValue(3),landed_adjustment:fixedValue(1)}};
    const body={revision:0,requestKey:'add-preview',reason:'Add new sourced part',effectivePeriod:period,changeSet:[addition]};
    const preview=service.preview(actor,'demo',draft.id,body);
    assert.equal(preview.fields.length,3);assert.equal(preview.fields[0].before,null);
    assert.equal(preview.comparison.products['product-a'].periodic[1].unit_material.delta.displayValue,'8.0000');
    assert.equal(preview.comparison.metrics.operating_profit.delta.displayValue,'-8000.00');
    const save={...body,requestKey:'add-save',previewCalculationVersion:preview.calculationVersion,candidateSha256:preview.candidateSha256};
    const receipt=service.save(actor,'demo',draft.id,save,context);
    assert.equal(receipt.calculationSha256,preview.calculationSha256);
    assert.deepEqual(service.save(actor,'demo',draft.id,save,context),receipt);
    const saved=service.get(actor,'demo',draft.id).snapshot;
    assert.equal(saved.sources.filter(source=>source.externalKey==='Supplier quote Q-02').length,1);
    assert.equal(saved.inputs.filter(input=>input.conversion.partNumber==='ADDED-01').length,3);
    assert.throws(()=>service.preview(actor,'demo',draft.id,{...body,revision:1}),/already exists/);
  } finally {store.db.close();}
});
