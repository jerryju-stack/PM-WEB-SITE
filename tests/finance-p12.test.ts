import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpFixture} from './http-fixture.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {budgetWorkspace} from '../lib/finance-budget-calculation.ts';
import {p12Scenario,p12Range,budgetCommand,t6Policy,t6Scope,t6Allocation,t6Cost,t6Forecast,t6Confirm,money} from './fixtures/finance-p12.ts';

function ledger(){
  let snapshot=p12Scenario();
  const apply=(change:unknown,actor='preparer')=>{
    const result=applyFinanceChanges(snapshot,[change],p12Range,actor);
    snapshot=result.candidate;
    return result.fields[0].key as string;
  };
  apply(t6Policy);
  const scope=apply(t6Scope),allocation=apply(t6Allocation(scope));
  apply(t6Confirm(allocation),'reviewer');
  const original=apply(t6Cost(scope,400,'T6-BASE-COST','T6 Accepted Service'));
  apply(t6Confirm(original),'reviewer');
  apply(t6Forecast(scope));
  const draft=apply(t6Cost(scope,50,'T6-DRAFT-COST','T6 Follow-up Service'));
  return {apply,scope,original,draft,report:()=>calculateFinance(snapshot),snapshot:()=>snapshot};
}

test('P12 T6 separates drafts, accepted actuals and residual forecast; cutoff follows the matched original scope',()=>{
  const f=ledger(),initial=f.report();
  for(const [key,value] of Object.entries({approved_budget:'1000.00',confirmed_actual:'400.00',draft_cost:'50.00',etc:'500.00',eac:'900.00',
    budget_balance:'600.00',completion_variance:'100.00'}))assert.equal(initial.budget[key].displayValue,value,key);
  // A late approval for a service dated within the cutoff was absent when ETC was captured.
  f.apply(t6Confirm(f.draft),'reviewer');
  assert.equal(f.report().budget.etc.displayValue,'450.00');
  assert.equal(f.report().budget.eac.displayValue,'900.00');
  const historicalCorrection=f.apply(t6Cost(f.scope,-20,'T6-CREDIT','Back-period price credit','year-2','2028-01-10',f.original));
  f.apply(t6Confirm(historicalCorrection),'reviewer');
  assert.equal(f.report().budget.confirmed_actual.displayValue,'430.00');
  assert.equal(f.report().budget.etc.displayValue,'450.00');
  assert.equal(f.report().budget.completion_variance.displayValue,'120.00');
  const another=f.apply(budgetCommand('scope',{scopeId:'OTHER',title:'Separate Cost Scope',productKey:null,reference:'Separate estimate'}));
  f.apply(t6Forecast(another,100));
  const anotherCost=f.apply(t6Cost(another,40,'OTHER-1','Separate Work','year-2','2028-01-11'));
  f.apply(t6Confirm(anotherCost),'reviewer');
  const scopes=budgetWorkspace(f.snapshot(),f.report(),'reviewer').scopes;
  assert.equal(scopes.find(row=>row.key===f.scope)!.metrics.etc!.displayValue,'450.00');
  assert.equal(scopes.find(row=>row.key===another)!.metrics.etc!.displayValue,'60.00');
  const over=f.apply(t6Cost(f.scope,-35,'T6-LATE-CREDIT','Later credit','year-2','2028-02-10',f.draft));
  f.apply(t6Confirm(over),'reviewer');
  assert.equal(f.report().budget.etc.displayValue,'545.00');
  assert.equal(compareCalculations(initial,f.report()).metrics.npv.delta.displayValue,'0.00');
});

test('P12 enforces configured currency precision and retains historical postings on withdrawal',()=>{
  let s=p12Scenario();
  const apply=(command:unknown)=>{
    const result=applyFinanceChanges(s,[command],p12Range,'maker');
    s=result.candidate;
    return result.fields[0].key;
  };
  apply(budgetCommand('policy',{currency:'JPY',taxBasis:'inclusive',recognition:'invoice_review',reference:'Synthetic enterprise policy'}));
  const scope=apply(t6Scope);
  assert.throws(()=>apply(t6Cost(scope,100,'JPY-1','Invoice')),/currency precision/);
  const cost=t6Cost(scope,100,'JPY-1','Invoice');
  cost.record.amount=money(100,0);
  const key=apply(cost);
  assert.equal(calculateFinance(s).budget.draft_cost.displayValue,'100');
  assert.equal(calculateFinance(s).budget.draft_cost.unit,'JPY');
  apply(budgetCommand('withdraw',{reference:'Duplicate invoice reference'},key));
  assert.equal(calculateFinance(s).budget.draft_cost.displayValue,'0');
  assert.equal(budgetWorkspace(s,calculateFinance(s),'maker').scopes[0].postings[0].entry.type,'cost');
  assert.throws(()=>apply(cost),/already recorded/);
});

