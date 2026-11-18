import {createFinancePreviewCoordinator} from '/finance-preview-state.js';
import {amountCell,definition,escapeHtml,metricLabel,nameOf} from '/finance-view.js';
import type {Dictionary,FinanceDriver,FinanceReport} from '/finance-view.js';
import type {financeService} from '../lib/finance.ts';
import type {FixedDecimal} from '../lib/finance-contracts.ts';

type Preview=ReturnType<ReturnType<typeof financeService>['preview']>;
export type FinanceApi=(path:string,body?:unknown,method?:string)=>Promise<any>;
type Entry={module:'commercial'|'bom'|'factory';fields:Record<string,readonly [string,string,string,string]>;
  products:{key:string;label:string}[];markets:{key:string;label:string}[];product:string;market:string;archived:boolean};
export type OperationEditor={period:string;title:string;markup:string;submit:(data:FormData,form:HTMLFormElement)=>unknown;
  bind?:(form:HTMLFormElement,clear:()=>void)=>void;development?:boolean;capital?:boolean;budget?:boolean;saveLabel?:string;range?:{from:string;to:string}};
type Options={root:HTMLElement;projectId:string;version:FinanceReport;driver?:FinanceDriver;entry?:Entry;dictionary:Dictionary;
  operation?:OperationEditor;period:string;currencies:Record<string,number>;api:FinanceApi;labelPeriod:(key:string)=>string;labelProduct:(key:string)=>string;onSaved:(fieldKey?:string)=>void};
export const inputDecimal=(value:FixedDecimal)=>{
  const digits=value.coefficient.replace('-','').padStart(value.scale+1,'0');
  return ((value.coefficient.startsWith('-')?'-':'')+(value.scale?digits.slice(0,-value.scale)+'.'+digits.slice(-value.scale):digits)).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
};
export function candidateValue(text:string,scale?:number):FixedDecimal|null {
  const value=text.trim();
  if(value.length>74||! /^-?\d+(?:\.\d{1,12})?$/.test(value))return null;
  const [integer,frac='']=value.split('.');
  if(scale!==undefined&&frac.length>scale)return null;
  const places=scale??frac.length;
  const coefficient=BigInt(integer+frac.padEnd(places,'0')).toString();
  return coefficient.replace('-','').length<=60?{coefficient,scale:places}:null;
}
const key=()=>crypto.randomUUID();
const renderOptions=(items:{key:string;label:string}[],selected:string)=>items.map(item=>
  '<option value="'+escapeHtml(item.key)+'" '+(item.key===selected?'selected':'')+'>'+escapeHtml(item.label)+'</option>').join('');

