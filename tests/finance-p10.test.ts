import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {developmentCosts} from '../lib/finance-development.ts';
import {financeService} from '../lib/finance.ts';
import {openStore} from '../lib/database.ts';
import {accountService} from '../lib/accounts.ts';
import {policy} from '../lib/policy.ts';
import {addCost,p10Scenario,packageCost,prototypeCost,retestCost} from './fixtures/finance-p10.ts';

const range={from:'year-0',to:'year-2'};
const scenario=()=>{
  const initial=applyFinanceChanges(p10Scenario(),[packageCost],range);
  const pkg=initial.fields[0].key;
  const records=applyFinanceChanges(initial.candidate,[prototypeCost(pkg),retestCost],range);
  return {snapshot:records.candidate,pkg,samples:records.fields[0].key,retest:records.fields[1].key};
};
const quantity=(key:string,value:string)=>({collection:'development',action:'quantity',key,quantity:value});

test('P10 reconciles T4 individual and combined changes and prevents duplicate package spend',()=>{
  const {snapshot,pkg,samples,retest}=scenario(),before=calculateFinance(snapshot);
  const candidates=[[quantity(samples,'10')],[quantity(retest,'1')],[quantity(samples,'10'),quantity(retest,'1')]];
  for(const [i,changes] of candidates.entries()){
    const total=[1800,2000,3800][i];
    const after=calculateFinance(applyFinanceChanges(snapshot,changes,range).candidate),delta=compareCalculations(before,after);
    assert.equal(delta.periodic[1].development_budget.delta.displayValue,'0.00');
    assert.equal(delta.periodic[1].development_remaining.delta.displayValue,(-total).toFixed(2));
    assert.equal(delta.periodic[1].net_engineering.delta.displayValue,total.toFixed(2));
    assert.equal(delta.periodic[1].development_cash.delta.displayValue,(-total).toFixed(2));
    assert.equal(delta.periodic[1].cash_flow.delta.displayValue,(-total).toFixed(2));
    assert.equal(delta.periodic[2].cash_flow.delta.displayValue,'0.00');
  }
  const pv=addCost('validation','PV-COVERED',{title:'PV covered fixture',group:'PV-01',stage:'PV',category:'fixture',quantity:'1',
    components:{rate:'100'},coverage:[{provider:pkg,quantity:'1'}]});
  const covered=applyFinanceChanges(snapshot,[pv],range).candidate;
  assert.equal(calculateFinance(covered).periodic[1].development_gross.displayValue,'5000.00');
  assert.throws(()=>applyFinanceChanges(snapshot,[quantity(samples,'3')],range),/Covered quantity exceeds/);
  assert.throws(()=>applyFinanceChanges(snapshot,[quantity(pkg,'0')],range),/active package/);
  assert.throws(()=>applyFinanceChanges(snapshot,[quantity(samples,'8'),quantity(samples,'9')],range),/only be changed once/);
  assert.throws(()=>applyFinanceChanges(snapshot,[prototypeCost(pkg)],range),/already recorded/);
  assert.throws(()=>applyFinanceChanges(snapshot,[{...pv,record:{...pv.record,coverage:[{provider:retest,quantity:'1'}]}}],range),/active package/);
});

