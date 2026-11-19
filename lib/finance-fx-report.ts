import type {CalculationOutput,CalculationReport} from './finance-calculation-types.ts';
import {calculateFinance} from './finance-calculation.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {FinanceBridgeInputs} from './finance-bridge-inputs.ts';
import {financeBridges} from './finance-bridges.ts';
import type {BridgeSide} from './finance-bridges.ts';
import {Decimal} from './finance-decimal.ts';
import {archived} from './finance-business.ts';
import {caseFinanceRate,financeCurrencyScales} from './finance-fx.ts';

const exact=(value:CalculationOutput['exact'])=>value?new Decimal(BigInt(value.numerator),BigInt(value.denominator)):null;

export function financeFxBasis(s:FinanceSnapshot){
  return s.policy.fx?{kind:'version' as const,snapshot:s.policy.fx}:
    archived(s)?{kind:'archived_workbook' as const,snapshot:null}:
    s.inputs.some(row=>row.metricKey==='fx_to_base')?{kind:'legacy_period_rates' as const,snapshot:null}:
    {kind:'missing' as const,snapshot:null};
}

/** Presentation applies one consistent multiplier to results after the original Case calculation. */
export function displayFinance(report:CalculationReport,s:FinanceSnapshot,target:string,reference=s,displayScales:Record<string,number>={}):CalculationReport {
  const currencies={...financeCurrencyScales,...s.policy.currencyScales,...reference.policy.currencyScales,...displayScales};
  if(!Object.hasOwn(currencies,target))throw new Error('Unsupported display currency.');
  const fx={...reference,policy:{...reference.policy,currencyScales:currencies}};
  const translated=new Map<string,CalculationOutput>(),rates=new Map<string,Decimal|null>();
  const issues=[...report.issues];
  const convert=(out:CalculationOutput)=>{
    const cached=translated.get(out.id);if(cached)return cached;
    const from=out.currency;
    if(!from||!out.unit.startsWith(from))return out;
    const scale=out.unit===from?currencies[target]:out.displayDecimals;
    if(from===target&&scale===out.displayDecimals)return out;
    // Historical native period rates can present a period, or a total when all applicable rates agree.
    const periods=out.periods.length?out.periods:report.periods;
    const applicable=periods.map(period=>{
      const key=from+':'+period;
      if(!rates.has(key))rates.set(key,caseFinanceRate(fx,from,target,period));
      return rates.get(key);
    });
    const first=applicable[0];
    const rate=first&&applicable.every(value=>value&&value.cmp(first)===0)?first:null;
    const value=rate?exact(out.exact)?.mul(rate):null;
    const message='A consistent '+from+' → '+target+' display rate is unavailable for this scope.';
    if(!rate&&out.exact)issues.push({code:'missing_fx',message,outputId:out.id,upstreamInputs:out.upstreamInputs});
    const result:CalculationOutput={...out,currency:target,unit:target+out.unit.slice(from.length),displayDecimals:scale,
      value:value?.text()??null,displayValue:value?.text(scale)??null,exact:value?.exact()??null,
      status:!rate&&out.exact?'missing_fx':out.status,details:rate&&from!==target?
        {...out.details,displayFx:{from,to:target,rate:rate.text()}}:!rate&&out.exact?{...out.details,message}:out.details};
    translated.set(out.id,result);return result;
  };
  const map=(row:Record<string,CalculationOutput>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,convert(value)]));
  return {...report,currency:target,metrics:map(report.metrics),periodic:report.periodic.map(map),budget:map(report.budget),issues,
    products:Object.fromEntries(Object.entries(report.products).map(([key,row])=>[key,{metrics:map(row.metrics),periodic:row.periodic.map(map)}]))};
}

export const financeFxModes=['own','a','b'] as const;
export type FinanceFxMode=typeof financeFxModes[number];

export function compareFinanceFx(before:BridgeSide,after:BridgeSide,target:string,mode:FinanceFxMode,cutoff:string|null,product:string|null){
  const basis=mode==='b'?'b':'a',reference=(basis==='b'?after:before).snapshot;
  const scales={...financeCurrencyScales,...before.snapshot.policy.currencyScales,...after.snapshot.policy.currencyScales};
  const reporting=(side:BridgeSide,reference?:FinanceSnapshot):BridgeSide=>{
    const s=side.snapshot;
    const inputs=reference?new FinanceBridgeInputs():side.inputs;
    const report=reference?calculateFinance(s,inputs,reference):side.report;
    return {snapshot:{...s,currency:target,currencyScale:scales[target],policy:{...s.policy,currencyScales:scales}},
      report:displayFinance(report,s,target,reference,scales),inputs};
  };
  const ownBefore=reporting(before),ownAfter=reporting(after);
  const own=financeBridges(ownBefore,ownAfter,cutoff,product,false);
  const hasArchive=[before,after].some(side=>archived(side.snapshot));
  const constant=!hasArchive&&own.data?financeBridges(
    basis==='a'?ownBefore:reporting(before,reference),
    basis==='b'?ownAfter:reporting(after,reference),cutoff,product,false):null;
  const selected=mode==='own'?own:constant;
  const rows=(a:NonNullable<typeof own.data>['metrics'],b:typeof a|undefined)=>Object.fromEntries(Object.entries(a).map(([key,row])=>{
    const business=b?.[key]?.delta??null;
    const original=exact(row.delta.exact),constant=exact(business?.exact??null);
    const effect=original&&constant?original.sub(constant):null;
    const scale=row.delta.unit==='percentage_point'||row.delta.unit==='year'?2:scales[target];
    return [key,{original:row.delta,business,fxImpact:{value:effect?.text()??null,displayValue:effect?.text(scale)??null,
      exact:effect?.exact()??null,unit:row.delta.unit,status:effect?'ok':'unavailable'}}];
  }));
  const missing=(data:typeof own.data)=>!!data&&[data.metrics,data.budget,...data.periodic.map(row=>row.metrics)]
    .some(group=>Object.values(group).some(row=>row.before?.status==='missing_fx'||row.after?.status==='missing_fx'));
  return {currency:target,mode,basis,beforeBasis:financeFxBasis(before.snapshot),afterBasis:financeFxBasis(after.snapshot),
    reason:own.reason??(hasArchive?'The archived workbook contains aggregated amounts without complete original-currency detail. Constant-rate changes are unavailable.':
      constant?.reason??(missing(own.data)||missing(constant?.data??null)?'Some amounts require documented rates in the selected currency or FX basis.':null)),
    data:selected?.data??null,
    metrics:own.data?rows(own.data.metrics,constant?.data?.metrics):{},
    budget:own.data?rows(own.data.budget,constant?.data?.budget):{},
    periodic:own.data?.periodic.map((item,i)=>({period:item.period,metrics:rows(item.metrics,constant?.data?.periodic[i]?.metrics)}))??[]};
}
