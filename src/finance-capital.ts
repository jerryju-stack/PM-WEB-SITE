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
const incAccounting=['incremental_profit','receivables','inventory','payables','nwc','nwc_change','signed_tax','capital_payments','capital_receipts',
  'capital_piece_cash','capital_salvage','cash_flow'];
const opts=(labels:Record<string,string>):Option[]=>Object.entries(labels).map(([key,label])=>({key,label}));
const optionLabel=(list:Option[],key:string)=>list.find(item=>item.key===key)?.label??key;
const table=(head:string[],rows:string,wide=false)=>'<div class="fin-table-scroll fin-capital-table'+(wide?' fin-capital-accounting':'')+'"><table><thead><tr>'+head.map(title=>'<th scope="col">'+title+'</th>').join('')+
  '</tr></thead><tbody>'+rows+'</tbody></table></div>';
const td=(value:string|number|null|undefined)=>'<td>'+html(value??'—')+'</td>';
const term=(label:string,value:string)=>'<dt>'+html(label)+'</dt><dd>'+html(value)+'</dd>';
const money=(value:string|null,data:Workspace)=>value===null?'Unavailable':value+' '+data.currency;
const evidenceLink=(link:Link,key:string,label:string,focus?:string)=>financeUrl(link('investment',key),label,focus);

export function investmentPage(data:Workspace,source:string,link:Link,periods:Option[],products:Option[],rights:Rights,draft:boolean,dictionary:Dictionary,params:URLSearchParams){
  const canEdit=rights.investment&&draft;
  if(params.get('view')==='items')return equipmentDetails(data,source,link,periods,products,canEdit,params);
  const assetSource=data.assets.find(row=>row.key===source||'edit-'+row.key===source);
  const agreementSource=data.rows.find(row=>(row.key===source||'edit-'+row.key===source)&&row.record.kind==='recovery');
  const archiveSource=data.archiveRows.find(row=>row.key===source);
  const period=(key:string)=>optionLabel(periods,key);
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
  return '<section class="fin-panel"><div class="fin-panel-head"><h2>Equipment, Tooling &amp; Compensation</h2>'+
    '<div class="fin-actions">'+financeUrl(link('investment','',{view:'items'}),'Equipment & Tooling Details','fin-equipment-items')+
    financeUrl(link('returns'),'Project Returns','fin-capital-returns')+'</div></div>'+
    '<dl class="fin-op-metrics">'+[
      ['Quoted investment',money(data.inventoryTotals.quoted,data)],['On the asset register',money(data.inventoryTotals.booked,data)],
      ['Pending asset registration',money(data.inventoryTotals.pending,data)],
      ['Original quoted compensation',data.inventoryTotals.quotedCompensation===null?amountCell(data.totals.capital_agreed):money(data.inventoryTotals.quotedCompensation,data)]
    ].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>'+totals+
    (data.isArchive?'<p class="fin-muted">Archived payments and receipts are included in lifecycle cash. Allocated capital and incremental acquisition above are drawn from detailed asset records.</p>':'')+
    (canEdit?'<div class="fin-actions">'+financeUrl(link('investment','new-asset'),'Add asset','fin-new-asset')+
      (data.assets.length?financeUrl(link('investment','new-recovery'),'Add customer agreement','fin-new-recovery'):'')+'</div>':'')+
    '<h3>Assets</h3>'+assetTable+
    (assetSource?assetDetail(assetSource,data,link,period,products,canEdit):'')+
    '<h3>Customer agreements</h3>'+recoveryTable+
    (data.originalCompensation.length?'<h3>Original quoted compensation</h3>'+
      table(['Source','Product','Period','Forecast amount'],data.originalCompensation.map(row=>
        '<tr><th scope="row">'+html(row.reference)+'</th>'+td(optionLabel(products,row.product??''))+td(period(row.period))+td(money(row.amount,data))+'</tr>').join('')):'')+
    '<p>Actual customer receipts · '+amountCell(data.totals.capital_actual_receipts)+'</p>'+
    (agreementSource?recoveryDetail(agreementSource.key,agreementSource.record as RecoveryRecord,agreementSource.originalCurrency,data,link,period,products,canEdit):'')+
    (archiveSource?'<article class="fin-capital-source"><h3>'+html(archiveSource.reference)+'</h3><dl>'+
      term('Period',period(archiveSource.period))+term('Archived settlement',money(archiveSource.amount,data))+term('Class',eventLabels[archiveSource.kind])+
      '</dl></article>':'')+archiveTable+'</section>';
}

