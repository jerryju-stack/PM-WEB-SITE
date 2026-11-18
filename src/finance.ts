import {amountCell,budgetKeys,cashChart,definition,escapeHtml,evidenceRows,financeUrl,groups,help,metricLabel,modules,nameOf,reports,rowFor,scopeFor,titleFor,trace,varianceCell} from '/finance-view.js';
import type {Dictionary,FinanceLink,FinanceReport,Workspace} from '/finance-view.js';
import {inputDecimal,mountImpactPanel} from '/finance-impact.js';
import type {FinanceApi} from '/finance-impact.js';
import type {CalculationOutput} from '../lib/finance-calculation-types.ts';
import {operationsEditor,operationsPage} from '/finance-operations.js';
import {developmentEditor,developmentPage} from '/finance-development.js';
import type {DevelopmentModule} from '../lib/finance-development.ts';
import {capitalEditor,investmentPage,returnsPage} from '/finance-capital.js';
import {budgetEditor,budgetPage,isBudgetDetail} from '/finance-budget.js';
import {comparisonFilters,comparisonPage,comparisonReturn,comparisonSource,mountComparisonChart} from '/finance-compare.js';

const html=escapeHtml;
const sectionPanel=(title:string,body:string,extra='')=>'<section class="fin-panel"><div class="fin-panel-head"><h2>'+title+'</h2>'+extra+'</div>'+body+'</section>';
const empty=(title:string,description:string)=>sectionPanel(html(title),'<p class="fin-muted">'+html(description)+'</p>');
const options=(items:{key:string;label:string}[],selected:string,placeholder:string)=>
  [{key:'',label:placeholder},...items].map(({key,label})=>'<option value="'+html(key)+'" '+(key===selected?'selected':'')+'>'+html(label)+'</option>').join('');
