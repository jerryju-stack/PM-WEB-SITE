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
const table=(label:string,fields:string[],rows:string,scrollClass='')=>'<div class="fin-table-scroll '+scrollClass+'" tabindex="0" role="region" aria-label="'+html(label)+
  '"><table><thead><tr>'+head(fields)+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
const panel=(title:string,body:string)=>'<section class="fin-panel fin-business-overview"><h2>'+html(title)+'</h2>'+body+'</section>';

type CommercialData=NonNullable<Workspace['commercial']>;
type SalesYear=Pick<CommercialData['products'][number]['years'][number],'volume'|'unitPrice'|'revenue'>;
type SalesSeries={product:string;market:string|null;label:string;years:(SalesYear|undefined)[]};
export type CommercialView='products'|'markets'|'quotes'|'inputs';

export function commercialOverview(data:CommercialData,product:string,market:string,period:string,view:CommercialView,
  productLabel:(key:string)=>string,marketLabel:(key:string|null)=>string,link:Link) {
  const variants=data.markets.filter(row=>(!product||row.product===product)&&(!market||row.market===market));
  if(view==='quotes'){
    const production=new Set(data.periods.map(item=>item.key));
    const rows=variants.filter(row=>period?row.period===period:production.has(row.period));
    return {summary:'',body:panel('Market assumptions and quotes',rows.length?
      '<p class="fin-muted">Select an original quote to see its source and available price-change actions.</p>'+
      '<div class="fin-market-quotes">'+table('Market prices and volume',['Market','Volume (pcs)','Original quote / piece','Forecast sales','Product','Period','Vehicle demand','Configuration','Units per vehicle'],rows.map(row=>{
        const price=row.originalPrice===null?'—':new Intl.NumberFormat('en',{minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(row.originalPrice))+' '+row.originalCurrency;
        const quote=row.quoteKey?financeUrl(link(row.quoteKey,{product:row.product,market:row.market,period:row.period,salesView:'quotes'}),price,'commercial-quote-'+row.quoteKey):html(price);
        return '<tr><th scope="row">'+html(marketLabel(row.market))+'</th>'+cell(format(row.volume))+'<td>'+quote+'</td>'+
          cell(row.revenue===null?'—':format(row.revenue,2)+' '+data.currency)+cell(productLabel(row.product??''))+cell(row.periodLabel)+
          cell(format(row.demand))+cell(row.configuration===null?'—':format(row.configuration,2)+'%')+cell(format(row.units,2))+'</tr>';
      }).join(''))+'</div>':'<p class="fin-muted">No market quotes are recorded for this selection.</p>')};
  }

  const periods=data.periods.filter(item=>!period||item.key===period);
  const series:SalesSeries[]=[];
  if(view==='markets'||market){
    const grouped=new Map<string,typeof variants>();
    for(const row of variants){
      if(!row.product||!periods.some(item=>item.key===row.period))continue;
      const key=JSON.stringify([row.product,row.market]);
      const group=grouped.get(key)??[];
      group.push(row);grouped.set(key,group);
    }
    for(const rows of grouped.values()){
      const first=rows[0],productKey=first.product!;
      series.push({product:productKey,market:first.market,label:productLabel(productKey)+' · '+marketLabel(first.market),
        years:periods.map(item=>rows.find(row=>row.period===item.key))});
    }
  }else{
    for(const row of data.products.filter(item=>!product||item.key===product)){
      series.push({product:row.key,market:null,label:row.label,years:periods.map(item=>row.years.find(year=>year.period===item.key))});
    }
  }
  const allYears=series.flatMap(row=>row.years);
  if(!allYears.length)return {summary:'',body:panel('Volume and selling price by year','<p class="fin-muted">No production forecast is available for this selection.</p>')};
  // Use the product forecast for project totals in both layouts. A selected market uses its own figures.
  const summaryYears=market?allYears:data.products.filter(row=>!product||row.key===product).flatMap(row=>row.years.filter(year=>!period||year.period===period));
  const total=(field:'volume'|'revenue')=>summaryYears.length&&summaryYears.every(row=>row?.[field]!=null)?
    summaryYears.reduce((sum,row)=>sum+Number(row![field]),0):null;
  const volume=total('volume'),sales=total('revenue'),span=periods.length===1?periods[0].label:periods[0].label+'–'+periods[periods.length-1].label;
  const amount=(value:number|null,places:number)=>value===null?'—':format(String(value),places);
  const cards=[
    ['Forecast volume',amount(volume,0),'pieces'],
    ['Forecast sales',amount(sales===null?null:sales/1000,2),data.currency+' thousands'],
    ['Weighted selling price',amount(volume&&sales!==null?sales/volume:null,2),data.currency+' / piece'],
    ['Forecast period',span,periods.length+' production '+(periods.length===1?'period':'periods')]
  ];
  const summary='<div class="fin-metrics fin-overview-metrics" aria-label="Commercial forecast summary">'+cards.map(([name,value,unit])=>
    '<section class="fin-metric"><div class="fin-metric-label">'+html(name)+'</div><div class="fin-summary-value"><strong class="fin-value">'+html(value)+
    '</strong></div><small class="fin-value-unit">'+html(unit)+'</small></section>').join('')+'</div>';
  const marketSeries=view==='markets'||!!market;
  const rows=series.map(row=>'<tbody>'+(['volume','unitPrice'] as const).map(metric=>{
    const units=metric==='volume',label=units?'Volume (pcs)':marketSeries?'Market price':'Weighted price';
    return '<tr>'+(units?'<th class="fin-annual-product" scope="rowgroup" rowspan="2">'+html(row.label)+'</th>':'')+
      '<th scope="row">'+label+'</th>'+row.years.map((year,index)=>{
        const value=year?.[metric];if(value==null)return cell('—');
        const p=periods[index],selectedMarket=view==='markets'?row.market:null,amount=format(value,units?0:2);
        const href=link('',{product:row.product,period:p.key,market:selectedMarket,salesView:'quotes',part:null,rows:null});
        const id=['commercial',metric,row.product,...(view==='markets'?[row.market]:[]),p.key].join('-');
        return '<td><a class="fin-link fin-annual-link" data-finance-nav id="'+html(id)+'" href="'+html(href)+'" aria-label="'+
          html(row.label+' · '+p.label+' · '+label+' '+amount+' · View market quotes')+'">'+html(amount)+'</a></td>';
      }).join('')+'</tr>';
  }).join('')+'</tbody>').join('');
  return {summary,body:panel('Volume and selling price by year','<p class="fin-muted">Prices in '+html(data.currency)+' per piece. Select a figure to open its market quotes.</p>'+
    '<div class="fin-table-scroll fin-annual-scroll" tabindex="0" role="region" aria-label="Annual volume and selling prices">'+
    '<table class="fin-annual-table"><thead><tr>'+head([marketSeries?'Product / market':'Product','Metric',...periods.map(item=>item.label)])+
    '</tr></thead>'+rows+'</table></div>')};
}

export type PurchasingView='markets'|'parts'|'annual'|'inputs';
type PurchasingScope={product:string;market:string;term:string;period:string;view:PurchasingView;archived:boolean;
  periods:{key:string;label:string}[];markets:{key:string;label:string;productKey:string|null}[];
  components:Workspace['bomComponents'];references:Workspace['bomSourceReferences']};
type Component=Workspace['bomComponents'][number];
type PartQuote={first:Input;quantity?:Input;quote?:Input;adjustment?:Input;tooling?:Input;component?:Component;
  part:string;name:string;supplier:string;reference:string;landed:string|null;usage:boolean};

function purchasingRows(inputs:Input[],scope:PurchasingScope):PartQuote[] {
  const {components,period,archived}=scope;
  const lookup=new Map(components.map(row=>[JSON.stringify([row.product,row.market,row.sheet,row.row]),row]));
  const groups=new Map<string,Input[]>();
  for(const row of inputs){
    if(row.periodKey!==period||!row.business)continue;
    const key=JSON.stringify([row.productKey,row.marketKey,row.business.businessGroup]);
    const parts=groups.get(key)??[];
    parts.push(row);groups.set(key,parts);
  }
  const sourceLine=(input:Input)=>{
    const {sheet,cell,reference}=input.source??{};
    const address=/^([^!]{1,100})!\$?[A-Z]{1,3}\$?(\d+)/.exec(sheet&&cell?sheet+'!'+cell:reference??'');
    return address?JSON.stringify([input.productKey,input.marketKey,address[1],Number(address[2])]):null;
  };
  const priced=new Map<string,PartQuote[]>();
  const rows=[...groups.values()].flatMap(parts=>{
    const quantity=parts.find(row=>row.business?.businessField==='part_quantity');
    const quote=parts.find(row=>row.business?.businessField==='part_price');
    const adjustment=parts.find(row=>row.business?.businessField==='landed_adjustment');
    const tooling=parts.find(row=>row.business?.businessField==='tooling');
    const first=quantity??quote??tooling??parts[0],source=first.source;
    // Historical imports project editable reference assumptions into later years without a new source BOM.
    if(archived&&!scope.references[first.marketKey??'']&&parts.every(row=>row.business?.origin))return [];
    const address=sourceLine(first),component=address?lookup.get(address):undefined;
    const reference=[source?.sheet,source?.cell].filter(Boolean).join('!')||source?.reference||'';
    const supplier=component?.supplier||String(first.business?.supplier??'')||
      parts.map(part=>part.source?.reference?.match(/\bSUP[_-][A-Za-z0-9_-]+\b/)?.[0]).find(Boolean)||'';
    const original=quantity?.business?.archiveContribution;
    const landed=quote?.landed??(archived&&scope.references[first.marketKey??'']&&quantity?.business?.referenceOnly&&typeof original==='string'?original:null);
    const row:PartQuote={first,quantity,quote,adjustment,tooling,component,landed,reference,supplier,
      part:component?.part??String(first.business?.partNumber??first.business?.label??first.key),
      name:component?.name??'',
      usage:!!quantity&&Number(quantity.value.coefficient)>0&&
        !/!AC\d+\s*·\s*按每件成品的产能工装\/标签费用/.test(source?.reference??'')};
    if(address&&quantity){const list=priced.get(address)??[];list.push(row);priced.set(address,list);}
    return [row];
  });
  return rows.filter(row=>{
    if(row.quantity||row.quote||row.adjustment||!row.tooling)return true;
    const address=sourceLine(row.tooling),matches=address?priced.get(address):undefined;
    if(matches?.length!==1||matches[0].tooling)return true;
    matches[0].tooling=row.tooling;
    return false;
  });
}

export function purchasingOverview(inputs:Input[],scope:PurchasingScope,marketLabel:(key:string|null)=>string,
  currency:string,link:Link,toolingLink:Link,curve:Workspace['materialSchedule'],
  periodLabel:(key:string)=>string,productLabel:(key:string)=>string) {
  const {product,market,term,period,view,components,references}=scope;
  const scoped=(row:{product:string|null;market:string|null})=>(!product||row.product===product)&&(!market||row.market===market);
  const money=(value:string|null,decimals=4)=>value===null?'—':format(value,decimals)+' '+currency;
  const recorded=(row:Input|undefined,decimals:number)=>row?format(decimal(row),decimals)+' '+row.currency:'—';
  const sum=(values:(string|null)[])=>values.length&&values.every(value=>value!==null)?String(values.reduce((total,value)=>total+Number(value),0)):null;
  const forPeriod=periodLabel(period);

  if(view==='annual'){
    const costs=curve.filter(row=>!product||row.product===product);
    const years=scope.periods.filter(year=>costs.some(row=>row.period===year.key));
    const products=[...new Set(costs.map(row=>row.product))];
    const rows=products.map(key=>'<tr><th scope="row">'+html(productLabel(key))+'</th>'+years.map(year=>{
      const item=costs.find(row=>row.product===key&&row.period===year.key);
      if(!item)return cell('—');
      if(item.unitCost===null)return '<td>—<small class="fin-state">Material cost unavailable</small></td>';
      const value=format(item.unitCost,4);
      return '<td>'+(item.hasItemQuotes?financeUrl(link('',{bomView:'parts',product:key,period:year.key,market:null,part:null}),value,
        'bom-year-'+key+'-'+year.key):html(value)+'<small class="fin-state">Annual curve only</small>')+'</td>';
    }).join('')+'</tr>').join('');
    return {summary:'',body:panel('Annual material cost per piece',rows?
      '<p class="fin-muted">'+html(currency)+' per finished piece · Product forecast, weighted by production volume. Years with item quotes link to the recorded components.</p>'+
      table('Annual material costs',['Product',...years.map(year=>year.label)],rows,'fin-annual-scroll'):'<p class="fin-muted">No annual material cost is available for this selection.</p>')};
  }

  const all=purchasingRows(inputs,scope);
  const parts=all.filter(row=>scoped({product:row.first.productKey,market:row.first.marketKey}));
  const sourceParts=components.filter(scoped);
  const match=(fields:string[])=>!term||fields.some(text=>text.toLowerCase().includes(term.toLowerCase()));
  const activeMarkets=scope.markets.filter(row=>scoped({product:row.productKey,market:row.key})&&
    (references[row.key]||parts.some(part=>part.first.marketKey===row.key)||sourceParts.some(part=>part.market===row.key)));
  const partLink=(key:string|null,marketKey:string|null)=>link('',{bomView:'parts',product:key,market:marketKey,part:null,rows:null});
  const sorted=(a:PartQuote,b:PartQuote)=>(b.landed===null?-Infinity:Number(b.landed))-(a.landed===null?-Infinity:Number(a.landed));
  const toolingLinkCell=(value:Input|undefined)=>value?
    financeUrl(toolingLink(value.key,{product:value.productKey,market:value.marketKey,period:value.periodKey}),recorded(value,2),'bom-tooling-'+value.key):'—';

  if(view==='parts'){
    const componentWithInput=new Set(parts.flatMap(row=>row.component?[row.component]:[]));
    const matching=parts.filter(row=>match([row.part,row.name,row.supplier,row.reference])).sort(sorted);
    const sourceOnly=sourceParts.filter(row=>!componentWithInput.has(row)&&match([row.part,row.name,row.supplier,row.sheet+'!M'+row.row]));
    const columns=['Component / part number','Supplier','Usage / piece','Original quote / part',
      'Landed adjustment / part','Landed / finished piece','One-time tooling','Evidence'];
    const renderPart=(row:PartQuote)=>{
      const {first,quote,quantity,adjustment,tooling}=row;
      const target=quote??quantity;
      const name=row.name||row.part,details=target?financeUrl(link(target.key,{bomView:'parts',product:first.productKey,market:first.marketKey,period:first.periodKey}),
        name,'procurement-'+first.key):html(name);
      return '<tr><th scope="row">'+details+(row.name&&row.name!==row.part?'<small class="fin-state">'+html(row.part)+'</small>':'')+
        (!market?'<small class="fin-state">'+html(marketLabel(first.marketKey))+'</small>':'')+'</th>'+
        cell(row.supplier||'Not provided')+cell(format(decimal(quantity),4))+cell(recorded(quote,4))+cell(recorded(adjustment,4))+
        '<td>'+html(money(row.landed))+(quote&&row.landed===null?'<small class="fin-state">Check quantity, adjustment and FX</small>':'')+
        '</td><td>'+toolingLinkCell(tooling)+'</td>'+cell(row.reference||'—')+'</tr>';
    };
    const renderSource=(row:Component)=>
      '<tr><th scope="row">'+html(row.name||row.part)+'<small class="fin-state">'+html(row.part)+'</small>'+
        (!market?'<small class="fin-state">'+html(marketLabel(row.market))+'</small>':'')+'</th>'+cell(row.supplier||'Not provided')+
        cell(format(row.quantity,4))+cell('No separate quote')+cell('—')+cell('—')+cell('—')+cell(row.sheet+'!M'+row.row)+'</tr>';
    const rows=matching.filter(row=>row.usage).map(renderPart).join('')+
      sourceOnly.filter(row=>Number(row.quantity)>0).map(renderSource).join('');
    const other=matching.filter(row=>!row.usage);
    const zeroUsage=sourceOnly.filter(row=>Number(row.quantity)===0);
    return {summary:'',body:panel('Parts and suppliers',
      '<p class="fin-muted">'+html(forPeriod)+' · Quoted parts ordered by landed contribution. Source-only components follow.</p>'+
      (rows?table('BOM component and quote details',columns,rows,'fin-annual-scroll fin-bom-table'):other.length||zeroUsage.length?'':'<p class="fin-muted">'+
        (term?'No component lines match this search.':'No itemized BOM is recorded for this period. Open the annual material cost view for the product forecast.')+'</p>')+
      (other.length||zeroUsage.length?'<details'+(term?' open':'')+'><summary>Allocations, separate tooling and reference lines ('+(other.length+zeroUsage.length)+')</summary>'+
        table('Other purchasing records',columns,other.map(renderPart).join('')+zeroUsage.map(renderSource).join(''),'fin-bom-table')+'</details>':'')+
      (!term&&!sourceParts.length&&parts.length?'<p class="fin-muted">No separate source component list is available for this scope. Recorded finance quotes are shown above.</p>':''))};
  }

  const scopeTotals=curve.filter(row=>!product||row.product===product);
  const suppliers=new Set([...sourceParts.map(row=>row.supplier),...parts.map(row=>row.supplier)]
    .flatMap(value=>value.split(/\s*\/\s*/)).filter(Boolean));
  const toolingAmount=(rows:PartQuote[],sourceZero:boolean)=>{
    const tools=rows.flatMap(row=>row.tooling?[row.tooling]:[]);
    if(!tools.length)return sourceZero?'0':null;
    return sum(tools.map(row=>row.fx?String(Number(decimal(row))*Number(row.fx.rate)):null));
  };
  const marketRows=activeMarkets.map(item=>{
    const rows=parts.filter(row=>row.first.marketKey===item.key);
    const materialRows=rows.filter(row=>row.quote||row.landed!==null||row.usage);
    const landed=sum(materialRows.map(row=>row.landed));
    const source=references[item.key];
    const sourceText=source?html(source.landed.split('!').at(-1)+' / '+source.tooling.split('!').at(-1))+
      '<small class="fin-state">'+html(source.landed.split('!')[0])+'</small>':'See quote lines';
    return '<tr id="'+html('bom-summary-'+item.key)+'"><th scope="row">'+
      financeUrl(partLink(item.productKey,item.key),marketLabel(item.key),'bom-market-'+item.productKey+'-'+item.key)+'</th>'+
      cell(source?.region??item.label)+cell(money(landed,6))+cell(money(toolingAmount(rows,!!source),2))+'<td>'+sourceText+'</td>'+
      '<td>'+financeUrl(partLink(item.productKey,item.key),'View parts','bom-parts-'+item.key)+'</td></tr>';
  }).join('');
  const sharedRows=parts.filter(row=>!row.first.marketKey);
  const shared=sharedRows.length?'<p>'+financeUrl(partLink(product||null,null),'View shared BOM lines')+'</p>':'';
  const cards=[
    ['Forecast direct materials',market?'—':format(sum(scopeTotals.map(row=>row.material)),2),currency+' · Full horizon · product forecast'],
    ['Market BOMs',String(activeMarkets.length),forPeriod],
    ['Identified suppliers',suppliers.size?String(suppliers.size):'—',forPeriod+' · source and quote records'],
    ['Supplier tooling quotes',format(toolingAmount(parts,activeMarkets.length>0&&activeMarkets.every(row=>!!references[row.key])),2),
      currency+' · '+forPeriod+' · one-time']
  ];
  const summary='<div class="fin-metrics fin-overview-metrics" aria-label="Purchasing summary">'+cards.map(([name,value,caption])=>
    '<section class="fin-metric"><div class="fin-metric-label">'+html(name)+'</div><div class="fin-summary-value"><strong class="fin-value">'+
    html(value)+'</strong></div><small class="fin-state">'+html(caption)+'</small></section>').join('')+'</div>';
  return {summary,body:panel('BOM quotes and landed cost','<p class="fin-muted">'+html(forPeriod+' · Landed cost in '+currency+' per finished piece · Tooling in '+currency)+
    '</p>'+(marketRows?table('Market BOM summary',['Product / variant','Sales region','Landed cost / piece','One-time tooling','Source totals',''],
      marketRows,'fin-bom-table fin-bom-market-summary'):'<p class="fin-muted">No market-specific BOM is recorded for this period. Check shared BOM lines or the annual material cost view.</p>')+shared)};
}

type FactoryCost=Workspace['factoryCosts'][number];
export type FactoryView='breakdown'|'annual'|'inputs';
type FactoryScope={
  product:string;period:string;field:string;view:FactoryView;source:string;periods:{key:string;label:string}[];
};
const originalAssumption=(row:FactoryCost)=>row.original===null?
  (row.metric?.hasSources?'See calculation sources':'No separate assumption'):
  row.originalUnit==='fraction'?new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:10}).format(Number(row.original)):
    row.original+' '+row.originalUnit;
