import type {FinanceSnapshot} from './finance-contracts.ts';
import type {CalculationOutput,CalculationReport,Value} from './finance-calculation-types.ts';
import {CalculationBuilder} from './finance-calculation-types.ts';
import {calculateReturns} from './finance-returns.ts';
import {bridgePeriodKey,FinanceBridgeInputs} from './finance-bridge-inputs.ts';
import type {BridgeTerm} from './finance-bridge-inputs.ts';
import {Decimal,ONE,ZERO,sum} from './finance-decimal.ts';

export const bridgeDrivers:Record<string,string>={
  sales_volume:'Sales volume / mix',sales_rate:'Selling price / annual reduction',sales_joint:'Volume × price interaction',sales:'Other sales effects',
  material:'Materials / landed BOM',labor_volume:'Manufacturing person-hours',labor_rate:'Manufacturing hourly rate',labor_joint:'Manufacturing hours × rate interaction',
  labor:'Other direct labor effects',factory_variable:'Variable factory overhead',factory_fixed:'Fixed factory overhead',factory_scrap:'Scrap',
  factory_warranty:'Warranty',factory_packaging:'Packaging and freight',factory_launch:'Launch',factory_allocation:'Division allocation',factory_other:'Other factory costs',
  engineering_volume:'Engineering hours',engineering_rate:'Engineering hourly rate',engineering_joint:'Engineering hours × rate interaction',
  engineering:'Other engineering / PM costs and recovery',prototypes:'Prototype batches',validation:'Validation and certification',
  archive_engineering:'Archived engineering and recovery',depreciation:'Full-cost depreciation',piece_recovery:'Piece-price recovery earned',
  capital_payments:'Capital payments',capital_receipts:'One-time customer recoveries',salvage:'Asset residual proceeds',piece_receipts:'Piece-price cash receipts',
  working_capital:'Working capital',tax:'Cash tax',cash_adjustment:'Other posted cash adjustments',cash_series:'Explicit cash flows',
  timing:'Cash timing on the same source',fx:'Reporting FX',discount:'Discount rate',residual:'Unexplained residual'
};
const driverOrder=Object.keys(bridgeDrivers);
const exact=(value:CalculationOutput|undefined)=>value?.exact?new Decimal(BigInt(value.exact.numerator),BigInt(value.exact.denominator)):null;
type Evidence={before:string[];after:string[]};
type Entry={driver:string;product:string;period:string;value:Decimal;evidence:Evidence};
type TimingMove=Pick<Entry,'driver'|'value'|'evidence'>;
const union=(a:string[],b:string[])=>[...new Set([...a,...b])];
const merge=(a:Evidence,b:Evidence)=>({before:union(a.before,b.before),after:union(a.after,b.after)});
const emptyEvidence=():Evidence=>({before:[],after:[]});
const upstream=(term?:BridgeTerm)=>term?union(term.value.out.upstreamInputs,term.sources?.flatMap(v=>v.out.upstreamInputs)??[]):[];
const valueOf=(term?:BridgeTerm)=>!term?ZERO:term.value.q&&term.multiplier!==null?
  term.value.q.mul(term.multiplier??ONE).mul(Decimal.from(term.sign??1)):null;

function amount(value:Decimal|null,unit:string,scale:number,status=value===null?'unavailable':'ok'){
  return {value:value?.text()??null,displayValue:value?.text(scale)??null,exact:value?.exact()??null,unit,status};
}
function reported(value:CalculationOutput|undefined){
  return value?{...amount(exact(value),value.unit,value.displayDecimals,value.status),displayValue:value.displayValue}:null;
}
function difference(before:CalculationOutput|undefined,after:CalculationOutput|undefined,scale:number,strictBasis=true){
  const a=exact(before),z=exact(after),unit=after?.unit??before?.unit??'';
  const delta=a&&z&&(!strictBasis||before?.basis===after?.basis)&&before?.unit===after?.unit?z.sub(a):null;
  return {before:reported(before),after:reported(after),delta:amount(unit==='fraction'?delta?.mul(Decimal.from(100))??null:delta,
    unit==='fraction'?'percentage_point':unit,unit==='fraction'||unit==='year'?2:scale)};
}

export type BridgeSide={snapshot:FinanceSnapshot;report:CalculationReport;inputs:FinanceBridgeInputs};

