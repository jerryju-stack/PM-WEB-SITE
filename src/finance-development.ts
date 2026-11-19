import {escapeHtml as html,financeUrl,metricLabel} from '/finance-view.js';
import type {Dictionary} from '/finance-view.js';
import type {OperationEditor} from '/finance-impact.js';
import type {DevelopmentCost,DevelopmentModule} from '../lib/finance-development.ts';
import type {developmentWorkspace} from '../lib/finance-development-calculation.ts';
import type {ValidationPhase} from '../lib/finance-validation-workspace.ts';
import {currencyOptions} from '/finance-fx.js';

type Workspace=ReturnType<typeof developmentWorkspace>;
type Source=Workspace['rows'][number];
type Item={key:string;label:string};
type Link=(module:DevelopmentModule,key?:string,changes?:Record<string,string|null>)=>string;
type Rights=Partial<Record<DevelopmentModule,boolean>>;
const labels={engineering:'Engineering & PM',prototypes:'Prototype Batches',validation:'Validation & Certification'};
const categoryLabels={labor:'Development labor',travel:'Travel',sample:'Sample batch',package:'Test package',internal_test:'Internal test (person-hours)',
  external_test:'External test / laboratory',fixture:'Fixture',certification:'Certification',retest:'Retest'};
const categoryKeys={engineering:['labor','travel'],prototypes:['sample'],validation:['package','internal_test','external_test','fixture','certification','retest']};
const components={engineering:{rate:'Hourly rate / travel unit cost',travel:'Additional travel total'},
  prototypes:{material:'Material',processing:'Processing',labor:'Prototype labor',expedite:'Expedite',freight:'Shipping'},
  validation:{rate:'Rate per hour or item / package'}};
const recoveryLabel={none:'Project-funded',lump_sum:'Customer lump sum',piece_price:'Customer piece-price uplift'};
const table=(headers:string[],rows:string,label='',className='')=>'<div class="fin-table-scroll fin-dev-table'+(className?' '+className:'')+
  (label?' fin-annual-scroll" tabindex="0" role="region" aria-label="'+html(label):'')+
  '"><table><thead><tr>'+headers.map(header=>'<th scope="col">'+header+'</th>').join('')+
  '</tr></thead><tbody>'+rows+'</tbody></table></div>';
const td=(value:string|number|null|undefined)=>'<td>'+html(value??'—')+'</td>';
const title=(value:string)=>'<h3>'+html(value)+'</h3>';
const field=(name:string,label:string,value='',attributes='required')=>'<label>'+html(label)+'<input name="'+html(name)+'" value="'+html(value)+'" '+attributes+'></label>';
const decimal=(name:string,label:string,value='',required=true)=>field(name,label,value,'inputmode="decimal" '+(required?'required':''));
const textField=(name:string,label:string,value='',limit=160)=>field(name,label,value,'required maxlength="'+limit+'"');
const select=(name:string,label:string,items:Item[],value:string)=>'<label>'+html(label)+'<select name="'+html(name)+'" required>'+
  items.map(item=>'<option value="'+html(item.key)+'" '+(value===item.key?'selected':'')+'>'+html(item.label)+'</option>').join('')+'</select></label>';
const entries=(labels:Record<string,string>)=>Object.entries(labels).map(([key,label])=>({key,label}));
const factTypes=['incurred','payment','receipt'] as const;
const factLabels={incurred:'Actual occurrence',payment:'Actual payment',receipt:'Actual customer receipt'};
const summaryKeys=['development_budget','development_gross','development_actual','development_remaining','development_recovery','net_engineering','development_cash'];

