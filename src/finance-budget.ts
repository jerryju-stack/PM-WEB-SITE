import {amountCell,amountText,escapeHtml as html,financeUrl,metricLabel} from '/finance-view.js';
import type {Dictionary} from '/finance-view.js';
import {candidateValue,inputDecimal} from '/finance-impact.js';
import type {OperationEditor} from '/finance-impact.js';
import {currencyOptions} from '/finance-fx.js';
import type {budgetWorkspace} from '../lib/finance-budget-calculation.ts';
import type {FinanceVersionSummary} from '../lib/finance-contracts.ts';

type Workspace=ReturnType<typeof budgetWorkspace>;
type Scope=Workspace['scopes'][number];
type Posting=Scope['postings'][number];
type Option={key:string;label:string};
type Rights={edit:boolean;setup:boolean;confirm:boolean};
type Link=(key?:string,period?:string,product?:string)=>string;
export const budgetViews={allocations:'Scope & allocations',execution:'Execution & evidence',versions:'Versions & comparison',policy:'Policy & cost scopes'};
export type BudgetView=keyof typeof budgetViews;
const metrics=['approved_budget','confirmed_actual','draft_cost','etc','eac','budget_balance','completion_variance'];
const recognitions={service_acceptance:'Service acceptance',goods_receipt:'Goods receipt',invoice_review:'Invoice review'};
const taxes={exclusive:'Tax-exclusive',inclusive:'Tax-inclusive'};
const labels=(list:Option[],key:string)=>list.find(item=>item.key===key)?.label??key;
const table=(head:string[],rows:string,id='')=>'<div class="fin-table-scroll fin-annual-scroll fin-budget-table"'+
  (id?' id="'+id+'" role="region" aria-label="'+(id==='fin-budget-allocation-table'?'Budget allocations':'Execution evidence')+'" tabindex="0"':'')+'><table><thead><tr>'+
  head.map(value=>'<th scope="col">'+value+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
const td=(value:string)=>'<td>'+html(value)+'</td>';
const term=(key:string,value:string)=>'<dt>'+html(key)+'</dt><dd>'+html(value)+'</dd>';
const controls=(links:string[])=>'<div class="fin-actions">'+links.join('')+'</div>';
const title=(label:string)=>'<h3>'+html(label)+'</h3>';
const itemLink=(scopeLink:Link,key:string,label:string)=>financeUrl(scopeLink(key),label,'budget-link-'+key);
function recordLabel(row:Posting){
  if(row.entry.type==='payment')return 'Recorded payment';
  if(row.entry.type==='allocation')return row.entry.status+' allocation';
  return row.entry.status+(row.event.relatedKey?' adjustment':' cost');
}
function selectedSource(data:Workspace,source:string){
  const actions=['allocation','cost','forecast','edit','confirm','withdraw','adjust','pay'] as const;
  const prefix=actions.find(action=>source.startsWith(action+'-'));
  const key=prefix?source.slice(prefix.length+1):source;
  const scope=data.scopes.find(item=>item.key===key||item.postings.some(row=>row.event.key===key));
  return {action:prefix,key,scope,row:scope?.postings.find(row=>row.event.key===key)};
}
export const isBudgetDetail=(data:Workspace,source:string)=>['policy','new-scope'].includes(source)||!!selectedSource(data,source).scope;

function ledgerRow(row:Posting,link:Link,periods:Option[]){
  return '<tr><th scope="row">'+financeUrl(link(row.event.key,row.event.periodKey),row.entry.title,'budget-link-'+row.event.key)+
    '<small class="fin-state">'+html(row.entry.documentId)+'</small></th>'+
    td(recordLabel(row))+td(periodName(periods,row.event.periodKey))+td(row.event.eventDate??'—')+td(row.amount+' '+row.event.currency)+'</tr>';
}

const money=(value:string,currency:string)=>amountText({value,displayValue:value,unit:currency,status:'ok'});
const periodName=(periods:Option[],key:string)=>key==='year-0'&&labels(periods,key)==='Year 0'?'Pre-SOP (Year 0)':labels(periods,key);
const panel=(name:string,content:string)=>'<section class="fin-panel fin-business-overview"><h2>'+html(name)+'</h2>'+content+'</section>';

export function budgetSummary(data:Workspace,product:string,period:string){
  const {count,amount}=data.allocationTotals.project,currency=data.policy?.currency;
  const scopes=data.scopes.filter(scope=>!product||scope.productKey===product);
  const empty=scopes.length?'':data.policy?'No cost scopes in selection':'Budget policy missing';
  const card=(name:string,value:string,context:string,id:string)=>'<section class="fin-metric" id="fin-budget-'+id+'"><div class="fin-metric-label">'+
    html(name)+'</div><div class="fin-summary-value"><span class="fin-value">'+html(value)+'</span></div><small class="fin-state">'+html(context)+'</small></section>';
  const forecast=(value:Workspace['approved'])=>value?money(value.amount,value.currency):'Pending';
  return '<div class="fin-metrics fin-overview-metrics fin-budget-summary" aria-label="Budget summary">'+
    card('Draft budget allocations',amount!==null?money(amount,currency!):count?'FX required':'—',
      period?'Selected period':'All allocation periods','draft-total')+
    card('Awaiting approval',String(count),count===1?'Draft allocation':'Draft allocations','draft-count')+
    card('Approved budget',forecast(data.approved),data.approved?'Scope total · all periods':empty||
      (scopes.some(scope=>scope.metrics.approved_budget?.status==='missing_input')?'Needs approval evidence':'Needs approved allocation FX'),'approved-total')+
    card('Estimate at completion (EAC)',forecast(data.eac),data.eac?'Scope total · all periods':empty||
      (scopes.some(scope=>!scope.remainingInput)?'Needs remaining ETC':'Needs cost or ETC FX'),'eac-total')+'</div>';
}

export function budgetVersions(versions:FinanceVersionSummary[],selected:string,current:string|null,baseline:string|null,versionLink:(id:string)=>string,
  compare:string,actions:string){
  return panel('Versions & comparison',table(['Version','Role','Status','Revision','Currency'],versions.map(version=>{
    const role=version.id===baseline?'Approved baseline':version.id===current?'Current forecast':
      version.model==='cash_series'?'Cash-flow reconciliation':
        version.model==='manufacturing'||version.basis==='cqa_full'?'Operating and development forecast':'Forecast version';
    return '<tr data-budget-version="'+html(version.id)+'"'+(version.id===selected?' aria-current="true"':'')+'><th scope="row">'+
      financeUrl(versionLink(version.id),version.name)+(version.id===selected?'<small class="fin-state">Selected</small>':'')+'</th>'+
      td(role)+td(version.status==='frozen'?'Frozen · read-only':'Draft')+td(String(version.revision))+td(version.currency)+'</tr>';
  }).join(''))+(baseline?'':'<p class="fin-muted">An approved baseline has yet to be designated.</p>')+
    controls([financeUrl(compare,'Compare selected versions','fin-budget-compare')])+actions);
}

export function budgetPage(data:Workspace,view:BudgetView,source:string,link:Link,home:string,periods:Option[],products:Option[],product:string,rights:Rights,
  draft:boolean,actors:Record<string,string>,dictionary:Dictionary,period:string,legacy:string,editor:string){
  const editing=rights.edit&&draft,{scope,row}=selectedSource(data,source),policy=data.policy;
  if(scope&&policy)return '<section class="fin-panel">'+scopeDetails(scope,row,link,home,periods,period,
    editing,rights.confirm&&draft,actors,policy.currency,dictionary,editor)+'</section>';
  const scopes=data.scopes.filter(item=>!product||item.productKey===product)
    .sort((a,b)=>products.findIndex(item=>item.key===a.productKey)-products.findIndex(item=>item.key===b.productKey)||
      a.title.localeCompare(b.title));
  const inPeriod=(key:string)=>!period||key===period;
  if(view==='allocations'&&!source){
    const keys=new Set(scopes.flatMap(item=>item.periodStatuses.filter(row=>inPeriod(row.period)&&(row.draft.keys.length||row.approved.keys.length)).map(row=>row.period)));
    const columns=periods.filter(item=>keys.has(item.key)||item.key===period);
    const draftAmount=(item:Scope)=>Number(data.allocationTotals.scopes[item.key].amount??'-Infinity');
    const rows=scopes.sort((a,b)=>draftAmount(b)-draftAmount(a)).map(item=>{
      const allocated=item.periodStatuses.filter(record=>inPeriod(record.period));
      const total=data.allocationTotals.scopes[item.key],approved=allocated.some(record=>record.approved.keys.length);
      const status=total.count?(approved?'Approved and pending':'Awaiting approval'):approved?'Approved':'No allocation recorded';
      const scopedLink=(key:string,periodKey?:string)=>link(key,periodKey,item.productKey??undefined);
      return '<tr data-budget-scope="'+html(item.scopeId)+'"><th scope="row">'+financeUrl(scopedLink(item.key),
        item.productKey?labels(products,item.productKey):item.title,'budget-scope-'+item.key)+'<small class="fin-state">'+html(item.scopeId)+'</small></th>'+
        columns.map(column=>{
          const record=allocated.find(record=>record.period===column.key)?.draft;
          const label=record?.keys.length?record.amount===null?'FX required':money(record.amount,policy!.currency):'No draft';
          return '<td data-budget-period="'+html(column.key)+'">'+financeUrl(scopedLink(record?.keys.length===1?record.keys[0]:item.key,column.key),
            label,'budget-allocation-'+item.key+'-'+column.key)+'</td>';
        }).join('')+'<td data-budget-draft-total>'+html(total.amount===null?(total.count?'FX required':'—'):money(total.amount,policy!.currency))+'</td>'+
        '<td data-budget-approval>'+html(status)+'</td></tr>';
    }).join('');
    return panel('Development budget allocations',policy&&rows?
      '<p class="fin-muted">Draft amounts in '+html(policy.currency)+' · '+data.currencyScale+' decimals per period · Largest draft totals first.</p>'+
      table(['Product / cost scope',...columns.map(item=>html(periodName(periods,item.key))),'Draft total','Approval status'],rows,'fin-budget-allocation-table'):
      '<p class="fin-muted">'+(policy?'No cost scopes match the selected product.':'This version has no scoped budget policy or allocation records.')+'</p>');
  }
  if(view==='execution'){
    const rows=policy?scopes.flatMap(item=>item.periodStatuses.filter(row=>inPeriod(row.period)).map(row=>{
      const detail=link(item.key,row.period,item.productKey??undefined);
      const status=(record:typeof row.draft,empty:string)=>{
        if(!record.keys.length)return td(empty);
        const value=record.amount===null?'Exchange rate required':money(record.amount,policy.currency);
        const target=record.keys.length===1?link(record.keys[0],row.period,item.productKey??undefined):detail;
        return '<td>'+financeUrl(target,value)+'</td>';
      };
      return '<tr><th scope="row">'+financeUrl(detail,item.title)+'</th>'+td(periodName(periods,row.period))+
        status(row.approved,'Approval not recorded')+status(row.confirmed,'No cost posting')+status(row.payments,'No payment posting')+
        (row.remaining.keys.length?'<td>'+financeUrl(detail,item.metrics.etc?.value!=null?amountText(item.metrics.etc):'ETC calculation pending')+
          '</td>':td('ETC not recorded'))+'</tr>';
    })).join(''):'';
    const scopeRows=scopes.map(item=>'<tr><th scope="row">'+financeUrl(link(item.key,'',item.productKey??undefined),item.title)+'</th>'+
      [...metrics,'recorded_payments'].map(key=>{
        const missing=key==='confirmed_actual'&&!item.periodStatuses.some(row=>row.confirmed.keys.length)?'No cost posting':
          key==='recorded_payments'&&!item.periodStatuses.some(row=>row.payments.keys.length)?'No payment posting':'';
        return '<td data-budget-metric="'+key+'">'+amountCell(item.metrics[key])+(missing?'<small class="fin-state">'+missing+'</small>':'')+'</td>';
      }).join('')+'</tr>').join('');
    return panel('Execution evidence','<p class="fin-muted">Approval requires an independent decision. Confirmed cost and payment each require a posting with evidence. Record remaining ETC to calculate EAC.</p>'+
      (rows?table(['Cost scope','Period','Approved budget','Confirmed cost','Recorded payments','Current ETC'],rows,'fin-budget-evidence-table'):
        '<p>No execution postings in this selection.</p>')+
      (scopeRows?'<details class="fin-settings"><summary>Scope execution totals · all periods</summary>'+
        table(['Cost scope',...metrics.map(key=>metricLabel(dictionary,key)),'Recorded payments'],scopeRows)+'</details>':'')+
      '<details class="fin-settings"><summary>Project totals and baseline</summary>'+legacy+'</details>');
  }
  const actions: string[]=[];
  if(draft&&rights.setup&&!policy)actions.push(financeUrl(link('policy'),'Set budget policy','fin-budget-policy'));
  if(editing&&policy)actions.push(financeUrl(link('new-scope'),'Add cost scope','fin-budget-new-scope'));
  return panel('Budget Policy & Cost Scopes',
    (policy?'<p id="fin-budget-policy-summary">'+html(policy.currency+' · '+data.currencyScale+' decimal places · '+taxes[policy.taxBasis]+' · '+recognitions[policy.recognition])+'</p>'+
      '<p>Policy source · '+html(policy.reference)+'</p>':'<p>Set a project budget policy to record independent approvals and remaining forecasts.</p>')+
    (data.legacyEvents?'<p class="fin-muted">This version contains '+data.legacyEvents+' legacy budget or cost events.'+
      ' View project totals under Execution &amp; evidence.</p>':'')+controls(actions)+editor+
    (scopes.length?table(['Cost scope','Product','Policy evidence'],scopes.map(item=>'<tr><th scope="row">'+itemLink(link,item.key,item.title)+
      '</th>'+td(item.productKey?labels(products,item.productKey):'Shared project scope')+td(item.reference)+'</tr>').join('')):''));
}

function scopeDetails(scope:Scope,row:Posting|undefined,link:Link,home:string,periods:Option[],period:string,edit:boolean,confirm:boolean,actors:Record<string,string>,
  currency:string,dictionary:Dictionary,editor:string){
  const amount=scope.metrics.completion_variance;
  const etc=scope.remainingInput;
  const label=(key:string)=>periodName(periods,key);
  const postings=scope.postings.filter(item=>!period||item.event.periodKey===period||item===row);
  const actions=edit?[financeUrl(link('allocation-'+scope.key),'Add budget allocation','fin-budget-allocation'),
    financeUrl(link('cost-'+scope.key),'Add cost draft','fin-budget-cost'),
    financeUrl(link('forecast-'+scope.key),'Record remaining ETC','fin-budget-etc')]:[];
  const missingActual=scope.periodStatuses.some(record=>record.confirmed.keys.length)?'':'<small class="fin-state">No cost posting</small>';
  const metricsHTML='<dl>'+metrics.map(key=>'<dt>'+metricLabel(dictionary,key)+'</dt><dd data-budget-metric="'+key+'">'+
    amountCell(scope.metrics[key])+(key==='confirmed_actual'?missingActual:'')+'</dd>').join('')+'</dl>';
  return '<article id="fin-budget-source" class="fin-budget-source"><h2>'+html(scope.title)+'</h2><p>'+html(scope.scopeId+' · '+scope.reference)+'</p>'+
    (row?postingDetail(row,scope,link,periods,edit,confirm,actors):'')+
    editor+
    '<h3>Scope execution totals · all periods</h3>'+
    (amount?.value&&Number(amount.value)<0?'<p class="fin-budget-overrun">Forecast exceeds the approved scope budget.</p>':'')+
    metricsHTML+controls(actions)+
    (etc?'<h4>Remaining forecast source</h4><dl>'+term('Forecast cutoff',label(etc.periodKey))+term('Entered remaining forecast',inputDecimal(etc.amount)+' '+etc.currency)+
      '<dt>Consumed by confirmed work</dt><dd>'+amountCell(etc.consumed)+'</dd>'+term('Evidence',etc.reference)+'</dl>':
      '<p>Enter remaining ETC with a cutoff, including zero for completed work.</p>')+
    '<h4>Postings'+(period?' · '+html(label(period)):'')+'</h4>'+(postings.length?table(['Document','Stage','Accounting period','Posting date','Amount'],
      postings.map(item=>ledgerRow(item,link,periods)).join('')):'<p>No postings recorded in this period.</p>')+
    (scope.timeline.length?'<h4>Occurrence and payment by period</h4>'+table(['Period','Confirmed cost','Recorded payments'],scope.timeline.map(item=>
      '<tr><th scope="row">'+html(label(item.period))+'</th>'+td(item.confirmed===null?'Exchange rate required':item.confirmed+' '+currency)+
      td(item.payments===null?'Exchange rate required':item.payments+' '+currency)+'</tr>').join('')):'')+
    controls([financeUrl(home,'Back to Finance Dashboard','fin-budget-dashboard')])+'</article>';
}

function postingDetail(row:Posting,scope:Scope,link:Link,periods:Option[],edit:boolean,confirm:boolean,actors:Record<string,string>){
  const {event,entry}=row,posting=entry.type!=='payment',draft=posting&&entry.status==='draft';
  const actions:string[]=[];
  if(edit&&draft)actions.push(financeUrl(link('edit-'+event.key),'Edit draft','fin-budget-edit'),
    financeUrl(link('withdraw-'+event.key),'Withdraw draft','fin-budget-withdraw'));
  if(confirm&&draft&&!row.ownDraft)actions.push(financeUrl(link('confirm-'+event.key),'Review and confirm','fin-budget-confirm'));
  if(edit&&entry.type==='cost'&&entry.status==='confirmed'&&!event.relatedKey)actions.push(
    financeUrl(link('adjust-'+event.key),'Add linked adjustment','fin-budget-adjust'),
    financeUrl(link('pay-'+event.key),'Record payment','fin-budget-pay'));
  const original=event.relatedKey?scope.postings.find(item=>item.event.key===event.relatedKey):null;
  const linked=scope.postings.filter(item=>item.event.relatedKey===event.key);
  return '<section id="fin-budget-posting" class="fin-budget-posting">'+title(entry.title)+'<dl>'+
    term('Document ID',entry.documentId)+term('Stage',recordLabel(row))+term('Evidence',entry.reference)+
    term('Accounting period',periodName(periods,event.periodKey))+term('Posting date',event.eventDate??'—')+term('Amount',money(row.amount,event.currency))+
    (posting?term('Prepared by',entry.makers.map(uid=>actors[uid]??uid).join(', '))+
      (entry.confirmedBy?term('Confirmed by',actors[entry.confirmedBy]??entry.confirmedBy):'')+
      (entry.decisionReference?term('Decision evidence',entry.decisionReference):''):'')+'</dl>'+
    (original?'<p>Original cost · '+financeUrl(link(original.event.key,original.event.periodKey),original.entry.title)+'</p>':'')+
    (draft&&row.ownDraft?'<p>An independent approver must confirm this draft.</p>':'')+controls(actions)+
    (linked.length?'<h4>Linked adjustments and payments</h4>'+table(['Document','Stage','Accounting period','Posting date','Amount'],
      linked.map(item=>'<tr><th scope="row">'+financeUrl(link(item.event.key,item.event.periodKey),item.entry.title)+'</th>'+td(recordLabel(item))+
        td(labels(periods,item.event.periodKey))+td(item.event.eventDate??'—')+td(item.amount+' '+item.event.currency)+'</tr>').join('')):'')+'</section>';
}

const input=(name:string,label:string,value='',attributes='')=>'<label>'+html(label)+'<input name="'+name+'" value="'+html(value)+'" required '+attributes+'></label>';
const select=(name:string,label:string,items:Option[],selected:string,placeholder='')=>'<label>'+html(label)+'<select name="'+name+'" required>'+
  (placeholder?'<option value="" '+(!selected?'selected':'')+'>'+html(placeholder)+'</option>':'')+
  items.map(item=>'<option value="'+html(item.key)+'" '+(item.key===selected?'selected':'')+'>'+html(item.label)+'</option>').join('')+'</select></label>';
const choices=(labels:Record<string,string>)=>Object.entries(labels).map(([key,label])=>({key,label}));
export function budgetEditor(data:Workspace,source:string,periods:Option[],products:Option[],period:string,product:string,currencies:Record<string,number>,
  reportCurrency:string,rights:Rights,draft:boolean):OperationEditor|undefined {
  if(!draft||!source||!periods.length)return;
  const {action,scope,row}=selectedSource(data,source);
  if(action==='confirm'?!rights.confirm:!rights.edit)return;
  const policy=data.policy,selectedPeriod=period||periods[0].key;
  const wrap=(action:string,title:string,markup:string,serializer:(form:FormData)=>Record<string,unknown>|null,key?:string,saveLabel?:string):OperationEditor=>({
    title,markup,period:selectedPeriod,range:{from:periods[0].key,to:periods.at(-1)!.key},budget:true,saveLabel,
    submit:(form)=>{
      const record=serializer(form);
      return record?{collection:'budget_execution',action,...(key?{key}:{}),record}:null;
    }
  });
  if(source==='policy'&&rights.setup&&!policy)return wrap('policy','Set project budget policy',
    select('currency','Budget currency',Object.keys(currencies).map(key=>({key,label:key+' · '+currencies[key]+' places'})),reportCurrency)+
    select('tax','Tax basis',choices(taxes),'','Choose tax basis')+select('recognition','Cost recognition',choices(recognitions),'','Choose recognition rule')+
    input('reference','Policy source'),form=>({currency:form.get('currency'),taxBasis:form.get('tax'),recognition:form.get('recognition'),reference:form.get('reference')}),
    undefined,'Save Policy');
  if(!policy)return;
  if(source==='new-scope')return wrap('scope','Add a cost scope',input('scope-id','Scope ID')+input('title','Scope name')+
    select('product','Scope product',[{key:'__shared__',label:'Shared project scope'},...products],product||'__shared__')+input('reference','Scope evidence'),form=>
    ({scopeId:form.get('scope-id'),title:form.get('title'),productKey:form.get('product')==='__shared__'?null:form.get('product'),reference:form.get('reference')}),
    undefined,'Save Scope');
  if(!scope||!action)return;
  const amountField=(value='',currency=policy.currency,linked=false)=>(linked?
    '<input type="hidden" name="posting-currency" value="'+html(currency)+'"><p>Posting currency '+html(currency)+'</p>':
    '<label>Posting currency<select name="posting-currency">'+currencyOptions(currencies,currency)+'</select></label>')+
    input('amount','Amount',value,'inputmode="decimal"');
  const readAmount=(form:FormData)=>candidateValue(String(form.get('amount')??''),currencies[String(form.get('posting-currency'))]);
  if(action==='forecast')return wrap('etc','Record remaining forecast · '+scope.title,
    '<p>Use the work still expected after the cutoff. The ledger consumes this estimate as matching work is confirmed.</p>'+
    select('accounting-period','Forecast cutoff',periods,selectedPeriod)+amountField('',scope.remainingInput?.currency)+input('reference','Forecast evidence'),form=>{
      const amount=readAmount(form);
      return amount?{scope:scope.key,period:form.get('accounting-period'),currency:form.get('posting-currency'),amount,reference:form.get('reference')}:null;
    },undefined,'Save ETC');
  const entry=row?.entry,canDecide=entry&&entry.type!=='payment'&&entry.status==='draft';
  if(action==='confirm'||action==='withdraw'){
    if(!row||!canDecide||action==='confirm'&&row.ownDraft)return;
    const confirmation=action==='confirm';
    return wrap(action,(confirmation?'Confirm ':'Withdraw ')+row.entry.title,input('reference',confirmation?'Approval evidence':'Withdrawal reason'),
      form=>({reference:form.get('reference')}),row.event.key,confirmation?'Confirm Posting':'Withdraw Draft');
  }
  if(action==='edit'&&!canDecide)return;
  if((action==='adjust'||action==='pay')&&(!row||entry?.type!=='cost'||entry.status!=='confirmed'||row.event.relatedKey))return;
  const allocation=action==='allocation'||action==='edit'&&entry?.type==='allocation',payment=action==='pay';
  const existing=action==='edit'?row:undefined;
  const linked=payment||action==='adjust'||!!existing?.event.relatedKey;
  return wrap(allocation?'allocation':payment?'payment':'cost',
    (action==='edit'?'Edit draft':allocation?'Add budget allocation':payment?'Record payment':action==='adjust'?'Add linked adjustment':'Add cost draft')+' · '+scope.title,
    input('document-id','Document ID',existing?.entry.documentId,existing?'readonly data-fixed':'')+
    input('title','Posting title',existing?.entry.title)+select('accounting-period','Accounting period',periods,existing?.event.periodKey??selectedPeriod)+
    (!allocation?input('date','Posting date',existing?.event.eventDate??'','type="date"'):'')+
    amountField(existing?inputDecimal(existing.event.amount):'',existing?.event.currency??(linked?row?.event.currency:undefined),linked)+
    (action==='adjust'?'<p>Enter the signed amount of the change to the confirmed original cost.</p>':'')+
    input('reference','Source evidence',existing?.entry.reference),form=>{
      const amount=readAmount(form);
      return amount?{scope:scope.key,period:form.get('accounting-period'),currency:form.get('posting-currency'),amount,reference:form.get('reference'),documentId:form.get('document-id'),
        title:form.get('title'),date:form.get('date'),relatedKey:payment||action==='adjust'?row?.event.key:existing?.event.relatedKey??null}:null;
    },existing?.event.key,payment?'Save Payment':'Save Draft');
}