/** Match offsetting movements only within the same cash record, even when one leg is beyond the selected cutoff. */
function timingSchedule(a:BridgeTerm[][],z:BridgeTerm[][]) {
  type Bucket={net:Decimal[];evidence:Evidence[]};
  const schedules=new Map<string,Bucket>();
  for(const [side,rows] of [['before',a],['after',z]] as const)rows.forEach((terms,i)=>terms.forEach(term=>{
    if(!term.timing)return;
    const key=term.driver+'|'+term.timing;
    let bucket=schedules.get(key);
    if(!bucket){bucket={net:rows.map(()=>ZERO),evidence:rows.map(emptyEvidence)};schedules.set(key,bucket);}
    const value=valueOf(term);
    if(!value)return;
    bucket.net[i]=bucket.net[i].add(side==='before'?value.neg():value);
    bucket.evidence[i][side]=union(bucket.evidence[i][side],upstream(term));
  }));
  const output=new Map<number,TimingMove[]>();
  for(const [key,{net,evidence}] of schedules){
    const gains=net.flatMap((v,i)=>v.n>0n?[i]:[]),losses=net.flatMap((v,i)=>v.n<0n?[i]:[]);
    const driver=key.split('|')[0];
    let positive=0,negative=0;
    const record=(i:number,value:Decimal,refs:Evidence)=>{
      const rows=output.get(i)??[];rows.push({driver,value,evidence:refs});output.set(i,rows);
    };
    while(positive<gains.length&&negative<losses.length){
      const gain=gains[positive],loss=losses[negative],amount=net[gain].cmp(net[loss].neg())<0?net[gain]:net[loss].neg();
      const refs=merge(evidence[gain],evidence[loss]);
      record(gain,amount,refs);record(loss,amount.neg(),refs);
      net[gain]=net[gain].sub(amount);net[loss]=net[loss].add(amount);
      if(net[gain].n===0n)positive++;
      if(net[loss].n===0n)negative++;
    }
  }
  return output;
}

function periodEntries(product:string,period:string,a:BridgeTerm[],z:BridgeTerm[],fxBefore:Decimal,fxAfter:Decimal,
  moves:TimingMove[],fxEvidence:Evidence){
  const entries=new Map<string,Entry>();
  const add=(driver:string,value:Decimal,evidence:Evidence)=>{
    if(!value.n)return;
    const entry=entries.get(driver);
    entries.set(driver,{driver,product,period,value:entry?entry.value.add(value):value,evidence:entry?merge(entry.evidence,evidence):evidence});
  };
  const index=(terms:BridgeTerm[])=>new Map(terms.map(term=>[term.driver+'|'+(term.identity??term.value.out.id),term]));
  const before=index(a),after=index(z);
  for(const key of new Set([...before.keys(),...after.keys()])){
    const old=before.get(key),next=after.get(key),term=(next??old)!;
    const v0=valueOf(old),v1=valueOf(next);
    if(!v0||!v1)continue;
    const evidence={before:upstream(old),after:upstream(next)};
    let change=v1.sub(v0);
    const q0=old?.factor?.quantity,q1=next?.factor?.quantity,r0=old?.factor?.rate,r1=next?.factor?.rate;
    if(term.factorKind&&q0&&q1&&r0&&r1&&old?.factorKind===next?.factorKind&&old?.sign===next?.sign){
      const quantity=q1.sub(q0),rate=r1.sub(r0),sign=Decimal.from(term.sign??1);
      const factors=[quantity.mul(r0),q0.mul(rate),quantity.mul(rate)].map(value=>value.mul(sign));
      ['volume','rate','joint'].forEach((suffix,i)=>add(term.factorKind+'_'+suffix,factors[i].mul(fxBefore),evidence));
      change=change.sub(sum(factors));
    }
    add(term.driver,change.mul(fxBefore),evidence);
    add('fx',v1.mul(fxAfter.sub(fxBefore)),merge(evidence,fxEvidence));
  }
  for(const move of moves){
    const value=move.value.mul(fxBefore);
    add(move.driver,value.neg(),move.evidence);
    add('timing',value,move.evidence);
  }
  return entries;
}