function renderDetails(row:Source,link:Link,periodLabel:(s:string)=>string,productLabel:(s:string)=>string,currency:string,canEdit:boolean,reportingCurrency=currency){
  const {cost,actual}=row,recovery=cost.recovery;
  const item=(label:string,value:string)=>'<dt>'+html(label)+'</dt><dd>'+html(value)+'</dd>';
  const engineeringBasis=cost.module==='engineering'?
    (row.labor!==null?item('Planned hours',cost.quantity+' h')+
      item('Hourly rate',cost.components.rate==null?'To collect':cost.components.rate+' '+currency+'/h'):'')+
    item('Travel forecast',row.travel+' '+currency)+
    item('Occurrence evidence',actual?.incurred?'Recorded':'To collect')+item('Payment evidence',actual?.payment?'Recorded':'To collect'):'';
  const prototypeBasis=cost.module==='prototypes'?(row.quoteBundle?
    item('Forecast basis',cost.quantity+' quote package'+(cost.quantity==='1'?'':'s'))+item('Planned pieces','To collect'):
    item('Planned / covered pieces',cost.quantity+' / '+row.coveredQuantity))+
    item('Delivery date and received pieces','To collect')+item('Delivery / acceptance evidence','To collect')+
    item('Cost occurrence evidence',actual?.incurred?'Recorded':'To collect')+
    item('Payment evidence',actual?.payment?'Recorded':'To collect')+
    (reportingCurrency!==currency?item('Converted forecast',row.reporting===null?'Exchange rate to collect':row.reporting+' '+reportingCurrency):''):'';
  const validationBasis=cost.module==='validation'?item('Required / covered',cost.quantity+' / '+row.coveredQuantity)+
    item(cost.category==='certification'?'Certificate number and issue date':'Test report reference and completion date','To collect')+
    item('Cost occurrence evidence',actual?.incurred?'Recorded':'To collect')+
    item('Payment evidence',actual?.payment?'Recorded':'To collect')+
    (reportingCurrency!==currency?item('Converted forecast',row.reporting===null?'Exchange rate to collect':row.reporting+' '+reportingCurrency):''):'';
  return '<article class="fin-dev-source" id="fin-development-source">'+title(cost.title)+'<p>'+html(cost.costRef)+' · '+html(cost.group)+' · '+html(categoryLabels[cost.category])+
    (cost.stage?' · '+html(cost.stage):'')+(cost.role?' · '+html(cost.role):'')+'</p>'+
    '<dl>'+item('Evidence',cost.reference)+engineeringBasis+prototypeBasis+validationBasis+
    item('Expected payable',row.planned+' '+currency)+item('Occurrence / payment period',periodLabel(cost.period)+' / '+periodLabel(cost.paymentPeriod))+
    item('Product allocation',cost.allocations.map(item=>productLabel(item.productKey)+' '+(Number(item.share)*100).toFixed(2)+'%').join(', '))+
    item('Allocation basis',cost.allocationBasis)+item('Customer responsibility',recoveryLabel[recovery.method])+
    (recovery.method==='none'?'':item('Recovery basis',recovery.amount+' '+currency+(recovery.method==='piece_price'?'/piece · '+productLabel(recovery.productKey):'')+
      ' · Earn '+periodLabel(recovery.earnedPeriod)+' · Receive '+periodLabel(recovery.receiptPeriod)))+'</dl>'+
    '<p>'+Object.entries(cost.components).map(([key,value])=>html(components[cost.module][key])+' '+html(value)+' '+html(currency)).join(' · ')+'</p>'+
    (row.related.length?'<p>Covered by '+row.related.map(target=>financeUrl(link('validation',target.provider),target.title)+' ('+html(target.quantity)+')').join(', ')+'</p>':'')+
    (row.includes.length?'<p>Package includes '+row.includes.map(target=>financeUrl(link(target.module,target.key),target.title)+' ('+html(target.quantity)+')').join(', ')+'</p>':'')+
    (actual?table(['Execution event','Amount','Period','Date','Evidence'],factTypes.flatMap(kind=>{
      const fact=actual[kind];
      return fact?['<tr><th scope="row">'+factLabels[kind]+'</th>'+td(fact.amount+' '+row.actualCurrency)+td(periodLabel(fact.period))+td(fact.date)+td(fact.reference)+'</tr>']:[];
    }).join('')):'')+
    (canEdit?'<div class="fin-actions">'+(!actual?financeUrl(link(cost.module,'edit-'+row.key),'Edit forecast','fin-development-edit'):'')+
      financeUrl(link(cost.module,'actual-'+row.key),actual?'Review actuals':'Record actuals','fin-development-actual')+'</div>':'')+'</article>';
}

export function developmentPage(data:Workspace,module:DevelopmentModule,source:string,link:Link,periods:Item[],products:Item[],rights:Rights,activeDraft:boolean,dictionary:Dictionary){
  const label=(list:Item[],key:string)=>list.find(item=>item.key===key)?.label??key;
  const periodLabel=(key:string)=>label(periods,key),productLabel=(key:string)=>label(products,key);
  const row=data.rows.find(item=>item.key===source||'actual-'+item.key===source||'edit-'+item.key===source);
  const archive=data.archivedRows.length?'<details class="fin-dev-archive"'+(module==='validation'?' open':'')+'><summary>P05 workbook sources</summary>'+
    '<p>DV includes samples and fixtures. PV columns V–X are covered by DV and excluded from the PV total. PM routes EU/NA shares to Financials 426. Financials 427 records customer recovery separately.</p>'+
    table(['Original source','Product','Value','Scope'],data.archivedRows.map(item=>'<tr><th scope="row">'+html(item.source)+'</th>'+
      td(item.productKey?productLabel(item.productKey):'Shared')+td(item.amount+' '+item.unit)+td(item.covered?'Covered by DV':'Archived forecast')+'</tr>').join(''))+'</details>':'';
  const actions=activeDraft?'<div class="fin-actions">'+(rights[module]?financeUrl(link(module,'new'),'New cost','fin-development-new'):'')+
    (data.editable.some(item=>rights[item.cost.module])?financeUrl(link(module,'combine'),'Preview multiple costs','fin-development-combine'):'')+'</div>':'';
  const metrics=table(['Period',...summaryKeys.map(key=>metricLabel(dictionary,key))],data.series.map(period=>'<tr><th scope="row">'+html(periodLabel(period.period))+'</th>'+
    summaryKeys.map(key=>td(period.metrics[key]==null?null:period.metrics[key]+' '+data.currency)).join('')+'</tr>').join(''));
  const list=data.rows.length?table(['Source row','Stage / batch / round','Occurrence','Payment','Net payable forecast'],data.rows.map(item=>
    '<tr><th scope="row">'+financeUrl(link(module,item.key),item.cost.title,'development-'+item.key)+'<small class="fin-state">'+html(item.cost.costRef)+'</small></th>'+
    td(item.cost.group)+td(periodLabel(item.cost.period))+td(periodLabel(item.cost.paymentPeriod))+td(item.planned+' '+item.originalCurrency)+'</tr>').join('')):'<p>No development records in this scope.</p>';
  const heading={engineering:'Engineering cost records & financials',prototypes:'Prototype cost records & financials',validation:'Validation cost records & financials'};
  return '<section class="fin-panel"><div class="fin-panel-head"><h2>'+html(heading[module])+'</h2></div><div class="fin-actions">'+
    (Object.keys(labels) as DevelopmentModule[]).filter(key=>key!==module).map(key=>financeUrl(link(key),labels[key])).join('')+'</div>'+
    '<h3>Development by period</h3>'+metrics+(archive?'<p class="fin-muted">Gross development and development cash here show added detail. Net engineering includes the archived Financials schedule.</p>':'')+
    actions+list+(row?renderDetails(row,link,periodLabel,productLabel,row.originalCurrency,!!rights[module]&&activeDraft):'')+archive+'</section>';
}

