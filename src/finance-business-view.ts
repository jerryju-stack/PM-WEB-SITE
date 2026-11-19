import {escapeHtml as html,financeUrl} from '/finance-view.js';
import type {Workspace} from '/finance-view.js';

type Link=(key:string,filters?:Record<string,string|null>)=>string;
type Input=Workspace['inputs'][number];
const format=(value:string|null,decimals=0)=>value===null?'—':
  new Intl.NumberFormat('en',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(Number(value));
const decimal=(entry:Input|undefined)=>entry?
  String(Number(entry.value.coefficient)/10**entry.value.scale):null;
const cell=(value:string)=>'<td>'+html(value)+'</td>';
const head=(fields:string[])=>fields.map(field=>'<th scope="col">'+html(field)+'</th>').join('');
const table=(label:string,fields:string[],rows:string)=>'<div class="fin-table-scroll" tabindex="0" role="region" aria-label="'+html(label)+
  '"><table><thead><tr>'+head(fields)+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
const panel=(title:string,body:string)=>'<section class="fin-panel fin-business-overview"><h2>'+html(title)+'</h2>'+body+'</section>';

export function commercialOverview(data:NonNullable<Workspace['commercial']>,product:string,market:string,period:string,
  productLabel:(key:string)=>string,marketLabel:(key:string|null)=>string,link:Link) {
  const variants=data.markets.filter(row=>(!product||row.product===product)&&(!market||row.market===market));
  const scoped=data.products.filter(row=>!product||row.key===product);
  const rows=scoped.map(row=>{
    const values=row.years.map(year=>market?variants.find(item=>item.product===row.key&&item.period===year.period):year);
    return '<tbody><tr><th class="fin-annual-product" scope="rowgroup" rowspan="2">'+html(row.label)+'</th>'+
      '<th scope="row">Volume</th>'+values.map(cellValue=>cell(format(cellValue?.volume??null))).join('')+'</tr>'+
      '<tr><th scope="row">'+(market?'Market price':'Unit price')+'</th>'+
      values.map(cellValue=>cell(format(cellValue?.unitPrice??null,2))).join('')+'</tr></tbody>';
  }).join('');
  const productionPeriods=new Set(data.periods.map(item=>item.key));
  const marketRows=variants.filter(row=>period?row.period===period:productionPeriods.has(row.period));
  const details=marketRows.length?table('Market prices and volume',
    ['Product','Market','Period','Vehicle demand','Configuration','Units per vehicle','Forecast pieces','Original unit price','Forecast sales'],marketRows.map(row=>{
      const title=marketLabel(row.market),year=row.periodLabel;
      const price=row.originalPrice===null?'—':format(row.originalPrice,5)+' '+row.originalCurrency;
      const quoteLink=row.quoteKey?financeUrl(link(row.quoteKey,{product:row.product,market:row.market,period:row.period}),price,'commercial-quote-'+row.quoteKey):html(price);
      return '<tr><th scope="row">'+html(productLabel(row.product??''))+'</th>'+cell(title)+cell(year)+cell(format(row.demand))+
        cell(row.configuration===null?'—':format(row.configuration,2)+'%')+cell(format(row.units,2))+cell(format(row.volume))+
        '<td>'+quoteLink+'</td>'+cell(row.revenue===null?'—':format(row.revenue,2)+' '+data.currency)+'</tr>';
    }).join('')):'<p class="fin-muted">There are no market quotes for this scope.</p>';
  return panel('Volume and selling price by year',
    '<p class="fin-muted">Volume in pieces · '+(market?'Prices':'Volume-weighted prices')+' in '+html(data.currency)+' per piece.</p>'+
    (rows&&data.periods.length?'<div class="fin-table-scroll fin-annual-scroll" tabindex="0" role="region" aria-label="Annual volume and selling prices">'+
      '<table class="fin-annual-table"><thead><tr>'+head(['Product','Metric',...data.periods.map(item=>item.label)])+'</tr></thead>'+rows+'</table></div>':
      '<p class="fin-muted">No production forecast is available for this version.</p>'))+
    panel('Market assumptions and quotes','<details'+(market||period?' open':'')+'><summary>View market details</summary>'+
      '<p class="fin-muted">Quoted prices remain available when market volume is zero. Open a quoted price to preview a change for its market and period.</p>'+details+'</details>');
}

export function purchasingOverview(inputs:Input[],term:string,periodName:string,marketLabel:(key:string|null)=>string,
  currency:string,link:Link,toolingLink:Link,curve:Workspace['materialSchedule'],
  periodLabel:(key:string)=>string,productLabel:(key:string)=>string) {
  const groups=new Map<string,Input[]>();
  for(const row of inputs){
    if(!row.business)continue;
    const key=row.business.businessGroup+':'+row.periodKey;
    const parts=groups.get(key)??[];
    parts.push(row);
    groups.set(key,parts);
  }
  const traceRow=(row:Input)=>{
    const reference=row.source?.sheet&&row.source?.cell?row.source.sheet+'!'+row.source.cell:row.source?.reference??'';
    const address=/^([^!]{1,100})!\$?[A-Z]{1,3}\$?(\d+)/.exec(reference);
    return address?[row.productKey,row.marketKey,row.periodKey,address[1],address[2]].join('|'):null;
  };
  const grouped=[...groups.values()];
  const recurringBySource=new Map<string,Input[][]>();
  for(const parts of grouped){
    const key=traceRow(parts[0]);
    if(!key||!parts.some(part=>part.business?.businessField==='part_quantity'))continue;
    const same=recurringBySource.get(key)??[];
    same.push(parts);
    recurringBySource.set(key,same);
  }
  const separate=grouped.filter(parts=>{
    const key=traceRow(parts[0]),candidate=key?recurringBySource.get(key):undefined;
    if(parts.length!==1||parts[0].business?.businessField!=='tooling'||candidate?.length!==1||
      candidate[0].some(part=>part.business?.businessField==='tooling'))return true;
    candidate[0].push(parts[0]);
    return false;
  });
  const rows=separate.flatMap(parts=>{
    const first=parts[0],part=typeof first.business?.partNumber==='string'?first.business.partNumber:first.business?.label??first.key;
    const reference=[first.source?.sheet,first.source?.cell].filter(Boolean).join('!')||first.source?.reference||'';
    const supplier=typeof first.business?.supplier==='string'?first.business.supplier:parts
      .map(part=>part.source?.reference?.match(/\bSUP[_-][A-Za-z0-9_-]+\b/)?.[0]).find(Boolean);
    if(term&&![part,supplier,reference,first.business?.label].some(value=>value?.toLowerCase().includes(term.toLowerCase())))return [];
    const field=(key:string)=>parts.find(row=>row.business?.businessField===key);
    const quote=field('part_price'),quantity=field('part_quantity'),adjustment=field('landed_adjustment'),tooling=field('tooling');
    return ['<tr><th scope="row">'+financeUrl(link((quote??tooling??first).key),part,'procurement-'+first.key)+'</th>'+
      cell(marketLabel(first.marketKey))+cell(supplier??'Not provided')+cell(format(decimal(quantity),2))+
      cell(quote?format(decimal(quote),4)+' '+quote.currency:'—')+
      cell(adjustment?format(decimal(adjustment),4)+' '+adjustment.currency:'—')+
      cell(quote?.landed==null?'—':format(quote.landed,4)+' '+currency)+
      '<td>'+(tooling?financeUrl(toolingLink(tooling.key),format(decimal(tooling),2)+' '+tooling.currency):'—')+'</td>'+
      cell(reference||'—')+'</tr>'];
  });
  const quotes=panel('BOM quotes and landed cost',
    '<p class="fin-muted">'+html(periodName)+' · Landed inputs in '+html(currency)+'. Tooling quotes are listed separately from per-piece contributions.</p>'+
    (rows.length?table('BOM quotes',['Part / source','Market','Supplier','Usage','Original quote / part','Adjustment / part',
      'Landed / assembled piece','One-time tooling','Evidence'],rows.join('')):
      '<p class="fin-muted">No item quotations match the selected period and market. Later-period materials may have only an annual cost curve.</p>'));
  if(!curve.length)return quotes;
  return quotes+panel('Annual material cost per piece',table('Annual material costs',['Product','Year','Unit material cost','Source coverage'],
    curve.map(row=>'<tr><th scope="row">'+html(productLabel(row.product))+'</th>'+cell(periodLabel(row.period))+
      cell(format(row.unitCost,4)+' '+row.currency)+cell(row.hasItemQuotes?'Item quotes available':'Annual cost curve only')+'</tr>').join('')));
}

export function factoryOverview(costs:Workspace['factoryCosts'],period:string,productLabel:(key:string)=>string,link:Link) {
  if(!costs.length)return '';
  return panel('Factory cost and launch by period',
    '<p class="fin-muted">'+html(period)+' · Fixed and launch amounts apply to the selected period. Per-piece cost requires positive volume.</p>'+
    table('Factory cost breakdown',['Product','Expense','Cost basis','Period total','Per piece','Original assumption'],costs.map(row=>
      '<tr><th scope="row">'+html(productLabel(row.product))+'</th><td>'+
      (row.inputKey?financeUrl(link(row.inputKey),row.label,'factory-cost-'+row.inputKey):html(row.label))+'</td>'+
      cell(row.basis)+cell(row.total===null?'—':format(row.total,2)+' '+row.currency)+
      cell(row.unit===null?'—':format(row.unit,4)+' '+row.currency+'/piece')+
      cell(row.original===null?'Source schedule':row.originalUnit==='fraction'?
        format(String(Number(row.original)*100),2)+'%':row.original+' '+row.originalUnit)+'</tr>').join('')));
}