function returns(side:BridgeSide,scope:string[],periods:string[]){
  const {snapshot,report,inputs}=side;
  const limited={...snapshot,periods:snapshot.periods.filter(p=>periods.includes(p.key))};
  const b=new CalculationBuilder(limited),same=periods.length===report.periods.length;
  const metrics:Record<string,CalculationOutput>={};
  const periodic=periods.map((period,i)=>{
    const rows=scope.flatMap(key=>report.products[key]?[report.products[key].periodic[i]]:[]);
    const selected=!rows.length?null:scope.length===1?rows[0]:report.periodic[i];
    const row:Record<string,CalculationOutput>={};
    for(const key of ['reported_revenue','reported_profit','cash_flow']){
      row[key]=selected?.[key]??b.make('comparison:'+period+':'+key,key,ZERO,[],{periods:[period]}).out;
    }
    return row;
  });
  const model=report.metrics['cqa.mpbitri']?'cqa':'website';
  const profitKey=model==='cqa'?'cqa.mpbitri':'operating_profit',marginKey=model==='cqa'?'cqa.mpbitri_margin':'operating_margin';
  const basis=report.metrics.revenue.basis,opts={periods,productScope:scope,basis};
  const make=(key:string,value:Decimal|null,extra:Partial<CalculationOutput>={})=>b.make('comparison:'+key,key,value,[],{...opts,...extra}).out;
  const value=(key:string)=>{
    const values=periodic.map(row=>exact(row[key]));return values.some(q=>q===null)?null:sum(values as Decimal[]);
  };
  const revenue=value('reported_revenue'),profit=value('reported_profit'),approved=report.metrics[profitKey]?.status!=='pending_finance';
  metrics.revenue=make('revenue',revenue);
  metrics[profitKey]=make(profitKey,approved?profit:null,approved?{}:{status:'pending_finance'});
  metrics[marginKey]=make(marginKey,approved&&revenue?.n&&profit?profit.div(revenue):null,
    {unit:'fraction',currency:null,...(!approved?{status:'pending_finance'}:revenue?.n===0n?{status:'zero_denominator'}:{})});
  const rate=inputs.rate??b.make('comparison:rate','discount_rate',null,[],{unit:'fraction'});
  metrics.discount_rate=make('discount_rate',rate.q,{unit:'fraction',currency:null,status:rate.out.status,basis:report.basis});
  const cash=periodic.map(row=>({out:row.cash_flow,q:exact(row.cash_flow)}));
  const scopeReport=scope.length===1?report.products[scope[0]]:report;
  // Reuse results from the full period cash series when the cutoff spans it, otherwise solve the truncated series.
  if(same&&scopeReport){
    for(const key of ['npv','irr','payback_period','peak_funding_requirement'])metrics[key]=scopeReport.metrics[key];
    periodic.forEach((row,i)=>Object.assign(row,{cumulative_cash:scopeReport.periodic[i].cumulative_cash,present_value:scopeReport.periodic[i].present_value}));
  } else {
    const calculated=calculateReturns(b,'comparison',cash,rate,scope,report.metrics.npv.basis);
    Object.assign(metrics,calculated.metrics);
    periodic.forEach((row,i)=>Object.assign(row,{cumulative_cash:calculated.cumulative[i].out,present_value:calculated.pv[i].out}));
  }
  return {metrics,periodic,profitKey};
}