export type EngineeringView='packages'|'validation-hours'|'records';
type EngineeringScope={view:EngineeringView;source:string;workPackage:string;specification:string;period:string;product:string};

function engineeringMoney(data:Workspace,value:string|null,currency=data.currency) {
  if(value===null)return '—';
  const scale=data.currencies[currency];
  return new Intl.NumberFormat('en',{minimumFractionDigits:scale,maximumFractionDigits:scale}).format(Number(value));
}
const hours=(value:string|null)=>value===null?'—':new Intl.NumberFormat('en',{maximumFractionDigits:8}).format(Number(value));
const engineeringPanel=(heading:string,body:string)=>'<section class="fin-panel fin-business-overview"><h2>'+html(heading)+'</h2>'+body+'</section>';

function engineeringValidation(data:Workspace,scope:EngineeringScope,link:Link,productLabel:(key:string)=>string) {
  const note='<p class="fin-muted">Quoted hours for the full validation specification. Costs remain in the paying validation package.</p>';
  const specification=data.validationHours.find(row=>String(row.row)===scope.specification);
  if(scope.specification){
    if(!specification)return engineeringPanel('Validation hours unavailable','<p>This specification has no verified quote evidence in the selected scope.</p>');
    return engineeringPanel(specification.description,note+
      table(['Validation phase','Role','Quoted hours','Workbook cell'],specification.groups.flatMap(group=>group.roles.map(role=>
        '<tr><th scope="row">'+html(group.stage)+'</th>'+td(role.label)+
        td(role.hours===null?'Not recorded':hours(role.hours)+(role.formula?' · Formula result':''))+td(role.source)+'</tr>'
      )).join(''),'Validation roles and source cells')+
      '<div class="fin-actions fin-dev-actions">'+specification.groups.flatMap(group=>group.cost?
        [financeUrl(link('validation',group.cost.key,{period:group.cost.period,product:scope.product||null}),group.stage+' cost record',
          'engineering-validation-cost-'+group.stage.toLowerCase().replaceAll(' ','-'))]:[]).join('')+'</div>');
  }
  const records=data.validationHours.map(row=>'<tr><th scope="row">'+financeUrl(link('engineering','',{validationSpec:String(row.row)}),
    row.description,'engineering-spec-'+row.row)+'<small class="fin-state">'+html(row.products.map(productLabel).join(', '))+'</small></th>'+
    row.groups.map(group=>td(group.total===null?'— · Incomplete':hours(group.total))).join('')+'</tr>').join('');
  return engineeringPanel('Validation engineering hours',note+(records?
    table(['Product / specification','Europe DV (h)','China DV (h)','China PV (h)'],records,'Validation hours by specification'):
    '<p>No verified workbook hours are available for this scope. '+financeUrl(link('validation'),'Open validation cost records')+'</p>'));
}

