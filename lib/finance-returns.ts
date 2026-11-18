import {Decimal,ONE,ZERO,sum} from './finance-decimal.ts';
import {CalculationBuilder} from './finance-calculation-types.ts';
import type {Value,CalculationOutput,CalculationStatus} from './finance-calculation-types.ts';

function irr(cash:Decimal[]):{q:Decimal|null;status:CalculationStatus;details:Record<string,unknown>} {
  const signs=cash.filter(v=>v.n!==0n).map(v=>v.n<0n?-1:1);
  const changes=signs.slice(1).filter((v,i)=>v!==signs[i]).length;
  if(!changes)return {q:null,status:'no_irr',details:{message:'IRR requires both positive and negative cash flows.'}};
  if(changes>1)return {q:null,status:'ambiguous_irr',details:{signChanges:changes,message:'Multiple sign changes; a unique economically interpretable IRR has not been established.'}};
  // Solve in log(1+r), with scaled exponentials. Zero years retain their time positions.
  const numbers=cash.map(v=>v.number()),scale=Math.max(...numbers.map(Math.abs));
  const f=(x:number)=>{
    const terms=numbers.map((v,t)=>({v:v/scale,e:-t*x})).filter(v=>v.v!==0),max=Math.max(...terms.map(v=>v.e));
    return terms.reduce((acc,t)=>acc+t.v*Math.exp(t.e-max),0);
  };
  let low=-35,high=70,fl=f(low),fh=f(high);
  if(!Number.isFinite(fl)||!Number.isFinite(fh)||fl*fh>=0)return {q:null,status:'solver_failed',details:{message:'The unique root could not be bracketed in the supported numerical domain.'}};
  for(let i=0;i<240;i++) {const mid=(low+high)/2,fm=f(mid);if(fm===0){low=high=mid;break;}if(Math.sign(fm)===Math.sign(fl)){low=mid;fl=fm;}else high=mid;}
  const rate=Math.expm1((low+high)/2);
  if(!Number.isFinite(rate)||rate<=-1)return {q:null,status:'solver_failed',details:{message:'IRR lies outside finite numerical precision.'}};
  const q=Decimal.from(rate.toPrecision(17)),residual=sum(cash.map((v,t)=>v.div(ONE.add(q).pow(t))));
  if(residual.abs().cmp(Decimal.from('0.01'))>0)return {q:null,status:'solver_failed',details:{message:'IRR residual exceeds the P01 money tolerance.',residual:residual.text()}};
  return {q,status:'ok',details:{method:'log-rate bisection; one sign change',residual:residual.text(),domain:'r > -1'}};
}

export function calculateReturns(b:CalculationBuilder,prefix:string,cash:Value[],rate:Value,scope:string[],basis:string) {
  const periods=[...b.snapshot.periods].sort((a,c)=>Number(a.metadata.ordinal)-Number(c.metadata.ordinal)).map(p=>p.key);
  const opts={productScope:scope,periods,basis},metric=(key:string,q:Decimal|null,deps:Value[],extra:Partial<CalculationOutput>={})=>b.make(prefix+':'+key,key,q,deps,{...opts,...extra});
  const cumulative=cash.map((_,i)=>b.calc(prefix+':'+periods[i]+':cumulative_cash','cumulative_cash',cash.slice(0,i+1),sum,{...opts,periods:periods.slice(0,i+1),formula:'sum(CF[0..t])'}));
  const pv=cash.map((v,i)=>b.calc(prefix+':'+periods[i]+':present_value','present_value',[v,rate],([c,r])=>c.div(ONE.add(r).pow(i)),{...opts,periods:[periods[i]],formula:'CF[t] / (1 + annualRate)^t'}));
  const npv=b.calc(prefix+':npv','npv',pv,sum,{...opts,formula:'CF[0] + sum(CF[t] / (1+r)^t, t=1..n)'});
  let irrValue:Value,payback:Value,peak:Value;
  if(cash.some(v=>v.q===null)) {
    irrValue=metric('irr',null,cash,{unit:'fraction',currency:null});
    payback=metric('payback_period',null,cash,{unit:'year',currency:null});
    peak=metric('peak_funding_requirement',null,cash);
  } else {
    const flows=cash.map(v=>v.q!),cum=cumulative.map(v=>v.q!),solved=irr(flows);
    irrValue=metric('irr',solved.q,cash,{unit:'fraction',currency:null,status:solved.status,details:solved.details,formula:'unique r > -1 where sum(CF[t]/(1+r)^t) = 0'});
    let min=ZERO,index:number|null=null;cum.forEach((v,i)=>{if(v.cmp(min)<0){min=v;index=i;}});
    peak=metric('peak_funding_requirement',min.neg(),cash,{status:index===null?'no_funding_required':'ok',details:{firstPeriod:index===null?null:periods[index],firstOrdinal:index},formula:'max(0, -min cumulative CF); first minimum'});
    const firstNegative=cum.findIndex(v=>v.n<0n);
    if(firstNegative<0)payback=metric('payback_period',ZERO,cash,{unit:'year',currency:null,status:'no_funding_required'});
    else {
      const recovered=cum.findIndex((v,i)=>i>firstNegative&&v.n>=0n);
      if(recovered<0)payback=metric('payback_period',null,cash,{unit:'year',currency:null,status:'not_recovered',details:{message:'The project does not recover its funding deficit within the supplied horizon.'}});
      else payback=metric('payback_period',Decimal.from(recovered-1).sub(cum[recovered-1].div(flows[recovered])),cash,{unit:'year',currency:null,status:cum.slice(recovered+1).some(v=>v.n<0n)?'recrossed':'ok',formula:'t - 1 - cumulative[t-1] / CF[t]',details:{previousPeriod:periods[recovered-1],recoveryPeriod:periods[recovered],interpolation:'linear, undiscounted',message:'First recovery; any later funding deficit remains visible.'}});
    }
  }
  return {metrics:{npv:npv.out,irr:irrValue.out,payback_period:payback.out,peak_funding_requirement:peak.out},cumulative,pv};
}
