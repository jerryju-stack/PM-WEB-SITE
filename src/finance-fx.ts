import {amountCell,escapeHtml as html,metricLabel} from '/finance-view.js';
import type {Dictionary,FinanceReport,Workspace} from '/finance-view.js';
import type {FinanceApi} from '/finance-impact.js';
import type {FinanceFxSnapshot} from '../lib/finance-fx.ts';

export function currencyOptions(currencies:Record<string,number>,selected:string) {
  return Object.keys(currencies).sort().map(code=>'<option value="'+html(code)+'"'+(code===selected?' selected':'')+'>'+html(code)+'</option>').join('');
}

export function displayCurrencySelect(workspace:Workspace) {
  return '<label>Display currency<select id="fin-display-currency" data-filter-key="displayCurrency">'+
    currencyOptions(workspace.currencyOptions,workspace.displayCurrency??'')+'</select></label>';
}

export function fxBasisText(basis:Workspace['fxBasis']) {
  if(!basis||basis.kind==='missing')return 'FX snapshot pending';
  if(basis.kind==='archived_workbook')return 'Approved CQA workbook FX';
  if(basis.kind==='legacy_period_rates')return 'Documented legacy period rates';
  const s=basis.snapshot;
  return [s.date,s.period,'Base '+s.base,s.source].filter(Boolean).join(' · ');
}

const rateFields=(base:string,codes:string[],rates:Record<string,string>)=>codes.filter(code=>code!==base).map(code=>
  '<label>1 '+html(base)+' = '+html(code)+'<input name="rate-'+html(code)+'" inputmode="decimal" maxlength="37" value="'+html(rates[code])+'"></label>').join('');

export function versionFxPanel(workspace:Workspace,report:FinanceReport) {
  const fx=workspace.fxBasis?.snapshot,main=report.details.currency;
  const base=fx?.base??main,currencies=workspace.fxCurrencyOptions;
  const direction=fx?'<p>'+Object.entries(fx.rates).map(([code,rate])=>'1 '+html(fx.base)+' = '+html(rate)+' '+html(code)).join(' · ')+'</p>':'';
  return '<section class="fin-panel"><div class="fin-panel-head"><h2>Version exchange rates</h2></div>'+
    '<p>Case currency <strong>'+html(main)+'</strong> · Display currency <strong>'+html(report.currency)+'</strong> · '+html(fxBasisText(workspace.fxBasis))+'</p>'+
    direction+(fx?.note?'<p>'+html(fx.note)+'</p>':'')+
    (workspace.archived?'<p class="fin-muted">This version uses the archived workbook’s approved valuation basis.</p>':'')+
    '<div class="fin-actions"><button class="small-btn" type="button" id="fin-export-snapshot">Export source snapshot</button>'+
    '<button class="small-btn" type="button" id="fin-export-dashboard">Export dashboard results</button>'+
    (workspace.canCloneFx?'<button class="small-btn" type="button" id="fin-copy-draft">Create Draft</button>':'')+'</div>'+
    '<p id="fin-business-status" role="status"></p>'+
    (workspace.canEditFx?'<details id="fin-fx-settings"><summary>Edit version exchange rates</summary>'+
      '<p class="fin-muted">Enter units of each currency per 1 unit of the FX base. The base rate is 1. Supply a reference date or period. Blank rates remain pending.</p>'+
      '<form id="fin-fx-form"><div class="fin-filters"><label>Case currency<select name="currency">'+currencyOptions(currencies,main)+'</select></label>'+
      '<label>FX base<select name="base">'+currencyOptions(currencies,base)+'</select></label>'+
      '<label>Reference date<input name="date" type="date" value="'+html(fx?.date) +'"></label>'+
      '<label>Reference period<input name="period" maxlength="100" value="'+html(fx?.period)+'"></label></div>'+
      '<div class="fin-filters" data-fx-rates>'+rateFields(base,Object.keys(currencies).sort(),fx?.rates??{})+'</div>'+
      '<div class="fin-filters"><label>FX note<input name="note" maxlength="2000" value="'+html(fx?.note)+'"></label>'+
      '<label>Change reason<input name="reason" maxlength="2000" required></label></div>'+
      '<div class="fin-actions"><button class="small-btn" type="submit" value="preview">Preview rate changes</button>'+
      '<button class="primary" type="submit" value="save" disabled>Save version rates</button></div>'+
      '<p role="status" data-fx-status></p><div data-fx-preview></div></form></details>':'')+'</section>';
}

export function downloadFinanceJson(filename:string,data:unknown){
  const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));
  const a=document.createElement('a');a.href=href;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}