export function engineeringPage(data:Workspace,scope:EngineeringScope,link:Link,periods:Item[],products:Item[],rights:Rights,draft:boolean,dictionary:Dictionary) {
  const periodLabel=(key:string)=>periods.find(item=>item.key===key)?.label??key;
  const productLabel=(key:string)=>products.find(item=>item.key===key)?.label??key;
  if(scope.source){
    const row=data.rows.find(item=>[item.key,'edit-'+item.key,'actual-'+item.key].includes(scope.source));
    return {summary:'',body:row?'<section class="fin-panel">'+renderDetails(row,link,periodLabel,productLabel,row.originalCurrency,!!rights.engineering&&draft)+'</section>':''};
  }
  if(scope.view==='records')return {summary:'',body:developmentPage(data,'engineering','',link,periods,products,rights,draft,dictionary)};
  if(scope.view==='validation-hours')return {summary:'',body:engineeringValidation(data,scope,link,productLabel)};
  const money=(value:string|null,code=data.currency)=>engineeringMoney(data,value,code);
  if(scope.workPackage){
    const plan=data.engineeringPackages.find(item=>item.key===scope.workPackage);
    if(!plan)return {summary:'',body:engineeringPanel('Work package unavailable','<p>There are no forecast records for this work package in the selected product and period.</p>')};
    const records=data.rows.filter(row=>plan.items.includes(row.key)).sort((a,b)=>
      periods.findIndex(period=>period.key===a.cost.period)-periods.findIndex(period=>period.key===b.cost.period));
    const lines=records.map(row=>'<tr><th scope="row">'+financeUrl(link('engineering',row.key,{period:row.cost.period}),periodLabel(row.cost.period),
      'engineering-period-'+row.key)+'</th>'+td(row.labor===null?null:hours(row.cost.quantity))+
      td(row.labor===null||row.cost.components.rate==null?null:money(row.cost.components.rate,row.originalCurrency)+' '+row.originalCurrency)+
      td(row.labor===null?null:money(row.labor,row.originalCurrency)+' '+row.originalCurrency)+td(money(row.travel,row.originalCurrency)+' '+row.originalCurrency)+
      td(money(row.planned,row.originalCurrency)+' '+row.originalCurrency)+td(row.actual?.incurred?'Occurrence recorded':'Occurrence evidence to collect')+'</tr>').join('');
    return {summary:'',body:engineeringPanel(plan.title,'<p class="fin-muted">'+html(plan.source)+
      ' · Original amounts for each period record. Select a period to open its source and actions.</p>'+
      table(['Occurrence period','Hours','Rate / h','Labor','Travel','Planned cost','Execution evidence'],lines,'Work package period records'))};
  }

  const pm=data.pmTotals;
  const period=scope.period?periodLabel(scope.period):'All forecast periods';
  const cards=[
    ['PM planned hours',hours(pm?.hours??null),'h · '+period],
    ['PM labor',money(pm?.labor??null),data.currency+' · '+period],
    ['PM travel',money(pm?.travel??null),data.currency+' · '+period],
    ['PM planned cost',money(pm?.total??null),data.currency+' · '+period]
  ];
  const summary='<div class="fin-metrics fin-overview-metrics" aria-label="Engineering summary">'+cards.map(([label,value,caption])=>
    '<section class="fin-metric"><div class="fin-metric-label">'+html(label)+'</div><div class="fin-summary-value"><strong class="fin-value">'+html(value)+
    '</strong></div><small class="fin-state">'+html(caption)+'</small></section>').join('')+'</div>';
  const records=data.engineeringPackages.map(plan=>{
    const label=(scope.product?[scope.product]:plan.products).map(productLabel).join(', ');
    const actuals=data.rows.filter(row=>plan.items.includes(row.key)&&row.actual?.incurred).length;
    const status=actuals===0?'Awaiting actuals':actuals===plan.items.length?'Occurrence recorded':'Partial actuals';
    return '<tr><th scope="row">'+financeUrl(link('engineering','',{engineeringPackage:plan.key}),plan.title,'engineering-package-'+plan.key)+
      '<small class="fin-state">'+html([label,plan.role].filter(Boolean).join(' · '))+'</small></th>'+td(hours(plan.hours))+
      td(plan.rate?money(plan.rate.value,plan.rate.currency)+' '+plan.rate.currency:plan.multipleRates?'Varies by period':'—')+
      td(money(plan.labor))+td(money(plan.travel))+td(money(plan.total))+td(status)+'</tr>';
  }).join('');
  const missingRates=data.engineeringPackages.some(plan=>plan.total===null);
  return {summary,body:engineeringPanel('Engineering work packages','<p class="fin-muted">'+html(period+' · '+data.currency)+
    ' · Select a work package to review its period records. Filtered totals use the selected product’s allocation.</p>'+
    (missingRates?'<p class="fin-muted">Some reporting amounts need a period exchange rate. The period records show amounts in their original currencies.</p>':'')+
    (records?table(['Product / specification','Planned hours','Hourly rate','Labor','Travel','Planned cost','Execution status'],
      records,'Engineering work packages'):'<p>No engineering work package is recorded for this scope.</p>'))};
}

export type PrototypeView='quotes'|'delivery'|'records';
type PrototypeScope={view:PrototypeView;source:string;group:string;period:string;product:string};

