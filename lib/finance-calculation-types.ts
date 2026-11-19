import type {FinanceSnapshot} from './finance-contracts.ts';
import {Decimal} from './finance-decimal.ts';
import type {FinanceBridgeInputs} from './finance-bridge-inputs.ts';
import {caseFinanceRate} from './finance-fx.ts';

export const FINANCE_CALCULATION_VERSION='P06.1';
export type CalculationStatus='ok'|'no_activity'|'missing_input'|'zero_denominator'|'pending_finance'|'invalid_rate'|'missing_fx'|'no_irr'|'ambiguous_irr'|'solver_failed'|'not_recovered'|'no_funding_required'|'recrossed'|'incompatible_scope'|'unsupported_driver';
export type CalculationIssue={code:CalculationStatus;message:string;outputId:string;upstreamInputs:string[]};
export type CalculationOutput={
  id:string;metricKey:string;value:string|null;displayValue:string|null;exact:{numerator:string;denominator:string}|null;
  status:CalculationStatus;basis:string;unit:string;currency:string|null;displayDecimals:number;periods:string[];productScope:string[];
  asOf:string;dictionaryVersion:string;calculationVersion:string;formula:string;dependencies:string[];upstreamInputs:string[];
  details:Record<string,unknown>;
};
export type InputEvidence={id:string;sourceKey:string|null;inputKey:string|null;role:string;unit:string;currency:string|null;periods:string[];value:string|null;status:CalculationStatus;sheet?:string|null;cell?:string|null};
export type Value={q:Decimal|null;out:CalculationOutput};
export type CalculationReport={calculationVersion:string;dictionaryVersion:string;asOf:string;currency:string;basis:string;periods:string[];productScope:string[];
  metrics:Record<string,CalculationOutput>;periodic:Record<string,CalculationOutput>[];products:Record<string,{metrics:Record<string,CalculationOutput>;periodic:Record<string,CalculationOutput>[]} >;
  budget:Record<string,CalculationOutput>;outputs:Record<string,CalculationOutput>;inputs:Record<string,InputEvidence>;issues:CalculationIssue[]};

export class CalculationBuilder {
  snapshot:FinanceSnapshot;
  outputs:Record<string,CalculationOutput>={};inputs:Record<string,InputEvidence>={};issues:CalculationIssue[]=[];
  values=new Map<string,Value>();
  readonly bridge?:FinanceBridgeInputs;
  readonly fxReference:FinanceSnapshot;
  constructor(snapshot:FinanceSnapshot,bridge?:FinanceBridgeInputs,fxReference=snapshot){
    this.snapshot=snapshot;this.bridge=bridge;
    this.fxReference={...fxReference,policy:{...fxReference.policy,currencyScales:{...snapshot.policy.currencyScales,...fxReference.policy.currencyScales}}};
  }
  input(e:InputEvidence,q:Decimal|null):Value {
    this.inputs[e.id]=e;
    return this.make(e.id,'input',q,[],{unit:e.unit,currency:e.currency,periods:e.periods,status:e.status,formula:e.role,upstreamInputs:[e.id]});
  }
  money(e:InputEvidence,q:Decimal|null,to:string,period:string):Value {
    const raw=this.input(e,q),from=e.currency;
    if(!from||from===to||q===null)return raw;
    const rate=caseFinanceRate(this.fxReference,from,to,period);
    const id='fx:'+period+':'+to+':'+from;
    const legacy=this.fxReference.policy.fx?undefined:this.fxReference.inputs.find(row=>
      row.metricKey==='fx_to_base'&&row.periodKey===period&&row.unit===to+'/'+from&&!row.productKey&&!row.marketKey&&!row.lineKey);
    const fx=this.values.get(id)??this.input({id,inputKey:legacy?.key??null,sourceKey:legacy?.sourceKey??null,
      role:'Version FX · units of '+to+' per 1 '+from,unit:to+'/'+from,currency:null,periods:[period],
      value:rate?.text()??null,status:rate?'ok':'missing_fx'},rate);
    const unit=to+e.unit.slice(from.length);
    return this.calc(e.id+':fx','converted_amount',[raw,fx],([amount,multiplier])=>amount.mul(multiplier),
      {unit,currency:to,periods:e.periods,details:{message:'FX '+from+' → '+to+' for '+period+(rate?'': ' is missing.')}});
  }
  make(id:string,metricKey:string,q:Decimal|null,deps:Value[],options:Partial<CalculationOutput>={}):Value {
    const upstreamInputs=options.upstreamInputs??[...new Set(deps.flatMap(v=>v.out.upstreamInputs))].sort();
    const status=options.status??(deps.find(v=>v.q===null)?.out.status??(q===null?'missing_input':'ok'));
    if(deps.some(v=>v.q===null)&&!options.status)q=null;
    const unit=options.unit??this.snapshot.currency;
    const currency=options.currency??(unit===this.snapshot.currency?this.snapshot.currency:null);
    const displayDecimals=unit==='fraction'?2:unit.includes('/piece')?4:unit==='pieces'?0:currency&&unit===currency?this.snapshot.policy.currencyScales[currency]:2;
    const display=q===null?null:unit==='fraction'?q.mul(Decimal.from(100)).text(displayDecimals):q.text(displayDecimals);
    const out:CalculationOutput={id,metricKey,value:q?.text()??null,displayValue:display,exact:q?.exact()??null,status,basis:this.snapshot.basis,
      unit,currency,displayDecimals,periods:this.snapshot.periods.map(p=>p.key),productScope:[],
      asOf:this.snapshot.asOf,dictionaryVersion:this.snapshot.dictionaryVersion,calculationVersion:this.snapshot.calculationVersion==='not_implemented'?FINANCE_CALCULATION_VERSION:this.snapshot.calculationVersion,formula:metricKey,
      dependencies:deps.map(v=>v.out.id),upstreamInputs,details:{},...options};
    this.outputs[id]=out;const result={q,out};this.values.set(id,result);
    if(q===null||status==='recrossed')this.issues.push({code:status,message:String(out.details.message??status.replaceAll('_',' ')),outputId:id,upstreamInputs});
    return result;
  }
  calc(id:string,key:string,deps:Value[],fn:(values:Decimal[])=>Decimal,options:Partial<CalculationOutput>={}):Value {
    if(deps.some(v=>v.q===null))return this.make(id,key,null,deps,options);
    try{return this.make(id,key,fn(deps.map(v=>v.q!)),deps,options);}
    catch(error){return this.make(id,key,null,deps,{...options,status: error instanceof Error&&error.message==='zero_denominator'?'zero_denominator':'missing_input',details:{message:String(error)}});}
  }
}
