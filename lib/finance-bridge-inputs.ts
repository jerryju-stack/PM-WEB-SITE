import type {Value} from './finance-calculation-types.ts';
import type {Decimal} from './finance-decimal.ts';

export type Factor = {quantity:Decimal|null;rate:Decimal|null};
export type BridgeTerm = {
  driver:string; value:Value; sign?:-1;
  factor?:Factor; factorKind?:'sales'|'labor'|'engineering'; identity?:string;
  timing?:string; multiplier?:Decimal|null; sources?:Value[];
};
export type BridgePeriod = {profit:BridgeTerm[];cash:BridgeTerm[];fx?:Value};
export function bridgeInput(driver:string,value:Value,options?:Omit<BridgeTerm,'driver'|'value'>):BridgeTerm {
  return {driver,value,...options};
}
export const cost=(driver:string,value:Value)=>bridgeInput(driver,value,{sign:-1});
export const bridgePeriodKey=(product:string,period:string)=>JSON.stringify([product,period]);

export class FinanceBridgeInputs {
  periods=new Map<string,BridgePeriod>();
  labor=new Map<Value,Factor>();
  rate?:Value;

  laborTerms(operations:Value[],other:Value[],scale:Decimal|null,sources:Value[]) {
    return [...operations,...other].map(operation=>{
      const factors=this.labor.get(operation);
      const factor=factors?{quantity:scale&&factors.quantity?.mul(scale)||null,rate:factors.rate}:undefined;
      return bridgeInput('labor',operation,{sign:-1,identity:operation.out.id,multiplier:scale,sources,factor,factorKind:'labor'});
    });
  }
}
