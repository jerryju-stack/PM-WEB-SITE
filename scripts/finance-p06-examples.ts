/** Public examples; expected values are independently computed by Python, not this engine. */
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {cashScenario,laborScenario,laborChange} from '../tests/fixtures/finance-p06.ts';

export function publicExamples() {
  const t1=calculateFinance(cashScenario()),s=laborScenario(),before=calculateFinance(s),after=calculateFinance(applyFinanceChanges(s,laborChange.changeSet,laborChange.effectivePeriod).candidate),diff=compareCalculations(before,after);
  const metric=(key:string)=>({value:t1.metrics[key].value,display:t1.metrics[key].displayValue,status:t1.metrics[key].status,unit:t1.metrics[key].unit});
  return {calculationVersion:t1.calculationVersion,inputs:{T1:{cash:['-100','60','60'],annualDiscountRate:'0.10',productCash:[['-80','40','50'],['-20','20','10']]},T2:{people:2,ctBefore:30,ctAfter:36,hourlyRate:60,efficiency:1,goodUnitsPerCycle:1,annualVolume:10000,paymentOrdinal:1,annualDiscountRate:'0.10',otherCashChanges:0}},
    T1:{npv:metric('npv'),irr:metric('irr'),payback_period:metric('payback_period'),peak_funding_requirement:metric('peak_funding_requirement'),peakOrdinal:t1.metrics.peak_funding_requirement.details.firstOrdinal},
    T2:{unit_labor_before:before.products['product-a'].periodic[1].unit_labor.value,unit_labor_after:after.products['product-a'].periodic[1].unit_labor.value,
      annual_labor_change:diff.products['product-a'].periodic[1].labor.delta.value,operating_profit_change:diff.metrics.operating_profit.delta.value,
      cash_flow_change:diff.periodic[1].cash_flow.delta.value,npv_change:diff.metrics.npv.delta.value,npv_change_display:diff.metrics.npv.delta.displayValue}};
}
