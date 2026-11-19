import type {CalculationBuilder, CalculationOutput, CalculationReport, Value} from './finance-calculation-types.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {budgetOrdinal, isBudgetEvent, readBudgetEntries, readBudgetPolicy, readBudgetScopes} from './finance-budget.ts';
import {Decimal, sum, ZERO} from './finance-decimal.ts';
import {caseFinanceRate} from './finance-fx.ts';

const q=Decimal.from;
const nonnegative=(amount:Decimal)=>amount.n<0n?ZERO:amount;
export const budgetSummaryKeys=['approved_budget','confirmed_actual','draft_allocation','draft_cost','etc','eac','budget_balance','completion_variance',
  'recorded_payments','unpaid_confirmed'] as const;
export const budgetScopeMetric=(scope:string,key:string)=>'budget:'+scope+':'+key;

export function calculateBudgetExecution(b:CalculationBuilder){
  const s=b.snapshot,policy=readBudgetPolicy(s)!,currency=b.fxReference.policy.fx||s.policy.fx?s.currency:policy.currency;
  const options={basis:'budget_events',currency,unit:currency};
  const entries=readBudgetEntries(s),rowsByScope=new Map<string,typeof entries>();
  for(const row of entries){
    const group=rowsByScope.get(row.entry.scope)??[];group.push(row);rowsByScope.set(row.entry.scope,group);
  }
  const scopes=readBudgetScopes(s).map(scope=>{
    const metrics:Record<string,Value>={},rows=rowsByScope.get(scope.key)??[];
    const opts={...options,productScope:scope.productKey?[scope.productKey]:[]};
    const posting=(row:typeof rows[number])=>{
      const {event,entry}=row,id='event:'+event.key,value=q(event.amount);
      const role=entry.type==='cost'||entry.type==='allocation'?entry.status+' '+entry.type:entry.type;
      return b.values.get(id+':fx')??b.values.get(id)??b.money({id,sourceKey:event.sourceKey,inputKey:event.key,role,unit:event.currency,currency:event.currency,
        periods:[event.periodKey],value:value.text(),status:'ok',cell:entry.reference},value,currency,event.periodKey);
    };
    const make=(key:string,deps:Value[],fn:(values:Decimal[])=>Decimal,formula:string)=>{
      const result=b.calc(budgetScopeMetric(scope.key,key),key,deps,fn,{...opts,formula});metrics[key]=result;return result;
    };
    const missing=(key:string,message:string)=>metrics[key]=b.make(budgetScopeMetric(scope.key,key),key,null,[],{...opts,status:'missing_input',details:{message}});
    const approved=rows.filter(row=>row.entry.type==='allocation'&&row.entry.status==='confirmed');
    const confirmed=rows.filter(row=>row.entry.type==='cost'&&row.entry.status==='confirmed');
    const budget=approved.length?make('approved_budget',approved.map(posting),sum,'Sum of independently approved allocations'):
      missing('approved_budget','A scope requires an approved allocation.');
    make('draft_allocation',rows.filter(row=>row.entry.type==='allocation'&&row.entry.status==='draft').map(posting),sum,'Unapproved forecast allocations');
    const actual=make('confirmed_actual',confirmed.map(posting),sum,'Confirmed occurrences plus linked confirmed adjustments');
    make('draft_cost',rows.filter(row=>row.entry.type==='cost'&&row.entry.status==='draft').map(posting),sum,'Unconfirmed cost drafts and adjustments');
    const payment=make('recorded_payments',rows.filter(row=>row.entry.type==='payment').map(posting),sum,'Separate dated settlements of confirmed costs');
    make('unpaid_confirmed',[actual,payment],([accrual,settled])=>accrual.sub(settled),'Confirmed cost minus recorded payments');

    const forecast=rows.find(row=>row.entry.type==='etc');
    let remaining:Value;
    if(forecast?.entry.type==='etc'){
      const {capturedOrder}=forecast.entry,cutoff=budgetOrdinal(s,forecast.event.periodKey);
      // A cutoff includes only originals known by then. Remeasuring an already included
      // original changes actual cost, while corrections to later work change its ETC consumption.
      const unmatched=new Set(confirmed.filter(row=>row.entry.type==='cost'&&!row.event.relatedKey&&
        (budgetOrdinal(s,row.event.periodKey)>cutoff||row.entry.order!>capturedOrder)).map(row=>row.event.key));
      const consumption=make('etc_consumed',confirmed.filter(row=>unmatched.has(row.event.relatedKey??row.event.key)).map(posting),
        amounts=>nonnegative(sum(amounts)),'Net confirmed work absent from the captured scope and cutoff');
      remaining=make('etc',[posting(forecast),consumption],([original,used])=>nonnegative(original.sub(used)),
        'Captured remaining forecast minus matching confirmed work, floored at zero');
    }else remaining=missing('etc','A scope requires a remaining forecast. Enter zero for completed work.');
    const eac=make('eac',[actual,remaining],sum,'Confirmed actual + remaining ETC');
    make('budget_balance',[budget,actual],([limit,actual])=>limit.sub(actual),'Approved budget minus confirmed actual');
    make('completion_variance',[budget,eac],([limit,total])=>limit.sub(total),'Approved budget minus EAC');
    return metrics;
  });
  return Object.fromEntries(budgetSummaryKeys.map(key=>{
    const id='budget:'+key;
    const output=scopes.length?b.calc(id,key,scopes.map(scope=>scope[key]),sum,{...options,formula:'Sum of execution scope '+key}):
      b.make(id,key,null,[],{...options,status:'missing_input',details:{message:'Set up a budget scope to begin execution reporting.'}});
    return [key,output.out];
  }));
}