export function prototypePage(data:Workspace,scope:PrototypeScope,link:Link,periods:Item[],products:Item[],rights:Rights,draft:boolean,dictionary:Dictionary) {
  const periodLabel=(key:string)=>periods.find(item=>item.key===key)?.label??key;
  const productLabel=(key:string)=>products.find(item=>item.key===key)?.label??key;
  const money=(value:string|null,code=data.currency)=>value===null?null:engineeringMoney(data,value,code);
  const panel=engineeringPanel;
  if(scope.source){
    const row=data.rows.find(item=>[item.key,'edit-'+item.key,'actual-'+item.key].includes(scope.source));
    return {summary:'',body:row?'<section class="fin-panel">'+renderDetails(row,link,periodLabel,productLabel,row.originalCurrency,!!rights.prototypes&&draft,
      data.currency)+'</section>':''};
  }
  if(scope.view==='records')return {summary:'',body:developmentPage(data,'prototypes','',link,periods,products,rights,draft,dictionary)};
  const model=data.prototypes!;
  const sources=new Map(data.rows.map(row=>[row.key,row]));
  const byPeriod=(a:string,b:string)=>periods.findIndex(item=>item.key===a)-periods.findIndex(item=>item.key===b);
  const kind=(item:{factor:string|null;classified:boolean},row:Source)=>item.factor?'Europe rush samples':
    item.classified?'China samples / performance check & shipping':row.cost.title;
  const group=model.groups.find(item=>item.key===scope.group);
  if(scope.group){
    if(!group)return {summary:'',body:panel('Quote package unavailable','<p>No package records match the selected product and period.</p>')};
    const records=group.items.map(item=>({...item,row:sources.get(item.key)!}))
      .sort((a,b)=>byPeriod(a.row.cost.period,b.row.cost.period)||Number(Boolean(b.factor))-Number(Boolean(a.factor)));
    const detail=table(['Occurrence period','Cost record','Source','Forecast basis','Net payable','Payment evidence'],records.map(item=>{
      const row=item.row,period=row.cost.period;
      return '<tr><th scope="row">'+html(periodLabel(period))+'</th><td>'+
        financeUrl(link('prototypes',row.key,{period}),kind(item,row),'prototype-record-'+row.key)+'</td>'+
        td(row.cost.reference)+td(row.cost.quantity+(row.quoteBundle?(row.cost.quantity==='1'?' package':' packages'):' pcs'))+
        td(engineeringMoney(data,row.planned,row.originalCurrency)+' '+row.originalCurrency)+
        td(row.actual?.payment?'Recorded':'To collect')+'</tr>';
    }).join(''),'Prototype period cost records');
    const coverage=group.row?'<h3>Samples included in DV testing</h3><p class="fin-muted">The DV testing package pays for its included samples and fixtures. '+
      'Its amount is excluded from the independent sample forecast.</p>'+
      (group.coverage.length?'<div class="fin-actions">'+group.coverage.slice().sort((a,b)=>byPeriod(a.period,b.period)).map(item=>
        financeUrl(link('validation',item.key,{period:item.period}),periodLabel(item.period)+' · '+item.reference,
          'prototype-dv-'+item.key)).join('')+'</div>':'<p>DV package source to collect for this scope.</p>'):'';
    const basis=records.some(item=>item.factor&&item.factor!=='1')?
      '<p class="fin-muted">The EUR records below already include the quote factor shown in their source references.</p>':'';
    const china=records.some(item=>item.classified&&!item.factor)?
      '<p class="fin-muted">Samples and performance checks are quoted together. Shipping is recorded separately.</p>':'';
    return {summary:'',body:panel(group.title,basis+china+detail+coverage)};
  }
  const scopeLabel=scope.period?periodLabel(scope.period):'All forecast periods';
  const groupCell=(item:typeof model.groups[number])=>'<th scope="row">'+financeUrl(link('prototypes','',{prototypeGroup:item.key}),
    item.title,'prototype-group-'+item.key)+'<small class="fin-state">'+
    html((scope.product?[scope.product]:item.products).map(productLabel).join(', '))+'</small></th>';
  if(scope.view==='delivery'){
    const status=(count:number,total:number)=>count===0?'To collect':count===total?'Recorded':'Partial evidence';
    const records=model.groups.map(item=>{
      const rows=item.items.map(row=>sources.get(row.key)!);
      const recorded=rows.filter(row=>!row.quoteBundle);
      const planned=recorded.length!==rows.length?'To collect':recorded.map(row=>row.cost.quantity+' pcs').join(' / ');
      return '<tr>'+groupCell(item)+td(planned)+td('To collect')+td('To collect')+td('To collect')+
        td(status(rows.filter(row=>row.actual?.payment).length,rows.length))+'</tr>';
    }).join('');
    return {summary:'',body:panel('Delivery and evidence','<p class="fin-muted">'+html(scopeLabel)+
      ' · Select a package or batch to review its records. Delivery evidence requires a dated receipt with the actual piece count.</p>'+
      (records?table(['Product / specification','Planned pieces','Target delivery date','Delivered pieces','Delivery / acceptance evidence',
        'Payment evidence'],records,'Prototype delivery and evidence','fin-prototype-table'):'<p>No prototype packages or batches are recorded for this scope.</p>'))};
  }
  const {summary:totals}=model;
  const columns=[['Europe rush samples','rush','EUR'],['China samples & performance check','inspection','CNY'],['Sample shipping','freight','CNY']] as const;
  const cards=[['Independent sample forecast',totals.total,data.currency],
    ...(model.classified?columns.map(([label,key,code])=>[label,totals[key],code]):[])];
  const summary='<div class="fin-metrics fin-overview-metrics" aria-label="Prototype summary">'+cards.map(([label,value,code])=>
    '<section class="fin-metric"><div class="fin-metric-label">'+html(label)+'</div><div class="fin-summary-value"><strong class="fin-value">'+html(money(value,code!)??'—')+
    '</strong></div><small class="fin-state">'+html(code+' · '+scopeLabel)+'</small></section>').join('')+'</div>';
  const records=model.groups.map(item=>'<tr>'+groupCell(item)+
    (model.classified?columns.map(([,key,code])=>td(money(item[key],code))).join(''):'')+td(money(item.total))+
    td(item.row?'Quote package':sources.get(item.items[0].key)?.quoteBundle?'Quote package':'Physical batch')+'</tr>').join('');
  const classifiedNote=model.classified?'<p class="fin-muted">Europe rush is shown in EUR before any quote factor. '+
    'The forecast total uses the applied quote factors and version exchange rates. DV package amounts stay in Validation.</p>':'';
  const missingRate=model.groups.some(item=>item.total===null)?
    '<p class="fin-muted">A period exchange rate is missing for one or more amounts. Original currencies remain available in the cost records.</p>':'';
  return {summary,body:panel('Sample quotes and batches','<p class="fin-muted">'+html(scopeLabel+' · Reporting currency '+data.currency)+
    ' · Select a specification or batch to review source records.</p>'+classifiedNote+missingRate+
    (records?table(['Product / specification',...(model.classified?columns.map(([label,,code])=>label+' ('+code+')'):[]),
      'Independent forecast ('+data.currency+')','Quantity basis'],records,'Prototype quote packages','fin-prototype-table'):
      '<p>No prototype forecast is recorded for this scope. '+financeUrl(link('prototypes','',{prototypeView:'records'}),'Open cost records')+'</p>'))};
}

export type ValidationView='packages'|'coverage'|'records';
type ValidationScope={view:ValidationView;source:string;group:string;phase:ValidationPhase|null;period:string;product:string};
const validationPhaseNames={'europe-dv':'Europe DV','china-dv':'China DV','china-pv':'China PV',other:'Other test costs'};
const validationComponentNames:Record<string,string>={
  M:'DV testing package with samples & fixtures',T:'DV engineering labor',V:'System licence',W:'Homologation',
  AB:'DV labor and travel',O:'PV test fixture',Y:'PV validation, labor & other costs'
};

