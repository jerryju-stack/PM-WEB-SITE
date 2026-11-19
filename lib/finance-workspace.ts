import type {FinanceSnapshot} from './finance-contracts.ts';
import type {CalculationOutput, CalculationReport} from './finance-calculation-types.ts';
import {compareCalculations} from './finance-calculation.ts';

const periodFields=['cash_flow','cumulative_cash','present_value','reported_revenue','reported_profit'];
const selectRows=(rows:Record<string,CalculationOutput>[])=>rows.map(row=>Object.fromEntries(periodFields.filter(key=>row[key]).map(key=>[key,row[key]])));
const labels=(items:FinanceSnapshot['periods'])=>items.map(({key,label})=>({key,label}));

// Sources and the full export use the original report. A screen only needs amounts and trace handles.
const dashboardMetrics=['revenue','total_cost','cqa.mpbitri','full_cost_management_profit','operating_profit','operating_margin',
  'npv','irr','payback_period','peak_funding_requirement'];
export type ScreenMetric=Pick<CalculationOutput,'id'|'metricKey'|'value'|'displayValue'|'status'|'unit'|'details'>&{hasSources:boolean};
export function screenMetric({id,metricKey,value,displayValue,status,unit,details,upstreamInputs}:CalculationOutput):ScreenMetric {
  return {id,metricKey,value,displayValue,status,unit,details,hasSources:upstreamInputs.length>0};
}
function screenRow(row:Record<string,CalculationOutput>,keys:string[]):Record<string,ScreenMetric> {
  return Object.fromEntries(keys.filter(key=>row[key]).map(key=>[key,screenMetric(row[key])]));
}

export function screenReport(snapshot:FinanceSnapshot,report:CalculationReport,section:string) {
  const dashboard=section==='',cash=dashboard||section==='returns';
  const measures=dashboard?dashboardMetrics:section==='returns'?['peak_funding_requirement','payback_period']:[];
  const rows=(values:CalculationReport['periodic'])=>cash?values.map(row=>screenRow(row,periodFields)):[];
  return {asOf:report.asOf,currency:report.currency,basis:report.basis,calculationVersion:report.calculationVersion,
    model:snapshot.policy.rules.model,periods:report.periods.map(key=>({key,label:snapshot.periods.find(p=>p.key===key)?.label??key})),
    productLabels:labels(snapshot.products.filter(product=>report.productScope.includes(product.key))),
    metrics:screenRow(report.metrics,measures),
    budget:screenRow(report.budget,section==='budget'?Object.keys(report.budget):dashboard?['draft_allocation','draft_cost']:[]),
    periodic:rows(report.periodic),products:cash?Object.fromEntries(Object.entries(report.products).map(([key,product])=>
      [key,{metrics:screenRow(product.metrics,measures),periodic:rows(product.periodic)}])):{}};
}

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