test('P10 allocates a shared cost once, dates payments and distinguishes price and lump-sum recovery',()=>{
  const s=p10Scenario();
  s.products.push({key:'product-b',label:'Product B',metadata:{active:true}});
  s.lines.push({key:'line-b',label:'Line B',metadata:{productKey:'product-b'}});
  s.inputs.push(...s.inputs.filter(row=>row.productKey==='product-a').map(row=>({...row,key:row.key+':b',productKey:'product-b',lineKey:row.lineKey?'line-b':null})));
  const shared=addCost('engineering','PM-SHARED',{title:'Shared PM',group:'Design',category:'labor',role:'PM',quantity:'10',components:{rate:'100',travel:'20'},
    paymentPeriod:'year-2',allocationBasis:'Planned project hours',allocations:[{productKey:'product-a',share:'0.6'},{productKey:'product-b',share:'0.4'}],
    recovery:{method:'lump_sum',amount:'500',earnedPeriod:'year-1',receiptPeriod:'year-2'}});
  const piece=addCost('validation','PIECE-01',{title:'Certification quote',group:'PV-01',stage:'Certification',category:'certification',quantity:'1',components:{rate:'2000'},
    recovery:{method:'piece_price',amount:'0.02',earnedPeriod:'year-1',receiptPeriod:'year-2'}});
  const edits=applyFinanceChanges(s,[shared,piece],range),report=calculateFinance(edits.candidate);
  assert.equal(report.periodic[1].development_gross.displayValue,'3020.00');
  assert.equal(report.products['product-b'].periodic[1].development_gross.displayValue,'408.00');
  assert.equal(report.periodic[1].development_recovery.displayValue,'700.00');
  assert.equal(report.periodic[1].development_cash.displayValue,'-2000.00');
  assert.equal(report.periodic[2].development_cash.displayValue,'-320.00');
  assert.equal(report.periodic[1].net_engineering.displayValue,'2320.00');
  assert.throws(()=>applyFinanceChanges(s,[{...shared,record:{...shared.record,allocations:[{productKey:'product-a',share:'0.6'}]}}],range),/add to 1/);
});

test('P10 validation authority records actual occurrence and a distinct payment period through persisted previews',()=>{
  process.env.ADMIN_PASSWORD='Synthetic-P10-Verification';
  const store=openStore(mkdtempSync(join(tmpdir(),'finance-p10-'))),service=financeService(store),admin=store.get('users','admin');
  const context={actorId:admin.uid,actorUid:admin.uid,actorName:admin.name,requestId:'p10-test'};
  try {
    store.put('projects',{id:'demo',title:'P10 tests'});
    const draft=service.create(admin,'demo',{requestKey:'create',reason:'Synthetic baseline',snapshot:p10Scenario()},context);
    const account=accountService(store).create(admin,{id:'p10-quality',name:'Quality',role:'editor',password:'Synthetic-P10-Quality'},context)!;
    policy(store).setMember(admin,'demo',account.id,'finance-validation',context);
    const quality=store.get('users',account.loginName);
    let revision=0;
    const request=(changeSet:Record<string,unknown>[])=>({requestKey:'preview-'+revision,revision,reason:'P10 evidence',effectivePeriod:range,changeSet});
    const commit=(changeSet:Record<string,unknown>[],actor:any=admin)=>{
      const body=request(changeSet),preview=service.preview(actor,'demo',draft.id,body);
      assert.equal(preview.saveBlocked,false);
      const save={...body,requestKey:'save-'+revision,candidateSha256:preview.candidateSha256,previewCalculationVersion:preview.calculationVersion};
      const result=service.save(actor,'demo',draft.id,save,context);
      assert.equal(result.calculationSha256,preview.calculationSha256);
      assert.deepEqual(service.save(actor,'demo',draft.id,save,context),result);
      revision=result.revision;
      return preview;
    };
    const pkg=commit([packageCost]).fields[0].key;
    const sample=commit([prototypeCost(pkg)]).fields[0].key;
    assert.throws(()=>service.preview(quality,'demo',draft.id,request([quantity(sample,'10')])),(error:any)=>error.status===403);
    const actual={collection:'development',action:'actual',key:pkg,record:{
      incurred:{amount:'5100',period:'year-1',date:'2027-12-03',reference:'Lab test acceptance'},
      payment:{amount:'5100',period:'year-2',date:'2028-01-05',reference:'Vendor payment'},receipt:null
    }};
    const preview=commit([actual],quality);
    assert.equal(preview.candidate.periodic[1].development_actual.displayValue,'5100.00');
    assert.equal(preview.candidate.periodic[1].development_cash.displayValue,'0.00');
    assert.equal(preview.candidate.periodic[2].development_cash.displayValue,'-5100.00');
    assert.equal(preview.candidate.periodic[1].net_engineering.displayValue,'5100.00');
    const persisted=service.get(quality,'demo',draft.id).snapshot;
    assert.equal(developmentCosts(persisted).length,2);
    assert.throws(()=>service.save(quality,'demo',draft.id,{requestKey:'forge',revision,reason:'Test guarded mechanism',snapshot:{...persisted,
      inputs:persisted.inputs.filter(row=>row.metricKey!=='p10.actual')}},context),/revision-bound/);
  } finally {store.db.close();}
});