function equipmentDetails(data:Workspace,source:string,link:Link,periods:Option[],products:Option[],edit:boolean,params:URLSearchParams){
  const period=(key:string)=>optionLabel(periods,key);
  const asset=data.assets.find(row=>row.key===source||'edit-'+row.key===source);
  const estimate=data.estimateDetails.find(row=>row.key===source);
  const quote=data.toolingQuotes.find(row=>row.key===source);
  const itemLink=(key:string,label:string,focus?:string)=>financeUrl(link('investment',key,{view:'items'}),label,focus);
  if(asset)return '<section class="fin-panel">'+assetDetail(asset,data,link,period,products,edit)+'</section>';
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
    term('Exchange rate',row.exchangeRate===null?'Unavailable':'1 '+row.sourceCurrency+' = '+row.exchangeRate+' '+data.currency)+
    term('Gross residual value',a.residual+' '+row.originalCurrency)+'</dl><div class="fin-actions">'+
    (row.quote?financeUrl(link('bom',row.quote.key,{period:row.quote.period,product:row.quote.product,market:row.quote.market}),'Supplier quote · '+row.quote.reference):'')+
    (row.line?financeUrl(link('operations',row.line.key??'',{product:row.line.product,period:row.line.period}),'ME line · '+a.lineId):'')+
    (a.estimate?financeUrl(link('investment',a.estimate.key,{view:'items'}),'Original estimate'): '')+
    data.rows.flatMap(item=>item.record.kind==='recovery'&&item.record.assetKey===row.key?
      [financeUrl(link('investment',item.key,{view:null}),item.record.title)]:[]).join('')+
    (edit?financeUrl(link('investment','edit-'+row.key),'Edit asset','fin-edit-asset')+
      financeUrl(link('investment','recover-'+row.key),'Add linked agreement','fin-asset-agreement'):'')+'</div>'+
    (a.payments.length?table(['Payment','Period','Share','Evidence'],a.payments.map(p=>'<tr><th scope="row">'+html(p.id)+'</th>'+td(period(p.period))+td(p.share)+td(p.reference)+'</tr>').join('')):'')+
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

export function returnsPage(data:Workspace,source:string,link:Link,periods:Option[],products:Option[],selected:string,full:boolean,rights:Rights,draft:boolean,
  dictionary:Dictionary,showIrr:boolean,reconciliation:Option[]){
  const period=(key:string)=>optionLabel(periods,key);
  const terms=data.rows.flatMap(row=>row.record.kind==='terms'?[{key:row.key,record:row.record}]:[]);
  const valuation=data.rows.find(row=>row.record.kind==='valuation');
  const keys=data.cashOnly?['cash_flow','cumulative_cash','present_value']:
    full?['reported_profit','depreciation','incremental_profit','incremental_depreciation']:incAccounting;
  const editor=rights.returns&&draft?'<div class="fin-actions">'+financeUrl(link('returns','new-terms'),'Add working-capital and tax terms','fin-new-terms')+
    financeUrl(link('returns',valuation?'edit-'+valuation.key:'new-valuation'),'Set discount rate','fin-valuation')+'</div>':'';
  const sourceRow=data.rows.find(row=>row.key===source||'edit-'+row.key===source);
  const focus=data.fundingPeriod,peak=periods.findIndex(p=>p.key===focus);
  const funding=data.events.filter(item=>peak>=0&&periods.findIndex(p=>p.key===item.period)<=peak);
  const afterLow=data.events.filter(item=>peak>=0&&item.kind!=='payment'&&periods.findIndex(p=>p.key===item.period)>peak);
  const accounting=table(['Period',...keys.map(key=>metricLabel(dictionary,key))],data.accounting.filter(row=>!selected||row.period===selected).map(row=>
    '<tr><th scope="row">'+html(period(row.period))+'</th>'+keys.map(key=>'<td>'+amountCell(row.metrics[key])+'</td>').join('')+'</tr>').join(''),!full);
  const keyMetrics=full?['cqa.mpbitri','full_cost_management_profit','operating_profit','incremental_profit']:
    ['npv','irr','payback_period','peak_funding_requirement',...(data.cashOnly?[]:['capital_net','capital_agreed','discount_rate'])];
  const totals=table(['Lifecycle metric','Amount'],keyMetrics.filter(key=>key!=='operating_profit'||!data.isArchive).filter(key=>key!=='cqa.mpbitri'||data.isArchive).map(key=>
    '<tr><th scope="row">'+metricLabel(dictionary,key)+'</th><td>'+amountCell(data.totals[key])+'</td></tr>').join(''));
  const assumptions=terms.length?table(['Source','Product','Effective from','AR / AP / inventory days','Tax rate'],terms.map(row=>
    '<tr><th scope="row">'+financeUrl(link('returns',row.key),row.record.reference,'capital-terms-'+row.key)+'</th>'+td(optionLabel(products,row.record.productKey))+
    td(period(row.record.period))+td([row.record.receivableDays,row.record.payableDays,row.record.inventoryDays].join(' / '))+td(row.record.tax)+'</tr>').join('')):'';
  const archived=data.archiveAssumptions.length?'<details class="fin-capital-archive"><summary>P05 working capital, tax and discount sources</summary>'+
    table(['Product','Inventory','Receivables','Payables','Tax','Discount'],data.archiveAssumptions.map(row=>'<tr><th scope="row">'+html(optionLabel(products,row.product))+'</th>'+
      [row.inventory,row.ar,row.ap,row.tax,row.discount].map(cell=>td((cell.value??'Unavailable')+' · '+cell.reference)).join('')+'</tr>').join(''))+'</details>':'';
  const eventTable=(events:Workspace['events'])=>table(['Period','Type','Product','Capital cash source','Amount','Evidence'],events.map(event=>
    '<tr><th scope="row">'+html(period(event.period))+'</th>'+td(eventLabels[event.kind])+td(event.product?optionLabel(products,event.product):null)+
    '<td>'+evidenceLink(link,event.key,event.label,'capital-event-'+event.id)+'</td>'+td((event.kind==='payment'?'−':'+')+money(event.amount,data))+
    td(event.reference+(event.actual?' · Actual':' · Forecast'))+'</tr>').join(''));
  const peakEvents=focus?'<section class="fin-panel" id="fin-funding-events"><h2>Funding sources through the low point</h2><p>First minimum · '+html(period(focus))+
    (data.recoveryPeriod?' · First recovery '+html(period(data.recoveryPeriod)):'')+'</p>'+
    (funding.length?eventTable(funding):
      '<p>The selected scope has no identified capital event at or before the low point. Review the period cash bridge and its sources below.</p>')+
    (afterLow.length?'<h3>Later capital receipts</h3>'+eventTable(afterLow):'')+
    '</section>':'';
  const audit=data.irrAudit;
  const diagnostics='<details class="fin-panel" id="fin-irr-diagnostic"'+(showIrr?' open':'')+'><summary>IRR calculation details</summary>'+
    '<p>'+amountCell(data.totals.irr)+(audit.precisionRate?' · '+html(audit.precisionRate)+'% at audit precision':'')+'</p>'+
    (audit.message?'<p>'+html(audit.message)+'</p>':'')+
    '<p>Sign changes across nonzero cash flows: '+html(audit.changes)+'.</p>'+
    table(['Period','Cash input at audit precision','Sign','Change from previous nonzero cash'],audit.rows.map(row=>
      '<tr><th scope="row">'+html(period(row.period))+'</th>'+td(row.amount===null?null:row.amount+' '+data.currency)+
      td(row.sign===null?'Unavailable':row.sign<0?'Negative':row.sign>0?'Positive':'Zero')+td(row.changed?'Sign changed':'—')+'</tr>').join(''))+
    (reconciliation.length?'<div class="fin-actions">'+reconciliation.map(item=>
      financeUrl(link('returns','',{version:item.key,period:null,returnDetail:'irr'}),'Open cash-flow reconciliation · '+item.label)).join('')+'</div>':'')+
    '</details>';
  return '<section class="fin-panel"><div class="fin-panel-head"><h2>'+(full?'Full-cost profitability':'Incremental project returns')+'</h2>'+
    (data.cashOnly?'':financeUrl(link('investment'),'Equipment & Investment','fin-returns-investment'))+'</div><div class="fin-actions">'+
    (data.cashOnly?'':full?financeUrl(link('returns','',{basis:'incremental'}),'Incremental cash basis','fin-basis-incremental'):
      financeUrl(link('returns','',{basis:'full'}),'Full-cost basis','fin-basis-full'))+'</div>'+
    (data.cashOnly?'<p class="fin-muted">Cash-flow reconciliation version · Explicit cash inputs for each period.</p>':'')+
    (full?'<p>Full-cost profit includes allocated depreciation and costs. NPV, IRR and funding requirements use the incremental cash basis.</p>':'')+
    totals+accounting+editor+(assumptions?'<h3>Working-capital and cash-tax assumptions</h3>'+assumptions:'')+archived+
    (sourceRow?.record.kind==='terms'?'<article class="fin-capital-source" id="fin-capital-source"><h3>'+html(sourceRow.record.reference)+'</h3><p>Day basis '+
      html(sourceRow.record.days)+' · '+(sourceRow.record.release?'Release closing working capital in '+html(period(sourceRow.record.period)):'Carry closing working capital into the next period')+'</p>'+
      (rights.returns&&draft?financeUrl(link('returns','edit-'+sourceRow.key),'Edit terms','fin-edit-terms'):'')+'</article>':'')+
    (valuation?'<p>Discount source · '+html((valuation.record as ValuationRecord).reference)+'</p>':'')+'</section>'+(!full?diagnostics+peakEvents:'');
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
