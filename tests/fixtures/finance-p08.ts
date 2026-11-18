import {addBusinessRecord} from '../../lib/finance-business.ts';
import type {FixedDecimal} from '../../lib/finance-contracts.ts';
import {laborScenario} from './finance-p06.ts';

export const fixedValue=(coefficient:number,scale=0):FixedDecimal=>({coefficient:String(coefficient),scale});
export function p08Scenario() {
  const snapshot=laborScenario();
  snapshot.name='P08 Scenario';
  snapshot.markets=[{key:'eu',label:'Europe',metadata:{productKey:'product-a'}},{key:'na',label:'North America',metadata:{productKey:'product-a'}}];
  const commercial={collection:'business',recordType:'commercial',productKey:'product-a',marketKey:'eu',
    reference:'Sales quote EU-1',currency:'CNY',values:{vehicles:fixedValue(1000),units_per_vehicle:fixedValue(1),
      configuration:fixedValue(1),sales_price:fixedValue(20)}};
  const part={collection:'business',recordType:'bom',productKey:'product-a',marketKey:'eu',partNumber:'T3-CLIP',
    reference:'Supplier quote Q-01',currency:'CNY',assetKey:'tool:T3-CLIP:01',values:{part_quantity:fixedValue(2),
      part_price:fixedValue(4),landed_adjustment:fixedValue(0),tooling:fixedValue(700)}};
  const factory={collection:'business',recordType:'factory',productKey:'product-a',marketKey:null,
    reference:'Plant plan F-01',currency:'CNY',values:{variable:fixedValue(1),fixed:fixedValue(100),
      scrap:fixedValue(0),warranty:fixedValue(0),packaging:fixedValue(0),launch:fixedValue(0),allocation:fixedValue(50)}};
  for(const record of [commercial,part,factory])addBusinessRecord(snapshot,record,['year-1']);
  return snapshot;
}
