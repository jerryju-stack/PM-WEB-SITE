import {addBusinessRecord} from '../../lib/finance-business.ts';
import type {FinanceFxSnapshot} from '../../lib/finance-fx.ts';
import {fixedValue} from './finance-p08.ts';
import {laborScenario} from './finance-p06.ts';

export const testFx:FinanceFxSnapshot={base:'USD',date:'2026-11-18',period:null,
  rates:{CNY:'7.20',EUR:'0.90',JPY:'150'},source:'test',note:'Synthetic acceptance rates only'};

export function mixedFxScenario(europeanPrice=90,fx=testFx) {
  const s=laborScenario();
  s.name='TEST · Four currency forecast';
  s.currency='USD';
  s.policy.fx=structuredClone(fx);
  s.policy.currencyScales.EUR=2;
  s.markets=[{key:'us',label:'United States',metadata:{productKey:'product-a'}}];
  for(const row of s.inputs)if(row.metricKey==='hourly_rate'||row.metricKey==='cash_adjustment')row.value={coefficient:'0',scale:row.value.scale};
  const base={collection:'business',productKey:'product-a',marketKey:'us'};
  addBusinessRecord(s,{...base,recordType:'commercial',reference:'Test US sales',currency:'USD',
    values:{vehicles:fixedValue(1),configuration:fixedValue(1),units_per_vehicle:fixedValue(1),sales_price:fixedValue(500)}},['year-1']);
  for(const [partNumber,currency,price] of [['EU-PART','EUR',europeanPrice],['JP-PART','JPY',15000]] as const)
    addBusinessRecord(s,{...base,recordType:'bom',partNumber,reference:'Test '+partNumber,currency,
      values:{part_quantity:fixedValue(1),part_price:fixedValue(price),landed_adjustment:fixedValue(0)}},['year-1']);
  addBusinessRecord(s,{...base,marketKey:null,recordType:'factory',reference:'Test China factory',currency:'CNY',
    values:{fixed:fixedValue(720)}},['year-1']);
  s.events.push({key:'test-budget',module:'budget',kind:'budget',periodKey:'year-1',productKey:'product-a',marketKey:null,lineKey:null,
    sourceKey:s.sources[0].key,amount:fixedValue(72000,2),currency:'CNY',eventDate:null,relatedKey:null,evidenceKey:'TEST-BUDGET'});
  return s;
}