const table=(headers:string[],body:string)=>'<div class="fin-table-scroll"><table><thead><tr>'+headers.map(header=>'<th scope="col">'+header+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
const route=()=>/^\/projects\/([a-zA-Z0-9_-]+)\/finance(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(location.pathname);
const stateKey='projectFinance';
type Position={index:number;parent?:string;focus?:string;scroll?:number};
const historyPosition=():Position|undefined=>history.state?.[stateKey];
const updateHistory=(position:Position,url=location.href)=>history.replaceState({...history.state,[stateKey]:position},'',url);
const supportedModule:Record<string,string>={operations:'operations',bom:'bom',commercial:'commercial','factory-costs':'factory',returns:'returns'};

export function mountFinanceWorkspace({root,api,user,login}:{root:HTMLElement;api:FinanceApi;user:unknown;login:()=>void}) {
  let sequence=0,stopped=false,position=historyPosition()?.index??0,restoring=false,approvedBack=false;
  let cleanChart:()=>void=()=>{},impact:ReturnType<typeof mountImpactPanel>|undefined;
  let dictionaryPromise:Promise<Dictionary>|undefined;
  let rendered:Workspace|null=null,displayedOutputs=new Map<string,CalculationOutput>();
  let helpButton:HTMLButtonElement|null=null,helpBox:HTMLElement|null=null;
  const oldScrollRestoration=history.scrollRestoration;history.scrollRestoration='manual';
  if(!historyPosition())updateHistory({index:position});
  const savePosition=(focus?:string)=>updateHistory({...historyPosition(),index:position,scroll:scrollY,focus:focus||document.activeElement?.id});
  const leave=()=>!impact?.saving()&&(!impact?.dirty()||confirm('Discard the unsaved finance change?'));
  function resetView() {cleanChart();impact?.dispose();impact=undefined;rendered=null;displayedOutputs.clear();closeHelp();root.innerHTML='';}
  function navigate(href:string,focus?:string) {
    if(!leave())return;
    savePosition(focus);
    const parent=location.pathname+location.search;
    history.pushState({[stateKey]:{index:++position,parent}},'',href);
    void load(false);
  }
  function pop() {
    if(restoring){restoring=false;return;}
    const approved=approvedBack;approvedBack=false;
    const target=historyPosition()?.index;
    if(!approved&&!leave()&&target!==undefined&&target!==position){restoring=true;history.go(position-target);return;}
    position=target??0;void load(true);
  }
  function unloading(event:BeforeUnloadEvent) {
    if(impact?.dirty()||impact?.saving()){event.preventDefault();event.returnValue='';}
  }
  function closeHelp() {
    const trigger=helpButton;
    trigger?.setAttribute('aria-expanded','false');trigger?.removeAttribute('aria-controls');
    helpBox?.remove();helpButton=null;helpBox=null;
  }
  let glossary:Dictionary={metrics:{}};
  function openHelp(button:HTMLButtonElement) {
    if(helpButton===button)return;
    const item=definition(glossary,button.dataset.definition!);
    if(!item)return;
    closeHelp();helpButton=button;helpBox=document.createElement('div');
    helpBox.id='fin-definition';helpBox.className='fin-definition';helpBox.setAttribute('role','region');
    helpBox.setAttribute('aria-label',item.en);
    helpBox.innerHTML='<strong>'+html(item.en)+'</strong><p lang="zh-CN">'+html(item.zh)+' · '+html(item.definition)+'</p>'+
      (item.formula?'<p lang="zh-CN">'+html(item.formula)+'</p>':'')+'<button type="button" class="small-btn" data-close-help>Close</button>';
    (button.closest('dialog')??root).append(helpBox);button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',helpBox.id);
    const rect=button.getBoundingClientRect(),left=Math.max(12,Math.min(rect.left,innerWidth-helpBox.offsetWidth-12));
    helpBox.style.left=left+'px';helpBox.style.top=Math.max(12,Math.min(rect.bottom+8,innerHeight-helpBox.offsetHeight-12))+'px';
  }
  function showSources(button:HTMLElement) {
    const report=button.dataset.side==='baseline'?rendered?.baseline:rendered?.current;
    const output=displayedOutputs.get(button.dataset.side+':'+button.dataset.source);
    if(!report||!output)return;
    const dialog=document.createElement('dialog');dialog.className='fin-source-dialog';
    dialog.setAttribute('aria-label','Calculation sources');
    const records=output.upstreamInputs.map(id=>report.inputs[id]).filter(Boolean);
    dialog.innerHTML='<form method="dialog"><button class="small-btn">Close</button></form><h2>'+metricLabel(glossary,output.metricKey)+' · Sources</h2>'+
      '<p>'+html(report.details.name)+' · '+html(output.basis)+' · '+html(output.calculationVersion)+'</p><p>'+html(output.formula)+'</p>'+
      '<ul>'+evidenceRows(records,key=>report.periods.find(item=>item.key===key)?.label??key)+'</ul>';
    root.append(dialog);dialog.addEventListener('close',()=>{if(helpButton&&dialog.contains(helpButton))closeHelp();dialog.remove();button.focus({preventScroll:true});});dialog.showModal();
  }
  const suppressFocus=(event:FocusEvent)=>{if(event.target instanceof HTMLButtonElement&&event.target.matches('[data-definition]'))openHelp(event.target);};
  const onHover=(event:PointerEvent)=>{if(event.pointerType==='mouse'&&event.target instanceof HTMLButtonElement&&event.target.matches('[data-definition]'))openHelp(event.target);};
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&helpBox){event.preventDefault();const trigger=helpButton;closeHelp();if(trigger&&document.activeElement!==trigger){root.removeEventListener('focusin',suppressFocus);trigger.focus({preventScroll:true});root.addEventListener('focusin',suppressFocus);}}};
  const click=(event:MouseEvent)=>{
    const target=event.target as Element;
    if(target.closest('[data-finance-login]')){login();return;}
    if(target.closest('[data-close-help]')){const trigger=helpButton;closeHelp();root.removeEventListener('focusin',suppressFocus);trigger?.focus({preventScroll:true});root.addEventListener('focusin',suppressFocus);return;}
    const help=target.closest<HTMLButtonElement>('[data-definition]');if(help){openHelp(help);return;}
    if(!target.closest('#fin-definition'))closeHelp();
    const source=target.closest<HTMLElement>('[data-source]');if(source){showSources(source);return;}
    const link=target.closest<HTMLAnchorElement>('[data-finance-nav]');
    if(!link||event.defaultPrevented||event.button||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    event.preventDefault();
    if(link.hasAttribute('data-finance-back')&&historyPosition()?.parent===link.pathname+link.search) {
      if(leave()){savePosition();approvedBack=true;history.back();}
    } else navigate(link.href,link.id);
  };
  const closeOnScroll=()=>{if(helpBox&&helpButton){const rect=helpButton.getBoundingClientRect();helpBox.style.top=Math.max(12,Math.min(rect.bottom+8,innerHeight-helpBox.offsetHeight-12))+'px';}};
  window.addEventListener('popstate',pop);window.addEventListener('beforeunload',unloading);window.addEventListener('scroll',closeOnScroll);
  root.addEventListener('click',click);root.addEventListener('focusin',suppressFocus);root.addEventListener('pointerover',onHover);document.addEventListener('keydown',onKey);

  async function load(restore:boolean) {
    const token=++sequence,params=new URLSearchParams(location.search),match=route();
    resetView();
    if(!user){root.innerHTML='<h1>Project Finance</h1>'+empty('Sign in to view project finance','Use your Project Station account to open the projects you can access.')+'<button type="button" class="primary" data-finance-login>Sign in</button>';return;}
    root.innerHTML='<p role="status">Loading project finance…</p>';
    try {
      if(!match){
        const {projects}=await api('finance/projects');
        if(stopped||token!==sequence)return;
        if(projects.length===1&&params.get('choose')!=='1'){
          const path='/projects/'+encodeURIComponent(projects[0].id)+'/finance';
          updateHistory({...historyPosition(),index:position},path);return void load(restore);
        }
        root.innerHTML='<div class="fin-heading"><h1>Project Finance</h1><a class="small-btn" href="/#projects">Project Overview</a></div>'+
          (projects.length?'<div class="fin-projects">'+projects.map(project=>sectionPanel(html(project.title),
            '<p class="fin-muted">'+(project.approvedBaselineId?'Approved baseline available':'No approved baseline')+'</p>'+
            financeUrl('/projects/'+encodeURIComponent(project.id)+'/finance','Open Finance Dashboard','project-'+project.id))).join('')+'</div>':
            empty('No finance projects available','Your account has no projects with finance access.'));
      } else {
        dictionaryPromise??=fetch('/finance-dictionary.json').then(response=>{if(!response.ok)throw Error('Metric definitions could not load.');return response.json();});
        const request=new URLSearchParams(params);
        if(match[2])request.set('module',match[2]);
        if(match[3])request.set('source',match[3]);
        const [workspace,dictionary]=await Promise.all([api('projects/'+encodeURIComponent(match[1])+'/finance/workspace?'+request),dictionaryPromise]);
        if(stopped||token!==sequence)return;
        glossary=dictionary;rendered=workspace;renderProject(workspace,match,params);
      }
      if(restore){const target=historyPosition();requestAnimationFrame(()=>{if(!stopped&&token===sequence){const focus=document.getElementById(target?.focus??'');
        for(let parent=focus?.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
        focus?.focus({preventScroll:true});window.scrollTo(0,target?.scroll??0);}});}
      else window.scrollTo(0,0);
    } catch(error) {
      if(stopped||token!==sequence)return;
      const status=(error as {status?:number}).status;
      root.innerHTML='<h1>'+((status===403||status===404)?'Project unavailable':status===401?'Sign in to Project Finance':'Finance could not load')+'</h1>'+
        '<p class="fin-muted">'+html(status===403||status===404?'This project is outside your finance access.':(error as Error).message)+'</p>'+
        (status===401?'<button class="primary" data-finance-login>Sign in</button>':financeUrl('/finance?choose=1','Switch Project'));
    }
  }

  function renderProject(workspace:Workspace,match:RegExpExecArray,params:URLSearchParams) {
    const projectId=match[1],section=match[2]??'',sourceKey=match[3]??'',baseline=workspace.baseline,current=workspace.current;
    const active=current??baseline,periods=active?.periods??[],products=active?.productLabels??[];
    const period=periods.find(p=>p.key===params.get('period'))?.key??'',product=products.find(p=>p.key===params.get('product'))?.key??'';
    const markets=(workspace.markets??[]).filter(item=>!product||!item.productKey||item.productKey===product);
    const market=markets.find(item=>item.key===params.get('market'))?.key??'';
    const effectiveModule=supportedModule[section],businessSection=['commercial','bom','factory'].includes(effectiveModule);
    const businessType=businessSection?effectiveModule as 'commercial'|'bom'|'factory':null;
    for(const [key,value] of [['baseline',baseline?.details.id],['version',current?.details.id],['period',period],['product',product],['market',market]] as const) {
      if(value)params.set(key,value);else params.delete(key);
    }
    const base='/projects/'+encodeURIComponent(projectId)+'/finance',isComparison=section==='compare';
    const compareReport=workspace.comparisonReport;
    if(isComparison&&compareReport){
      params.set('from',compareReport.before.id);params.set('to',compareReport.after.id);
      if(compareReport.cutoff)params.set('cutoff',compareReport.cutoff);else params.delete('cutoff');
      if(compareReport.product)params.set('compareProduct',compareReport.product);else params.delete('compareProduct');
    }
    const link:FinanceLink=(route='')=>{
      const target=new URLSearchParams(params);
      if(route==='compare'&&!target.has('compareReturn')&&!target.has('from')&&!target.has('to')){
        if(period)target.set('cutoff',period);
        if(product)target.set('compareProduct',product);
      }
      return base+(route?'/'+route:'')+(target.size?'?'+target:'');
    };
    const operations=section==='operations'?workspace.operations:null;
    const development=workspace.development;
    const capital=workspace.capital,fullReturns=section==='returns'&&params.get('basis')==='full';
    const budgetExecution=workspace.budget;
    const budgetLink=(key='')=>link('budget'+(key?'/'+key:''));
    const capitalLink=(module:string,key='',changes:Record<string,string|null>={})=>{
      const next=new URLSearchParams(params);
      for(const [name,value] of Object.entries(changes))if(value)next.set(name,value);else next.delete(name);
      return base+'/'+module+(key?'/'+key:'')+(next.size?'?'+next:'');
    };
    const developmentModule=section as DevelopmentModule;
    const developmentLink=(module:DevelopmentModule,key?:string)=>link(module+(key?'/'+key:''));
    const operationScope=operations?.find(scope=>scope.productKey===product)??(operations?.length===1?operations[0]:null);
    const operationsLink=(scope:{productKey:string;period:string},source='')=>{
      const next=new URLSearchParams(params);
      next.set('product',scope.productKey);next.set('period',scope.period);
      return base+'/operations'+(source?'/'+source:'')+'?'+next;
    };
    const isDraft=active?.details.status==='draft';
    const developmentForm=development?developmentEditor(development,developmentModule,sourceKey,periods,products,period,product,workspace.developmentRights,isDraft):undefined;
    const capitalForm=capital?capitalEditor(capital,section,sourceKey,periods,products,period,product,workspace.capitalRights,isDraft):undefined;
    const budgetForm=budgetExecution?budgetEditor(budgetExecution,sourceKey,periods,products,period,product,workspace.currencies,
      active!.currency,workspace.budgetRights,isDraft):undefined;
    const operation=budgetForm??capitalForm??developmentForm??(operationScope?operationsEditor(operationScope,sourceKey,workspace.canOperate,workspace.canCalibrate,isDraft):undefined);
    const routeSource=operationScope?.records.some(row=>row.key===sourceKey);
    const developmentSource=development?.rows.some(row=>row.key===sourceKey);
    const capitalSource=capital?.rows.some(row=>row.key===sourceKey)||capital?.archiveRows.some(row=>row.key===sourceKey);
    updateHistory({...historyPosition(),index:position},link([section,sourceKey].filter(Boolean).join('/')));
    const labelPeriod=(key:string)=>periods.find(item=>item.key===key)?.label??key;
    const labelProduct=(key:string)=>products.find(item=>item.key===key)?.label??key;
    const side=(value:CalculationOutput|undefined,version:'baseline'|'current')=>{
      if(value)displayedOutputs.set(version+':'+value.id,value);
      return amountCell(value,false,version==='baseline'?'No baseline':'No forecast')+trace(value,version);
    };
    const bScope=scopeFor(baseline,product),cScope=scopeFor(current,product);
    const scopedDifference=product?workspace.comparison?.products[product]:workspace.comparison;
    const rowIndex=periods.findIndex(item=>item.key===period);
    const reportMetric=(data:FinanceReport|null,key:string)=>{
      const scoped=scopeFor(data,product),row=rowFor(data,product,period);
      if(period&&key==='revenue')return row?.reported_revenue;
      if(period&&key==='cqa.mpbitri')return row?.reported_profit;
      return scoped?.metrics[key];
    };
    const metricDelta=(key:string)=>period&&['revenue','cqa.mpbitri'].includes(key)?
      scopedDifference?.periodic[rowIndex]?.[key==='revenue'?'reported_revenue':'reported_profit']:scopedDifference?.metrics[key];
    const cards=()=>'<div class="fin-metrics" aria-label="Key financial metrics">'+groups.map(({keys,title,route})=>{
      const hasCqa=keys.includes('operating_profit')&&!!(bScope?.metrics['cqa.mpbitri']||cScope?.metrics['cqa.mpbitri']);
      return '<section class="fin-metric">'+financeUrl(link(route),title,'metric-'+keys[0])+keys.map(key=>help(glossary,key)).join('')+
        keys.map(key=>'<div class="fin-card-values"><div><span>Baseline'+(key==='operating_margin'?' margin':'')+'</span>'+side(reportMetric(baseline,key),'baseline')+
          '</div><div><span>Forecast'+(key==='operating_margin'?' margin':'')+'</span>'+side(reportMetric(current,key),'current')+
          '</div><div><span>Change'+(key==='operating_margin'?' in margin':'')+'</span>'+varianceCell(metricDelta(key),key)+'</div></div>').join('')+
        (hasCqa?'<div class="fin-historical"><span>Historical '+metricLabel(glossary,'cqa.mpbitri')+'</span>'+
          '<div class="fin-card-values"><div><span>Baseline</span>'+side(reportMetric(baseline,'cqa.mpbitri'),'baseline')+
          '</div><div><span>Forecast</span>'+side(reportMetric(current,'cqa.mpbitri'),'current')+
          '</div><div><span>Change</span>'+varianceCell(metricDelta('cqa.mpbitri'),'cqa.mpbitri')+'</div></div></div>':'')+
        (keys.includes('operating_profit')?'<div class="fin-work-links">'+financeUrl(link('bom'),'BOM Cost Inputs','metric-bom')+
          financeUrl(link('factory-costs'),'Factory Cost Inputs','metric-factory')+'</div>':'')+'</section>';
    }).join('')+'</div>';
    const comparison=()=>{
      if(!baseline||!current)return empty('Version Comparison','Select a baseline and a forecast to see changes.');
      if(!workspace.comparison?.compatible)return empty('Version Comparison','The selected versions have incompatible calculation scopes.');
      const keys=['revenue','operating_profit','operating_margin','cqa.mpbitri','npv','irr','payback_period','peak_funding_requirement'];
      return sectionPanel('Version Comparison',table(['Metric','Baseline','Forecast','Change'],keys.filter(key=>reportMetric(baseline,key)||reportMetric(current,key)).map(key=>
        '<tr><th scope="row">'+metricLabel(glossary,key)+'</th><td>'+amountCell(reportMetric(baseline,key))+'</td><td>'+amountCell(reportMetric(current,key))+
        '</td><td>'+varianceCell(metricDelta(key),key)+'</td></tr>').join('')),section?'':financeUrl(link('compare'),'Open comparison','dashboard-compare'));
    };
    const budget=()=>{
      const keys=[...budgetKeys,...['draft_cost','recorded_payments','unpaid_confirmed'].filter(key=>baseline?.budget[key]||current?.budget[key])];
      return sectionPanel('Budget Execution <small>· Project total</small>',table(['Metric','Baseline','Forecast','Change'],keys.map(key=>
        '<tr><th scope="row">'+metricLabel(glossary,key)+'</th><td>'+side(baseline?.budget[key],'baseline')+'</td><td>'+side(current?.budget[key],'current')+
        '</td><td>'+varianceCell(workspace.comparison?.budget[key],key)+'</td></tr>').join('')),section?'':financeUrl(link('budget'),'Open budget'));
    };
    const chartPeriods=periods.slice(0,period?rowIndex+1:undefined);
    const series=[{name:'Baseline',report:baseline},{name:'Forecast',report:current}].map(({name,report})=>({name,values:chartPeriods.map(p=>{
      const value=report?.currency===active?.currency?rowFor(report,product,p.key)?.cumulative_cash?.value:null;
      return value==null?null:Number(value);
    })}));
    const focusReturns=scopeFor(active,product)?.metrics;
    const peakPeriod=focusReturns?.peak_funding_requirement?.details.firstPeriod;
    const recoveryPeriod=focusReturns?.payback_period?.details.recoveryPeriod;
    const chart=()=>sectionPanel('Cumulative Cash Flow '+help(glossary,'cumulative_cash'),series.some(s=>s.values.some(v=>v!==null))?
      '<div class="fin-chart"><div class="fin-chart-legend">'+series.map((item,index)=>item.values.some(v=>v!==null)?'<span class="fin-series-'+index+'">'+item.name+'</span>':'').join('')+
      '<span>'+html(active?.currency)+'</span></div><canvas role="img"></canvas></div>'+
      (baseline&&current&&baseline.currency!==current.currency?'<p class="fin-muted">The chart shows the selected forecast currency.</p>':'')+
      '<p class="fin-muted">'+html(current?'Forecast':'Baseline')+' · Full horizon'+
      (typeof peakPeriod==='string'?' · Peak funding: '+html(labelPeriod(peakPeriod)):'')+
      (typeof recoveryPeriod==='string'?' · First recovery: '+html(labelPeriod(recoveryPeriod)):'')+'</p>':
      '<p class="fin-muted">No cumulative cash flow is available for this scope.</p>',section?'':financeUrl(link('returns'),'Open returns'));
    const cashRows=()=>sectionPanel('Period Cash Flow',table(['Period','Version',metricLabel(glossary,'cash_flow'),metricLabel(glossary,'cumulative_cash'),metricLabel(glossary,'present_value')],
      periods.filter(p=>!period||p.key===period).flatMap(p=>([{report:baseline,key:'baseline'},{report:current,key:'current'}] as const).filter(x=>x.report).map(({report,key})=>{
        const row=rowFor(report,product,p.key);return '<tr><th scope="row">'+html(p.label)+'</th><td>'+html(report!.details.name)+'</td>'+
          ['cash_flow','cumulative_cash','present_value'].map(metric=>'<td>'+side(row?.[metric],key)+'</td>').join('')+'</tr>';
      })).join('')));
    const catalog=()=>sectionPanel('Business Modules','<div class="fin-modules">'+modules.map(([key,title])=>financeUrl(link(key),title,'module-'+key)).join('')+'</div>');
    const context='<div class="fin-context"><span>Approved baseline · <strong>'+html(workspace.versions.find(v=>v.id===workspace.approvedBaselineId)?.name??'None')+
      '</strong></span><span>Current forecast · <strong>'+html(workspace.versions.find(v=>v.id===workspace.currentVersionId)?.name??'None')+
      '</strong></span><span>Viewed as of · <strong>'+html(active?.asOf??'—')+'</strong></span><span>Currency · <strong>'+html(active?.currency??'—')+'</strong></span></div>';
    const filters='<div class="fin-filters">'+
      '<label>Baseline<select id="fin-filter-baseline" data-filter-key="baseline">'+options(workspace.versions.filter(v=>v.status==='frozen').map(v=>({key:v.id,label:v.name})),baseline?.details.id??'','Use approved baseline')+'</select></label>'+
      '<label>Forecast version<select id="fin-filter-version" data-filter-key="version">'+options(workspace.versions.map(v=>({key:v.id,label:v.name+(v.status==='draft'?' · Draft':'')})),current?.details.id??'','Use current forecast')+'</select></label>'+
      '<label>Period<select id="fin-filter-period" data-filter-key="period">'+options(periods,period,'All periods')+'</select></label>'+
      '<label>Product<select id="fin-filter-product" data-filter-key="product">'+options(products,product,'All products')+'</select></label>'+
      (businessSection&&effectiveModule!=='factory'?'<label>Market<select id="fin-filter-market" data-filter-key="market">'+options(markets,market,'All markets')+'</select></label>':'')+'</div>';
    const unavailable=(!workspace.approvedBaselineId?empty('No approved baseline','An authorized finance owner can import or approve a baseline for this project.'):'')+
      (!active?empty('No finance version selected','There is no active finance version to calculate. Select an available version or return to Project Overview.'):'');
    const module=modules.find(item=>item[0]===section);
    const driverScope=workspace.inputs.filter(input=>input.module===effectiveModule&&(!product||!input.productKey||input.productKey===product)&&
      (!market||!input.marketKey||input.marketKey===market)&&(!period||input.acrossPeriods||input.periodKey===period||input.business?.assetKey));
    const picked=sourceKey?workspace.inputs.find(input=>input.key===sourceKey&&input.module===effectiveModule):undefined;
    const creating=!!(active&&workspace.canAdd&&sourceKey==='new'&&businessType);
    const entries=driverScope.filter(input=>input.business);
    const drivers=entries.length?entries:[...driverScope.filter(input=>!input.business)];
    const term=(params.get('part')??'').slice(0,100);
    const matching=term?drivers.filter(input=>[input.business?.label,input.label,input.source?.reference,input.metricKey]
      .some(value=>String(value??'').toLowerCase().includes(term.toLowerCase()))):drivers;
    const pageCount=Math.max(1,Math.ceil(matching.length/50)),page=Math.max(1,Math.min(pageCount,Number(params.get('rows'))||1));
    const rowHref=(key:string,sourcePeriod:string)=>{
      const next=new URLSearchParams(params);
      if(businessSection&&sourcePeriod)next.set('period',sourcePeriod);
      return base+'/'+section+'/'+key+(next.size?'?'+next:'');
    };
    const driverRows=matching.slice((page-1)*50,page*50).map(input=>
      '<tr><th scope="row">'+financeUrl(rowHref(input.key,input.business?input.periodKey:''),input.label??nameOf(glossary,input.metricKey),'source-'+input.key)+help(glossary,input.metricKey)+
      (input.business?.label?'<small class="fin-state">'+html(input.business.label)+'</small>':'')+
      (input.business?.normalizedDemand?'<small class="fin-state">Archived equivalent volume</small>':'')+
      '</th><td>'+html(input.productKey?labelProduct(input.productKey):input.lineKey??'Shared')+
      (input.marketKey?'<small class="fin-state">'+html(markets.find(item=>item.key===input.marketKey)?.label??input.marketKey)+'</small>':'')+
      '</td><td>'+html(labelPeriod(input.periodKey))+'</td>'+
      (businessSection?'<td>'+html(inputDecimal(input.value)+' '+input.unit)+(input.fx?.source?'<small class="fin-state">FX '+html(input.fx.source)+'</small>':'')+
        (input.landed!=null?'<small class="fin-state">Landed · '+html(input.landed)+' '+html(workspace.archived?'CNY':active?.currency)+'/piece</small>':'')+
        (input.business?.assetKey?'<small class="fin-state">'+html(input.business.assetKey)+' · M08</small>':'')+'</td>':'')+
      '<td>'+html([input.source?.sheet,input.source?.cell].filter(Boolean).join('!')||input.source?.reference||input.source?.key)+'</td></tr>').join('');
    const controlLink=(target:number,label:string)=>{
      const next=new URLSearchParams(params);next.set('rows',String(target));
      return financeUrl(base+'/'+section+'?'+next,label);
    };
    const anchors=businessSection||operations||development||capital||budgetExecution?'<div class="fin-actions">'+(workspace.canAdd&&!creating?financeUrl(link(section+'/new'),'Add record','fin-add-business'):'')+
      (workspace.canClone?'<button class="small-btn" type="button" id="fin-copy-draft">Create Draft</button>':'')+'</div>':'';
    const lookup=businessSection?'<form id="fin-business-search" class="fin-actions"><label>Find input or part<input name="part" maxlength="100" value="'+html(term)+'"></label>'+
      '<button class="small-btn" type="submit">Find</button></form>':'';
    const bizIntro=effectiveModule==='bom'?'Recurring material uses quantity × (converted quote + landed adjustment per part). Supplier tooling is listed separately for Equipment & Investment.':
      effectiveModule==='commercial'?'Volume uses vehicle demand, configuration rate and units per vehicle. Annual reductions apply to the previous effective selling price.':
      'Scrap and warranty use percentage rates. Packaging and freight, launch and division allocation have separate inputs.';
    const details=(module&&!businessSection&&!operations&&!development&&!capital&&!budgetExecution?'<p class="fin-muted">Full '+html(module[1])+' workflow is scheduled for '+module[2]+'.</p>':'')+
      (sourceKey&&!picked&&!creating&&!operation&&!routeSource&&!developmentSource&&!capitalSource&&!(budgetExecution&&isBudgetDetail(budgetExecution,sourceKey))?
        empty('Source unavailable','This input is not available for the selected version and period.'):'')+
      (budgetExecution?budgetPage(budgetExecution,sourceKey,budgetLink,link(),periods,products,product,workspace.budgetRights,isDraft,workspace.budgetActors,glossary)+
        (workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):'')+
      (capital?(section==='investment'?investmentPage(capital,sourceKey,capitalLink,periods,products,workspace.capitalRights,isDraft,glossary):
        returnsPage(capital,sourceKey,capitalLink,periods,products,period,fullReturns,workspace.capitalRights,isDraft,glossary))+
        (workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):'')+
      (development?developmentPage(development,developmentModule,sourceKey,developmentLink,periods,products,workspace.developmentRights,isDraft,glossary)+
        (workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):operations?operationsPage(operations,sourceKey,operationsLink,labelPeriod(workspace.operationPeriod??''),workspace.canOperate,workspace.canCalibrate,
        active?.details.status==='draft',glossary)+(workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):'')+
      (businessSection?sectionPanel(html(module?.[1]??'Business inputs'),
        '<p class="fin-muted">'+html(bizIntro)+' · '+html(labelPeriod(workspace.businessPeriod??''))+'</p><p id="fin-business-status" role="status"></p>'+
        lookup+(matching.length?table(['Input','Product / market','Effective period','Value','Source'],driverRows):'<p class="fin-muted">No matching inputs in this scope.</p>')+
        (pageCount>1?'<div class="fin-actions fin-pagination">'+(page>1?controlLink(page-1,'Previous'):'')+'<span>Page '+page+' / '+pageCount+'</span>'+
          (page<pageCount?controlLink(page+1,'Next'):'')+'</div>':''),anchors):
        drivers.length?sectionPanel('Connected Calculation Inputs',table(['Input','Product / line','Source period','Source'],driverRows)):
        module&&!development&&!capital&&section!=='budget'&&section!=='returns'?empty('Business entry pending','Connected values are available in the finance dashboard where the selected version provides them.'):'');
    const origin=historyPosition()?.parent,originPath=origin?.split('?')[0];
    const safeOrigin=originPath===base||originPath?.startsWith(base+'/');
    const comparisonOrigin=!isComparison&&params.get('compareReturn')==='1';
    const backHref=safeOrigin?origin!:comparisonOrigin?comparisonReturn(base,params):sourceKey?link(section):link();
    const backLabel=safeOrigin?titleFor(originPath!.slice(base.length+1).split('/')[0]):comparisonOrigin?'Version Comparison':sourceKey?titleFor(section):'Finance Dashboard';
    root.innerHTML='<div class="fin-heading"><div><p class="fin-muted">'+html(workspace.title)+'</p><h1>'+html(section?titleFor(section):'Project Finance Dashboard')+'</h1></div>'+
      '<div class="fin-actions">'+financeUrl('/finance?choose=1','Switch Project','fin-switch')+'<a class="small-btn" href="/#projects">Project Overview</a>'+
      '<a class="small-btn" href="/projects/'+encodeURIComponent(projectId)+'/timing">Timing ↗</a></div></div>'+context+
      '<nav class="fin-tabs" aria-label="Finance reports">'+reports.map(([key,title])=>'<a data-finance-nav href="'+html(link(key))+'" '+(section===key?'aria-current="page"':'')+'>'+html(title)+'</a>').join('')+'</nav>'+
      (section?'<a class="fin-link fin-back" data-finance-nav data-finance-back href="'+html(backHref)+'">← Back to '+html(backLabel==='Dashboard'?'Finance Dashboard':backLabel)+'</a>':'')+
      (isComparison?comparisonFilters(workspace,params):filters)+(workspace.selectionAdjusted?'<p role="status">An unavailable version selection was reset.</p>':'')+
      (isComparison?comparisonPage(compareReport,base,params,glossary):unavailable+comparisonSource(workspace,params.has('traceKey'))+(active?'<p class="fin-scope">'+html(product?labelProduct(product):'All products')+' · '+html(period?labelPeriod(period):'All periods')+
        ' · Revenue and historical MPBITRI follow the period filter. Returns and standard operating metrics cover the full horizon. Budget covers the project.</p>'+
        (!section?cards()+'<div class="fin-analysis">'+chart()+comparison()+'</div>'+budget()+catalog():
          (section==='returns'?details+(fullReturns&&capital?'':chart()+cashRows()):section==='budget'?budget():details)+
          (section==='budget'?details:'')+
          (picked||creating||operation?'<div id="fin-impact-mount"></div>':'')):''));
    const search=root.querySelector<HTMLFormElement>('#fin-business-search');
    if(search)search.onsubmit=event=>{
      event.preventDefault();
      const next=new URLSearchParams(params),input=String(new FormData(search).get('part')??'').trim();
      if(input)next.set('part',input);else next.delete('part');next.delete('rows');
      navigate(base+'/'+section+(next.size?'?'+next:''),'fin-business-search');
    };
    const clone=root.querySelector<HTMLButtonElement>('#fin-copy-draft');
    if(clone&&active)clone.onclick=async()=>{
      if(!leave())return;
      clone.disabled=true;
      const status=root.querySelector<HTMLElement>('#fin-business-status')!;
      status.textContent='Creating draft…';
      try {
        const result=await api('projects/'+encodeURIComponent(projectId)+'/finance/versions',{requestKey:crypto.randomUUID(),reason:'Create business editing draft',
          parentId:active.details.id,parentRevision:active.details.revision,name:'Business Review Draft'});
        const next=new URLSearchParams(params);next.set('version',result.id);
        impact?.dispose();impact=undefined;
        navigate(base+'/'+section+(sourceKey?'/'+sourceKey:'')+'?'+next);
      } catch(error) {status.textContent=(error as Error).message;clone.disabled=false;}
    };
    for(const filter of root.querySelectorAll<HTMLSelectElement>('[data-filter-key]'))filter.onchange=()=>{
      const next=new URLSearchParams(params);if(filter.value)next.set(filter.dataset.filterKey!,filter.value);else next.delete(filter.dataset.filterKey!);
      next.delete('rows');
      if(!leave()){filter.value=params.get(filter.dataset.filterKey!)??'';return;}
      savePosition(filter.id);
      const pathname=sourceKey&&(businessSection||operations||development||capital||budgetExecution)?base+'/'+section:location.pathname;
      history.pushState({[stateKey]:{index:++position,parent:historyPosition()?.parent}},'',pathname+(next.size?'?'+next:''));
      void load(false);
    };
    const chartNode=root.querySelector<HTMLElement>('.fin-chart');
    if(isComparison)cleanChart=mountComparisonChart(root,compareReport);
    else if(chartNode)cleanChart=cashChart(chartNode,series,chartPeriods.map(p=>p.label),active!.currency);
    if((picked||creating||operation)&&active)impact=mountImpactPanel({root:root.querySelector('#fin-impact-mount')!,projectId,version:active,driver:picked,operation,
      entry:creating&&businessType?{module:businessType,fields:workspace.businessFields,products,markets,product,market,archived:workspace.archived}:undefined,
      dictionary:glossary,period,currencies:workspace.currencies,api,labelPeriod,labelProduct,
      onSaved:(fieldKey)=>{
        savePosition();
        if(budgetForm){
          const target=sourceKey==='policy'?'':sourceKey.startsWith('forecast-')?sourceKey.slice('forecast-'.length):fieldKey;
          updateHistory({...historyPosition(),index:position},budgetLink(target));
        }
        else if(capitalForm)updateHistory({...historyPosition(),index:position},capitalLink(section,fieldKey));
        else if(developmentForm)updateHistory({...historyPosition(),index:position},sourceKey==='combine'?link(section):developmentLink(developmentModule,fieldKey?.replace(/:actual$/,'')));
        else if(creating||sourceKey==='rate'&&operation)updateHistory({...historyPosition(),index:position},link(section));
        else if(operationScope&&fieldKey&&(sourceKey==='new-design'||sourceKey.startsWith('batch-')))
          updateHistory({...historyPosition(),index:position},operationsLink(operationScope,fieldKey));
        void load(true);
      }});
  }
  void load(true);
  return ()=>{
    stopped=true;sequence++;cleanChart();impact?.dispose();closeHelp();history.scrollRestoration=oldScrollRestoration;
    window.removeEventListener('popstate',pop);window.removeEventListener('beforeunload',unloading);window.removeEventListener('scroll',closeOnScroll);
    root.removeEventListener('click',click);root.removeEventListener('focusin',suppressFocus);root.removeEventListener('pointerover',onHover);document.removeEventListener('keydown',onKey);
  };
}