export function budgetWorkspace(snapshot:FinanceSnapshot,report:CalculationReport,actorUid:string,product?:string,period?:string) {
  const policy=readBudgetPolicy(snapshot),scopes=readBudgetScopes(snapshot),entries=readBudgetEntries(snapshot);
  const format=(amount:Decimal,code:string)=>amount.text(snapshot.policy.currencyScales[code]);
  const data=scopes.map(scope=>{
    const rows=entries.filter(row=>row.entry.scope===scope.key);
    const latest=rows.find(row=>row.entry.type==='etc');
    const time=new Map<string,{confirmed:Decimal|null;payments:Decimal|null}>();
    const periods=new Map<string,typeof rows>();
    for(const {event,entry} of rows){
      const postings=periods.get(event.periodKey)??[];
      postings.push({event,entry});
      periods.set(event.periodKey,postings);
      if(!(entry.type==='cost'&&entry.status==='confirmed'||entry.type==='payment'))continue;
      const current=time.get(event.periodKey)??{confirmed:ZERO,payments:ZERO};
      const category=entry.type==='payment'?'payments':'confirmed';
      const rate=caseFinanceRate(snapshot,event.currency,policy!.currency,event.periodKey);
      current[category]=rate&&current[category]?current[category].add(q(event.amount).mul(rate)):null;
      time.set(event.periodKey,current);
    }
    return {...scope,metrics:Object.fromEntries(budgetSummaryKeys.map(key=>[key,compact(report.outputs[budgetScopeMetric(scope.key,key)])])),
      periodStatuses:[...periods.entries()].sort(([a],[b])=>budgetOrdinal(snapshot,a)-budgetOrdinal(snapshot,b))
        .map(([period,postings])=>{
          const stat=(match:(entry:typeof rows[number]['entry'])=>boolean)=>{
            const items=postings.filter(row=>match(row.entry));
            const converted=items.map(({event})=>{
              const rate=caseFinanceRate(snapshot,event.currency,policy!.currency,event.periodKey);
              return rate?Decimal.from(event.amount).mul(rate):null;
            });
            return {amount:items.length&&converted.every(value=>value!==null)?format(sum(converted.map(value=>value!)),policy!.currency):null,
              keys:items.map(row=>row.event.key)};
          };
          return {period,draft:stat(entry=>entry.type==='allocation'&&entry.status==='draft'),
            approved:stat(entry=>entry.type==='allocation'&&entry.status==='confirmed'),
            confirmed:stat(entry=>entry.type==='cost'&&entry.status==='confirmed'),payments:stat(entry=>entry.type==='payment'),
            remaining:stat(entry=>entry.type==='etc')};
        }),
      remainingInput:latest?{...latest.event,reference:latest.entry.reference,
        consumed:compact(report.outputs[budgetScopeMetric(scope.key,'etc_consumed')])}:null,
      postings:rows.flatMap(({event,entry})=>entry.type==='etc'?[]:[{event,entry,
        amount:format(q(event.amount),event.currency),ownDraft:(entry.type==='allocation'||entry.type==='cost')&&entry.makers.includes(actorUid)}])
        .sort((a,b)=>budgetOrdinal(snapshot,a.event.periodKey)-budgetOrdinal(snapshot,b.event.periodKey)||a.event.key.localeCompare(b.event.key)),
      timeline:[...time.entries()].sort(([a],[b])=>budgetOrdinal(snapshot,a)-budgetOrdinal(snapshot,b))
        .map(([period,values])=>({period,confirmed:values.confirmed?format(values.confirmed,policy!.currency):null,
          payments:values.payments?format(values.payments,policy!.currency):null}))};
  });
  const scoped=data.filter(scope=>!product||scope.productKey===product);
  const draftTotal=(rows:typeof data[number]['periodStatuses'])=>{
    const drafts=rows.filter(row=>row.draft.keys.length);
    const available=drafts.length&&drafts.every(row=>row.draft.amount!==null);
    return {count:drafts.reduce((count,row)=>count+row.draft.keys.length,0),
      amount:available?format(sum(drafts.map(row=>q(row.draft.amount!))),policy!.currency):null};
  };
  const selected=(scope:typeof data[number])=>scope.periodStatuses.filter(row=>!period||row.period===period);
  const rollup=(key:'approved_budget'|'eac')=>{
    const values=scoped.map(scope=>scope.metrics[key]);
    if(!values.length||values.some(value=>value?.value==null))return null;
    const currency=values[0]!.unit;
    return {amount:format(sum(values.map(value=>q(value!.value!))),currency),currency};
  };
  return {policy,scopes:data,currencyScale:policy?snapshot.policy.currencyScales[policy.currency]:snapshot.currencyScale,
    allocationTotals:{project:draftTotal(scoped.flatMap(selected)),scopes:Object.fromEntries(scoped.map(scope=>[scope.key,draftTotal(selected(scope))]))},
    approved:rollup('approved_budget'),eac:rollup('eac'),
    legacyEvents:snapshot.events.filter(event=>!isBudgetEvent(event)&&['budget','incurred','etc','payment'].includes(event.kind)).length};
}

function compact(output:CalculationOutput|undefined){
  return output?{value:output.value,displayValue:output.displayValue,unit:output.unit,status:output.status}:null;
}
