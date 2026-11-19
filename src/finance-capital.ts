import {amountCell,escapeHtml as html,financeUrl,metricLabel} from '/finance-view.js';
import type {Dictionary} from '/finance-view.js';
import type {OperationEditor} from '/finance-impact.js';
import type {AssetRecord,RecoveryRecord,TermsRecord,ValuationRecord} from '../lib/finance-capital.ts';
import type {capitalWorkspace} from '../lib/finance-capital-workspace.ts';
import {currencyOptions} from '/finance-fx.js';

type Workspace=ReturnType<typeof capitalWorkspace>;
type Option={key:string;label:string};
type Link=(module:string,key?:string,filters?:Record<string,string|null>)=>string;
type Rights={investment:boolean;returns:boolean};
const assetLabels={equipment:'Equipment',line:'Production line',in_house_tooling:'In-house tooling',supplier_tooling:'Supplier tooling'};
const eventLabels={payment:'Payment',receipt:'One-time recovery',salvage:'Residual receipt',piece_receipt:'Piece-price receipt'};
const lifecycle=['capital_gross','capital_allocated','capital_new','capital_payments','capital_receipts','capital_net','capital_agreed','capital_salvage'];
const opts=(labels:Record<string,string>):Option[]=>Object.entries(labels).map(([key,label])=>({key,label}));
const optionLabel=(list:Option[],key:string)=>list.find(item=>item.key===key)?.label??key;
const table=(head:string[],rows:string,wide=false)=>'<div class="fin-table-scroll fin-capital-table'+(wide?' fin-capital-accounting':'')+'"><table><thead><tr>'+head.map(title=>'<th scope="col">'+title+'</th>').join('')+
  '</tr></thead><tbody>'+rows+'</tbody></table></div>';
const td=(value:string|number|null|undefined)=>'<td>'+html(value??'—')+'</td>';
const term=(label:string,value:string)=>'<dt>'+html(label)+'</dt><dd>'+html(value)+'</dd>';
const money=(value:string|null,data:Workspace)=>value===null?'Unavailable':value+' '+data.currency;
const evidenceLink=(link:Link,key:string,label:string,focus?:string)=>financeUrl(link('investment',key),label,focus);

