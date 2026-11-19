import {amountCell,escapeHtml as html,financeUrl,metricLabel} from '/finance-view.js';
import type {Dictionary,Workspace as FinanceWorkspace} from '/finance-view.js';
import type {capitalWorkspace} from '../lib/finance-capital-workspace.ts';
import type {ScreenMetric} from '../lib/finance-workspace.ts';

type Workspace=ReturnType<typeof capitalWorkspace>;
type Option={key:string;label:string};
type Link=(module:string,key?:string,filters?:Record<string,string|null>)=>string;
export type ReturnView='cash'|'working-capital'|'irr'|'funding'|'sources'|'period'|'full';
type Scope={view:ReturnView;source:string;period:string;version:string};
const table=(headers:string[],body:string,name:string)=>'<div class="fin-table-scroll fin-capital-table fin-annual-scroll fin-returns-table" '+
  'tabindex="0" role="region" aria-label="'+html(name)+'"><table><thead><tr>'+
  headers.map(header=>'<th scope="col">'+html(header)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
const panel=(title:string,body:string,id='')=>'<section class="fin-panel fin-business-overview"'+(id?' id="'+id+'"':'')+'><h2>'+
  html(title)+'</h2>'+body+'</section>';
const td=(value:string|null|undefined)=>'<td>'+html(value??'—')+'</td>';
const th=(value:string)=>'<tr><th scope="row">'+html(value)+'</th>';
const percent=(value:string|null)=>value===null?'—':value+'%';
const measured=(metric:ScreenMetric|null|undefined,showRoundedZero=false)=>'<td>'+amountCell(metric)+
  (showRoundedZero&&metric?.value!=null&&metric.displayValue!=null&&Number(metric.value)!==0&&Number(metric.displayValue)===0?
    '<small class="fin-state">Rounded to zero</small>':'')+'</td>';
const auditNumber=(value:string|null)=>value?.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'').replace(/^-/,'−')??'—';
const days=(value:string|null)=>value===null?'—':new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(Number(value));
const statuses:Record<string,string>={ambiguous_irr:'Multiple sign changes',no_irr:'No meaningful IRR',solver_failed:'IRR could not be resolved',
  missing_input:'Cash inputs required',invalid_rate:'Invalid discount rate',ok:'Calculated'};