function entryFields(entry:Entry,currencies:Record<string,number>,base:string) {
  const fields=Object.entries(entry.fields).filter(([,field])=>field[0]===entry.module);
  return '<label>Product<select name="productKey" required>'+renderOptions(entry.products,entry.product)+'</select></label>'+
    (entry.module!=='factory'?'<label>Market<select name="marketKey" '+(entry.module==='commercial'||entry.archived?'required':'')+'>'+
      '<option value="">Shared / choose market</option>'+renderOptions(entry.markets,entry.market)+'</select></label>':'')+
    (entry.module==='bom'?'<label>Part number<input name="partNumber" required maxlength="100"></label><label>Tooling asset reference, if entered<input name="assetKey" maxlength="160"></label>':'')+
    '<label>Source reference<input name="reference" required maxlength="200"></label>'+
    (entry.module!=='factory'?'<label>Quote currency<select name="currency">'+renderOptions(Object.keys(currencies).map(code=>({key:code,label:code})),base)+'</select></label>':'')+
    fields.map(([id,[,label,unit]])=>'<label>'+escapeHtml(label)+(unit==='fraction'?' · 0 to 1':'')+
      '<input name="field:'+id+'" inputmode="decimal"'+(id==='configuration'?' value="1"':id==='landed_adjustment'?' value="0"':'')+
      (['vehicles','configuration','units_per_vehicle','part_quantity','part_price','landed_adjustment'].includes(id)?' required':'')+'></label>').join('')+
    (entry.module==='commercial'?'<p class="fin-muted">Enter a selling price or a reduction from the previous period.</p>':
      entry.module==='bom'?'<p class="fin-muted">Enter the landed adjustment in '+escapeHtml(base)+' per part. Tooling is recorded separately for Equipment & Investment.</p>':'');
}
export function mountImpactPanel({root,projectId,version,driver,entry,operation,dictionary,period,currencies,api,labelPeriod,labelProduct,onSaved}:Options) {
  const coordinator=createFinancePreviewCoordinator();
  const details=version.details,path='projects/'+encodeURIComponent(projectId)+'/finance/versions/'+encodeURIComponent(details.id);
  const possible=operation?version.periods.filter(p=>p.key===operation.period):entry?version.periods.filter(p=>entry.module==='factory'||p.key!==version.periods[0]?.key):
    driver?.business?version.periods.filter(p=>p.key===driver.periodKey):
    driver?.acrossPeriods?version.periods.filter(p=>p.key!==version.periods[0]?.key):version.periods.filter(p=>p.key===driver?.periodKey);
  const selected=possible.some(p=>p.key===period)?period:(possible.find(p=>p.key===driver?.periodKey)??possible[0])?.key;
  const initial=(period:string)=>driver?inputDecimal((driver.overrides as Record<string,FixedDecimal>)[period]??driver.value):'';
  const canPreview=!!(entry||operation||driver?.canPreview)&&!!selected;
  const canSave=canPreview&&details.status==='draft';
  let saving=false,closed=false,result:Preview|null=null,saveKey='',pending=false;
  const source=driver?.source,base=version.basis==='cqa_incremental'||version.basis==='cqa_full'?'CNY':version.currency;
  const allowedEnds=entry?possible:version.periods.filter(p=>driver?.applicable?.includes(p.key));
  const periodIndex=(value:string|undefined)=>version.periods.findIndex(p=>p.key===value);
  const endPeriods=allowedEnds.filter(p=>periodIndex(p.key)>=periodIndex(selected));
  const quoteCurrency=driver?.business&&['sales_price','part_price'].includes(driver.business.businessField);
  const editor=operation?operation.markup:entry?entryFields(entry,currencies,base):
    (quoteCurrency?'<label>Quote currency<select name="currency">'+renderOptions(Object.keys(currencies).map(code=>({key:code,label:code})),driver?.currency??base)+'</select></label>':'')+
    '<label>Candidate value<input inputmode="decimal" name="value" required value="'+escapeHtml(initial(selected!))+'"></label>';
  const heading=operation?escapeHtml(operation.title):entry?'New business record':metricLabel(dictionary,driver!.metricKey)+' · '+escapeHtml(driver!.unit);
  root.innerHTML='<details class="fin-impact'+(operation?.development||operation?.capital||operation?.budget?' fin-dev-impact':'')+'" open><summary>Change Impact</summary><div class="fin-impact-body">'+
    '<p>'+heading+'</p>'+
    '<p class="fin-muted">'+escapeHtml(details.name)+' · Revision '+details.revision+
    (source?'<br>'+escapeHtml([source.sheet,source.cell].filter(Boolean).join('!')||source.reference):'')+
    (driver?.fx?.source?'<br>FX '+escapeHtml(driver.fx.source)+' · '+escapeHtml(driver.fx.rate.slice(0,18)):'')+'</p>'+
    (canPreview?'<form id="fin-impact-form">'+(operation?.range?'<input type="hidden" name="period" value="'+escapeHtml(selected)+'">':
      '<label>Effective period<select name="period">'+renderOptions(possible,selected!)+'</select></label>')+
      (endPeriods.length>1?'<label>Through period<select name="end">'+renderOptions(endPeriods,selected!)+'</select></label>':'')+
      editor+'<div class="fin-actions"><button class="primary">Preview Change</button>'+
      (canSave?'<button class="small-btn" type="button" id="fin-save" disabled>'+escapeHtml(operation?.saveLabel??'Save Draft')+'</button>':'')+'</div></form>'+
      (canSave?'':'<p class="fin-muted">This baseline is frozen. Select an editable draft to save a change.</p>'):
      '<p class="fin-muted">'+(driver?.business?.assetKey?'Tooling link: '+escapeHtml(driver.business.assetKey)+' · Managed with Equipment & Investment.':
      driver?.business?.referenceOnly?'Read-only archive. A mapped quote, quantity and exchange rate are needed to edit.':'Read-only source. Preview requires permission to edit this input.')+'</p>')+
    '<p id="fin-impact-status" role="status"></p><div id="fin-impact-result"></div></div></details>';
  const form=root.querySelector<HTMLFormElement>('form');
  if(!form)return {dirty:()=>false,saving:()=>false,dispose:()=>{}};
  const valueInput=form.elements.namedItem('value') as HTMLInputElement|null,periodInput=form.elements.namedItem('period') as HTMLSelectElement;
  const status=root.querySelector<HTMLElement>('#fin-impact-status')!,resultNode=root.querySelector<HTMLElement>('#fin-impact-result')!;
  const save=root.querySelector<HTMLButtonElement>('#fin-save');
  const preview=form.querySelector<HTMLButtonElement>('button.primary')!;
  const seed=JSON.stringify([...new FormData(form)]);
  const dirty=()=>entry||operation||driver?.business?JSON.stringify([...new FormData(form)])!==seed:valueInput?.value.trim()!==initial(periodInput.value);
  const lock=()=>{
    preview.disabled=saving||pending;
    if(save)save.disabled=saving||pending||!result||result.saveBlocked||!dirty();
    // Read-only inputs keep their values in FormData while a save is in flight.
    form.querySelectorAll<HTMLInputElement>('input:not([data-fixed])').forEach(input=>input.readOnly=saving);
    form.querySelectorAll<HTMLSelectElement>('select').forEach(input=>input.disabled=saving);
    form.querySelectorAll<HTMLButtonElement>('[data-op-add],[data-op-remove]').forEach(input=>input.disabled=saving);
    form.querySelectorAll<HTMLButtonElement>('[data-capital-add],[data-capital-remove]').forEach(input=>input.disabled=saving);
  };
  function clear() {
    coordinator.invalidate();result=null;saveKey='';pending=false;
    status.textContent='';resultNode.innerHTML='';lock();
  }
  form.oninput=clear;
  operation?.bind?.(form,clear);
  periodInput.onchange=()=>{
    if(valueInput&&!driver?.business)valueInput.value=initial(periodInput.value);
    const end=form.elements.namedItem('end') as HTMLSelectElement|null;
    if(end)end.innerHTML=renderOptions(allowedEnds.filter(p=>periodIndex(p.key)>=periodIndex(periodInput.value)),periodInput.value);
    clear();
  };
  const request=()=>{
    const data=new FormData(form),start=String(data.get('period')),end=String(data.get('end')??start);
    const effectivePeriod={from:start,to:end};
    if(operation){
      const submitted=operation.submit(data,form);
      if(!submitted)return null;
      const changeSet=Array.isArray(submitted)?submitted:[submitted];
      return changeSet.length?{effectivePeriod:operation.range??effectivePeriod,changeSet}:null;
    }
    const currency=String(data.get('currency')??base);
    if(entry){
      const values:Record<string,FixedDecimal>={};
      for(const [id,text] of data)if(id.startsWith('field:')&&String(text).trim()){
        const name=id.slice(6),amount=candidateValue(String(text));
        if(!amount)return null;
        values[name]=amount;
      }
      const assetKey=String(data.get('assetKey')??'').trim();
      return {effectivePeriod,changeSet:[{collection:'business',recordType:entry.module,productKey:data.get('productKey'),marketKey:data.get('marketKey')||null,
        reference:data.get('reference'),...(entry.module==='bom'?{partNumber:data.get('partNumber')}:{ }),...(assetKey?{assetKey}:{}),currency,values}]};
    }
    const value=candidateValue(valueInput!.value,driver?.valueKind==='money'?(driver.currency?currencies[driver.currency]:driver.value.scale):undefined);
    return value?{effectivePeriod,changeSet:[{collection:'inputs',key:driver!.key,value,...(quoteCurrency?{currency}:{})}]}:null;
  };
  function show(response:Preview) {
    const {comparison}=response,keys=['revenue','operating_profit','cqa.mpbitri','npv','irr','payback_period','peak_funding_requirement',
      ...(operation?.capital?['capital_gross','capital_allocated','capital_new','capital_payments','capital_receipts','capital_agreed','capital_net','incremental_profit']:[])];
    const paths=response.paths;
    const nodes=new Map(paths.flatMap(path=>path.nodes.map(node=>[node.id,node] as const)));
    const projectImpact=new Set(Object.values(comparison.metrics).map(item=>item.after?.id));
    const developmentKeys=['development_budget','development_gross','development_actual','development_remaining','development_recovery','net_engineering','development_cash','cash_flow'];
    const capitalKeys=['capital_payments','capital_receipts','capital_actual_receipts','capital_receivable','capital_piece_earned','capital_piece_cash',
      'depreciation','incremental_depreciation','incremental_profit','receivables','inventory','payables','nwc','nwc_change','signed_tax','capital_net','capital_salvage','cash_flow','cumulative_cash'];
    const budgetKeys=['approved_budget','confirmed_actual','draft_cost','etc','eac','budget_balance','completion_variance','recorded_payments','unpaid_confirmed'];
    const named=new Set(['unit_labor','labor','unit_sales','unit_material','landed_contribution','material','reported_profit','factory_profit','cash_flow','cumulative_cash','cash','npv','cqa.mpbitri','operating_profit',...developmentKeys,...capitalKeys,...budgetKeys]);
    const shownEdges=new Set<string>();
    for(const edge of paths.flatMap(path=>path.edges)) {
      const from=nodes.get(edge.from)?.metricKey,to=nodes.get(edge.to)?.metricKey;
      if(!to||!named.has(to)&&!projectImpact.has(edge.to))continue;
      const input=operation?.title??driver?.label??(driver?nameOf(dictionary,driver.metricKey):'Business input');
      const label=from&&from!=='input'&&definition(dictionary,from)?metricLabel(dictionary,from):
        escapeHtml(from&&from!=='input'?'Supporting calculation':input);
      shownEdges.add(label+' → '+metricLabel(dictionary,to));
    }
    const errors=response.errors.filter(issue=>issue.phase==='candidate'&&
      (nodes.has(issue.outputId)||projectImpact.has(issue.outputId)));
    const row=(label:string,metric:typeof comparison.metrics[string])=>'<tr><th>'+label+'</th><td>'+amountCell(metric.before)+'</td><td>'+amountCell(metric.after)+'</td><td>'+amountCell(metric.delta,true)+'</td></tr>';
    const periodKeys=['unit_labor','labor','unit_sales','unit_material','material','revenue','volume','voh','foh','factory_profit','reported_profit','other_costs','cash_flow'];
    const periodImpact=new Set(periodKeys);
    const phasedKeys=operation?.capital?capitalKeys:operation?.development?developmentKeys:[];
    const phasedRows=phasedKeys.length?comparison.periodic.flatMap((period,index)=>phasedKeys.flatMap(key=>{
      const metric=period[key];
      return metric&&metric.before?.value!==metric.after?.value?[row(escapeHtml(labelPeriod(response.candidate.periods[index]))+' · '+metricLabel(dictionary,key),metric)]:[];
    })).join(''):'';
    const periodRows=response.fields.length&&(driver?.business||entry||operation&&!operation.budget&&!phasedKeys.length)?[...new Set<string>(response.fields.map(f=>f.period))].flatMap(period=>{
      const index=response.candidate.periods.indexOf(period);
      const products:string[]=[...new Set<string>(response.fields.filter(f=>f.period===period).map(f=>f.productKey).filter(Boolean))];
      return products.flatMap(product=>Object.entries(comparison.products[product]?.periodic[index]??{})
        .filter(([key,metric])=>(periodImpact.has(key)||key.startsWith('landed:'))&&
          (operation?metric.before?.value!==metric.after?.value:metric.delta.value!=null&&Number(metric.delta.value)!==0))
        .sort(([a],[b])=>operation?periodKeys.indexOf(a)-periodKeys.indexOf(b):0)
        .map(([key,metric])=>row(escapeHtml(labelPeriod(period))+' · '+metricLabel(dictionary,key.startsWith('landed:')?'landed_contribution':key),metric)));
    }).join(''):'';
    const funding=operation?.capital?['peak_funding_requirement','payback_period'].map(key=>{
      const comparisonMetric=comparison.metrics[key],field=key==='payback_period'?'recoveryPeriod':'firstPeriod';
      const display=(value:typeof comparisonMetric.before)=>typeof value?.details?.[field]==='string'?labelPeriod(String(value.details[field])):'—';
      return '<p>'+escapeHtml(key==='payback_period'?'First recovery period':'First funding minimum')+' · '+escapeHtml(display(comparisonMetric.before))+
        ' → '+escapeHtml(display(comparisonMetric.after))+'</p>';
    }).join(''):'';
    const budgetRows=operation?.budget?budgetKeys.filter(key=>comparison.budget[key]).map(key=>row(metricLabel(dictionary,key),comparison.budget[key])).join(''):'';
    const budgetCashRows=operation?.budget?[...new Set<string>(response.fields.map(field=>field.period))].flatMap(period=>{
      const metric=comparison.periodic[response.candidate.periods.indexOf(period)]?.cash_flow;
      return metric?[row(escapeHtml(labelPeriod(period))+' · '+metricLabel(dictionary,'cash_flow'),metric)]:[];
    }).join(''):'';
    resultNode.innerHTML=response.fields.slice(0,24).map(field=>'<p><strong>'+escapeHtml(field.beforeLabel??(field.before?inputDecimal(field.before):'New'))+
      (field.beforeCurrency&&field.beforeCurrency!==field.currency?' '+escapeHtml(field.beforeCurrency):'')+' → '+escapeHtml(field.afterLabel??inputDecimal(field.after))+
      (field.unit==='record'?'':' '+escapeHtml(field.unit))+'</strong> · '+escapeHtml(labelPeriod(field.period))+'</p>').join('')+
      '<p>'+escapeHtml(response.affectedProducts.map(labelProduct).join(', ')||'No product values changed')+
      (response.affectedPeriods.length?'<br>'+escapeHtml(response.affectedPeriods.map(labelPeriod).join(', ')):'')+'</p>'+
      (phasedRows?'<h3>'+(operation?.capital?'Capital & cash by period':'Development period impact')+'</h3><div class="fin-table-scroll"><table><thead><tr><th>Metric</th><th>Before</th><th>Candidate</th><th>Change</th></tr></thead><tbody>'+phasedRows+'</tbody></table></div>':'')+
      (periodRows?'<h3>Unit and period impact</h3><div class="fin-table-scroll"><table><thead><tr><th>Metric</th><th>Before</th><th>Candidate</th><th>Change</th></tr></thead><tbody>'+periodRows+'</tbody></table></div>':'')+
      (budgetRows?'<h3>Budget execution impact</h3><div class="fin-table-scroll"><table><thead><tr><th>Metric</th><th>Before</th><th>Candidate</th><th>Change</th></tr></thead><tbody>'+
        budgetRows+'</tbody></table></div>':'')+
      '<h3>'+(operation?.budget?'Project operating and returns impact':'Lifecycle impact')+'</h3>'+funding+
      '<div class="fin-table-scroll"><table><thead><tr><th>Metric</th><th>Before edit</th><th>Candidate</th><th>Change</th></tr></thead><tbody>'+
      keys.filter(k=>comparison.metrics[k]).map(k=>row(metricLabel(dictionary,k),comparison.metrics[k])).join('')+budgetCashRows+
      '</tbody></table></div>'+(shownEdges.size?'<details open><summary>Impact path</summary><ul>'+[...shownEdges].map(edge=>'<li>'+edge+'</li>').join('')+'</ul></details>':'')+
      (errors.length?'<details><summary>Calculation notes ('+errors.length+')</summary><ul>'+[...new Set(errors.map(error=>error.message))].map(message=>'<li>'+escapeHtml(message)+'</li>').join('')+'</ul></details>':'');
  }
  form.onsubmit=async event=>{
    event.preventDefault();
    const change=request();
    if(!change){status.textContent=operation?.development?'Select at least one cost to preview.':'Enter a valid decimal with the required precision.';return;}
    pending=true;result=null;saveKey='';lock();status.textContent='Calculating preview…';resultNode.innerHTML='';
    const response=await coordinator.run<Preview>({projectId,versionId:details.id,revision:details.revision,requestKey:key()},
      token=>api(path+'/preview'+(driver?.business||entry||operation?'?view=panel':''),{requestKey:token.requestKey,revision:token.revision,clientSequence:token.clientSequence,reason:'Preview change from Project Finance',...change}));
    if(closed||response.status==='stale')return;
    pending=false;
    if(response.status==='failed')status.textContent=(response.error as Error).message;
    else {
      result=response.result;saveKey=key();show(result);status.textContent=result.saveBlocked?'Review the calculation notes. The candidate cannot be saved.':'Preview ready. Review the candidate before saving.';
    }
    lock();
  };
  if(save)save.onclick=async()=>{
    const change=request();
    if(!result||!change||saving)return;
    saving=true;lock();status.textContent=operation?.budget?'Saving budget action…':'Saving draft…';
    try {
      const saved=await api(path,{requestKey:saveKey,revision:details.revision,reason:'Save reviewed finance input',
        candidateSha256:result.candidateSha256,previewCalculationVersion:result.calculationVersion,...change},'PUT');
      if(saved.calculationSha256!==result.calculationSha256)status.textContent='Saved. Reload to review the recalculated draft.';
      else onSaved(result.fields[0]?.key);
    } catch(error) {status.textContent=(error as Error).message;}
    finally {saving=false;lock();}
  };
  return {dirty,saving:()=>saving,dispose:()=>{closed=true;coordinator.invalidate();}};
}
