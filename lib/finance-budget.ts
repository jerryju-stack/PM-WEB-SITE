import {financeKey, fixedDecimal} from './finance-contracts.ts';
import type {FinanceEvent, FinanceInput, FinanceSnapshot, FinanceSource} from './finance-contracts.ts';
import {businessSlug} from './finance-business.ts';
import {Decimal, sum} from './finance-decimal.ts';
import {invalid} from './contracts.ts';
import {caseFinanceRate,sourceFinanceCurrency} from './finance-fx.ts';

export const BUDGET_VERSION='P12.1';
export const isBudgetSource=(row:{key:string})=>row.key.startsWith('p12:');
export const isBudgetInput=(row:FinanceInput)=>isBudgetSource(row)||isBudgetSource({key:row.sourceKey})||row.metricKey.startsWith('p12.');
export const isBudgetEvent=(row:FinanceEvent)=>isBudgetSource(row)||isBudgetSource({key:row.sourceKey});
export const budgetPolicyKey='p12:policy';

export type BudgetPolicy={currency:string;taxBasis:'exclusive'|'inclusive';recognition:'service_acceptance'|'goods_receipt'|'invoice_review';reference:string};
export type BudgetScope={scopeId:string;title:string;productKey:string|null;reference:string};
type PostingApproval={makers:string[];status:'draft'|'confirmed'|'withdrawn';confirmedBy:string|null;order:number|null;decisionReference:string|null};
type PostingBase={scope:string;documentId:string;title:string;reference:string};
export type BudgetPosting=PostingBase&PostingApproval&{type:'allocation'|'cost'};
type Forecast={type:'etc';scope:string;reference:string;capturedOrder:number};
type Payment=PostingBase&{type:'payment'};
export type BudgetEntry=BudgetPosting|Forecast|Payment;
const q=Decimal.from;
const id=(type:string,key:string)=>'p12:'+type+':'+businessSlug(key.toLowerCase());
const fail=(message:string,status=400):never=>invalid('Budget execution: '+message,status);
const isPosting=(entry:BudgetEntry):entry is BudgetPosting=>entry.type==='allocation'||entry.type==='cost';
export const hasBudgetExecution=(s:FinanceSnapshot)=>s.inputs.some(row=>row.key===budgetPolicyKey);
export const readBudgetPolicy=(s:FinanceSnapshot)=>(s.inputs.find(row=>row.key===budgetPolicyKey)?.conversion.policy??null) as BudgetPolicy|null;
export const readBudgetScopes=(s:FinanceSnapshot)=>s.inputs.filter(row=>row.metricKey==='p12.scope').map(row=>({key:row.key,...row.conversion.scope as BudgetScope}));
export const budgetOrdinal=(s:FinanceSnapshot,key:string)=>Number(s.periods.find(item=>item.key===key)?.metadata.ordinal);

export function readBudgetEntries(s:FinanceSnapshot){
  const sources=new Map(s.sources.map(source=>[source.key,source]));
  return s.events.filter(isBudgetEvent).map(event=>({event,entry:sources.get(event.sourceKey)!.metadata.execution as BudgetEntry}));
}
export const latestBudgetOrder=(entries:ReturnType<typeof readBudgetEntries>)=>entries.reduce(
  (max,{entry})=>isPosting(entry)?Math.max(max,entry.order??0):max,0);
export function budgetAction(raw:unknown){
  if(!Array.isArray(raw))return null;
  const command=raw.find(change=>change?.collection==='budget_execution');
  if(!command)return null;
  if(raw.length!==1)fail('Use one budget action per revision.');
  const action=command.action;
  if(!['policy','scope','allocation','cost','etc','payment','confirm','withdraw'].includes(action))fail('Unknown budget action.');
  return action as 'policy'|'scope'|'allocation'|'cost'|'etc'|'payment'|'confirm'|'withdraw';
}

function fields(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('Invalid record fields.');
  return value as Record<string,unknown>;
}
function text(value:unknown,name:string,max=200):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail('Enter '+name+'.');
  return (value as string).trim();
}
function eventDate(s:FinanceSnapshot,period:string,value:unknown) {
  const date=text(value,'a posting date',10),year=s.periods.find(item=>item.key===period)?.metadata.calendarYear;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||
    Number.isInteger(year)&&Number(date.slice(0,4))!==year)fail('The posting date must match the selected accounting period.');
  return date;
}
const scopeFields={module:'budget' as const,marketKey:null,lineKey:null};
const replace=<T extends {key:string}>(values:T[],item:T)=>values.filter(row=>row.key!==item.key).concat(item);

