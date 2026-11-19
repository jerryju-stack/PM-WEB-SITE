import type {CalculationOutput,CalculationReport} from './finance-calculation-types.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {archived} from './finance-business.ts';
import {Decimal,sum} from './finance-decimal.ts';
import {capitalAssets,capitalCurrency,capitalEstimates,capitalLines,capitalOrdinal,capitalQuoteRows,capitalRows,resolveAssetGross} from './finance-capital.ts';
import type {CapitalRecord} from './finance-capital.ts';
import type {CapitalCashEvent} from './finance-capital-calculation.ts';
import {caseFinanceRate} from './finance-fx.ts';

const q=Decimal.from;
const exact=(output:CalculationOutput)=>output.exact?new Decimal(BigInt(output.exact.numerator),BigInt(output.exact.denominator)):null;
export function capitalWorkspace(s:FinanceSnapshot,report:CalculationReport,product:string|null,source:string|null,showAssets:boolean){
  const currency=capitalCurrency(s),scale=s.policy.currencyScales[currency],assetRows=capitalAssets(s),rows=capitalRows(s),isArchive=archived(s);
  const quotes=showAssets?capitalQuoteRows(s):[],known=new Map(assetRows.map(row=>[row.key,row.conversion.capital]));
  const inProduct=(record:CapitalRecord)=>!product||record.kind==='valuation'||(record.kind==='terms'||record.kind==='estimate'?record.productKey===product:
    (record.kind==='asset'?record:known.get(record.assetKey))?.allocations.some(item=>item.productKey===product));
  const scopes=rows.filter(row=>inProduct(row.conversion.capital)||[row.key,'edit-'+row.key].includes(source??''));
  const assets=assetRows.map(row=>{
    const record=row.conversion.capital,{amount:gross,quote}=resolveAssetGross(s,record,quotes),originalCurrency=row.currency??currency;
    const rate=record.gross===null?null:caseFinanceRate(s,originalCurrency,currency,record.orderPeriod);
    const amount=record.gross===null?gross:rate?.mul(q(record.gross))??null;
    const share=sum(record.allocations.map(item=>q(item.share)));
    const linked=s.inputs.find(item=>item.metricKey==='p09.design'&&record.lineId&&
      (item.conversion.operations as {lines:{line:string}[]}).lines.some(line=>line.line===record.lineId));
    const original=quote?q(quote.value):record.gross===null?null:q(record.gross);
    return {key:row.key,record,originalCurrency,sourceCurrency:quote?.currency??originalCurrency,
      originalAmount:original?.text(s.policy.currencyScales[quote?.currency??originalCurrency])??null,
      exchangeRate:(quote?caseFinanceRate(s,quote.currency??currency,currency,quote.periodKey):rate)?.text(8)??null,
      amount:amount?.text(scale)??null,allocated:amount?.mul(share).text(scale)??null,
      incremental:record.mode==='new'?amount?.mul(share).text(scale)??null:q(0).text(scale),
      quote:quote?{key:quote.key,period:quote.periodKey,product:quote.productKey,market:quote.marketKey,reference:quote.conversion.label}:null,
      line:record.lineId?{key:linked?.key??null,period:linked?.periodKey??null,product:linked?.productKey??record.allocations[0].productKey}:null};
  });
  const sourceIndex=new Map(s.sources.map(row=>[row.key,row]));
  const estimateRows=showAssets?capitalEstimates(s):[];
  const estimateByQuote=new Map(estimateRows.flatMap(row=>row.conversion.capital.quoteKeys.map(key=>[key,row.key] as const)));
  const bookedQuotes=new Map(assets.flatMap(row=>row.quote?[[row.quote.key,row.key] as const]:[]));
  const estimateDetails=estimateRows.filter(row=>!product||row.productKey===product).map(row=>{
    const record=row.conversion.capital,from=row.currency??currency;
    const allocated=assetRows.filter(item=>item.conversion.capital.estimate?.key===row.key);
    const used=sum(allocated.map(item=>q(item.conversion.capital.estimate!.amount)));
    const balance=q(record.gross).sub(used);
    const identified=sum(quotes.filter(quote=>estimateByQuote.get(quote.key)===row.key&&!bookedQuotes.has(quote.key)).map(quote=>q(quote.value)));
    const remainder=balance.sub(identified);
    const unidentified=remainder.n>0n?remainder:q(0);
    const rate=caseFinanceRate(s,from,currency,row.periodKey);
    return {key:row.key,record,originalCurrency:from,used:used.text(s.policy.currencyScales[from]),
      balance:balance.text(s.policy.currencyScales[from]),amount:rate?.mul(q(record.gross)).text(scale)??null,
      unbooked:rate?.mul(balance).text(scale)??null,unidentified:unidentified.text(s.policy.currencyScales[from]),
      unidentifiedAmount:rate?.mul(unidentified).text(scale)??null,assets:allocated.map(asset=>asset.key)};
  });
  const toolingQuotes=quotes.filter(row=>!product||row.productKey===product).map(row=>{
    const source=sourceIndex.get(row.sourceKey),from=row.currency??currency;
    const rate=caseFinanceRate(s,from,currency,row.periodKey);
    return {key:row.key,assetId:row.conversion.assetKey!,title:row.conversion.label,
      partNumber:typeof row.conversion.partNumber==='string'?row.conversion.partNumber:null,
      supplier:typeof row.conversion.supplier==='string'?row.conversion.supplier:
        source?.externalKey?.match(/\bSUP[_-][A-Za-z0-9_-]+\b/)?.[0]??null,
      product:row.productKey,market:row.marketKey,period:row.periodKey,originalCurrency:from,
      originalAmount:q(row.value).text(s.policy.currencyScales[from]),amount:rate?.mul(q(row.value)).text(scale)??null,
      reference:source?.sheet&&source.cell?source.sheet+'!'+source.cell:source?.externalKey??null,
      archived:!!row.conversion.archiveCapitalized,estimate:estimateByQuote.get(row.key)??null,
      asset:bookedQuotes.get(row.key)??null};
  });
  const scopedAssets=assets.filter(row=>scopes.some(scope=>scope.key===row.key));
  const totalAmounts=(values:(string|null)[])=>values.some(value=>value===null)?null:sum(values.map(value=>q(value!))).text(scale);
  const standaloneQuotes=toolingQuotes.filter(row=>!row.estimate&&!row.asset&&!row.archived);
  const recordedAssets=scopedAssets.filter(row=>!product||row.record.allocations.some(a=>a.productKey===product));
  const coveredAssets=recordedAssets.filter(row=>!row.record.estimate);
  const assetAmount=(row:typeof assets[number])=>product?row.amount&&q(row.amount).mul(
    q(row.record.allocations.find(a=>a.productKey===product)!.share)).text(scale):row.amount;
  const originalCompensation=showAssets?s.inputs.flatMap(row=>{
    if(row.metricKey!=='cash_adjustment'||product&&row.productKey!==product)return [];
    const source=sourceIndex.get(row.sourceKey);
    if(source?.system!=='template001'||!source.sheet)return [];
    const cell=Object.keys(source.metadata).find(key=>/^(?:[E-Z]|[A-Z]{2,3})342$/.test(key));
    const value=cell?source.metadata[cell]:null;
    if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value)||q(value).n<=0n)return [];
    return [{product:row.productKey,period:row.periodKey,amount:q(value).mul(q(1000)).text(scale),reference:source.sheet+'!'+cell}];
  }):[];
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
  const cashOnly=s.policy.rules.model==='cash_series';
  let previousSign=0;
  const cashEvidence=report.periods.map((period,i)=>{
    const output=result?.periodic[i]?.cash_flow,amount=output?exact(output):null;
    const sign=amount?(amount.n<0n?-1:amount.n>0n?1:0):null;
    const changed=!!sign&&previousSign!==0&&sign!==previousSign;
    if(sign)previousSign=sign;
    return {period,amount:amount?.text(18).replace(/\.?0+$/,'')??null,sign,changed};
  });
  const irr=metrics.irr;
  const irrValue=irr?exact(irr):null;
  const keys=['reported_profit','incremental_profit','depreciation','incremental_depreciation','capital_payments','capital_receipts','capital_net','capital_salvage',
    'capital_piece_cash','capital_piece_earned','capital_receivable','capital_agreed','capital_actual_receipts','receivables','inventory','payables','nwc','nwc_change','signed_tax','cash_flow','cumulative_cash','present_value'];
  return {currency,currencies:s.policy.currencyScales,isArchive,cashOnly,rows:scopes.map(row=>({key:row.key,record:row.conversion.capital,originalCurrency:row.currency??currency})),assets,archiveRows,events,archiveAssumptions,
    irrAudit:{rows:cashEvidence,status:irr?.status??'missing_input',message:typeof irr?.details.message==='string'?irr.details.message:null,
      precisionRate:irrValue?.mul(q(100)).text(6)??null,changes:cashEvidence.filter(row=>row.changed).length},
    accounting:report.periods.map((period,i)=>({period,metrics:Object.fromEntries(keys.map(key=>[key,compact(result?.periodic[i]?.[key])]))})),
    totals:Object.fromEntries(['operating_profit','full_cost_management_profit','cqa.mpbitri','incremental_profit','discount_rate','npv','irr','payback_period','peak_funding_requirement',
      'capital_gross','capital_allocated','capital_new','capital_payments','capital_receipts','capital_agreed','capital_actual_receipts','capital_net','capital_salvage'].map(key=>[key,compact(metrics[key])])),
    fundingPeriod:typeof metrics.peak_funding_requirement?.details.firstPeriod==='string'?metrics.peak_funding_requirement.details.firstPeriod:null,
    recoveryPeriod:typeof metrics.payback_period?.details.recoveryPeriod==='string'?metrics.payback_period.details.recoveryPeriod:null,
    quoteOptions:quotes.filter(row=>!row.conversion.archiveCapitalized).map(row=>({key:row.conversion.assetKey!,label:row.conversion.label})),
    archivedTools:quotes.filter(row=>row.conversion.archiveCapitalized).filter(row=>!product||row.productKey===product).map(row=>
      ({assetId:row.conversion.assetKey!,key:row.key,label:row.conversion.label,period:row.periodKey,market:row.marketKey,product:row.productKey})),
    estimateDetails,toolingQuotes,originalCompensation,
    inventoryTotals:{
      quoted:totalAmounts([...estimateDetails.map(row=>row.amount),...coveredAssets.map(assetAmount),...standaloneQuotes.map(row=>row.amount)]),
      booked:totalAmounts(recordedAssets.map(assetAmount)),
      pending:totalAmounts([...estimateDetails.map(row=>row.unbooked),...standaloneQuotes.map(row=>row.amount)]),
      quotedCompensation:originalCompensation.length?totalAmounts(originalCompensation.map(row=>row.amount)):null
    },
    lines:capitalLines(s)
  };
}
function compact(output:CalculationOutput|undefined){
  return output?{value:output.value,displayValue:output.displayValue,unit:output.unit,status:output.status}:null;
}