export function validationPage(data:Workspace,scope:ValidationScope,link:Link,periods:Item[],products:Item[],rights:Rights,draft:boolean,
  dictionary:Dictionary) {
  const periodLabel=(key:string)=>periods.find(item=>item.key===key)?.label??key;
  const productLabel=(key:string)=>products.find(item=>item.key===key)?.label??key;
  const reporting=(value:string|null,code=data.currency)=>value===null?null:engineeringMoney(data,value,code);
  const panel=engineeringPanel;
  if(scope.source){
    const row=data.rows.find(item=>[item.key,'edit-'+item.key,'actual-'+item.key].includes(scope.source));
    if(!row)return {summary:'',body:''};
    const handoff='<div class="fin-actions">'+financeUrl(link('prototypes'),'Prototype Batches')+'</div>';
    return {summary:'',body:'<section class="fin-panel">'+renderDetails(row,link,periodLabel,productLabel,row.originalCurrency,!!rights.validation&&draft,
      data.currency)+handoff+'</section>'};
  }
  if(scope.view==='records')return {summary:'',body:developmentPage(data,'validation','',link,periods,products,rights,draft,dictionary)};
  const model=data.validation!;
  const sources=new Map(data.rows.map(row=>[row.key,row]));
  const period=scope.period?periodLabel(scope.period):'All forecast periods';
  const scopeLabel=(item:typeof model.groups[number])=>html((scope.product?[scope.product]:item.products).map(productLabel).join(', '));
  if(scope.view==='coverage'){
    const note='<p class="fin-muted">Full workbook quote · PV lists 3C, ECE and FMVSS under DV coverage. These amounts are excluded from the PV forecast.</p>';
    if(scope.group){
      const item=model.coverage.find(row=>row.key===scope.group);
      if(!item?.coverage)return {summary:'',body:panel('Certification evidence unavailable','<p>No verified certification quote is accessible for this specification.</p>')};
      const rows=item.coverage.certifications.map(cert=>{
        const basis=cert.basis==='covered'?'Listed under DV coverage':cert.basis==='pv'?'Included in China PV':'Europe DV homologation';
        return '<tr><th scope="row">'+html(cert.name)+'</th>'+td(cert.amount===null?'Not quoted':reporting(cert.amount,cert.currency)+' '+cert.currency)+
          td(cert.source)+td(basis)+td('To collect')+'</tr>';
      }).join('');
      return {summary:'',body:panel(item.title,note+table(['Standard / scope','Quoted amount','Workbook cell','Cost basis','Certificate evidence'],
        rows,'Certification quote sources','fin-validation-table')+
        '<div class="fin-actions">'+financeUrl(link('validation','',{validationView:null,validationPhase:'europe-dv'}),'Europe DV cost records')+
        financeUrl(link('validation','',{validationView:null,validationPhase:'china-pv'}),'China PV cost records')+'</div>')};
    }
    const rows=model.coverage.map(item=>'<tr><th scope="row">'+financeUrl(link('validation','',{validationGroup:item.key}),item.title,
      'validation-cert-'+item.key)+'<small class="fin-state">'+scopeLabel(item)+'</small></th>'+
      item.coverage!.certifications.filter(cert=>cert.basis==='covered').map(cert=>td(cert.amount===null?'Not quoted':reporting(cert.amount,cert.currency))).join('')+
      td('To collect')+'</tr>').join('');
    return {summary:'',body:panel('Certification and coverage',note+(rows?
      table(['Product / specification','3C (CNY)','ECE (CNY)','FMVSS (CNY)','Certificate evidence'],
        rows,'Certification coverage by specification','fin-validation-table'):
      '<p>No verified workbook coverage is available for this scope. '+financeUrl(link('validation','',{validationView:'records'}),'Open cost records')+'</p>'))};
  }
  if(scope.group){
    const group=model.groups.find(row=>row.key===scope.group);
    const selected=group?.items.filter(item=>!scope.phase||item.phase===scope.phase)??[];
    if(!group||!selected.length)return {summary:'',body:panel('Validation package unavailable','<p>No forecast records match the selected specification, phase and period.</p>')};
    const order=(key:string)=>periods.findIndex(item=>item.key===key);
    selected.sort((a,b)=>order(a.period)-order(b.period)||a.phase.localeCompare(b.phase)||String(a.part).localeCompare(String(b.part)));
    const rows=selected.map(item=>{
      const row=sources.get(item.key)!,phase=item.phase==='other'?row.cost.stage??'—':validationPhaseNames[item.phase];
      return '<tr><th scope="row">'+html(periodLabel(item.period))+'</th>'+td(phase)+'<td>'+
        financeUrl(link('validation',item.key,{period:item.period}),item.part?validationComponentNames[item.part]:row.cost.title,'validation-record-'+row.key)+
        '</td>'+td(row.cost.reference)+td(reporting(row.planned,row.originalCurrency)+' '+row.originalCurrency)+'<td>'+
        html(row.actual?.incurred?'Recorded':'To collect')+'</td></tr>';
    }).join('');
    const context=period+(scope.phase?' · '+validationPhaseNames[scope.phase]:'')+' · Select a cost record to review its source and actions.';
    const quoteNotes=(selected.some(row=>row.phase==='europe-dv')?
      '<p class="fin-muted">The EUR records below already reflect the quote factor shown in their source. The testing package includes its own samples and fixtures.</p>':'')+
      (selected.some(row=>row.phase==='china-pv')&&group.coverage?
        '<p class="fin-muted">PV travel in the full source quote · '+html(group.coverage.pvTravel.source)+' · '+
        html(group.coverage.pvTravel.amount===null?'Not quoted':reporting(group.coverage.pvTravel.amount,'CNY')+' CNY')+'</p>':'');
    const related=group.row?'<div class="fin-actions">'+financeUrl(link('validation','',{validationView:'coverage',validationPhase:null}),'Certification & coverage')+
      financeUrl(link('prototypes','',{prototypeGroup:'dv-'+group.row}),'Separately quoted samples')+'</div>':'';
    return {summary:'',body:panel(group.title,'<p class="fin-muted">'+html(context)+'</p>'+quoteNotes+
      table(['Occurrence period','Phase','Cost record','Source','Net payable','Occurrence evidence'],rows,'Validation period cost records')+related)};
  }

  const columns=model.hasQuoteBasis?model.summary.phases.filter(phase=>phase.phase!=='other'||phase.present):[];
  const cards=[['Independent validation forecast',model.summary.total,data.currency],
    ...columns.filter(phase=>phase.phase!=='other').map(phase=>[validationPhaseNames[phase.phase],phase.amount,phase.currency])];
  const summary='<div class="fin-metrics fin-overview-metrics" aria-label="Validation summary">'+cards.map(([label,amount,code])=>
    '<section class="fin-metric"><div class="fin-metric-label">'+html(label)+'</div><div class="fin-summary-value"><strong class="fin-value">'+
    html(reporting(amount,code!)??'—')+'</strong></div><small class="fin-state">'+html(code+' · '+period)+'</small></section>').join('')+'</div>';
  const rows=model.groups.map(item=>{
    const href=link('validation','',{validationGroup:item.key});
    return '<tr><th scope="row">'+financeUrl(href,item.title,'validation-package-'+item.key)+
      '<small class="fin-state">'+scopeLabel(item)+'</small></th>'+
      (columns.length?columns.map(({phase,currency})=>{
        const amount=item.phases.find(row=>row.phase===phase)?.amount??null;
        return amount===null?td(null):'<td>'+financeUrl(link('validation','',{validationGroup:item.key,validationPhase:phase}),
          reporting(amount,currency)!,'validation-phase-'+item.key+'-'+phase)+'</td>';
      }).join(''):td(sources.get(item.items[0].key)?.cost.stage))+
      td(reporting(item.total))+td('To collect')+'</tr>';
  }).join('');
  const quoteNote=model.hasQuoteBasis?'<p class="fin-muted">Europe DV is shown before the quote factor. The forecast total applies the factor and version exchange rates. Separately quoted samples stay in Prototypes.</p>':'';
  const missingRate=model.groups.some(item=>item.total===null)?
    '<p class="fin-muted">An exchange rate is required for one or more reporting amounts. Original currencies remain available in the cost records.</p>':'';
  return {summary,body:panel('Validation by specification and stage','<p class="fin-muted">'+html(period+' · Reporting currency '+data.currency)+
    ' · Select a phase amount or specification to open its cost records.</p>'+quoteNote+missingRate+(rows?
    table(['Product / specification',...(columns.length?columns.map(phase=>validationPhaseNames[phase.phase]+' ('+phase.currency+')'):['Phase']),
      'Independent forecast ('+data.currency+')','Test report / certificate'],rows,'Validation test packages','fin-validation-table'):
    '<p>No validation forecast is recorded for this scope. '+financeUrl(link('validation','',{validationView:'records'}),'Open cost records')+'</p>'))};
}