const factoryAmount=(value:string|null,currency:string,decimals:number)=>value===null?'—':format(value,decimals)+' '+currency;

function summarizeFactoryCosts(rows:FactoryCost[]) {
  const sum=(key:'exactTotal'|'volume')=>rows.length&&rows.every(row=>row[key]!==null)?
    rows.reduce((total,row)=>total+Number(row[key]),0):null;
  const amount=sum('exactTotal'),volume=sum('volume');
  return {amount,volume,unit:amount!==null&&volume!==null&&volume>0?amount/volume:null};
}

export function factoryOverview(costs:FactoryCost[],scope:FactoryScope,productLabel:(key:string)=>string,
  periodLabel:(key:string)=>string,link:Link,sources:(metric:NonNullable<FactoryCost['metric']>)=>string) {
  if(!costs.length)return {summary:'',body:panel('Factory cost and launch by period','<p class="fin-muted">No factory cost schedule is available for this version.</p>')};
  const {currency,moneyScale}=costs[0];
  const money=(value:number|null)=>value===null?'—':format(String(value),moneyScale);
  const perPiece=(value:number|null)=>value===null?'—':format(String(value),4);
  const forPeriod=periodLabel(scope.period);
  const rows=costs.filter(row=>row.period===scope.period);
  const types=[...new Map(costs.map(row=>[row.field,row.label])).entries()];
  const costLink=(field:string,product:string,period:string)=>link('',{product:product||null,period,factoryCost:field,factoryView:null,part:null,rows:null});
  const assumptionLink=(row:FactoryCost)=>link(row.inputKey!,{product:row.product,period:row.period,factoryCost:row.field,part:null,rows:null});
  const units=(value:string,volume:number|null)=>value==='—'?value+'<small class="fin-state">'+
    (volume===0?'No forecast volume':'Forecast unavailable')+'</small>':html(value);
  const periodTotal=(row:FactoryCost)=>factoryAmount(row.total,currency,moneyScale);
  const periodUnit=(row:FactoryCost)=>factoryAmount(row.unit,currency,4);
  const group=(field:string,period=scope.period)=>costs.filter(row=>row.field===field&&row.period===period);
  const selected=scope.field?types.find(([field])=>field===scope.field):undefined;
  const selectedRow=selected&&scope.product?rows.find(row=>row.product===scope.product&&row.field===selected[0]):undefined;
  const scopeLabel=scope.product?productLabel(scope.product):'All products';

  if(selected){
    const [field,label]=selected;
    const focus=selectedRow?panel('Cost assumption',
      '<p>'+html([scopeLabel,label,forPeriod].join(' · '))+'</p><dl class="fin-op-metrics"><div><dt>Cost basis</dt><dd>'+html(selectedRow.basis)+'</dd></div>'+
      '<div><dt>Recorded assumption</dt><dd>'+html(originalAssumption(selectedRow))+'</dd></div>'+
      '<div><dt>Period total</dt><dd>'+html(periodTotal(selectedRow))+'</dd></div>'+
      '<div><dt>Per piece</dt><dd>'+units(periodUnit(selectedRow),selectedRow.volume===null?null:Number(selectedRow.volume))+'</dd></div></dl>'+
      (selectedRow.reference?'<p>'+html(selectedRow.reference)+'</p>':'<p class="fin-muted">No separate input reference is recorded for this cost.</p>')+
      (scope.source&&selectedRow.originalUnit==='fraction'?'<p class="fin-muted">Enter a decimal fraction for this rate. 0.005 represents 0.5% of sales.</p>':'')+
      '<div class="fin-actions">'+(selectedRow.inputKey&&!scope.source?financeUrl(assumptionLink(selectedRow),'Open recorded input','factory-assumption'):'')+
      (selectedRow.metric?sources(selectedRow.metric):'')+'</div>'):
      panel('Costs by product','<p class="fin-muted">'+html(label+' · '+forPeriod+' · '+currency)+'</p>'+
        table('Selected expense by product',['Product','Period total','Per piece','Cost basis'],group(field).map(row=>
          '<tr><th scope="row">'+financeUrl(costLink(field,row.product,row.period),productLabel(row.product),'factory-detail-'+row.product)+'</th>'+
          cell(periodTotal(row))+'<td>'+units(periodUnit(row),row.volume===null?null:Number(row.volume))+'</td>'+cell(row.basis)+'</tr>').join(''),'fin-factory-table'));
    const timeline=scope.source?'':panel(label+' by year',
      '<p class="fin-muted">'+html(scopeLabel+' · '+currency)+' · Select a period to review its recorded assumption.</p>'+
      table('Annual factory cost comparison',['Period','Period total','Per piece','Volume (pcs)','Recorded assumption'],scope.periods.map(year=>{
        const periodRows=group(field,year.key),row=scope.product?periodRows[0]:undefined,totals=summarizeFactoryCosts(periodRows);
        return '<tr><th scope="row"'+(year.key===scope.period?' aria-current="date"':'')+'>'+
          financeUrl(costLink(field,scope.product,year.key),year.label,'factory-period-'+year.key)+'</th>'+
          cell(factoryAmount(totals.amount===null?null:String(totals.amount),currency,moneyScale))+
          '<td>'+units(factoryAmount(totals.unit===null?null:String(totals.unit),currency,4),totals.volume)+'</td>'+
          cell(totals.volume===null?'—':format(String(totals.volume)))+cell(row?originalAssumption(row):'See product costs')+'</tr>';
      }).join(''),'fin-annual-scroll fin-factory-table'));
    return {summary:'',body:focus+timeline};
  }
  if(scope.view==='annual'){
    const trend=types.map(([field,label])=>'<tr><th scope="row">'+html(label)+'</th>'+scope.periods.map(year=>{
      const amount=summarizeFactoryCosts(group(field,year.key)).amount;
      const detail=amount===null?'—':financeUrl(costLink(field,scope.product,year.key),money(amount),'factory-trend-'+field+'-'+year.key);
      return '<td>'+detail+'</td>';
    }).join('')+'</tr>').join('');
    return {summary:'',body:panel('Factory cost trends',
      '<p class="fin-muted">'+html(scopeLabel+' · '+currency)+' per period. Select an amount to open its cost detail.</p>'+
      table('Factory cost trends',['Expense',...scope.periods.map(year=>year.label)],trend,'fin-annual-scroll fin-factory-table fin-factory-expenses'))};
  }
  const products=[...new Set(rows.map(row=>row.product))];
  const expenses=types.map(([field,label])=>{
    const periodRows=group(field),totals=summarizeFactoryCosts(periodRows);
    const productCells=scope.product?'':products.map(product=>{
      const row=periodRows.find(item=>item.product===product);
      return row?.total!=null?'<td>'+financeUrl(costLink(field,product,row.period),money(Number(row.total)),'factory-cost-'+product+'-'+field)+'</td>':cell('—');
    }).join('');
    const details=financeUrl(costLink(field,scope.product,scope.period),money(totals.amount),
      scope.product?'factory-cost-'+scope.product+'-'+field:'factory-cost-total-'+field);
    return '<tr><th scope="row">'+html(label)+'</th>'+productCells+'<td><strong>'+details+'</strong></td>'+
      '<td>'+units(perPiece(totals.unit),totals.volume)+'</td></tr>';
  }).join('');
  const variable=summarizeFactoryCosts(group('variable')),fixed=summarizeFactoryCosts(group('fixed'));
  const launch=summarizeFactoryCosts(group('launch'));
  const combined=variable.amount!==null&&fixed.amount!==null&&fixed.volume!==null&&fixed.volume>0?
    (variable.amount+fixed.amount)/fixed.volume:null;
  const cards=[
    ['Variable overhead',money(variable.amount),currency+' · '+forPeriod],
    ['Fixed overhead',money(fixed.amount),currency+' · '+forPeriod],
    ['Overhead per piece',perPiece(combined),fixed.volume===0?'No forecast volume':currency+' / piece · Fixed + variable'],
    ['One-time launch',money(launch.amount),currency+' · '+forPeriod]
  ];
  const summary='<div class="fin-metrics fin-overview-metrics fin-factory-summary" aria-label="Factory cost summary">'+cards.map(([label,value,caption])=>
    '<section class="fin-metric"><div class="fin-metric-label">'+html(label)+'</div><div class="fin-summary-value"><strong class="fin-value">'+html(value)+
    '</strong></div><small class="fin-state">'+html(caption)+'</small></section>').join('')+'</div>';
  const body=panel('Factory cost and launch by period','<p class="fin-muted">'+html(forPeriod+' · '+currency)+
    ' · Select an amount for its cost basis and annual comparison.</p>'+
    table('Factory cost breakdown',['Expense',...(scope.product?[]:products.map(productLabel)),'Period total','Per piece'],expenses,
      'fin-annual-scroll fin-factory-table fin-factory-expenses'+(scope.product?' fin-factory-single':'')));
  return {summary,body};
}
