import {p10Scenario} from './finance-p10.ts';

export function p11Scenario(){
  const snapshot=p10Scenario();
  snapshot.events=[];
  for(const row of snapshot.inputs.filter(input=>['volume','cash_adjustment'].includes(input.metricKey)))row.value={...row.value,coefficient:'0'};
  return snapshot;
}
export const capitalRange={from:'year-0',to:'year-2'};
export const t5Asset={kind:'asset',assetId:'T5-EQUIPMENT',title:'T5 Assembly Equipment',category:'equipment',mode:'new',gross:'10000',residual:'0',life:'2',
  purchaseReference:'Synthetic PO T5-01',meReference:'Synthetic ME specification',lineId:'line-a',basis:'Dedicated project equipment',
  allocations:[{productKey:'product-a',share:'1'}],orderPeriod:'year-0',servicePeriod:'year-1',
  payments:[{id:'PO-T5-DEPOSIT',period:'year-0',share:'1',reference:'Synthetic capital payment T5-01'}]};
export const t5Agreement=(assetKey:string)=>({kind:'recovery',agreementId:'T5-COMPENSATION',assetKey,title:'T5 Customer Compensation',
  reference:'Synthetic customer contract T5-C',agreementPeriod:'year-0',amount:'10000',receiptPeriod:'year-1',
  receivable:{period:'year-1',amount:'10000',reference:'Synthetic receivable T5-AR'},receipts:[],piece:null});
export const capitalChange=(record:Record<string,unknown>,key?:string)=>({collection:'capital',...(key?{key}:{}),record});