function editCost(data:Workspace,module:DevelopmentModule,cost:DevelopmentCost|undefined,periods:Item[],products:Item[],period:string,product:string,currency:string,
  quoteBundle=false){
  const category=cost?.category??categoryKeys[module][0],cash=cost?.recovery;
  const unitLabels=module==='prototypes'?(quoteBundle?'Each component is a rate per quote package.':'Each component is a rate per sample.'):
    'Set the quantity to one for a fixed charge.';
  return field('costRef','Unique cost / commitment reference',cost?.costRef,'maxlength="100" required'+(cost?' readonly data-fixed':''))+
    textField('title','Source row title',cost?.title)+textField('group',module==='engineering'?'Development stage':module==='prototypes'?'Batch ID':'Validation round',cost?.group)+
    select('category','Cost category',categoryKeys[module].map(key=>({key,label:categoryLabels[key]})),category)+
    (module==='engineering'?textField('role','Role / discipline',cost?.role??''):'')+
    (module==='validation'?select('stage','Validation stage',['DV','PV','Certification'].map(key=>({key,label:key})),cost?.stage??'DV'):'')+
    decimal('quantity',module==='engineering'?'Hours or travel units':module==='prototypes'?
      (quoteBundle?'Quote packages':'Required samples'):'Hours or units',cost?.quantity)+
    '<p>'+html(unitLabels)+'</p><label>Source currency<select name="currency">'+currencyOptions(data.currencies,currency)+'</select></label>'+
    Object.entries(components[module]).map(([key,label])=>decimal('component:'+key,label,cost?.components[key],false)).join('')+
    select('incurrence','Occurrence period',periods,cost?.period??period)+select('payment','Payment period',periods,cost?.paymentPeriod??period)+
    textField('reference','Evidence reference',cost?.reference,240)+textField('allocationBasis','Allocation basis',cost?.allocationBasis,240)+
    '<fieldset><legend>Product shares (total 1)</legend>'+products.map(item=>decimal('allocation:'+item.key,item.label,
      cost?.allocations.find(a=>a.productKey===item.key)?.share??(!cost&&item.key===product?'1':''),false)).join('')+'</fieldset>'+
    (module!=='engineering'&&data.packages.length?'<fieldset><legend>Covered quantities by paying package</legend>'+
      data.packages.map(pkg=>decimal('coverage:'+pkg.key,pkg.title+' · '+pkg.ref,cost?.coverage.find(link=>link.provider===pkg.key)?.quantity??'',false)).join('')+'</fieldset>':'')+
    select('method','Customer responsibility',entries(recoveryLabel),cash?.method??'none')+
    decimal('recovery','Recovery amount / rate',cash&&cash.method!=='none'?cash.amount:'',false)+
    select('recovery-product','Piece-price recovery product',products,cash?.method==='piece_price'?cash.productKey:product)+
    select('earned','Recovery earned period',periods,cash&&cash.method!=='none'?cash.earnedPeriod:period)+
    select('receipt','Forecast receipt period',periods,cash&&cash.method!=='none'?cash.receiptPeriod:period)+
    '<p>Enter only the uplift beyond the commercial quote. Piece-price recovery uses the selected product’s sales volume for the earned period.</p>';
}

