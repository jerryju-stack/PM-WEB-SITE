import {sampleFinance} from './finance-p04.ts';
import type {FinanceSnapshot,FinanceInput} from '../../lib/finance-contracts.ts';
import {Decimal} from '../../lib/finance-decimal.ts';

export function addInput(s:FinanceSnapshot,key:string,metricKey:string,value:string,periodKey:string,productKey='product-a',unit=s.currency,lineKey:string|null=null) {
  const currency=unit.startsWith(s.currency)?s.currency:null,kind=unit===s.currency?'money':currency?'unit_price':['fraction'].includes(unit)?'rate':'quantity';
  const q=Decimal.from(value),scale=kind==='money'?s.currencyScale:Math.min((value.split('.')[1]??'').length,12);
  const text=q.text(scale),coefficient=BigInt(text.replace('.','')).toString();
  const input:FinanceInput={key,metricKey,value:{coefficient,scale},module:metricKey==='cash_flow'||metricKey==='cash_adjustment'?'returns':lineKey?'operations':'commercial',
    productKey,marketKey:null,lineKey,periodKey,sourceKey:s.sources[0].key,valueKind:kind,unit,currency,effectiveFrom:'2027-01-01',effectiveTo:null,conversion:{role:'synthetic_input'}};
  s.inputs.push(input);return input;
}
export function cashScenario(flows:string[][]=[['-80','40','50'],['-20','20','10']]):FinanceSnapshot {
  const s=sampleFinance();s.inputs=[];s.events=[];s.lines=[];s.markets=[];s.products=flows.map((_,i)=>({key:'product-'+i,label:'Synthetic product '+i,metadata:{active:true}}));
  s.periods=flows[0].map((_,i)=>({key:'year-'+i,label:'Year '+i,metadata:{ordinal:i,calendarYear:i?2026+i:null}}));
  s.policy.rules={...s.policy.rules,model:'cash_series'};
  flows.forEach((row,i)=>row.forEach((v,t)=>addInput(s,'cash-'+i+'-'+t,'cash_flow',v,'year-'+t,'product-'+i)));
  return s;
}
export function laborScenario():FinanceSnapshot {
  const s=sampleFinance();s.inputs=[];s.events=[];s.markets=[];s.lines[0].metadata.productKey='product-a';
  s.policy.rules={...s.policy.rules,model:'manufacturing',operatingMapping:'approved'};
  for(let t=0;t<2;t++) {
    const p='year-'+t;
    for(const [key,value,unit] of [['volume',t?'10000':'0','pieces'],['unit_sales','20','CNY/piece'],['unit_material','8','CNY/piece'],['other_cost','0','CNY'],['cash_adjustment',t?'0':'-10000','CNY']])addInput(s,key+'-'+t,key,value,p,'product-a',unit);
  }
  for(const [key,value,unit] of [['cycle_time','30','seconds/cycle'],['people','2','persons'],['hourly_rate','60','CNY/person-hour'],['labor_efficiency','1','fraction'],['units_per_cycle','1','pieces/cycle'],['cycles_per_unit','1','cycles/piece']])addInput(s,key,key,value,'year-1','product-a',unit,'line-a');
  return s;
}
export const laborChange={requestKey:'t2-preview',reason:'T2 CT 30 to 36 seconds',revision:0,clientSequence:1,effectivePeriod:{from:'year-1',to:'year-1'},changeSet:[{collection:'inputs' as const,key:'cycle_time',value:{coefficient:'36',scale:0}}]};
