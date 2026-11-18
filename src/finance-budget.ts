import {amountCell,escapeHtml as html,financeUrl,metricLabel} from '/finance-view.js';
import type {Dictionary} from '/finance-view.js';
import {candidateValue,inputDecimal} from '/finance-impact.js';
import type {OperationEditor} from '/finance-impact.js';
import type {budgetWorkspace} from '../lib/finance-budget-calculation.ts';

type Workspace=ReturnType<typeof budgetWorkspace>;
type Scope=Workspace['scopes'][number];
type Posting=Scope['postings'][number];
type Option={key:string;label:string};
type Rights={edit:boolean;setup:boolean;confirm:boolean};
type Link=(key?:string)=>string;
const metrics=['approved_budget','confirmed_actual','draft_cost','etc','eac','budget_balance','completion_variance'];
const recognitions={service_acceptance:'Service acceptance',goods_receipt:'Goods receipt',invoice_review:'Invoice review'};
const taxes={exclusive:'Tax-exclusive',inclusive:'Tax-inclusive'};
const labels=(list:Option[],key:string)=>list.find(item=>item.key===key)?.label??key;
const table=(head:string[],rows:string)=>'<div class="fin-table-scroll fin-budget-table"><table><thead><tr>'+
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
  return '<tr><th scope="row">'+itemLink(link,row.event.key,row.entry.title)+'<small class="fin-state">'+html(row.entry.documentId)+'</small></th>'+
    td(recordLabel(row))+td(labels(periods,row.event.periodKey))+td(row.event.eventDate??'—')+td(row.amount+' '+row.event.currency)+'</tr>';
}

export function budgetPage(data:Workspace,source:string,link:Link,home:string,periods:Option[],products:Option[],product:string,rights:Rights,
  draft:boolean,actors:Record<string,string>,dictionary:Dictionary){
  const editing=rights.edit&&draft,{scope,row}=selectedSource(data,source),policy=data.policy;
  const scopeRows=data.scopes.filter(item=>!product||item.productKey===product||item.key===scope?.key).map(item=>{
    const variance=item.metrics.completion_variance?.value;
    return '<tr'+(variance!=null&&Number(variance)<0?' class="fin-budget-overrun"':'')+'><th scope="row">'+itemLink(link,item.key,item.title)+
      '<small class="fin-state">'+html(item.scopeId)+'</small></th>'+td(item.productKey?labels(products,item.productKey):'Shared project scope')+
      metrics.map(key=>'<td data-budget-metric="'+key+'">'+amountCell(item.metrics[key])+'</td>').join('')+'</tr>';
  });
  const actions: string[]=[];
  if(draft&&rights.setup&&!policy)actions.push(financeUrl(link('policy'),'Set budget policy','fin-budget-policy'));
  if(editing&&policy)actions.push(financeUrl(link('new-scope'),'Add cost scope','fin-budget-new-scope'));
  return '<section class="fin-panel"><div class="fin-panel-head"><h2>Budget Policy &amp; Cost Scopes</h2></div>'+
    (policy?'<p id="fin-budget-policy-summary">'+html(policy.currency+' · '+data.currencyScale+' decimal places · '+taxes[policy.taxBasis]+' · '+recognitions[policy.recognition])+'</p>'+
      '<p>Policy source · '+html(policy.reference)+'</p>':'<p>Set a project budget policy to record independent approvals and remaining forecasts.</p>')+
    (data.legacyEvents?'<p class="fin-muted">This version contains '+data.legacyEvents+' legacy budget or cost events.'+
      (policy?' Scoped execution totals use postings under this policy.':' The legacy totals above follow the archived version policy.')+'</p>':'')+
    controls(actions)+
    (scopeRows.length?table(['Cost scope','Product',...metrics.map(key=>metricLabel(dictionary,key))],scopeRows.join('')):policy?'<p>No cost scopes in this filter.</p>':'')+
    (scope&&policy?scopeDetails(scope,row,link,home,periods,editing,rights.confirm&&draft,actors,policy.currency,dictionary):'')+'</section>';
}