export function financeBridges(before:BridgeSide,after:BridgeSide,cutoff:string|null,product:string|null){
  const a=before.snapshot,z=after.snapshot,scale=a.currencyScale;
  const sorted=(s:FinanceSnapshot)=>[...s.periods].sort((x,y)=>Number(x.metadata.ordinal)-Number(y.metadata.ordinal));
  const left=sorted(a),right=sorted(z),periods:string[]=[];
  for(const [i,item] of left.entries()){
    const match=right[i];
    if(!match||item.key!==match.key||item.metadata.calendarYear!==match.metadata.calendarYear)break;
    periods.push(item.key);
  }
  const products=union(before.report.productScope,after.report.productScope).sort();
  const common={
    periods:periods.map(key=>({key,label:right.find(p=>p.key===key)!.label})),
    products:products.map(key=>({key,label:z.products.find(p=>p.key===key)?.label??a.products.find(p=>p.key===key)!.label})),
    currency:a.currency,attributionVersion:'P13.1',
    cutoff:cutoff&&periods.includes(cutoff)?cutoff:periods.at(-1)??null,
    product:product&&products.includes(product)?product:null
  };
  const compatible=a.currency===z.currency&&a.currencyScale===z.currencyScale&&a.basis===z.basis&&
    a.dictionaryVersion===z.dictionaryVersion&&a.policy.cashFlowOriginPeriod===z.policy.cashFlowOriginPeriod&&
    before.report.metrics.npv.basis===after.report.metrics.npv.basis&&products.length>0&&common.cutoff!==null;
  if(!compatible)return {...common,data:null,reason:'The versions require the same currency, valuation basis, dictionary and aligned annual periods from Year 0.'};

  const horizon=periods.slice(0,periods.indexOf(common.cutoff!)+1),scope=common.product?[common.product]:products;
  const old=returns(before,scope,horizon),next=returns(after,scope,horizon);
  const metrics=Object.fromEntries(union(Object.keys(old.metrics),Object.keys(next.metrics)).map(key=>
    [key,difference(old.metrics[key],next.metrics[key],scale)]));
  const periodic=horizon.map((period,i)=>({period,metrics:Object.fromEntries(Object.keys(next.periodic[i]).map(key=>
    [key,difference(old.periodic[i][key],next.periodic[i][key],scale,false)]))}));
  const budget=Object.fromEntries(union(Object.keys(before.report.budget),Object.keys(after.report.budget)).map(key=>
    [key,difference(before.report.budget[key],after.report.budget[key],after.report.budget[key]?.displayDecimals??scale)]));
  const driverEntries={profit:[] as Entry[],npv:[] as Entry[]};
  const rate0=before.inputs.rate?.q,rate1=after.inputs.rate?.q,df0=rate0&&ONE.add(rate0),df1=rate1&&ONE.add(rate1);
  const activePeriod=(side:BridgeSide,key:string)=>side.report.periods.indexOf(key);
  const valuation=(side:BridgeSide)=>side.inputs.rate?.out.upstreamInputs??[];
  for(const p of scope){
    const all=union(before.report.periods,after.report.periods);
    const steps=(side:BridgeSide)=>all.map(key=>side.inputs.periods.get(bridgePeriodKey(p,key)));
    const leftSteps=steps(before),rightSteps=steps(after);
    const moves=timingSchedule(leftSteps.map(step=>step?.cash??[]),rightSteps.map(step=>step?.cash??[]));
    for(const [i,period] of horizon.entries()){
      const original=before.report.products[p]?.periodic[activePeriod(before,period)],updated=after.report.products[p]?.periodic[activePeriod(after,period)];
      const index=all.indexOf(period),aStep=leftSteps[index],zStep=rightSteps[index];
      const fx0=aStep?.fx?.q??zStep?.fx?.q??ONE,fx1=zStep?.fx?.q??aStep?.fx?.q??ONE;
      const fxEvidence={before:aStep?.fx?.out.upstreamInputs??[],after:zStep?.fx?.out.upstreamInputs??[]};
      const reconcile=(target:Entry[],entries:Map<string,Entry>,exactDelta:Decimal,refs:Evidence)=>{
        const rows=[...entries.values()].filter(row=>row.value.n);
        const residual=exactDelta.sub(sum(rows.map(row=>row.value)));
        target.push(...rows);
        if(residual.n)target.push({driver:'residual',product:p,period,value:residual,evidence:refs});
      };
      const bridge=(kind:'profit'|'cash',key:string,movesForPeriod:TimingMove[])=>{
        const aValue=original?exact(original[key]):ZERO,zValue=updated?exact(updated[key]):ZERO;
        if(!aValue||!zValue)return;
        const refs={before:original?.[key]?.upstreamInputs??[],after:updated?.[key]?.upstreamInputs??[]};
        const entries=periodEntries(p,period,aStep?.[kind]??[],zStep?.[kind]??[],fx0,fx1,movesForPeriod,fxEvidence);
        if(kind==='profit'){reconcile(driverEntries.profit,entries,zValue.sub(aValue),refs);return;}
        if(!df0||!df1)return;
        const baseDiscount=ONE.div(df0.pow(i)),newDiscount=ONE.div(df1.pow(i));
        for(const entry of entries.values())entry.value=entry.value.mul(baseDiscount);
        const rateChange=zValue.mul(newDiscount.sub(baseDiscount));
        if(rateChange.n)entries.set('discount',{driver:'discount',product:p,period,value:rateChange,
          evidence:{before:valuation(before),after:valuation(after)}});
        reconcile(driverEntries.npv,entries,zValue.mul(newDiscount).sub(aValue.mul(baseDiscount)),refs);
      };
      bridge('profit','reported_profit',[]);bridge('cash','cash_flow',moves.get(index)??[]);
    }
  }
  const describe=(entry:Entry)=>({...entry,value:amount(entry.value,a.currency,scale)});
  const totalBy=(entries:Entry[],field:'product'|'period')=>[...new Set(entries.map(item=>item[field]))].map(key=>
    ({key,value:amount(sum(entries.filter(item=>item[field]===key).map(item=>item.value)),a.currency,scale)}));
  const bridgeSummary=(entries:Entry[],key:string)=>{
    const metric=metrics[key],target=metric?.delta.exact,newExact=target?new Decimal(BigInt(target.numerator),BigInt(target.denominator)):null;
    if(!newExact)return null;
    const byDriver=driverOrder.flatMap(driver=>{
      const rows=entries.filter(e=>e.driver===driver);
      if(!rows.length)return [];
      const value=sum(rows.map(e=>e.value));
      return [{key:driver,label:bridgeDrivers[driver],value:amount(value,a.currency,scale),products:totalBy(rows,'product'),details:rows.map(describe)}];
    });
    const rounded=sum(byDriver.map(row=>Decimal.from(row.value.displayValue!)));
    const roundoff=Decimal.from(metric.delta.displayValue!).sub(rounded);
    return {metric,byDriver,products:totalBy(entries,'product'),roundoff:amount(roundoff,a.currency,scale),
      reconciled:newExact.cmp(sum(entries.map(e=>e.value)))===0,unexplained:entries.some(e=>e.driver==='residual')};
  };
  return {...common,reason:null,data:{metrics,periodic,budget,profitKey:next.profitKey,
    profit:bridgeSummary(driverEntries.profit,next.profitKey),npv:bridgeSummary(driverEntries.npv,'npv')}};
}
