import type {CalculationOutput,CalculationReport} from './finance-calculation-types.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {archived} from './finance-business.ts';
import {Decimal,sum} from './finance-decimal.ts';
import {capitalAssets,capitalCurrency,capitalLines,capitalOrdinal,capitalQuoteRows,capitalRows,resolveAssetGross} from './finance-capital.ts';
import type {CapitalRecord} from './finance-capital.ts';
import type {CapitalCashEvent} from './finance-capital-calculation.ts';

const q=Decimal.from;
const exact=(output:CalculationOutput)=>output.exact?new Decimal(BigInt(output.exact.numerator),BigInt(output.exact.denominator)):null;
export function capitalWorkspace(s:FinanceSnapshot,report:CalculationReport,product:string|null,source:string|null,showAssets:boolean){
  const currency=capitalCurrency(s),scale=s.policy.currencyScales[currency],assetRows=capitalAssets(s),rows=capitalRows(s),isArchive=archived(s);
  const quotes=showAssets?capitalQuoteRows(s):[],known=new Map(assetRows.map(row=>[row.key,row.conversion.capital]));
  const inProduct=(record:CapitalRecord)=>!product||record.kind==='valuation'||(record.kind==='terms'?record.productKey===product:
    (record.kind==='asset'?record:known.get(record.assetKey))?.allocations.some(item=>item.productKey===product));
  const scopes=rows.filter(row=>inProduct(row.conversion.capital)||[row.key,'edit-'+row.key].includes(source??''));
  const assets=assetRows.map(row=>{
    const record=row.conversion.capital,{amount,quote}=resolveAssetGross(s,record,quotes);
    const share=sum(record.allocations.map(item=>q(item.share)));
    const linked=s.inputs.find(item=>item.metricKey==='p09.design'&&record.lineId&&
      (item.conversion.operations as {lines:{line:string}[]}).lines.some(line=>line.line===record.lineId));
    return {key:row.key,record,amount:amount?.text(scale)??null,allocated:amount?.mul(share).text(scale)??null,
      incremental:record.mode==='new'?amount?.mul(share).text(scale)??null:q(0).text(scale),
      quote:quote?{key:quote.key,period:quote.periodKey,product:quote.productKey,market:quote.marketKey,reference:quote.conversion.label}:null,
      line:record.lineId?{key:linked?.key??null,period:linked?.periodKey??null,product:linked?.productKey??record.allocations[0].productKey}:null};
  });
  const sourceIndex=new Map(s.sources.map(row=>[row.key,row]));
  const archiveRows=isArchive?s.inputs.filter(row=>(!product||row.productKey===product||[row.key,'edit-'+row.key].includes(source??''))&&
    ['cqa.cqa_incremental.building','cqa.cqa_incremental.machining_forming','cqa.cqa_incremental.assembly','cqa.cqa_incremental.dunnage_packaging',
     'cqa.cqa_incremental.in_house_tooling','cqa.cqa_incremental.supplier_tooling','cqa.cqa_incremental.capex_300','cqa.cqa_incremental.investment_recovery'].includes(row.metricKey)&&q(row.value).n!==0n)
    .map(row=>{
      const original=sourceIndex.get(row.sourceKey);
      return {key:row.key,product:row.productKey,period:row.periodKey,amount:q(row.value).text(scale),reference:original?.sheet+'!'+original?.cell,
        kind:row.metricKey.endsWith('investment_recovery')?'receipt' as const:'payment' as const};
    }):[];
  const actualEvents=Object.values(report.outputs).flatMap(output=>{
    const event=output.details.capitalEvent as CapitalCashEvent|undefined;
    const amount=event?exact(output):null;
    return event&&amount&&amount.n!==0n&&(!product||output.productScope.includes(product))?
      [{...event,id:output.id,period:output.periods[0],product:output.productScope[0],amount:amount.text(scale)}]:[];
  });
  const events=[...actualEvents,...archiveRows.map(row=>({...row,id:row.key,label:row.reference,actual:false}))].sort((a,b)=>
    capitalOrdinal(s,a.period)-capitalOrdinal(s,b.period)||a.key.localeCompare(b.key));
  const result=product?report.products[product]:{periodic:report.periodic,metrics:report.metrics};
  const archiveAssumptions=isArchive?s.products.filter(p=>p.metadata.active!==false&&(!product||p.key===product)).map(p=>{
    const sheet=String(p.metadata.externalKey);
    const value=(cell:string)=>{
      const source=s.sources.find(row=>row.sheet===sheet&&row.cell===cell);
      const cached=source?.metadata.excel as {state:string;value:string}|undefined;
      return {reference:sheet+'!'+cell,value:cached?.state==='number'?cached.value:null};
    };
    return {product:p.key,inventory:value('D446'),ar:value('D447'),ap:value('D448'),tax:value('C329'),discount:value('C330')};
  }):[];
  const metrics=result?.metrics??{};
  const keys=['reported_profit','incremental_profit','depreciation','incremental_depreciation','capital_payments','capital_receipts','capital_net','capital_salvage',
    'capital_piece_cash','capital_piece_earned','capital_receivable','capital_agreed','capital_actual_receipts','receivables','inventory','payables','nwc','nwc_change','signed_tax','cash_flow','cumulative_cash','present_value'];
  return {currency,isArchive,rows:scopes.map(row=>({key:row.key,record:row.conversion.capital})),assets,archiveRows,events,archiveAssumptions,
    accounting:report.periods.map((period,i)=>({period,metrics:Object.fromEntries(keys.map(key=>[key,compact(result?.periodic[i]?.[key])]))})),
    totals:Object.fromEntries(['operating_profit','cqa.mpbitri','incremental_profit','discount_rate','npv','irr','payback_period','peak_funding_requirement',
      'capital_gross','capital_allocated','capital_new','capital_payments','capital_receipts','capital_agreed','capital_net','capital_salvage'].map(key=>[key,compact(metrics[key])])),
    fundingPeriod:typeof metrics.peak_funding_requirement?.details.firstPeriod==='string'?metrics.peak_funding_requirement.details.firstPeriod:null,
    recoveryPeriod:typeof metrics.payback_period?.details.recoveryPeriod==='string'?metrics.payback_period.details.recoveryPeriod:null,
    quoteOptions:quotes.filter(row=>!row.conversion.archiveCapitalized).map(row=>({key:row.conversion.assetKey!,label:row.conversion.label})),
    archivedTools:quotes.filter(row=>row.conversion.archiveCapitalized).filter(row=>!product||row.productKey===product).map(row=>
      ({assetId:row.conversion.assetKey!,key:row.key,label:row.conversion.label,period:row.periodKey,market:row.marketKey,product:row.productKey})),
    lines:capitalLines(s)
  };
}
function compact(output:CalculationOutput|undefined){
  return output?{value:output.value,displayValue:output.displayValue,unit:output.unit,status:output.status}:null;
}