export function applyBudgetChange(s:FinanceSnapshot,raw:unknown,selected:string[],actorUid:string|undefined){
  if(!actorUid)return fail('A server-authenticated actor is required.',403);
  const action=budgetAction([raw]);
  const command=fields(raw,['collection','action','key','record']);
  const policy=readBudgetPolicy(s),scopes=readBudgetScopes(s),entries=readBudgetEntries(s);
  const order=latestBudgetOrder(entries);
  const original=command.key===undefined?undefined:entries.find(row=>row.event.key===financeKey(command.key));
  const scope=(key:unknown)=>{
    const found=scopes.find(item=>item.key===financeKey(key));
    if(!found)return fail('Select a cost scope in this version.');
    return found;
  };
  const eventPeriod=(value:unknown)=>{
    const period=financeKey(value);
    if(!selected.includes(period))fail('The accounting period is outside this preview.');
    return period;
  };
  const upsertSource=(key:string,source:Omit<FinanceSource,'key'|'system'|'fingerprint'|'sheet'|'cell'|'owner'|'effectiveTo'|'mappingStatus'>)=>{
    const record:FinanceSource={...source,key,system:'Budget execution',fingerprint:null,sheet:null,cell:null,owner:'Finance',effectiveTo:null,mappingStatus:'mapped'};
    s.sources=replace(s.sources,record);
  };
  if(action==='policy'||action==='scope'){
    if(action==='policy'&&(policy||command.key!==undefined))fail('The budget policy is already established.');
    if(action==='scope'&&!policy)return fail('Establish the budget policy first.');
    if(command.key!==undefined)fail('Use a new scope identity.');
    const record=fields(command.record,action==='policy'?['currency','taxBasis','recognition','reference']:['scopeId','title','productKey','reference']);
    const reference=text(record.reference,'the policy or scope evidence');
    let key=budgetPolicyKey,productKey:string|null=null,conversion:FinanceInput['conversion'];
    if(action==='policy'){
      const currency=text(record.currency,'the budget currency',3),taxBasis=record.taxBasis,recognition=record.recognition;
      if(!Object.hasOwn(s.policy.currencyScales,currency)||taxBasis!=='exclusive'&&taxBasis!=='inclusive'||
        recognition!=='service_acceptance'&&recognition!=='goods_receipt'&&recognition!=='invoice_review')
        return fail('Choose a configured currency, tax basis and recognition rule.');
      conversion={policy:{currency,taxBasis,recognition,reference} satisfies BudgetPolicy};
    }else {
      const scopeId=financeKey(record.scopeId),title=text(record.title,'the scope title');
      key=id('scope',scopeId);
      if(scopes.some(item=>item.key===key))fail('This cost scope already exists.',409);
      productKey=record.productKey===null?null:financeKey(record.productKey);
      if(productKey&&!s.products.some(item=>item.key===productKey&&item.metadata.active!==false))fail('Select an enabled product.');
      conversion={scope:{scopeId,title,productKey,reference} satisfies BudgetScope};
    }
    const period=eventPeriod(s.policy.cashFlowOriginPeriod),sourceKey=key+':source',value={coefficient:'0',scale:0};
    upsertSource(sourceKey,{externalKey:reference,observation:'budget',originalCurrency:null,originalUnit:'record',originalPeriod:period,
      effectiveFrom:s.asOf,metadata:{}});
    s.inputs=replace(s.inputs,{...scopeFields,key,metricKey:'p12.'+action,productKey,periodKey:period,sourceKey,value,
      valueKind:'quantity',unit:'record',currency:null,effectiveFrom:s.asOf,effectiveTo:null,conversion});
    return {collection:'inputs',key,metricKey:'p12.'+action,period,productKey,sourceKey,unit:'record',currency:null,
      before:null,after:value,afterLabel:reference};
  }
  if(!policy)return fail('Establish the budget policy first.');
  const money=(value:unknown,currency:string)=>{
    const amount=fixedDecimal(value);
    if(amount.scale!==s.policy.currencyScales[currency])fail('Use the original posting currency precision.');
    return amount;
  };
  let event:FinanceEvent,entry:BudgetEntry;
  if(action==='confirm'||action==='withdraw'){
    if(!original||!isPosting(original.entry)||original.entry.status!=='draft')return fail('The selected posting is no longer a draft.',409);
    const decision=fields(command.record,['reference']);
    const reference=text(decision.reference,'the decision evidence');
    const record=original.entry;
    if(action==='confirm'&&record.makers.includes(actorUid))fail('An independent approver must confirm this posting.',403);
    if(action==='confirm'){
      const link=original.event.relatedKey;
      if(link){
        const net=sum(entries.filter(row=>row.entry.type==='cost'&&row.entry.status==='confirmed'&&(row.event.key===link||row.event.relatedKey===link))
          .map(row=>q(row.event.amount))).add(q(original.event.amount));
        if(net.n<0n)fail('Linked adjustments cannot reduce the original cost below zero.');
      }
      if(record.type==='allocation'){
        const valued=(event:FinanceEvent)=>{
          const rate=caseFinanceRate(s,event.currency,policy.currency,event.periodKey);
          if(!rate)return fail('Provide an exchange rate for '+event.currency+' before confirming this allocation.');
          return q(event.amount).mul(rate);
        };
        const net=sum(entries.filter(row=>row.entry.type==='allocation'&&row.entry.status==='confirmed'&&row.entry.scope===record.scope)
          .map(row=>valued(row.event))).add(valued(original.event));
        if(net.n<0n)fail('Approved scope budget cannot fall below zero.');
      }
    }
    event=original.event;eventPeriod(event.periodKey);
    entry={...record,status:action==='confirm'?'confirmed':'withdrawn',confirmedBy:action==='confirm'?actorUid:null,order:action==='confirm'?order+1:null,
      decisionReference:reference};
  }else{
    const record=fields(command.record,action==='etc'?['scope','period','amount','reference','currency']:['scope','period','amount','reference','documentId','title','date','relatedKey','currency']);
    const currency=sourceFinanceCurrency(s,record.currency,original?.event.currency??policy.currency);
    const reference=text(record.reference,'the source evidence'),amount=money(record.amount,currency),period=eventPeriod(record.period);
    if(!caseFinanceRate(s,currency,policy.currency,period)||s.policy.fx&&!caseFinanceRate(s,currency,s.currency,period))
      return fail('Provide a documented exchange rate for '+currency+' in '+period+'.');
    const selectedScope=scope(record.scope),productKey=selectedScope.productKey;
    let kind:FinanceEvent['kind'],key:string,relatedKey:string|null=null,date:string|null=null;
    if(action==='etc'){
      if(command.key!==undefined||q(amount).n<0n)fail('Enter a nonnegative forecast for the selected scope.');
      key=id('etc',selectedScope.key);kind='etc';
      const previous=s.events.find(row=>row.key===key);
      if(previous&&budgetOrdinal(s,period)<budgetOrdinal(s,previous.periodKey))fail('The remaining forecast cutoff cannot move backwards.');
      entry={type:'etc',scope:selectedScope.key,reference,capturedOrder:order};
    }else{
      const documentId=financeKey(record.documentId),title=text(record.title,'the posting title');
      const base={scope:selectedScope.key,documentId,title,reference};
      const posting=action==='allocation'||action==='cost';
      if(!posting&&action!=='payment')return fail('Unknown posting.');
      key=id(action,documentId);kind=action==='allocation'?'budget':action==='cost'?'incurred':'payment';
      if(command.key!==undefined&&(!posting||!original||original.event.key!==key||original.entry.type!==action||
        original.entry.status!=='draft'))fail('Only the original draft posting can be edited.',409);
      if(command.key===undefined&&entries.some(row=>row.event.key===key))fail('This document identity is already recorded.',409);
      if(action!=='allocation'){
        date=eventDate(s,period,record.date);
        relatedKey=record.relatedKey===null?null:financeKey(record.relatedKey);
      }
      if(action==='payment'&&!relatedKey)fail('Link the payment to a confirmed original cost.');
      if(relatedKey){
        const root=entries.find(row=>row.event.key===relatedKey);
        if(!root||root.entry.type!=='cost'||root.entry.status!=='confirmed'||root.event.relatedKey||root.entry.scope!==selectedScope.key)
          return fail('Use a confirmed original cost in the same scope.');
        if(root.event.currency!==currency)return fail('Linked postings use the original cost currency.');
        if(budgetOrdinal(s,period)<budgetOrdinal(s,root.event.periodKey)||date!<root.event.eventDate!)
          fail('Corrections and payments cannot precede the original occurrence.');
        if(action==='payment'&&sum(entries.filter(row=>row.entry.type==='payment'&&row.event.relatedKey===relatedKey).map(row=>q(row.event.amount))).add(q(amount)).n<0n)
          fail('Net payments cannot be negative.');
      }
      if(q(amount).n===0n||action==='cost'&&!relatedKey&&q(amount).n<0n)fail('Enter a nonzero posting amount. Original costs must be positive.');
      const makers=original&&isPosting(original.entry)?original.entry.makers:[];
      entry=posting?{...base,type:action,makers:[...new Set([...makers,actorUid])],status:'draft',confirmedBy:null,order:null,decisionReference:null}:
        {...base,type:'payment'};
    }
    event={...scopeFields,key,kind,productKey,periodKey:period,sourceKey:key+':source',amount,currency,eventDate:date,relatedKey,evidenceKey:reference};
  }
  const previous=s.events.find(row=>row.key===event.key);
  const currency=event.currency,scale=s.policy.currencyScales[currency];
  upsertSource(event.sourceKey,{externalKey:entry.reference,observation:entry.type==='payment'||entry.type==='cost'&&entry.status==='confirmed'?'measured':'budget',
    originalCurrency:currency,originalUnit:currency,originalPeriod:event.periodKey,effectiveFrom:event.eventDate??s.asOf,metadata:{execution:entry}});
  s.events=replace(s.events,event);
  return {collection:'events',key:event.key,metricKey:event.kind,period:event.periodKey,productKey:event.productKey,sourceKey:event.sourceKey,
    unit:currency,currency,before:previous?.amount??null,after:event.amount,
    ...(action==='confirm'||action==='withdraw'?{beforeLabel:'Draft · '+q(event.amount).text(scale),
      afterLabel:(action==='confirm'?'Confirmed':'Withdrawn')+' · '+q(event.amount).text(scale)}:{})};
}
