import {p10Scenario} from './finance-p10.ts';

export function p12Scenario(){
  const snapshot=p10Scenario();snapshot.events=[];
  return snapshot;
}
export const p12Range={from:'year-0',to:'year-2'};
export const budgetCommand=(action:string,record:Record<string,unknown>,key?:string)=>({collection:'budget_execution',action,record,...(key?{key}:{})});
export const t6Policy=budgetCommand('policy',{currency:'CNY',taxBasis:'exclusive',recognition:'service_acceptance',reference:'Synthetic T6 scope policy'});
export const t6Scope=budgetCommand('scope',{scopeId:'T6-SERVICES',title:'T6 Engineering Services',productKey:'product-a',reference:'Synthetic service package scope'});
export const money=(amount:number,scale=2)=>({coefficient:String(amount*10**scale),scale});
export const t6Allocation=(scope:string)=>budgetCommand('allocation',{scope,period:'year-1',documentId:'T6-ALLOC-1',title:'T6 Budget Allocation',
  amount:money(1000),reference:'Synthetic approved funding'});
export const t6Cost=(scope:string,amount:number,documentId:string,title:string,period='year-1',date='2027-03-04',relatedKey:string|null=null)=>
  budgetCommand('cost',{scope,period,date,documentId,title,relatedKey,amount:money(amount),reference:'Synthetic occurrence '+documentId});
export const t6Forecast=(scope:string,amount=500,period='year-1')=>budgetCommand('etc',{scope,amount:money(amount),period,reference:'Synthetic remaining scope forecast'});
export const t6Confirm=(key:string)=>budgetCommand('confirm',{reference:'Synthetic independent confirmation'},key);
