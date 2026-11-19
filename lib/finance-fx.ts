import {invalid} from './contracts.ts';
import {Decimal,ONE} from './finance-decimal.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';

export const financeCurrencyScales: Readonly<Record<string,number>> = Object.freeze({USD:2,CNY:2,EUR:2,JPY:0});

export function sourceFinanceCurrency(s:FinanceSnapshot,value:unknown,fallback=s.currency):string {
  const code=value??fallback;
  if(typeof code!=='string'||!Object.hasOwn(s.policy.currencyScales,code))return invalid('Select a configured source currency.');
  return code;
}

export type FinanceFxSnapshot = {
  base: string;
  date: string | null;
  period: string | null;
  rates: Record<string,string>;
  note: string;
  source: string;
};

export function readFxSnapshot(value:unknown,scales:Record<string,number>):FinanceFxSnapshot {
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  if(!object(value)||Object.keys(value).some(key=>!['base','date','period','rates','note','source'].includes(key)))
    return invalid('Finance FX: invalid snapshot.');
  const {base,date,period,rates,note,source}=value;
  if(typeof base!=='string'||!Object.hasOwn(scales,base)||!object(rates)||Object.hasOwn(rates,base))
    return invalid('Finance FX: choose a configured base. Its implicit rate is 1 and must be omitted from rates.');
  if(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))
    return invalid('Finance FX: invalid reference date.');
  if(period!==null&&(typeof period!=='string'||!period.trim()||period.length>100)||date===null&&period===null)
    return invalid('Finance FX: supply a reference date or period.');
  if(typeof note!=='string'||note.length>2000||typeof source!=='string'||!source.trim()||source.length>100)
    return invalid('Finance FX: invalid note or source.');
  const parsed:Record<string,string>={};
  for(const [code,value] of Object.entries(rates)) {
    if(!Object.hasOwn(scales,code)||typeof value!=='string'||!/^\d{1,18}(?:\.\d{1,18})?$/.test(value)||Decimal.from(value).n<=0n)
      return invalid('Finance FX: '+code+' requires a configured currency and a positive decimal rate.');
    parsed[code]=value;
  }
  return {base,date,period,rates:parsed,note,source};
}

export function fxRate(scales:Readonly<Record<string,number>>,snapshot:FinanceFxSnapshot|undefined,from:string,to:string):Decimal|null {
  for(const code of [from,to])if(!Object.hasOwn(scales,code))throw new Error('Invalid currency '+code+'.');
  if(from===to)return ONE;
  if(!snapshot)return null;
  const find=(code:string)=>code===snapshot.base?ONE:Object.hasOwn(snapshot.rates,code)?Decimal.from(snapshot.rates[code]):null;
  const a=find(from),b=find(to);
  if(a&&a.n<=0n||b&&b.n<=0n)throw new Error('Exchange rates must be positive.');
  return a&&b?b.div(a):null;
}

export function convertFinanceAmount(amount:Decimal,scales:Readonly<Record<string,number>>,snapshot:FinanceFxSnapshot|undefined,from:string,to:string) {
  const rate=fxRate(scales,snapshot,from,to);
  return rate?amount.mul(rate):null;
}

// Before version snapshots, native cases stored approved base-per-quote rates by period.
export function legacyFinanceRate(s:FinanceSnapshot,from:string,to:string,period:string) {
  const toBase=(code:string)=>{
    if(code===s.currency)return ONE;
    const rows=s.inputs.filter(row=>row.metricKey==='fx_to_base'&&row.periodKey===period&&row.unit===s.currency+'/'+code&&
      !row.productKey&&!row.marketKey&&!row.lineKey);
    const row=rows.length===1?rows[0]:null;
    const source=row&&s.sources.find(item=>item.key===row.sourceKey);
    const rate=row&&source&&!['to_collect','pending_inputs'].includes(source.mappingStatus)?Decimal.from(row.value):null;
    return rate&&rate.n>0n?rate:null;
  };
  const a=toBase(from),b=toBase(to);
  return a&&b?a.div(b):null;
}

export function caseFinanceRate(s:FinanceSnapshot,from:string,to:string,period:string) {
  if(s.policy.fx||from===to)return fxRate(s.policy.currencyScales,s.policy.fx,from,to);
  if(s.policy.rules.importFormat==='cqa-import-P05.1'){
    const toCny=(code:string)=>{
      if(code==='CNY')return ONE;
      const cell=code==='USD'?'C8':code==='EUR'?'C9':null;
      const source=cell&&s.sources.find(row=>row.sheet==='Input'&&row.cell===cell);
      const excel=source?source.metadata.excel as {state?:string;value?:string}|undefined:undefined;
      const rate=excel?.state==='number'&&typeof excel.value==='string'?Decimal.from(excel.value):null;
      return rate&&rate.n>0n?rate:null;
    };
    const a=toCny(from),b=toCny(to);
    return a&&b?a.div(b):null;
  }
  return legacyFinanceRate(s,from,to,period);
}