test('P12 HTTP guards independent approval, immutable amounts, version races, receipt replay, revocation and reread',async()=>{
  const f=await httpFixture();
  try {
    const p=(await f.call('projects',{title:'P12 T6 Isolated HTTP'},f.cookie)).data.id;
    const reviewGroup=(await f.call('groups',{name:'T6 approvals only',capabilities:['financeRead','financeApprove']},f.cookie)).data.id;
    const password='Isolated-P12-Test-Only';
    const logins={maker:'p12-maker',reviewer:'p12-reviewer'};
    const maker=(await f.call('users',{id:logins.maker,name:'Budget Maker',password,role:'editor'},f.cookie)).data;
    const reviewer=(await f.call('users',{id:logins.reviewer,name:'Budget Reviewer',password,role:'editor'},f.cookie)).data;
    const members='projects/'+p+'/members';
    assert.equal((await f.call(members,{userUid:maker.id,groupId:'finance-controller'},f.cookie)).status,200);
    assert.equal((await f.call(members,{userUid:reviewer.id,groupId:reviewGroup},f.cookie)).status,200);
    const makerCookie=(await f.call('login',{id:logins.maker,password})).cookie;
    const reviewerCookie=(await f.call('login',{id:logins.reviewer,password})).cookie;
    assert.ok(makerCookie&&reviewerCookie);
    const base='projects/'+p+'/finance';
    const created=await f.call(base+'/versions',{requestKey:'create-version',reason:'Synthetic T6 fixture',snapshot:p12Scenario()},f.cookie);
    assert.equal(created.status,201);
    const path=base+'/versions/'+created.data.id;
    let revision=0,next=0;
    const body=(command:unknown)=>({requestKey:'p12-preview-'+next++,reason:'Synthetic T6 preview',revision,effectivePeriod:p12Range,changeSet:[command]});
    const ready=async(command:unknown,cookie:string)=>{
      const input=body(command),preview=await f.call(path+'/preview',input,cookie);
      assert.equal(preview.status,200,JSON.stringify(preview.data));
      return {preview:preview.data,save:{...input,requestKey:'p12-save-'+next,candidateSha256:preview.data.candidateSha256,
        previewCalculationVersion:preview.data.calculationVersion}};
    };
    const commit=async(command:unknown,cookie=makerCookie)=>{
      const {preview,save}=await ready(command,cookie),saved=await f.call(path,save,cookie,'PUT');
      assert.equal(saved.status,200,JSON.stringify(saved.data));
      assert.equal(saved.data.calculationSha256,preview.calculationSha256);
      revision=saved.data.revision;
      return preview.fields[0].key as string;
    };
    await commit(t6Policy);
    const scope=await commit(t6Scope),allocation=await commit(t6Allocation(scope));
    await commit(t6Confirm(allocation),reviewerCookie);
    const original=await commit(t6Cost(scope,400,'T6-BASE-COST','T6 Accepted Service'));
    await commit(t6Confirm(original),reviewerCookie);
    await commit(t6Forecast(scope));
    const draft=await commit(t6Cost(scope,50,'T6-DRAFT-COST','T6 Follow-up Service'));
    assert.equal((await f.call(path+'/preview',body(t6Confirm(draft)),makerCookie)).status,403);
    // Confirmed costs are guarded in both historical snapshot replacement and the legacy event edit path.
    const sourceVersion=(await f.call(path,undefined,makerCookie)).data.snapshot;
    sourceVersion.events.find((row:any)=>row.key===original).amount=money(123);
    assert.equal((await f.call(path,{requestKey:'spoof-snapshot',reason:'Guard test',revision,snapshot:sourceVersion},makerCookie,'PUT')).status,400);
    assert.equal((await f.call(path+'/preview',body({collection:'events',key:original,value:money(123)}),makerCookie)).status,400);
    const stale=await ready(t6Confirm(draft),reviewerCookie);
    const payment=budgetCommand('payment',{scope,period:'year-2',date:'2028-03-05',documentId:'T6-PAYMENT',title:'T6 Separate Payment',
      amount:money(125),reference:'Synthetic dated settlement',relatedKey:original});
    await commit(payment);
    assert.equal((await f.call(path,stale.save,reviewerCookie,'PUT')).status,409);
    const approval=await ready(t6Confirm(draft),reviewerCookie),confirmed=await f.call(path,approval.save,reviewerCookie,'PUT');
    assert.equal(confirmed.status,200);revision=confirmed.data.revision;
    assert.deepEqual((await f.call(path,approval.save,reviewerCookie,'PUT')).data,confirmed.data);
    const change=(await f.call(path+'/changes',undefined,reviewerCookie)).data.changes.filter((row:any)=>row.id===confirmed.data.changeSetId);
    assert.equal(change.length,1);assert.equal(change[0].actorUid,reviewer.id);
    assert.equal((await f.call(path,{...approval.save,reason:'Changed replay'},reviewerCookie,'PUT')).status,409);
    const correction=await commit(t6Cost(scope,-20,'T6-ADJ','T6 Cross-period Credit','year-2','2028-04-10',original));
    await commit(t6Confirm(correction),reviewerCookie);
    const loaded=(await f.call(base+'/workspace?module=budget&version='+created.data.id,undefined,reviewerCookie)).data;
    const metrics=loaded.budget.scopes[0].metrics;
    for(const [key,value] of Object.entries({confirmed_actual:'430.00',etc:'450.00',eac:'880.00',budget_balance:'570.00',
      completion_variance:'120.00',recorded_payments:'125.00'}))assert.equal(metrics[key].displayValue,value,key);
    assert.equal(loaded.budget.scopes[0].postings.find((row:any)=>row.event.key===correction).event.relatedKey,original);
    assert.equal(approval.preview.comparison.metrics.npv.delta.displayValue,'0.00');
    assert.equal((await f.call(members,{userUid:reviewer.id,groupId:'finance-reader'},f.cookie)).status,200);
    assert.equal((await f.call(path,approval.save,reviewerCookie,'PUT')).status,403);
    assert.equal((await f.call(path,undefined,reviewerCookie)).status,200);
    assert.equal((await f.call(members,{userUid:reviewer.id},f.cookie,'DELETE')).status,200);
    assert.equal((await f.call(path,approval.save,reviewerCookie,'PUT')).status,404);
    assert.equal((await f.call(path,undefined,reviewerCookie)).status,404);
  } finally {await f.stop();}
});
