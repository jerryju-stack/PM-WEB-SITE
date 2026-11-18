import {laborScenario} from './finance-p06.ts';
import type {DevelopmentModule} from '../../lib/finance-development.ts';
import type {FinanceSnapshot} from '../../lib/finance-contracts.ts';

export function p10Scenario():FinanceSnapshot {
  const s=laborScenario();
  s.periods[1].metadata.calendarYear=2027;
  s.periods.push({key:'year-2',label:'2028',metadata:{ordinal:2,calendarYear:2028}});
  s.inputs.push(...s.inputs.filter(row=>row.periodKey==='year-1').map(row=>({...row,key:row.key+':year-2',periodKey:'year-2'})));
  s.events.push({key:'dev-budget',module:'engineering',productKey:'product-a',marketKey:null,lineKey:null,periodKey:'year-1',sourceKey:s.sources[0].key,
    kind:'budget',amount:{coefficient:'1000000',scale:2},currency:'CNY',eventDate:null,relatedKey:null,evidenceKey:'SYN-T4-DEVELOPMENT-BUDGET'});
  return s;
}

export const addCost=(module:DevelopmentModule,costRef:string,record:Record<string,unknown>)=>({
  collection:'development',action:'new',module,costRef,record:{
    period:'year-1',paymentPeriod:'year-1',reference:'Synthetic quotation '+costRef,allocationBasis:'Dedicated product',
    allocations:[{productKey:'product-a',share:'1'}],coverage:[],recovery:{method:'none'},...record
  }
});
export const packageCost=addCost('validation','T4-DV-PACKAGE',{title:'DV Package',group:'DV-01',category:'package',stage:'DV',quantity:'1',components:{rate:'5000'}});
export const prototypeCost=(packageKey:string)=>addCost('prototypes','T4-SAMPLE-BATCH',{title:'T4 Sample Batch',group:'SAMPLE-01',category:'sample',quantity:'4',
  components:{material:'200',processing:'60',labor:'20',expedite:'10',freight:'10'},coverage:[{provider:packageKey,quantity:'4'}]});
export const retestCost=addCost('validation','T4-RETEST',{title:'T4 Retest',group:'PV-02',category:'retest',stage:'PV',quantity:'0',components:{rate:'2000'}});
export const engineeringCost=addCost('engineering','DEV-PM-ZERO',{title:'PM Planning Hours',group:'Concept',category:'labor',role:'Project Manager',
  quantity:'5',components:{rate:'100',travel:'25'},period:'year-0',paymentPeriod:'year-0'});