export function mountVersionFx(root:HTMLElement,workspace:Workspace,report:FinanceReport,api:FinanceApi,path:string,dictionary:Dictionary,
  dashboardSelection:unknown,onSaved:()=>void) {
  const form=root.querySelector<HTMLFormElement>('#fin-fx-form'),status=root.querySelector<HTMLElement>('#fin-business-status')!;
  const revision=report.details.revision,versionPath=path+'/versions/'+encodeURIComponent(report.details.id);
  const exportButton=root.querySelector<HTMLButtonElement>('#fin-export-snapshot')!;
  exportButton.onclick=async()=>{
    exportButton.disabled=true;
    try {
      const {snapshot,revision:exportedRevision}=await api(versionPath);
      if(exportedRevision!==revision)throw Error('The version changed. Reload the dashboard before exporting.');
      downloadFinanceJson('finance-'+report.details.id+'-r'+revision+'-snapshot.json',snapshot);
    } catch(error){status.textContent=(error as Error).message;}
    finally{exportButton.disabled=false;}
  };
  root.querySelector<HTMLButtonElement>('#fin-export-dashboard')!.onclick=()=>downloadFinanceJson('finance-dashboard.json',{
    format:'finance-dashboard-v1',displayCurrency:workspace.displayCurrency,fxMode:'own',
    selection:dashboardSelection,baseline:workspace.baseline,current:workspace.current,comparison:workspace.comparison});
  if(!form)return;
  const preview=root.querySelector<HTMLElement>('[data-fx-preview]')!,message=root.querySelector<HTMLElement>('[data-fx-status]')!;
  const base=form.elements.namedItem('base') as HTMLSelectElement;
  const rateList=form.querySelector<HTMLElement>('[data-fx-rates]')!;
  const save=form.querySelector<HTMLButtonElement>('[value="save"]')!,previewButton=form.querySelector<HTMLButtonElement>('[value="preview"]')!;
  let dirty=false,savingRates=false;
  const clear=()=>{dirty=true;candidate=undefined;save.disabled=true;preview.replaceChildren();message.textContent='';};
  let candidate:{requestKey:string;reason:string;revision:number;fxSettings:unknown;candidateSha256:string}|undefined;
  form.oninput=clear;
  base.onchange=()=>{
    // A number quoted against the previous base has a different meaning. Ask for the new quotes explicitly.
    rateList.innerHTML=rateFields(base.value,Array.from(base.options,option=>option.value),{});
    clear();
  };
  form.onsubmit=async event=>{
    event.preventDefault();const fields=new FormData(form);
    const saving=(event.submitter as HTMLButtonElement|null)?.value==='save';
    if(saving&&!candidate)return;
    const rates=Object.fromEntries([...fields].filter(([key,value])=>key.startsWith('rate-')&&String(value).trim())
      .map(([key,value])=>[key.slice(5),String(value).trim()]));
    const snapshot:FinanceFxSnapshot={base:base.value,date:String(fields.get('date')||'')||null,period:String(fields.get('period')||'').trim()||null,
      rates,note:String(fields.get('note')||''),source:'manual'};
    const body={revision,requestKey:crypto.randomUUID(),reason:String(fields.get('reason')||'').trim(),fxSettings:{currency:fields.get('currency'),snapshot}};
    const controls=[...form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button')];
    controls.forEach(control=>{control.disabled=true;});
    message.textContent=saving?'Saving version rates…':'Calculating preview…';
    try {
      if(saving){savingRates=true;await api(versionPath,candidate,'PUT');dirty=false;onSaved();return;}
      const response=await api(versionPath+'/fx-preview',body);
      preview.innerHTML='<div class="fin-table-scroll"><table><thead><tr><th>Metric</th><th>Saved</th><th>Preview</th></tr></thead><tbody>'+
        Object.keys(response.after).map(key=>'<tr><th scope="row">'+metricLabel(dictionary,key)+'</th><td>'+amountCell(response.before[key])+
          '</td><td>'+amountCell(response.after[key])+'</td></tr>').join('')+'</tbody></table></div>';
      candidate=response.missingFx.length?undefined:{...body,candidateSha256:response.candidateSha256};
      message.textContent=response.missingFx.length?response.missingFx.join(' '):'Preview ready.';
    } catch(error){message.textContent=(error as Error).message;}
    finally{savingRates=false;controls.forEach(control=>{control.disabled=false;});save.disabled=!candidate;previewButton.disabled=false;}
  };
  return {dirty:()=>dirty,saving:()=>savingRates};
}