export function developmentEditor(data:Workspace,module:DevelopmentModule,source:string,periods:Item[],products:Item[],period:string,product:string,rights:Rights,draft:boolean):OperationEditor|undefined{
  if(!draft||!source||!periods.length)return;
  const defaultPeriod=period||periods[0].key;
  const wrap=(title:string,markup:string,submit:OperationEditor['submit']):OperationEditor=>({
    period:defaultPeriod,range:{from:periods[0].key,to:periods.at(-1)!.key},development:true,title,markup,submit
  });
  if(source==='combine'){
    const eligible=data.editable.filter(row=>rights[row.cost.module]).slice(0,100);
    if(!eligible.length)return;
    return wrap('Preview multiple development costs','<p>Enter new quantities for the source rows you want to change together. Leave the other rows blank.</p>'+
      eligible.map(row=>decimal('change:'+row.key,row.cost.title+' · current '+row.cost.quantity+
        (data.rows.find(item=>item.key===row.key)?.quoteBundle?' packages':''),'',false)).join(''),form=>
      eligible.filter(row=>String(form.get('change:'+row.key)).trim()).map(row=>({collection:'development',action:'quantity',key:row.key,quantity:form.get('change:'+row.key)})));
  }
  if(!rights[module])return;
  const row=data.rows.find(item=>'edit-'+item.key===source||'actual-'+item.key===source);
  if(row&&source.startsWith('actual-')){
    return wrap('Record execution · '+row.cost.title,'<p>For each event, enter the amount, date and evidence. Leave events awaiting evidence blank.</p>'+
      '<label>Posting currency<select name="currency">'+currencyOptions(data.currencies,row.actualCurrency)+'</select></label>'+
      factTypes.filter(kind=>kind!=='receipt'||row.cost.recovery.method!=='none').map(kind=>{
        const fact=row.actual?.[kind];
        const fallback=kind==='incurred'?row.cost.period:kind==='payment'?row.cost.paymentPeriod:row.cost.recovery.method!=='none'?row.cost.recovery.receiptPeriod:row.cost.period;
        return '<fieldset><legend>'+factLabels[kind]+'</legend>'+decimal(kind+'-amount','Amount',fact?.amount,false)+
          select(kind+'-period','Period',periods,fact?.period??fallback)+field(kind+'-date','Date',fact?.date,'type="date"')+
          field(kind+'-reference','Evidence',fact?.reference,'maxlength="240"')+'</fieldset>';
      }).join(''),form=>{
        const record=Object.fromEntries(factTypes.map(kind=>{
          const amount=form.get(kind+'-amount');
          return [kind,amount?{amount,period:form.get(kind+'-period'),date:form.get(kind+'-date'),reference:form.get(kind+'-reference')}:null];
        }));
        return {collection:'development',action:'actual',key:row.key,currency:form.get('currency'),record};
      });
  }
  if(source!=='new'&&(!row||row.actual))return;
  const original=row?.cost;
  return wrap(original?'Edit forecast · '+original.title:'New development cost',editCost(data,module,original,periods,products,defaultPeriod,
    product||products[0]?.key,row?.originalCurrency??data.currency,row?.quoteBundle),form=>{
    const numbers=(prefix:string)=>[...form].filter(([name,value])=>name.startsWith(prefix)&&String(value).trim()).map(([name,value])=>[name.slice(prefix.length),value]);
    return {collection:'development',action:original?'edit':'new',module,costRef:form.get('costRef'),currency:form.get('currency'),...(row?{key:row.key}:{}),
      record:{title:form.get('title'),group:form.get('group'),category:form.get('category'),role:form.get('role'),stage:form.get('stage'),
        quantity:form.get('quantity'),components:Object.fromEntries(numbers('component:')),period:form.get('incurrence'),paymentPeriod:form.get('payment'),
        reference:form.get('reference'),allocationBasis:form.get('allocationBasis'),allocations:numbers('allocation:').map(([productKey,share])=>({productKey,share})),
        coverage:numbers('coverage:').map(([provider,quantity])=>({provider,quantity})),
        recovery:{method:form.get('method'),amount:form.get('recovery'),productKey:form.get('recovery-product'),earnedPeriod:form.get('earned'),receiptPeriod:form.get('receipt')}}};
  });
}