function scopeDetails(scope:Scope,row:Posting|undefined,link:Link,home:string,periods:Option[],edit:boolean,confirm:boolean,actors:Record<string,string>,
  currency:string,dictionary:Dictionary){
  const amount=scope.metrics.completion_variance;
  const etc=scope.remainingInput;
  const label=(key:string)=>labels(periods,key);
  const actions=edit?[financeUrl(link('allocation-'+scope.key),'Add budget allocation','fin-budget-allocation'),
    financeUrl(link('cost-'+scope.key),'Add cost draft','fin-budget-cost'),
    financeUrl(link('forecast-'+scope.key),'Record remaining ETC','fin-budget-etc')]:[];
  const metricsHTML='<dl>'+metrics.map(key=>'<dt>'+metricLabel(dictionary,key)+'</dt><dd data-budget-metric="'+key+'">'+
    amountCell(scope.metrics[key])+'</dd>').join('')+'</dl>';
  return '<article id="fin-budget-source" class="fin-budget-source"><h3>'+html(scope.title)+'</h3><p>'+html(scope.scopeId+' · '+scope.reference)+'</p>'+
    (amount?.value&&Number(amount.value)<0?'<p class="fin-budget-overrun">Forecast exceeds the approved scope budget.</p>':'')+
    metricsHTML+controls(actions)+
    (etc?'<h4>Remaining forecast source</h4><dl>'+term('Forecast cutoff',label(etc.periodKey))+term('Entered remaining forecast',inputDecimal(etc.amount)+' '+currency)+
      term('Consumed by confirmed work',etc.consumed?etc.consumed+' '+currency:'—')+term('Evidence',etc.reference)+'</dl>':
      '<p>Enter remaining ETC with a cutoff, including zero for completed work.</p>')+
    '<h4>Postings</h4>'+(scope.postings.length?table(['Document','Stage','Accounting period','Posting date','Amount'],
      scope.postings.map(item=>ledgerRow(item,link,periods)).join('')):'<p>No postings recorded.</p>')+
    (row?postingDetail(row,scope,link,periods,edit,confirm,actors):'')+
    (scope.timeline.length?'<h4>Occurrence and payment by period</h4>'+table(['Period','Confirmed cost','Recorded payments'],scope.timeline.map(item=>
      '<tr><th scope="row">'+html(label(item.period))+'</th>'+td(item.confirmed+' '+currency)+td(item.payments+' '+currency)+'</tr>').join('')):'')+
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
    term('Accounting period',labels(periods,event.periodKey))+term('Posting date',event.eventDate??'—')+term('Amount',row.amount+' '+event.currency)+
    (posting?term('Prepared by',entry.makers.map(uid=>actors[uid]??uid).join(', '))+
      (entry.confirmedBy?term('Confirmed by',actors[entry.confirmedBy]??entry.confirmedBy):'')+
      (entry.decisionReference?term('Decision evidence',entry.decisionReference):''):'')+'</dl>'+
    (original?'<p>Original cost · '+financeUrl(link(original.event.key),original.entry.title)+'</p>':'')+
    (draft&&row.ownDraft?'<p>An independent approver must confirm this draft.</p>':'')+controls(actions)+
    (linked.length?'<h4>Linked adjustments and payments</h4>'+table(['Document','Stage','Accounting period','Posting date','Amount'],
      linked.map(item=>'<tr><th scope="row">'+financeUrl(link(item.event.key),item.entry.title)+'</th>'+td(recordLabel(item))+
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
  const amountField=(value='')=>input('amount','Amount ('+policy.currency+')',value,'inputmode="decimal"');
  const readAmount=(form:FormData)=>candidateValue(String(form.get('amount')??''),data.currencyScale);
  if(action==='forecast')return wrap('etc','Record remaining forecast · '+scope.title,
    '<p>Use the work still expected after the cutoff. The ledger consumes this estimate as matching work is confirmed.</p>'+
    select('accounting-period','Forecast cutoff',periods,selectedPeriod)+amountField()+input('reference','Forecast evidence'),form=>{
      const amount=readAmount(form);
      return amount?{scope:scope.key,period:form.get('accounting-period'),amount,reference:form.get('reference')}:null;
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
  return wrap(allocation?'allocation':payment?'payment':'cost',
    (action==='edit'?'Edit draft':allocation?'Add budget allocation':payment?'Record payment':action==='adjust'?'Add linked adjustment':'Add cost draft')+' · '+scope.title,
    input('document-id','Document ID',existing?.entry.documentId,existing?'readonly data-fixed':'')+
    input('title','Posting title',existing?.entry.title)+select('accounting-period','Accounting period',periods,existing?.event.periodKey??selectedPeriod)+
    (!allocation?input('date','Posting date',existing?.event.eventDate??'','type="date"'):'')+
    amountField(existing?inputDecimal(existing.event.amount):'')+
    (action==='adjust'?'<p>Enter the signed amount of the change to the confirmed original cost.</p>':'')+
    input('reference','Source evidence',existing?.entry.reference),form=>{
      const amount=readAmount(form);
      return amount?{scope:scope.key,period:form.get('accounting-period'),amount,reference:form.get('reference'),documentId:form.get('document-id'),
        title:form.get('title'),date:form.get('date'),relatedKey:payment||action==='adjust'?row?.event.key:existing?.event.relatedKey??null}:null;
    },existing?.event.key,payment?'Save Payment':'Save Draft');
}
