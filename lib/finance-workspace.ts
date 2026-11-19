import type {FinanceSnapshot} from './finance-contracts.ts';
import type {CalculationOutput, CalculationReport} from './finance-calculation-types.ts';
import {compareCalculations} from './finance-calculation.ts';

const periodFields=['cash_flow','cumulative_cash','present_value','reported_revenue','reported_profit'];
const selectRows=(rows:Record<string,CalculationOutput>[])=>rows.map(row=>Object.fromEntries(periodFields.filter(key=>row[key]).map(key=>[key,row[key]])));
const labels=(items:FinanceSnapshot['periods'])=>items.map(({key,label})=>({key,label}));

// Deliver dashboard detail and traceable sources without shipping the raw imported workbook or the entire graph.
export function workspaceReport(snapshot:FinanceSnapshot,report:CalculationReport) {
  const periodic=selectRows(report.periodic);
  const products=Object.fromEntries(Object.entries(report.products).map(([key,value])=>[key,{metrics:value.metrics,periodic:selectRows(value.periodic)}]));
  const inputIds=new Set<string>();
  const collect=(row:Record<string,CalculationOutput>)=>Object.values(row).forEach(metric=>metric.upstreamInputs.forEach(id=>inputIds.add(id)));
  collect(report.metrics);collect(report.budget);periodic.forEach(collect);
  for(const product of Object.values(products)){collect(product.metrics);product.periodic.forEach(collect);}
  return {asOf:report.asOf,currency:report.currency,basis:report.basis,calculationVersion:report.calculationVersion,
    model:snapshot.policy.rules.model,
    periods:report.periods.map(key=>({key,label:snapshot.periods.find(period=>period.key===key)?.label??key})),
    productLabels:labels(snapshot.products.filter(product=>report.productScope.includes(product.key))),
    metrics:report.metrics,budget:report.budget,periodic,products,
    inputs:Object.fromEntries([...inputIds].filter(id=>report.inputs[id]).map(id=>[id,report.inputs[id]]))};
}

export function workspaceComparison(before:CalculationReport,after:CalculationReport) {
  // The P06 pure comparison still handles unrounded differences and incompatible scopes.
  const project=(report:CalculationReport)=>({...report,periodic:selectRows(report.periodic),
    products:Object.fromEntries(Object.entries(report.products).map(([key,value])=>[key,{metrics:value.metrics,periodic:selectRows(value.periodic)}]))});
  const comparison=compareCalculations(project(before),project(after));
  const deltas=(values:typeof comparison.metrics)=>Object.fromEntries(Object.entries(values).map(([key,{delta}])=>[key,
    {displayValue:delta.displayValue,value:delta.value,unit:delta.unit,status:delta.status}]));
  return {compatible:comparison.compatible,metrics:deltas(comparison.metrics),budget:deltas(comparison.budget),
    periodic:comparison.periodic.map(deltas),products:Object.fromEntries(Object.entries(comparison.products).map(([key,value])=>
      [key,{metrics:deltas(value.metrics),periodic:value.periodic.map(deltas)}]))};
}