const formatted=(data:Workspace,value:string|null,code=data.currency)=>value===null?'—':new Intl.NumberFormat('en',{
  minimumFractionDigits:data.currencies[code],maximumFractionDigits:data.currencies[code]
}).format(Number(value));
const overviewTable=(headers:string[],rows:string,label:string)=>
  '<div class="fin-table-scroll fin-capital-table fin-annual-scroll fin-investment-table" tabindex="0" role="region" aria-label="'+html(label)+'"><table>'+
  '<thead><tr>'+headers.map(title=>'<th scope="col">'+html(title)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
const investmentPanel=(heading:string,body:string)=>'<section class="fin-panel fin-business-overview"><h2>'+html(heading)+'</h2>'+body+'</section>';

export function investmentPage(data:Workspace,source:string,link:Link,periods:Option[],products:Option[],rights:Rights,draft:boolean,dictionary:Dictionary,params:URLSearchParams){
  const edit=rights.investment&&draft,view=params.get('view');
  if(view==='items')return {summary:'',body:equipmentDetails(data,source,link,periods,products,edit,params)};
  if(view==='records'||source){
    const isAsset=data.assets.some(row=>row.key===source||'edit-'+row.key===source);
    const isItem=data.estimateDetails.some(row=>row.key===source)||data.toolingQuotes.some(row=>row.key===source);
    return {summary:'',body:isAsset||isItem?equipmentDetails(data,source,link,periods,products,edit,params):
      investmentRecords(data,source,link,periods,products,edit,dictionary)};
  }
  if(view==='cash')return {summary:'',body:investmentCash(data,link,periods,products,params)};
  const inventory=data.inventoryTotals,{allocations,quoteGap}=data.investment;
  const recovery=inventory.quotedCompensation??(data.rows.some(row=>row.record.kind==='recovery')?data.totals.capital_agreed?.displayValue??null:null);
  const summary='<div class="fin-metrics fin-overview-metrics" aria-label="Investment summary">'+[
    ['Quoted investment',allocations.length?inventory.quoted:null,'Lifecycle quote'],
    ['On the asset register',allocations.length?inventory.booked:null,'Registered cost'],
    ['Pending asset registration',allocations.length?inventory.pending:null,'Quote balance'],
    ['Expected customer compensation',recovery,inventory.quotedCompensation!==null?'Original quote forecast':'Contract amount']
  ].map(([label,value,caption])=>'<section class="fin-metric"><div class="fin-metric-label">'+html(label)+
    '</div><div class="fin-summary-value"><strong class="fin-value">'+html(formatted(data,value))+'</strong></div><small class="fin-state">'+
    html(data.currency+' · '+caption)+'</small></section>').join('')+'</div>';
  const categories=(['line','in_house_tooling','supplier_tooling','equipment'] as const)
    .filter(category=>category!=='equipment'||allocations.some(row=>row.categories.equipment!==null));
  const register=(product:string,category:string|null)=>link('investment','',{view:'items',product,assetCategory:category,
    assetSearch:null,assetStatus:null,assetSupplier:null,period:null});
  const rows=allocations.map(item=>'<tr><th scope="row">'+financeUrl(register(item.product,null),optionLabel(products,item.product),
    'investment-product-'+item.product)+'</th>'+categories.map(category=>{
      const value=item.categories[category];
      return value===null?td(null):'<td>'+financeUrl(register(item.product,category),formatted(data,value),
        'investment-class-'+item.product+'-'+category)+'</td>';
    }).join('')+td(formatted(data,item.gross))+
    (item.recovery===null?td(null):'<td>'+financeUrl(link('investment','',{view:'cash',product:item.product,period:item.recoveryPeriod,cashDetail:'recovery'}),
      formatted(data,item.recovery),'investment-recovery-'+item.product)+'</td>')+td(formatted(data,item.net))+'</tr>').join('');
  const gap=quoteGap===null?'':'<p class="fin-muted">Original quoted payments less recorded investment · '+html(formatted(data,quoteGap)+' '+data.currency)+
    '. Check the estimate coverage in this version.</p>';
  const note='<p class="fin-muted">Lifecycle amounts in '+html(data.currency)+
    '. Shared equipment is allocated to its benefiting products. A dash indicates an unavailable amount or no record for that class.</p>';
  return {summary,body:investmentPanel('Investment allocation by product',note+gap+(rows?
    overviewTable(['Benefiting product',...categories.map(category=>assetLabels[category]),'Quoted investment','Expected compensation','Net after compensation'],
      rows,'Investment allocation by product'):'<p>No investment or compensation records are available in this version. '+
      financeUrl(link('investment','',{view:'records'}),'Open capital records')+'</p>'))};
}

function investmentCash(data:Workspace,link:Link,periods:Option[],products:Option[],params:URLSearchParams){
  const selected=params.get('period')??'',detail=params.get('cashDetail'),product=params.get('product')??'';
  const label=(key:string)=>optionLabel(periods,key);
  const archive=data.investment.hasArchiveCash;
  const scope=(selected?label(selected):'All forecast periods')+' · '+data.currency;
  const original=data.investment.originalCash.filter(row=>!product||row.product===product);
  const events=data.events.filter(row=>(!selected||row.period===selected)&&(!product||row.product===product));
  if(detail&&product){
    const isPayment=detail==='payment',isReceived=detail==='received',isNet=detail==='quote-net';
    const heading=isNet?'Original net quote cash':isPayment?'Investment payment forecast':isReceived?'Actual customer receipts':'Expected compensation';
    const quotes=isReceived?[]:original.filter(row=>isNet|| (isPayment?Number(row.amount)<0:Number(row.amount)>0));
    const applicable=events.filter(row=>isNet?false:isReceived?row.actual&&row.kind!=='payment':
      !row.actual&&(isPayment?row.kind==='payment':row.kind!=='payment'));
    const quoteTable=quotes.length?overviewTable(['Period','Workbook cell','Original forecast ('+data.currency+')'],
      quotes.map(row=>'<tr><th scope="row">'+html(label(row.period))+'</th>'+td(row.reference)+td(formatted(data,row.amount))+'</tr>').join(''),
      'Original investment cash sources'):'';
    const native=applicable.length?overviewTable(['Period','Cost or agreement source','Amount ('+data.currency+')','Evidence'],
      applicable.map(row=>'<tr><th scope="row">'+html(label(row.period))+'</th><td>'+
        financeUrl(link('investment',row.key,{view:row.kind==='payment'||row.kind==='salvage'?'items':'records',cashDetail:null}),row.label,
          'investment-cash-event-'+row.id)+'</td>'+td((row.kind==='payment'&&Number(row.amount)>0?'-':'')+formatted(data,row.amount))+
          td(row.reference)+'</tr>').join(''),'Investment cash record links'):'';
    const note=isPayment?'Actual payment requires a dated payment voucher.':isReceived?'Actual receipts require a dated remittance reference.':
      isNet?'The workbook records the signed net cash amount for each period.':'A dated remittance is required to confirm receipt.';
    return investmentPanel(heading,'<p class="fin-muted">'+html(optionLabel(products,product)+' · '+scope)+'</p>'+quoteTable+
      (quoteTable&&native?'<h3>Registered forecast records</h3>':'')+native+
      (!quoteTable&&!native?'<p>No matching cash record is available for this scope.</p>':'')+
      '<p class="fin-muted">'+html(note)+'</p>'+
      '<div class="fin-actions">'+financeUrl(link('investment','',{view:isPayment?'items':'records',cashDetail:null}),
        isPayment?'Open equipment and tooling':'Open customer agreements')+'</div>');
  }
  const flow=(row:typeof data.investment.cash[number],field:'payment'|'recovery'|'quote-net'|'received')=>{
    const entry=field==='quote-net'?row.quoteNet:row[field];
    const period=entry.periods.length===1?entry.periods[0]:selected;
    if(entry.amount===null&&field!=='received')return td(null);
    const href=link('investment','',{view:'cash',cashDetail:field,product:row.product,period:period||null});
    return '<td>'+financeUrl(href,entry.amount===null?'To collect':formatted(data,entry.amount),'investment-flow-'+row.product+'-'+field)+
      (entry.periods.length?'<small class="fin-state">'+html(entry.periods.length===1?label(entry.periods[0]):'Multiple periods')+'</small>':'')+'</td>';
  };
  const rows=data.investment.cash.map(row=>'<tr><th scope="row">'+html(optionLabel(products,row.product))+'</th>'+
    flow(row,'payment')+flow(row,'recovery')+(archive?flow(row,'quote-net'):'')+td('To collect')+flow(row,'received')+'</tr>').join('');
  return investmentPanel('Investment payments and recovery','<p class="fin-muted">'+html(scope)+
    '. Outflows are shown as negative amounts. '+(archive?'The forecast columns use the original quote cash schedule.':'The forecast columns use registered schedules.')+
    '</p>'+(rows?overviewTable(['Product','Forecast payment','Forecast recovery',...(archive?['Original net quote cash']:[]),
      'Actual payment evidence','Actual customer receipt'],rows,'Investment payments by product'):
      '<p>No investment cash records are available for the selected product and period.</p>'));
}

function investmentRecords(data:Workspace,source:string,link:Link,periods:Option[],products:Option[],canEdit:boolean,dictionary:Dictionary){
  const agreementSource=data.rows.find(row=>(row.key===source||'edit-'+row.key===source)&&row.record.kind==='recovery');
  const archiveSource=data.archiveRows.find(row=>row.key===source);
  const period=(key:string)=>optionLabel(periods,key);
  const returnsLink=financeUrl(link('returns'),'Project Returns','fin-capital-returns');
  if(agreementSource)return '<section class="fin-panel">'+recoveryDetail(agreementSource.key,agreementSource.record as RecoveryRecord,
    agreementSource.originalCurrency,data,link,period,products,canEdit)+'<div class="fin-actions">'+returnsLink+'</div></section>';
  if(archiveSource)return '<section class="fin-panel"><article class="fin-capital-source" id="fin-capital-source"><h3>'+
    html(archiveSource.reference)+'</h3><dl>'+term('Period',period(archiveSource.period))+term('Archived settlement',money(archiveSource.amount,data))+
    term('Class',eventLabels[archiveSource.kind])+'</dl></article><div class="fin-actions">'+returnsLink+'</div></section>';
  const assets=data.assets.filter(asset=>data.rows.some(row=>row.key===asset.key));
  const recoveries=data.rows.flatMap(row=>row.record.kind==='recovery'?[{key:row.key,record:row.record,originalCurrency:row.originalCurrency}]:[]);
  const totals=table(['Lifecycle investment','Amount'],lifecycle.map(key=>'<tr><th scope="row">'+metricLabel(dictionary,key)+'</th><td>'+amountCell(data.totals[key])+'</td></tr>').join(''));
  const assetTable=assets.length?table(['Asset source','Class','Ownership','Gross cost','Allocated cost','Incremental cost','Order / service'],assets.map(row=>
    '<tr><th scope="row">'+evidenceLink(link,row.key,row.record.title,'capital-source-'+row.key)+'<small class="fin-state">'+html(row.record.assetId)+'</small></th>'+
    td(assetLabels[row.record.category])+td(row.record.mode==='new'?'New':'Existing shared')+td(money(row.amount,data))+td(money(row.allocated,data))+
    td(money(row.incremental,data))+td(period(row.record.orderPeriod)+' / '+period(row.record.servicePeriod))+'</tr>').join('')):'<p>No detailed asset records for this scope.</p>';
  const recoveryTable=recoveries.length?table(['Agreement source','Linked asset','Method','Contract','Forecast receipt'],recoveries.map(row=>
    '<tr><th scope="row">'+evidenceLink(link,row.key,row.record.title,'capital-source-'+row.key)+'<small class="fin-state">'+html(row.record.agreementId)+'</small></th>'+
    '<td>'+evidenceLink(link,row.record.assetKey,data.assets.find(asset=>asset.key===row.record.assetKey)?.record.title??row.record.assetKey)+'</td>'+
    td(row.record.piece?'Piece-price':'One-time recovery')+td(row.record.amount+' '+row.originalCurrency)+td(period(row.record.receiptPeriod))+'</tr>').join('')):'<p>No detailed customer agreements for this scope.</p>';
  const archiveTable=data.archiveRows.length?'<details class="fin-capital-archive" '+(archiveSource?'open':'')+'><summary>P05 asset payments and compensation</summary>'+
    '<p>Financials 294–300 and 430 provide the archived investment cash schedule. Supplier tooling already capitalized in that schedule is linked for reference.</p>'+
    table(['Source','Product','Period','Amount','Class'],data.archiveRows.map(row=>'<tr><th scope="row">'+evidenceLink(link,row.key,row.reference)+'</th>'+
      td(row.product?optionLabel(products,row.product):null)+td(period(row.period))+td(money(row.amount,data))+td(eventLabels[row.kind])+'</tr>').join(''))+
    (data.archivedTools.length?table(['Supplier tooling source','Asset ID'],data.archivedTools.map(row=>'<tr><th scope="row">'+
      financeUrl(link('bom',row.key,{period:row.period,market:row.market,product:row.product}),row.label)+'</th>'+td(row.assetId)+'</tr>').join('')):'')+'</details>':'';
  return '<section class="fin-panel"><div class="fin-panel-head"><h2>Capital records and agreements</h2>'+
    '<div class="fin-actions">'+returnsLink+'</div></div>'+
    totals+
    (data.isArchive?'<p class="fin-muted">Archived payments and receipts are included in lifecycle cash. Allocated capital and incremental acquisition above are drawn from detailed asset records.</p>':'')+
    (canEdit?'<div class="fin-actions">'+financeUrl(link('investment','new-asset'),'Add asset','fin-new-asset')+
      (data.assets.length?financeUrl(link('investment','new-recovery'),'Add customer agreement','fin-new-recovery'):'')+'</div>':'')+
    '<h3>Assets</h3>'+assetTable+
    '<h3>Customer agreements</h3>'+recoveryTable+
    (data.originalCompensation.length?'<h3>Original quoted compensation</h3>'+
      table(['Source','Product','Period','Forecast amount'],data.originalCompensation.map(row=>
        '<tr><th scope="row">'+html(row.reference)+'</th>'+td(optionLabel(products,row.product??''))+td(period(row.period))+td(money(row.amount,data))+'</tr>').join('')):'')+
    '<p>Actual customer receipts · '+amountCell(data.totals.capital_actual_receipts)+'</p>'+
    archiveTable+'</section>';
}

function equipmentDetails(data:Workspace,source:string,link:Link,periods:Option[],products:Option[],edit:boolean,params:URLSearchParams){
  const period=(key:string)=>optionLabel(periods,key);
  const asset=data.assets.find(row=>row.key===source||'edit-'+row.key===source);
  const estimate=data.estimateDetails.find(row=>row.key===source);
  const quote=data.toolingQuotes.find(row=>row.key===source);
  const itemLink=(key:string,label:string,focus?:string)=>financeUrl(link('investment',key,{view:'items'}),label,focus);
  if(asset)return '<section class="fin-panel">'+assetDetail(asset,data,link,period,products,edit)+'<div class="fin-actions">'+
    financeUrl(link('returns'),'Project Returns','fin-capital-returns')+'</div></section>';
  if(estimate){
    const r=estimate.record;
    const book=edit&&Number(estimate.unidentified)>0?
      itemLink('book-estimate-'+estimate.key,'Register an asset against this quote','fin-book-estimate'):'';
    return '<section class="fin-panel"><h2>'+html(r.title)+'</h2><dl class="fin-capital-source">'+
      term('Source',r.reference)+term('Class',assetLabels[r.category])+term('Product',optionLabel(products,r.productKey))+
      term('Original quote',r.gross+' '+estimate.originalCurrency)+term('Original amount linked',estimate.used+' '+estimate.originalCurrency)+
      term('Balance to identify or register',estimate.balance+' '+estimate.originalCurrency)+
      term('Balance without an item quote',estimate.unidentified+' '+estimate.originalCurrency)+
      term('Quoted depreciation life',r.life===null?'Not provided':r.life+' years')+'</dl>'+
      '<div class="fin-actions">'+book+estimate.assets.map(key=>itemLink(key,data.assets.find(row=>row.key===key)?.record.title??key)).join('')+
      '</div></section>';
  }
  if(quote){
    return '<section class="fin-panel"><h2>'+html(quote.title)+'</h2><dl class="fin-capital-source">'+
      term('Quoted item',quote.assetId)+term('Part number',quote.partNumber??'Not provided')+
      term('Supplier',quote.supplier??'Not provided')+term('Product',optionLabel(products,quote.product??''))+
      term('Original quote',quote.originalAmount+' '+quote.originalCurrency)+term('Reporting amount',money(quote.amount,data))+
      term('Quote evidence',quote.reference??'Not provided')+'</dl><div class="fin-actions">'+
      financeUrl(link('bom',quote.key,{period:quote.period,product:quote.product,market:quote.market}),'Open BOM quote','fin-tooling-bom')+
      (quote.asset?itemLink(quote.asset,'Open linked asset','fin-tooling-asset'):
        edit&&!quote.archived?itemLink('book-quote-'+quote.key,'Register this tooling quote','fin-book-tooling'):'')+
      (quote.estimate?itemLink(quote.estimate,'Open equipment estimate'):'')+'</div></section>';
  }
  const states={registered:'Registered',quoted:'Quoted · awaiting asset',split:'Pending breakout',archived:'Included in the archived schedule'};
  const items=[
    ...data.assets.filter(row=>data.rows.some(scope=>scope.key===row.key)).map(row=>{
      const quote=data.toolingQuotes.find(item=>item.asset===row.key);
      const r=row.record;
      return {key:row.key,title:r.title,id:r.assetId,category:r.category,product:r.allocations.map(a=>optionLabel(products,a.productKey)).join(', '),
        supplier:r.supplier??quote?.supplier??null,part:r.partNumber??quote?.partNumber??null,quantity:r.quantity?.toString()??null,
        original:row.originalAmount?row.originalAmount+' '+row.sourceCurrency:null,amount:row.amount,state:'registered' as const};
    }),
    ...data.toolingQuotes.filter(row=>!row.asset).map(row=>({key:row.key,title:row.title,id:row.assetId,category:'supplier_tooling' as const,
      product:optionLabel(products,row.product??''),supplier:row.supplier,part:row.partNumber,quantity:null,
      original:row.originalAmount+' '+row.originalCurrency,amount:row.amount,state:row.archived?'archived' as const:'quoted' as const})),
    ...data.estimateDetails.filter(row=>Number(row.unidentified)>0).map(row=>({
      key:row.key,title:row.record.title,id:row.record.estimateId,category:row.record.category,product:optionLabel(products,row.record.productKey),
      supplier:null,part:null,quantity:null,original:row.unidentified+' '+row.originalCurrency,amount:row.unidentifiedAmount,state:'split' as const}))
  ];
  const search=(params.get('assetSearch')??'').slice(0,100),category=params.get('assetCategory')??'',status=params.get('assetStatus')??'',
    supplier=params.get('assetSupplier')??'';
  const matches=items.filter(row=>(!category||row.category===category)&&(!status||row.state===status)&&
    (!supplier||supplier===(row.supplier??'unknown'))&&[row.title,row.id,row.part,row.supplier].join(' ').toLowerCase().includes(search.toLowerCase()));
  const suppliers=[...new Set(items.map(row=>row.supplier??'unknown'))].sort();
  const filter='<form id="fin-asset-search" class="fin-filters">'+input('assetSearch','Equipment, tooling or part',search,'maxlength="100"')+
    select('assetCategory','Asset class',opts(assetLabels),category,'All classes')+
    select('assetStatus','Registration status',opts(states),status,'All statuses')+
    select('assetSupplier','Supplier',suppliers.map(key=>({key,label:key==='unknown'?'Not provided':key})),supplier,'All suppliers')+
    '<button type="submit" class="small-btn" id="fin-asset-search-submit">Apply filters</button></form>';
  return '<section class="fin-panel"><div class="fin-panel-head"><h2>Equipment and tooling register</h2>'+
    (edit?itemLink('new-asset','Add asset','fin-new-asset'):'')+'</div>'+filter+
    (matches.length?table(['Item','Class','Product / part','Supplier','Quantity','Original amount','Reporting amount','Status'],matches.map(row=>
      '<tr><th scope="row">'+itemLink(row.key,row.title,'equipment-item-'+row.key)+'<small class="fin-state">'+html(row.id)+'</small></th>'+
      td(assetLabels[row.category])+td([row.product,row.part].filter(Boolean).join(' · '))+td(row.supplier??'Not provided')+
      td(row.quantity??'Not provided')+td(row.original)+td(money(row.amount,data))+td(states[row.state])+'</tr>').join('')):
      '<p role="status">No equipment or tooling matches this scope.</p>')+'</section>';
}

function assetDetail(row:Workspace['assets'][number],data:Workspace,link:Link,period:(key:string)=>string,products:Option[],edit:boolean){
  const a=row.record;
  return '<article class="fin-capital-source" id="fin-capital-source"><h3>'+html(a.title)+'</h3><dl>'+
    term('Asset identity',a.assetId)+term('ME evidence',a.meReference)+term('Procurement evidence',a.purchaseReference)+term('Allocation basis',a.basis)+
    term('Product allocation',a.allocations.map(item=>optionLabel(products,item.productKey)+' '+item.share).join(', '))+
    term('Order / service',period(a.orderPeriod)+' / '+period(a.servicePeriod))+term('Depreciation','Straight-line · '+a.life+' years from service')+
    term('Supplier',a.supplier??data.toolingQuotes.find(item=>item.asset===row.key)?.supplier??'Not provided')+
    term('Asset quantity',a.quantity===undefined?'Not provided':String(a.quantity))+
    term('Original gross cost',row.originalAmount===null?'Unavailable':row.originalAmount+' '+row.sourceCurrency)+
    term('Reporting amount',money(row.amount,data))+term('Allocated amount',money(row.allocated,data))+
    (row.selectedAllocation===null?'':term('Selected product allocation',money(row.selectedAllocation,data)))+
    term('Exchange rate',row.exchangeRate===null?'Unavailable':'1 '+row.sourceCurrency+' = '+row.exchangeRate+' '+data.currency)+
    term('Gross residual value',a.residual+' '+row.originalCurrency)+'</dl><div class="fin-actions">'+
    (row.quote?financeUrl(link('bom',row.quote.key,{period:row.quote.period,product:row.quote.product,market:row.quote.market}),'Supplier quote · '+row.quote.reference):'')+
    (row.line?financeUrl(link('operations',row.line.key??'',{product:row.line.product,period:row.line.period}),'ME line · '+a.lineId):'')+
    (a.estimate?financeUrl(link('investment',a.estimate.key,{view:'items'}),'Original estimate'): '')+
    data.rows.flatMap(item=>item.record.kind==='recovery'&&item.record.assetKey===row.key?
      [financeUrl(link('investment',item.key,{view:null}),item.record.title)]:[]).join('')+
    (edit?financeUrl(link('investment','edit-'+row.key),'Edit asset','fin-edit-asset')+
      financeUrl(link('investment','recover-'+row.key,{view:'records'}),'Add linked agreement','fin-asset-agreement'):'')+'</div>'+
    (a.payments.length?'<h4>Scheduled payments</h4>'+table(['Payment','Period','Share','Schedule reference'],a.payments.map(p=>
      '<tr><th scope="row">'+html(p.id)+'</th>'+td(period(p.period))+td(p.share)+td(p.reference)+'</tr>').join('')):'')+
    '</article>';
}

function recoveryDetail(key:string,record:RecoveryRecord,currency:string,data:Workspace,link:Link,period:(key:string)=>string,products:Option[],edit:boolean){
  const a=data.assets.find(row=>row.key===record.assetKey),piece=record.piece;
  return '<article class="fin-capital-source" id="fin-capital-source"><h3>'+html(record.title)+'</h3><dl>'+
    term('Agreement ID',record.agreementId)+term('Agreement evidence',record.reference)+term('Contract amount',record.amount+' '+currency+' · '+period(record.agreementPeriod))+
    term('Receivable',record.receivable?record.receivable.amount+' '+currency+' · '+period(record.receivable.period)+' · '+record.receivable.reference:'Unbilled')+
    term('Forecast receipt',period(record.receiptPeriod))+
    term('Treatment',piece?'Piece-price · '+(piece.included?'Included in commercial quote':'Separate uplift'):'One-time capital recovery')+
    (piece?term('Earning basis',optionLabel(products,piece.productKey)+' · '+piece.rate+' '+currency+'/piece · '+period(piece.first)+'–'+period(piece.last)):'')+
    '</dl><div class="fin-actions">'+(a?evidenceLink(link,a.key,a.record.title):'')+(edit?financeUrl(link('investment','edit-'+key),'Edit agreement','fin-edit-recovery'):'')+'</div>'+
    (record.receipts.length?table(['Receipt','Amount','Period','Date','Evidence'],record.receipts.map(r=>'<tr><th scope="row">'+html(r.id)+'</th>'+
      td(r.amount+' '+currency)+td(period(r.period))+td(r.date)+td(r.reference)+'</tr>').join('')):'<p>No actual receipts recorded.</p>')+'</article>';
}


const input=(name:string,label:string,value='',extra='required')=>'<label>'+html(label)+'<input name="'+name+'" value="'+html(value)+'" '+extra+'></label>';
const amount=(name:string,label:string,value='',required=true)=>input(name,label,value,'inputmode="decimal" '+(required?'required':''));
const select=(name:string,label:string,list:Option[],value:string,optional='')=>'<label>'+html(label)+'<select name="'+name+'">'+
  (optional?'<option value="">'+html(optional)+'</option>':'')+list.map(item=>'<option value="'+html(item.key)+'" '+(value===item.key?'selected':'')+'>'+html(item.label)+'</option>').join('')+'</select></label>';
const box=(name:string,label:string,checked:boolean)=>'<label><input type="checkbox" name="'+name+'" '+(checked?'checked':'')+'> '+html(label)+'</label>';
const rowBlock=(label:string,fields:string)=>'<fieldset data-capital-row><legend>'+label+'</legend>'+fields+'<button type="button" class="small-btn" data-capital-remove>Remove</button></fieldset>';
const repeats=(label:string,rows:string[])=>'<div data-capital-list>'+rows.join('')+'</div><button type="button" class="small-btn" data-capital-add>Add '+label+'</button>';
function bindRows(form:HTMLFormElement,clear:()=>void,newRow:()=>string){
  form.addEventListener('click',event=>{
    const trigger=(event.target as HTMLElement).closest('[data-capital-add],[data-capital-remove]');
    if(!trigger)return;
    if(trigger.hasAttribute('data-capital-add')){
      const list=form.querySelector('[data-capital-list]')!;
      if(list.childElementCount>=24)return;
      list.insertAdjacentHTML('beforeend',newRow());list.lastElementChild?.querySelector('input')?.focus();
    }else trigger.closest('[data-capital-row]')?.remove();
    clear();
  });
}
function scheduleRows(form:HTMLFormElement){
  return [...form.querySelectorAll('[data-capital-row]')].map(row=>Object.fromEntries([...row.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')]
    .map(field=>[field.name.replace('schedule-',''),field.value]))).filter(row=>row.id||row.share||row.amount||row.reference||row.date);
}

export function capitalEditor(data:Workspace,section:string,source:string,periods:Option[],products:Option[],selectedPeriod:string,product:string,rights:Rights,draft:boolean):OperationEditor|undefined{
  const isReturns=section==='returns';
  if(!draft||!(isReturns?rights.returns:rights.investment)||!periods.length)return;
  const key=source.startsWith('edit-')?source.slice(5):null,previousRow=data.rows.find(row=>row.key===key),previous=previousRow?.record;
  const quoteDraft=source.startsWith('book-quote-')?data.toolingQuotes.find(row=>row.key===source.slice('book-quote-'.length)&&!row.asset&&!row.archived):undefined;
  const estimateDraft=data.estimateDetails.find(row=>row.key===(source.startsWith('book-estimate-')?source.slice('book-estimate-'.length):quoteDraft?.estimate));
  const draftProduct=quoteDraft?.product??estimateDraft?.record.productKey??product??'';
  const booking=!!(quoteDraft||estimateDraft);
  const originalCurrency='<label>Source currency<select name="currency">'+
    currencyOptions(data.currencies,previousRow?.originalCurrency??quoteDraft?.originalCurrency??estimateDraft?.originalCurrency??data.currency)+'</select></label>';
  const rowPeriod=selectedPeriod||periods[0].key;
  const wrap=(title:string,markup:string,record:(data:FormData,form:HTMLFormElement)=>unknown,bind?:OperationEditor['bind']):OperationEditor=>({
    title,markup,period:rowPeriod,capital:true,range:{from:periods[0].key,to:periods.at(-1)!.key},bind,
    submit:(form,element)=>({collection:'capital',...(key?{key}:{}),...(form.has('currency')?{currency:form.get('currency')}:{}),record:record(form,element)})
  });
  if(!isReturns&&(source==='new-asset'||previous?.kind==='asset'||booking)){
    const a=previous as AssetRecord|undefined;
    const orderPeriod=estimateDraft?.record.period??rowPeriod;
    const evidence=quoteDraft?.reference??estimateDraft?.record.reference??'';
    const selectedEstimate=a?.estimate?.key??estimateDraft?.key??'';
    const estimateOptions=data.estimateDetails.map(row=>({key:row.key,label:row.record.title+' · '+row.balance+' '+row.originalCurrency}));
    const payment=(row?:AssetRecord['payments'][number])=>rowBlock('Payment',input('schedule-id','Payment ID',row?.id,'')+
      select('schedule-period','Payment period',periods,row?.period??orderPeriod)+amount('schedule-share','Payment share',row?.share,false)+
      input('schedule-reference','Payment evidence',row?.reference,''));
    return wrap(a?'Edit capital asset':'Add capital asset',
      input('asset-id','Asset ID',a?.assetId??quoteDraft?.assetId,a||quoteDraft?'required readonly data-fixed':'')+
      (!a&&!quoteDraft&&data.quoteOptions.length?select('quote','Supplier quote asset ID',data.quoteOptions,'','Use entered asset ID'):'')+
      input('title','Asset title',a?.title??quoteDraft?.title)+select('category','Asset class',opts(assetLabels),
        a?.category??(quoteDraft?'supplier_tooling':estimateDraft?.record.category??'equipment'))+
      select('mode','Ownership',opts({new:'New asset',existing_shared:'Existing shared asset'}),a?.mode??'new')+
      originalCurrency+amount('gross','Gross cost',a?.gross??'',false)+
      '<p>Leave gross cost blank for a linked supplier quote. New payments total a share of 1. Existing shared assets use allocation and depreciation only.</p>'+
      input('supplier','Supplier code',a?.supplier??quoteDraft?.supplier??'','')+
      input('part-number','Part number',a?.partNumber??quoteDraft?.partNumber??'','')+
      amount('quantity','Asset quantity',a?.quantity?.toString()??'',false)+
      (estimateOptions.length?select('estimate-key','Original estimate',estimateOptions,selectedEstimate,'No linked estimate')+
        amount('estimate-amount','Original amount to consume',a?.estimate?.amount??quoteDraft?.originalAmount??'',false):'')+
      input('me','ME evidence',a?.meReference)+select('line','ME line ID',data.lines.map(line=>({key:line,label:line})),a?.lineId??'','No linked line')+
      input('purchase','Procurement evidence',a?.purchaseReference??evidence)+input('basis','Allocation basis',a?.basis)+
      '<fieldset><legend>Product allocation shares</legend>'+products.map(item=>amount('share:'+item.key,item.label,
        a?.allocations.find(row=>row.productKey===item.key)?.share??(!a&&item.key===(draftProduct||products[0]?.key)?'1':''),false)).join('')+'</fieldset>'+
      select('order','Order / reference period',periods,a?.orderPeriod??orderPeriod)+
      select('service','Placed-in-service period',periods,a?.servicePeriod??quoteDraft?.period??orderPeriod)+
      amount('life','Depreciation life (years)',String(a?.life??estimateDraft?.record.life??5))+amount('residual','Gross residual at end of life',a?.residual??'0')+
      repeats('payment',a?a.payments.map(payment):[payment(booking?{id:'initial',period:orderPeriod,share:'1',reference:evidence}:undefined)]),
      (form,element)=>({kind:'asset',
        assetId:form.get('quote')||form.get('asset-id'),title:form.get('title'),category:form.get('category'),mode:form.get('mode'),
        meReference:form.get('me'),purchaseReference:form.get('purchase'),lineId:form.get('line')||null,basis:form.get('basis'),
        supplier:form.get('supplier'),partNumber:form.get('part-number'),quantity:form.get('quantity'),
        ...(form.get('estimate-key')?{estimate:{key:form.get('estimate-key'),amount:form.get('estimate-amount')}}:{}),
        gross:form.get('gross')||null,orderPeriod:form.get('order'),servicePeriod:form.get('service'),life:form.get('life'),residual:form.get('residual'),
        allocations:[...form].filter(([name,share])=>name.startsWith('share:')&&share).map(([name,share])=>({productKey:name.slice(6),share})),
        payments:form.get('mode')==='new'?scheduleRows(element):[]}), (form,clear)=>bindRows(form,clear,()=>payment()));
  }
  if(!isReturns&&(source==='new-recovery'||source.startsWith('recover-')||previous?.kind==='recovery')){
    const r=previous as RecoveryRecord|undefined,p=r?.piece;
    const receipt=(row?:RecoveryRecord['receipts'][number])=>rowBlock('Actual receipt',input('schedule-id','Receipt identity',row?.id,'')+
      amount('schedule-amount','Actual amount',row?.amount,false)+select('schedule-period','Actual receipt period',periods,row?.period??rowPeriod)+
      input('schedule-date','Receipt date',row?.date,'type="date"')+input('schedule-reference','Receipt evidence',row?.reference,''));
    return wrap(r?'Edit customer agreement':'Add customer agreement',
      input('agreement-id','Agreement ID',r?.agreementId,r?'required readonly data-fixed':'required')+
      select('asset','Linked asset',data.assets.map(row=>({key:row.key,label:row.record.title})),r?.assetKey??source.slice(8))+
      input('title','Agreement title',r?.title)+input('reference','Agreement evidence',r?.reference)+select('agreed-period','Agreement period',periods,r?.agreementPeriod??rowPeriod)+
      originalCurrency+amount('agreement-amount','Contract amount',r?.amount)+
      amount('receivable-amount','Receivable amount',r?.receivable?.amount,false)+select('receivable-period','Receivable period',periods,r?.receivable?.period??rowPeriod)+
      input('receivable-reference','Receivable evidence',r?.receivable?.reference,'')+
      select('receipt-period','Forecast receipt period',periods,r?.receiptPeriod??rowPeriod)+
      select('method','Recovery method',opts({lump:'One-time',piece:'Piece-price'}),p?'piece':'lump')+
      '<fieldset><legend>Piece-price terms</legend>'+select('product','Product',products,p?.productKey??product)+
      amount('uplift','Recovery per piece',p?.rate,false)+select('first','First earning period',periods,p?.first??rowPeriod)+
      select('last','Last earning period',periods,p?.last??rowPeriod)+box('included','Included in commercial quote',!!p?.included)+'</fieldset>'+
      repeats('actual receipt',r?.receipts.map(receipt)??[]),(form,element)=>({kind:'recovery',agreementId:form.get('agreement-id'),assetKey:form.get('asset'),
        title:form.get('title'),reference:form.get('reference'),agreementPeriod:form.get('agreed-period'),amount:form.get('agreement-amount'),receiptPeriod:form.get('receipt-period'),
        receivable:form.get('receivable-amount')?{amount:form.get('receivable-amount'),period:form.get('receivable-period'),reference:form.get('receivable-reference')}:null,
        piece:form.get('method')==='piece'?{productKey:form.get('product'),rate:form.get('uplift'),first:form.get('first'),last:form.get('last'),included:form.has('included')}:null,
        receipts:scheduleRows(element)}),(form,clear)=>bindRows(form,clear,()=>receipt()));
  }
  if(isReturns&&(source==='new-terms'||previous?.kind==='terms')){
    const t=previous as TermsRecord|undefined;
    return wrap(t?'Edit operating terms':'Add operating terms',
      (t?'<p>'+html(optionLabel(products,t.productKey))+' · '+html(optionLabel(periods,t.period))+'</p>':
        select('product','Product',products,product)+select('from','Effective period',periods,rowPeriod))+
      amount('receivable-days','Receivable days',t?.receivableDays??'0')+amount('payable-days','Payable days',t?.payableDays??'0')+
      amount('inventory-days','Inventory days',t?.inventoryDays??'0')+select('days','Annual day basis',opts({'360':'360 days','365':'365 days'}),String(t?.days??360))+
      amount('tax','Tax rate (fraction)',t?.tax??'0')+box('release','Release closing working capital in this period',!!t?.release)+input('reference','Terms evidence',t?.reference)+
      '<p>Terms carry forward from the effective period. Explicit other cash adjustments should exclude amounts already modeled in this schedule.</p>',
      form=>({kind:'terms',productKey:t?.productKey??form.get('product'),period:t?.period??form.get('from'),
        receivableDays:form.get('receivable-days'),payableDays:form.get('payable-days'),inventoryDays:form.get('inventory-days'),
        days:Number(form.get('days')),tax:form.get('tax'),release:form.has('release'),reference:form.get('reference')}));
  }
  if(isReturns&&(source==='new-valuation'||previous?.kind==='valuation')){
    const v=previous as ValuationRecord|undefined;
    return wrap('Set project discount rate',amount('discount','Annual discount rate (fraction)',v?.discount??'')+input('reference','Valuation evidence',v?.reference),
      form=>({kind:'valuation',discount:form.get('discount'),reference:form.get('reference')}));
  }
}