export function returnsPage(data:Workspace,scope:Scope,link:Link,periods:Option[],products:Option[],canEdit:boolean,dictionary:Dictionary,
  trace:(output:ScreenMetric|null|undefined)=>string,checks:FinanceWorkspace['returnChecks'],controls:FinanceWorkspace['returnControls']){
  const label=(options:Option[],key:string)=>options.find(item=>item.key===key)?.label??key;
  const period=(key:string)=>label(periods,key),product=(key:string)=>label(products,key);
  const currency=data.reportingCurrency;
  const returnLink=(view:ReturnView,filters:Record<string,string|null>={})=>link('returns','',{
    returnDetail:view==='cash'||view==='full'?null:view,basis:view==='full'?'full':null,...filters
  });
  const valuation=data.rows.find(row=>row.record.kind==='valuation');
  const terms=data.rows.flatMap(row=>row.record.kind==='terms'?[{key:row.key,record:row.record}]:[]);
  const source=data.rows.find(row=>row.key===scope.source||'edit-'+row.key===scope.source);
  const editable=canEdit&&!data.cashOnly;
  if(scope.source){
    if(source?.record.kind==='terms'){
      const r=source.record,detail=table(['Term','Value'],[
        ['Effective from',period(r.period)],['Receivable days',r.receivableDays],['Inventory days',r.inventoryDays],
        ['Payable days',r.payableDays],['Day basis',r.days+' days'],['Cash tax rate',percent(days(String(Number(r.tax)*100)))],
        ['Working capital treatment',r.release?'Release closing balance in '+period(r.period):'Carry closing balance forward']
      ].map(([name,value])=>th(name)+td(value)+'</tr>').join(''),'Working capital terms source');
      return {summary:'',body:'<section class="fin-panel" id="fin-capital-source"><h2>'+html(product(r.productKey)+' · Working capital terms')+'</h2>'+
        '<p>'+html(r.reference)+'</p>'+detail+(editable?'<div class="fin-actions">'+financeUrl(link('returns','edit-'+source.key),'Edit terms','fin-edit-terms')+'</div>':'')+'</section>'};
    }
    if(source?.record.kind==='valuation')return {summary:'',body:'<section class="fin-panel" id="fin-capital-source"><h2>Discount rate source</h2>'+
      '<p>'+html(source.record.reference)+'</p><p>'+html(percent(days(String(Number(source.record.discount)*100))))+'</p>'+
      (editable?financeUrl(link('returns','edit-'+source.key),'Edit discount rate','fin-valuation'):'')+'</section>'};
    return {summary:'',body:''};
  }

  if(scope.view==='working-capital'){
    if(data.cashOnly)return {summary:'',body:panel('Working capital unavailable','<p>This cash-flow reconciliation version has no working capital balances or operating terms.</p>')};
    const keys=['receivables','inventory','payables','nwc','nwc_change'];
    const rows=data.workingCapital.map(row=>{
      const title=row.source?financeUrl(link('returns',row.source,{period:data.workingPeriod,product:row.product}),product(row.product),
        'returns-terms-'+row.product):html(product(row.product));
      return '<tr><th scope="row">'+title+'<small class="fin-state">'+
        html(row.days===null?'Terms to collect':row.days+'-day basis'+(row.effectiveFrom?' · From '+period(row.effectiveFrom):''))+'</small></th>'+
        [row.receivableDays,row.inventoryDays,row.payableDays].map(value=>td(days(value))).join('')+
        keys.map(key=>measured(row.metrics[key])).join('')+'</tr>';
    }).join('');
    return {summary:'',body:panel('Working capital by product','<p class="fin-muted">'+html(period(data.workingPeriod)+' · Closing balances in '+currency)+
      '. Payables reduce the net balance. A positive cash movement releases funds.</p>'+
      (rows?table(['Product','Receivable days','Inventory days','Payable days','Receivables','Inventory','Payables','Net working capital','Cash movement'],
        rows,'Working capital by product'):'<p>No working capital scope is available.</p>')+
      '<div class="fin-actions">'+financeUrl(returnLink('period',{period:data.workingPeriod}),'Open period cash and sources')+
        financeUrl(returnLink('sources'),'Terms and source records')+'</div>')};
  }

  if(scope.view==='irr'){
    const audit=data.irrAudit,terminal=audit.rows.at(-1);
    const suffix=(amount:string|null,currency:string)=>amount===null?'—':auditNumber(amount)+' '+currency;
    const status=(code:string)=>statuses[code]??'Unavailable';
    const compare=th(scope.version)+td(suffix(terminal?.amount??null,audit.currency))+td(percent(audit.precisionRate))+td(status(audit.status))+'</tr>'+
      checks.map(check=>'<tr><th scope="row">'+financeUrl(returnLink('irr',{version:check.id,period:null}),check.name,
        'returns-reconciliation-'+check.id)+'</th>'+td(suffix(check.terminal,check.currency))+td(percent(check.irr))+
        td(check.period+' · '+status(check.status))+'</tr>').join('')+
      (controls?th('Original workbook')+td(suffix(controls.terminal,controls.currency))+td(percent(controls.irr))+
        td(controls.irrSource+' · '+controls.cashSource)+'</tr>':'');
    const auditRows=audit.rows.map(row=>th(period(row.period))+td(suffix(row.amount,audit.currency))+
      td(row.sign===null?'Unavailable':row.sign<0?'Negative':row.sign>0?'Positive':'Zero')+(row.changed?td('Sign changed'):td(null))+'</tr>').join('');
    return {summary:'',body:panel('IRR calculation details','<p class="fin-muted">Each version uses its own cash inputs. Audit cash is shown in each version’s calculation currency.</p>'+
      table(['Calculation basis','Final-period cash','IRR at audit precision','Status / source'],compare,'IRR version reconciliation')+
      '<h3>Cash inputs for '+html(scope.version)+'</h3><p>Sign changes across nonzero cash flows: '+html(audit.changes)+'.</p>'+
      (audit.message?'<p>'+html(audit.message)+'</p>':'')+
      table(['Period','Cash input at audit precision','Sign','Change from previous nonzero cash'],auditRows,'IRR inputs by period'),'fin-irr-diagnostic')};
  }

  if(scope.view==='funding'){
    const peak=periods.findIndex(item=>item.key===data.fundingPeriod);
    const order=(key:string)=>periods.findIndex(item=>item.key===key);
    const through=data.events.filter(row=>peak>=0&&order(row.period)<=peak);
    const later=data.events.filter(row=>peak>=0&&order(row.period)>peak&&row.kind!=='payment');
    const labels={payment:'Payment',receipt:'One-time recovery',salvage:'Residual receipt',piece_receipt:'Piece-price receipt'};
    const events=(items:typeof data.events,name:string)=>table(['Period','Type','Product','Capital cash source','Amount','Evidence'],
      items.map(row=>th(period(row.period))+td(labels[row.kind])+td(row.product?product(row.product):null)+
        '<td>'+financeUrl(link('investment',row.key),row.label,'capital-event-'+row.id)+'</td>'+
        td((row.kind==='payment'?'−':'+')+row.amount+' '+data.currency)+td(row.reference+' · '+(row.actual?'Actual':'Forecast'))+'</tr>').join(''),name);
    return {summary:'',body:panel('Funding sources through the low point',
      (data.fundingPeriod?'<p>First minimum · '+html(period(data.fundingPeriod))+
        (data.recoveryPeriod?' · First recovery '+html(period(data.recoveryPeriod)):'')+'</p>':'<p>No funding low point is available for this scope.</p>')+
      (through.length?events(through,'Capital cash through the low point'):'<p>No identified capital event at or before the low point.</p>')+
      (later.length?'<h3>Later capital receipts</h3>'+events(later,'Capital receipts after the low point'):'')+
      (data.fundingPeriod?'<div class="fin-actions">'+financeUrl(returnLink('period',{period:data.fundingPeriod}),'Open low-point cash and sources')+'</div>':''),
      'fin-funding-events')};
  }

  if(scope.view==='sources'){
    const legacy=data.archiveAssumptions.length?'<details class="fin-capital-archive"><summary>P05 working capital, tax and discount sources</summary>'+
      table(['Product','Inventory','Receivables','Payables','Tax','Discount'],data.archiveAssumptions.map(row=>th(product(row.product))+
        [row.inventory,row.ar,row.ap,row.tax,row.discount].map(cell=>td((cell.value??'Unavailable')+' · '+cell.reference)).join('')+'</tr>').join(''),
      'Archived working capital and tax sources')+'</details>':'';
    const actions='<div class="fin-actions">'+(data.cashOnly?'':financeUrl(link('investment'),'Equipment & Investment','fin-returns-investment')+
      financeUrl(returnLink('full'),'Full-cost basis','fin-basis-full'))+
      (editable?financeUrl(link('returns','new-terms'),'Add working-capital and tax terms','fin-new-terms')+
        financeUrl(link('returns',valuation?'edit-'+valuation.key:'new-valuation'),'Set discount rate','fin-valuation'):'')+'</div>';
    return {summary:'',body:panel('Returns source records',actions+
      (valuation?.record.kind==='valuation'?'<p>Discount source · '+financeUrl(link('returns',valuation.key),valuation.record.reference)+'</p>':'')+
      (terms.length?table(['Source','Product','Effective from','AR / AP / inventory days','Tax rate'],terms.map(row=>
        '<tr><th scope="row">'+financeUrl(link('returns',row.key,{product:row.record.productKey}),row.record.reference,
          'capital-terms-'+row.key)+'</th>'+td(product(row.record.productKey))+td(period(row.record.period))+
        td([row.record.receivableDays,row.record.payableDays,row.record.inventoryDays].join(' / '))+td(percent(days(String(Number(row.record.tax)*100))))+'</tr>').join(''),
      'Working capital and tax assumptions'):'<p>No structured working capital or tax terms are recorded for this scope.</p>')+legacy)};
  }

  if(scope.view==='full'){
    const keys=['reported_profit','depreciation','incremental_profit','incremental_depreciation'];
    const totals=[data.isArchive?'cqa.mpbitri':'operating_profit','full_cost_management_profit','incremental_profit']
      .filter(key=>data.totals[key]).map(key=>'<tr><th scope="row">'+metricLabel(dictionary,key)+'</th>'+measured(data.totals[key])+'</tr>').join('');
    return {summary:'',body:panel('Full-cost profitability','<div class="fin-actions">'+
      financeUrl(returnLink('cash'),'Incremental cash basis','fin-basis-incremental')+'</div>'+
      '<p>Full-cost profit includes allocated depreciation and costs. Return metrics use incremental cash.</p>'+
      (totals?table(['Lifecycle measure','Amount'],totals,'Lifecycle full-cost totals'):'')+
      table(['Period','Full-cost profit','Full-cost depreciation','Incremental profit','Incremental depreciation'],data.accounting
        .filter(row=>!scope.period||row.period===scope.period).map(row=>th(period(row.period))+keys.map(key=>measured(row.metrics[key])).join('')+'</tr>').join(''),
      'Full-cost profitability by period'))};
  }

  const cashKeys=['cash_flow','cumulative_cash','present_value'];
  if(scope.view==='period'){
    const record=data.accounting.find(row=>row.period===scope.period);
    if(!record)return {summary:'',body:panel('Period cash unavailable','<p>Select a forecast period to open cash and sources.</p>')};
    const keys=data.cashOnly?cashKeys:[...cashKeys,'nwc_change','nwc','signed_tax','capital_payments','capital_receipts',
      'capital_piece_cash','capital_salvage','incremental_profit'];
    return {summary:'',body:panel(period(record.period)+' · Cash and sources',
      '<p class="fin-muted">Incremental cash basis · '+html(currency)+'</p>'+
      table(['Measure','Amount','Source'],keys.map(key=>'<tr><th scope="row">'+metricLabel(dictionary,key)+'</th>'+
        measured(record.metrics[key],key==='cash_flow')+'<td>'+trace(record.metrics[key])+'</td></tr>').join(''),'Cash measures and sources')+
      '<div class="fin-actions">'+(data.cashOnly?'':financeUrl(returnLink('working-capital'),'Working capital for this period'))+
      financeUrl(returnLink('sources'),'Connected inputs for this period')+
      financeUrl(returnLink('irr'),'Review cash precision')+'</div>')};
  }

  const card=(name:string,value:string,context:string)=>'<section class="fin-metric"><div class="fin-metric-label">'+name+
    '</div><div class="fin-summary-value">'+value+'</div><small class="fin-state">'+html(context)+'</small></section>';
  const rate=data.totals.discount_rate?.displayValue;
  const horizon='Full horizon';
  const summary='<div class="fin-metrics fin-overview-metrics fin-returns-summary" aria-label="Returns summary">'+
    card('Net present value',amountCell(data.totals.npv),horizon+(rate?' · '+rate+'% discount rate':''))+
    card('Payback period',data.paybackPrecision&&data.totals.payback_period?.status==='ok'?
      '<strong class="fin-value">'+html(data.paybackPrecision+' yr')+'</strong>':amountCell(data.totals.payback_period),
      horizon+(data.recoveryPeriod?' · First recovery '+period(data.recoveryPeriod):''))+
    card(financeUrl(returnLink('funding'),'Peak funding requirement','fin-returns-funding'),amountCell(data.totals.peak_funding_requirement),
      horizon+(data.fundingPeriod?' · '+period(data.fundingPeriod):''))+
    card(financeUrl(returnLink('irr'),'IRR','fin-returns-irr'),data.irrAudit.status==='ambiguous_irr'?
      '<strong class="fin-value">Review</strong>':amountCell(data.totals.irr),
      data.irrAudit.status==='ambiguous_irr'?'Multiple sign changes':horizon)+'</div>';
  const rows=data.accounting.filter(row=>!scope.period||row.period===scope.period);
  const keys=data.cashOnly?cashKeys:[...cashKeys,'nwc_change'];
  return {summary,body:panel('Period Cash Flow','<p class="fin-muted">'+html((scope.period?period(scope.period):'Full lifecycle')+' · '+currency)+
    '. Select a period to review its cash components and sources.</p>'+
    (data.cashOnly?'<p class="fin-muted">Cash-flow reconciliation version · Explicit cash inputs by period.</p>':'')+
    table(['Period','Net cash flow','Cumulative cash flow','Discounted cash flow',...(data.cashOnly?[]:['Working capital movement'])],
      rows.map(row=>'<tr><th scope="row">'+financeUrl(returnLink('period',{period:row.period}),period(row.period),'returns-period-'+row.period)+'</th>'+
        keys.map(key=>measured(row.metrics[key],key==='cash_flow')).join('')+'</tr>').join(''),'Lifecycle cash flow'))};
}
