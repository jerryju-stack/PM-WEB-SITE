import {amountCell,budgetKeys,cashChart,definition,escapeHtml,evidenceRows,financeUrl,groups,help,metricLabel,moduleGroups,modules,nameOf,rowFor,scopeFor,titleFor,trace,varianceCell} from '/finance-view.js';
import type {Dictionary,FinanceLink,FinanceReport,Workspace} from '/finance-view.js';
import {inputDecimal,mountImpactPanel} from '/finance-impact.js';
import type {FinanceApi} from '/finance-impact.js';
import type {CalculationOutput} from '../lib/finance-calculation-types.ts';
import type {ScreenMetric} from '../lib/finance-workspace.ts';
import type {financeService} from '../lib/finance.ts';
import {operationsEditor,operationsPage} from '/finance-operations.js';
import type {OperationsView} from '/finance-operations.js';
import {developmentEditor,developmentPage,engineeringPage,prototypePage,validationPage} from '/finance-development.js';
import type {PrototypeView,ValidationView} from '/finance-development.js';
import type {EngineeringView} from '/finance-development.js';
import type {DevelopmentModule} from '../lib/finance-development.ts';
import {capitalEditor,investmentPage} from '/finance-capital.js';
import {returnsPage} from '/finance-returns.js';
import type {ReturnView} from '/finance-returns.js';
import {commercialOverview,factoryOverview,purchasingOverview} from '/finance-business-view.js';
import type {CommercialView,PurchasingView} from '/finance-business-view.js';
import type {FactoryView} from '/finance-business-view.js';
import {budgetEditor,budgetPage,budgetSummary,budgetVersions,budgetViews,isBudgetDetail} from '/finance-budget.js';
import type {BudgetView} from '/finance-budget.js';
import {comparisonFilters,comparisonPage,comparisonReturn,comparisonSource,mountComparisonChart} from '/finance-compare.js';
import {displayCurrencySelect,downloadFinanceJson,mountVersionFx,versionFxPanel} from '/finance-fx.js';

const html=escapeHtml;
const equipmentParameters=['view','assetSearch','assetCategory','assetStatus','assetSupplier','cashDetail'];
const sectionPanel=(title:string,body:string,extra='')=>'<section class="fin-panel"><div class="fin-panel-head"><h2>'+title+'</h2>'+extra+'</div>'+body+'</section>';
const empty=(title:string,description:string)=>sectionPanel(html(title),'<p class="fin-muted">'+html(description)+'</p>');
const options=(items:{key:string;label:string}[],selected:string,placeholder:string)=>
  [{key:'',label:placeholder},...items].map(({key,label})=>'<option value="'+html(key)+'" '+(key===selected?'selected':'')+'>'+html(label)+'</option>').join('');
const table=(headers:string[],body:string)=>'<div class="fin-table-scroll"><table><thead><tr>'+headers.map(header=>'<th scope="col">'+header+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
const route=()=>/^\/projects\/([a-zA-Z0-9_-]+)\/finance(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(location.pathname);
const stateKey='projectFinance';
type Position={index:number;parent?:string;focus?:string;scroll?:number;annualScroll?:number};
type HelpMode='hover'|'focus'|'pinned';
const historyPosition=():Position|undefined=>history.state?.[stateKey];
const updateHistory=(position:Position,url=location.href)=>history.replaceState({...history.state,[stateKey]:position},'',url);
const supportedModule:Record<string,string>={operations:'operations',bom:'bom',commercial:'commercial','factory-costs':'factory',returns:'returns'};
function screenRequest(match:RegExpExecArray,params:URLSearchParams) {
  const section=match[2]??'';
  const keys=['baseline','version','displayCurrency','traceKind','traceKey','tracePeriod','traceRevision'];
  if(section==='compare')keys.push('from','to','cutoff','compareProduct','fxMode');
  if(['commercial','bom','operations','factory-costs','engineering','prototypes','validation','investment','returns','budget'].includes(section))keys.push('period');
  if(section==='returns')keys.push('returnDetail');
  if(['operations','factory-costs','engineering','prototypes','validation','investment','returns','budget'].includes(section))keys.push('product');
  const request=new URLSearchParams({shape:'screen'});
  for(const key of keys)if(params.has(key))request.set(key,params.get(key)!);
  if(section==='factory-costs'&&(params.get('factoryView')==='annual'||params.has('factoryCost'))){
    request.set('factoryHorizon','1');
  }
  if(section)request.set('module',section);
  if(match[3])request.set('source',match[3]);
  return 'projects/'+encodeURIComponent(match[1])+'/finance/workspace?'+request;
}

export function mountFinanceWorkspace({root,api,user,login}:{root:HTMLElement;api:FinanceApi;user:unknown;login:()=>void}) {
  let sequence=0,stopped=false,position=historyPosition()?.index??0,restoring=false,approvedBack=false;
  let cleanChart:()=>void=()=>{},impact:ReturnType<typeof mountImpactPanel>|undefined;
  let fxEditor:ReturnType<typeof mountVersionFx>;
  let settingsOpen=false,returnOptionsOpen=false;
  let dictionaryPromise:Promise<Dictionary>|undefined;
  let rendered:Workspace|null=null,renderedRequest='';
  const displayedOutputs=new Map<string,CalculationOutput|ScreenMetric>();
  let activeHelp:{button:HTMLButtonElement;box:HTMLElement;mode:HelpMode}|undefined;
  const oldScrollRestoration=history.scrollRestoration;history.scrollRestoration='manual';
  if(!historyPosition())updateHistory({index:position});
  const savePosition=(focus?:string)=>updateHistory({...historyPosition(),index:position,scroll:scrollY,
    focus:focus||document.activeElement?.id,annualScroll:root.querySelector('.fin-annual-scroll')?.scrollLeft});
  const leave=()=>!impact?.saving()&&!fxEditor?.saving()&&(!(impact?.dirty()||fxEditor?.dirty())||confirm('Discard the unsaved finance change?'));
  function resetView() {cleanChart();impact?.dispose();impact=undefined;fxEditor=undefined;rendered=null;displayedOutputs.clear();closeHelp();root.innerHTML='';}
  function navigate(href:string,focus?:string) {
    if(!leave())return;
    savePosition(focus);
    const parent=location.pathname+location.search;
    history.pushState({[stateKey]:{index:++position,parent}},'',href);
    void load(false,true);
  }
  function pop() {
    if(restoring){restoring=false;return;}
    const approved=approvedBack;approvedBack=false;
    const target=historyPosition()?.index;
    if(!approved&&!leave()&&target!==undefined&&target!==position){restoring=true;history.go(position-target);return;}
    position=target??0;void load(true,true);
  }
  function unloading(event:BeforeUnloadEvent) {
    if(impact?.dirty()||impact?.saving()||fxEditor?.dirty()||fxEditor?.saving()){event.preventDefault();event.returnValue='';}
  }
  function closeHelp() {
    if(!activeHelp)return;
    const {button,box,mode}=activeHelp;
    if(mode==='pinned') {
      button.setAttribute('aria-expanded','false');
      button.removeAttribute('aria-controls');
    } else button.removeAttribute('aria-describedby');
    box.remove();
    activeHelp=undefined;
  }
  function positionHelp() {
    if(!activeHelp)return;
    const {button,box}=activeHelp;
    const rect=button.getBoundingClientRect();
    const left=Math.max(12,Math.min(rect.left,innerWidth-box.offsetWidth-12));
    const below=rect.bottom+8;
    const above=rect.top-box.offsetHeight-8;
    const top=below+box.offsetHeight>innerHeight-12&&above>=12?above:below;
    box.style.left=left+'px';
    box.style.top=Math.max(12,Math.min(top,innerHeight-box.offsetHeight-12))+'px';
  }
  let glossary:Dictionary={metrics:{}};
  function openHelp(button:HTMLButtonElement,mode:HelpMode) {
    if(activeHelp?.button===button&&activeHelp.mode===mode)return;
    if(activeHelp?.mode==='pinned'&&mode!=='pinned')return;
    const item=definition(glossary,button.dataset.definition!);
    if(!item)return;
    closeHelp();
    const box=document.createElement('div');
    const pinned=mode==='pinned';
    box.id='fin-definition';
    box.className='fin-definition';
    box.setAttribute('role',pinned?'region':'tooltip');
    box.innerHTML='<strong>'+html(item.en)+'</strong><p lang="zh-CN">'+html(item.zh)+' · '+html(item.definition)+'</p>'+
      (item.formula?'<p lang="zh-CN">'+html(item.formula)+'</p>':'')+
      (pinned?'<button type="button" class="small-btn" data-close-help>Close</button>':'');
    (button.closest('dialog')??root).append(box);
    activeHelp={button,box,mode};
    positionHelp();
    if(pinned) {
      box.setAttribute('aria-label',item.en);
      button.setAttribute('aria-expanded','true');
      button.setAttribute('aria-controls',box.id);
      box.querySelector('button')?.focus({preventScroll:true});
    } else button.setAttribute('aria-describedby',box.id);
  }
  async function showSources(button:HTMLElement) {
    const report=button.dataset.side==='baseline'?rendered?.baseline:rendered?.current;
    const output=displayedOutputs.get(button.dataset.side+':'+button.dataset.source);
    if(!report||!output||!rendered)return;
    const path='projects/'+encodeURIComponent(rendered.projectId)+'/finance/versions/'+encodeURIComponent(report.details.id)+'/sources?'+
      new URLSearchParams({revision:String(report.details.revision),output:output.id});
    const dialog=document.createElement('dialog');dialog.className='fin-source-dialog';
    dialog.setAttribute('aria-label','Calculation sources');
    const displayFx=output.details.displayFx as {from:string;to:string;rate:string}|undefined;
    dialog.innerHTML='<form method="dialog"><button class="small-btn">Close</button></form><h2>'+metricLabel(glossary,output.metricKey)+' · Sources</h2><div role="status">Loading sources…</div>';
    root.append(dialog);dialog.addEventListener('close',()=>{if(activeHelp&&dialog.contains(activeHelp.button))closeHelp();dialog.remove();button.focus({preventScroll:true});});dialog.showModal();
    const body=dialog.querySelector<HTMLElement>('[role=status]')!;
    try {
      const evidence:ReturnType<ReturnType<typeof financeService>['outputSources']>=await api(path);
      if(!dialog.open||!dialog.isConnected)return;
      body.innerHTML='<p>'+html(report.details.name)+' · '+html(evidence.basis)+' · '+html(evidence.calculationVersion)+'</p><p>'+html(evidence.formula)+'</p>'+
        (displayFx?'<p>Display conversion · 1 '+html(displayFx.from)+' = '+html(displayFx.rate)+' '+html(displayFx.to)+'</p>':'')+
        '<ul>'+evidenceRows(evidence.inputs,key=>report.periods.find(item=>item.key===key)?.label??key)+'</ul>';
    }catch(error){body.textContent=(error as Error).message;}
  }
  const onFocus=(event:FocusEvent)=>{
    if(event.target instanceof HTMLButtonElement&&event.target.matches('[data-definition]:focus-visible'))openHelp(event.target,'focus');
  };
  const onBlur=(event:FocusEvent)=>{if(activeHelp?.mode==='focus'&&event.target===activeHelp.button)closeHelp();};
  const onHover=(event:PointerEvent)=>{
    if(event.pointerType==='mouse'&&event.target instanceof HTMLButtonElement&&event.target.matches('[data-definition]'))openHelp(event.target,'hover');
  };
  const onLeave=(event:PointerEvent)=>{
    if(event.pointerType==='mouse'&&activeHelp?.mode==='hover'&&event.target===activeHelp.button)closeHelp();
  };
  const onKey=(event:KeyboardEvent)=>{
    if(event.key!=='Escape'||!activeHelp||event.defaultPrevented)return;
    const modal=document.activeElement?.closest('dialog:modal');
    if(modal&&!modal.contains(activeHelp.box))return;
    event.preventDefault();
    if(activeHelp.box.contains(document.activeElement))activeHelp.button.focus({preventScroll:true});
    closeHelp();
  };
  const click=(event:MouseEvent)=>{
    const target=event.target as Element;
    if(target.closest('[data-finance-login]')){login();return;}
    if(target.closest('[data-close-help]')){activeHelp?.button.focus({preventScroll:true});closeHelp();return;}
    const help=target.closest<HTMLButtonElement>('[data-definition]');if(help){openHelp(help,'pinned');return;}
    const source=target.closest<HTMLElement>('[data-source]');if(source){showSources(source);return;}
    const link=target.closest<HTMLAnchorElement>('[data-finance-nav]');
    if(!link||event.defaultPrevented||event.button||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    event.preventDefault();
    if(link.hasAttribute('data-finance-back')&&historyPosition()?.parent===link.pathname+link.search) {
      if(leave()){savePosition();approvedBack=true;history.back();}
    } else navigate(link.href,link.id);
  };
  window.addEventListener('popstate',pop);window.addEventListener('beforeunload',unloading);
  window.addEventListener('scroll',positionHelp,true);window.addEventListener('resize',positionHelp);
  root.addEventListener('click',click);
  root.addEventListener('focusin',onFocus);root.addEventListener('focusout',onBlur);
  root.addEventListener('pointerenter',onHover,true);root.addEventListener('pointerleave',onLeave,true);
  document.addEventListener('keydown',onKey);

  async function load(restore:boolean,reuseScreen=false) {
    const token=++sequence,params=new URLSearchParams(location.search),match=route();
    document.body.classList.toggle('finance-project-workspace',Boolean(match));
    const request=match?screenRequest(match,params):'';
    const available=reuseScreen&&request===renderedRequest?rendered:null;
    resetView();
    if(!user){root.innerHTML='<h1>Project Finance</h1>'+empty('Sign in to view project finance','Use your Project Station account to open the projects you can access.')+'<button type="button" class="primary" data-finance-login>Sign in</button>';return;}
    if(!available)root.innerHTML='<p role="status">Loading project finance…</p>';
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
        const [workspace,dictionary]=await Promise.all([available??api(request),dictionaryPromise]);
        if(stopped||token!==sequence)return;
        glossary=dictionary;rendered=workspace;renderProject(workspace,match,params);
        renderedRequest=screenRequest(match,params);
      }
      if(restore){const target=historyPosition();requestAnimationFrame(()=>{if(!stopped&&token===sequence){const focus=document.getElementById(target?.focus??'');
        for(let parent=focus?.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
        const annual=root.querySelector('.fin-annual-scroll');
        if(annual)annual.scrollLeft=target?.annualScroll??0;
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
    const market=['operations','factory-costs','engineering','prototypes','validation','investment','returns','budget'].includes(section)?'':markets.find(item=>item.key===params.get('market'))?.key??'';
    const effectiveModule=supportedModule[section],businessSection=['commercial','bom','factory'].includes(effectiveModule);
    const isOperations=section==='operations',requestedOpsView=params.get('opsView');
    const opsView:OperationsView=requestedOpsView==='annual'||requestedOpsView==='routes'?requestedOpsView:'stations';
    const isFactory=section==='factory-costs';
    const isEngineering=section==='engineering',requestedEngineeringView=params.get('engineeringView');
    const engineeringView:EngineeringView=requestedEngineeringView==='records'||requestedEngineeringView==='validation-hours'?
      requestedEngineeringView:'packages';
    const engineeringPackage=params.get('engineeringPackage')??'';
    const validationSpec=params.get('validationSpec')??'';
    const isPrototype=section==='prototypes',requestedPrototypeView=params.get('prototypeView');
    const prototypeView:PrototypeView=requestedPrototypeView==='delivery'||requestedPrototypeView==='records'?requestedPrototypeView:'quotes';
    const prototypeGroup=params.get('prototypeGroup')??'';
    const isValidation=section==='validation',requestedValidationView=params.get('validationView');
    const validationView:ValidationView=requestedValidationView==='coverage'||requestedValidationView==='records'?requestedValidationView:'packages';
    const validationGroup=params.get('validationGroup')??'',requestedValidationPhase=params.get('validationPhase');
    const validationPhase=requestedValidationPhase==='europe-dv'||requestedValidationPhase==='china-dv'||requestedValidationPhase==='china-pv'||
      requestedValidationPhase==='other'?requestedValidationPhase:null;
    const requestedFactoryView=params.get('factoryView');
    const factoryView:FactoryView=requestedFactoryView==='annual'||requestedFactoryView==='inputs'||requestedFactoryView==='breakdown'?
      requestedFactoryView:params.has('part')||sourceKey?'inputs':'breakdown';
    const factoryField=workspace.factoryCosts.find(row=>row.field===params.get('factoryCost'))?.field??'';
    const businessType=businessSection?effectiveModule as 'commercial'|'bom'|'factory':null;
    for(const [key,value] of [['baseline',baseline?.details.id],['version',current?.details.id],['period',period],['product',product],['market',market]] as const) {
      if(value)params.set(key,value);else params.delete(key);
    }
    const base='/projects/'+encodeURIComponent(projectId)+'/finance',isComparison=section==='compare';
    const compareReport=workspace.comparisonReport,fxComparison=workspace.fxComparison;
    if(isComparison&&compareReport){
      params.set('from',compareReport.before.id);params.set('to',compareReport.after.id);
      if(compareReport.cutoff)params.set('cutoff',compareReport.cutoff);else params.delete('cutoff');
      if(compareReport.product)params.set('compareProduct',compareReport.product);else params.delete('compareProduct');
    }
    const link:FinanceLink=(route='')=>{
      const target=new URLSearchParams(params);
      if(route.split('/')[0]!=='commercial')target.delete('salesView');
      if(route.split('/')[0]!=='bom')target.delete('bomView');
      if(route.split('/')[0]!=='operations')target.delete('opsView');
      if(route.split('/')[0]!=='investment')for(const name of equipmentParameters)target.delete(name);
      if(route.split('/')[0]!=='factory-costs')for(const name of ['factoryCost','factoryView'])target.delete(name);
      if(route.split('/')[0]!=='engineering')for(const name of ['engineeringView','engineeringPackage','validationSpec'])target.delete(name);
      if(route.split('/')[0]!=='prototypes')for(const name of ['prototypeView','prototypeGroup'])target.delete(name);
      if(route.split('/')[0]!=='validation')for(const name of ['validationView','validationGroup','validationPhase'])target.delete(name);
      if(route.split('/')[0]!=='returns')for(const name of ['returnDetail','basis'])target.delete(name);
      if(route.split('/')[0]!=='budget')target.delete('budgetView');
      if(route==='compare'&&!target.has('compareReturn')&&!target.has('from')&&!target.has('to')){
        if(period)target.set('cutoff',period);
        if(product)target.set('compareProduct',product);
      }
      return base+(route?'/'+route:'')+(target.size?'?'+target:'');
    };
    const operations=section==='operations'?workspace.operations:null;
    const development=workspace.development;
    const capital=workspace.capital,isReturns=section==='returns',requestedReturnView=params.get('returnDetail');
    const returnView:ReturnView=params.get('basis')==='full'&&!capital?.cashOnly?'full':
      requestedReturnView==='working-capital'||requestedReturnView==='irr'||requestedReturnView==='funding'||requestedReturnView==='period'||
      requestedReturnView==='sources'?requestedReturnView:'cash';
    const isInvestment=section==='investment',requestedInvestmentView=params.get('view');
    const investmentView=requestedInvestmentView==='items'||requestedInvestmentView==='cash'||requestedInvestmentView==='records'?
      requestedInvestmentView:'allocation';
    const equipmentView=isInvestment&&investmentView==='items';
    const investmentCashDetail=isInvestment&&investmentView==='cash'&&params.has('cashDetail')&&!!product;
    const isBudget=section==='budget',budgetExecution=workspace.budget;
    const requestedBudgetView=params.get('budgetView')??'';
    const budgetView:BudgetView=Object.hasOwn(budgetViews,requestedBudgetView)?requestedBudgetView as BudgetView:'allocations';
    const capitalLink=(module:string,key='',changes:Record<string,string|null>={})=>{
      const next=new URLSearchParams(params);
      if(module!=='commercial')next.delete('salesView');
      if(module!=='bom')next.delete('bomView');
      if(module!=='operations')next.delete('opsView');
      if(module!=='investment')for(const name of equipmentParameters)next.delete(name);
      if(module!=='factory-costs')for(const name of ['factoryCost','factoryView'])next.delete(name);
      if(module!=='engineering')for(const name of ['engineeringView','engineeringPackage','validationSpec'])next.delete(name);
      if(module!=='prototypes')for(const name of ['prototypeView','prototypeGroup'])next.delete(name);
      if(module!=='validation')for(const name of ['validationView','validationGroup','validationPhase'])next.delete(name);
      if(module!=='returns')for(const name of ['returnDetail','basis'])next.delete(name);
      if(module!=='budget')next.delete('budgetView');
      for(const [name,value] of Object.entries(changes))if(value)next.set(name,value);else next.delete(name);
      return base+'/'+module+(key?'/'+key:'')+(next.size?'?'+next:'');
    };
    const budgetViewLink=(view:BudgetView,id?:string)=>capitalLink('budget','',{
      budgetView:view==='allocations'?null:view,...(id?{version:id}:{})
    });
    const budgetLink=(key='',periodKey=period,productKey=product)=>capitalLink('budget',key,{
      budgetView:budgetView==='allocations'?null:budgetView,period:periodKey,product:productKey
    });
    const developmentModule=section as DevelopmentModule;
    const developmentLink=(module:DevelopmentModule,key?:string,changes?:Record<string,string|null>)=>
      isEngineering||isPrototype||isValidation||changes?capitalLink(module,key,changes):link(module+(key?'/'+key:''));
    const operationScope=operations?.find(scope=>scope.productKey===product||scope.records.some(record=>record.key===sourceKey))??
      (operations?.length===1?operations[0]:null);
    const operationsLink=(scope:{productKey:string;period:string},source='',view:OperationsView='routes')=>
      capitalLink('operations',source,{product:scope.productKey,period:scope.period,opsView:view,market:null});
    const isDraft=active?.details.status==='draft';
    const developmentForm=development?developmentEditor(development,developmentModule,sourceKey,periods,products,period,product,workspace.developmentRights,isDraft):undefined;
    const capitalForm=capital?capitalEditor(capital,section,sourceKey,periods,products,period,product,workspace.capitalRights,isDraft):undefined;
    const budgetForm=budgetExecution?budgetEditor(budgetExecution,sourceKey,periods,products,period,product,workspace.currencies,
      active!.currency,workspace.budgetRights,isDraft):undefined;
    const operation=budgetForm??capitalForm??developmentForm??(operationScope?operationsEditor(operationScope,sourceKey,workspace.canOperate,workspace.canCalibrate,isDraft):undefined);
    const routeSource=operationScope?.records.some(row=>row.key===sourceKey);
    const manufacturing=operations?operationsPage(operations,operationsLink,{
      source:sourceKey,view:opsView,periodLabel:periods.find(item=>item.key===workspace.operationPeriod)?.label??'',
      periods,canOperate:workspace.canOperate,canCalibrate:workspace.canCalibrate,draft:isDraft,dictionary:glossary,
      linkedAssets:(scope,line)=>workspace.operationAssets.filter(row=>row.line===line&&row.products.includes(scope.productKey)).map(asset=>({
        title:asset.title,href:capitalLink('investment',asset.key,{view:'items',product:scope.productKey,period:null})
      }))
    }):null;
    const developmentSource=development?.rows.some(row=>row.key===sourceKey||
      (isEngineering||isPrototype||isValidation)&&['edit-'+row.key,'actual-'+row.key].includes(sourceKey));
    const engineering=isEngineering&&development?engineeringPage(development,{
      source:sourceKey,view:engineeringView,workPackage:engineeringPackage,specification:validationSpec,period,product
    },developmentLink,periods,products,workspace.developmentRights,isDraft,glossary):null;
    const prototype=isPrototype&&development?prototypePage(development,{
      source:sourceKey,view:prototypeView,group:prototypeGroup,period,product
    },developmentLink,periods,products,workspace.developmentRights,isDraft,glossary):null;
    const validation=isValidation&&development?validationPage(development,{
      source:sourceKey,view:validationView,group:validationGroup,phase:validationPhase,period,product
    },developmentLink,periods,products,workspace.developmentRights,isDraft,glossary):null;
    const capitalSource=capital?.rows.some(row=>row.key===sourceKey||isReturns&&'edit-'+row.key===sourceKey)||capital?.archiveRows.some(row=>row.key===sourceKey)||
      capital?.toolingQuotes.some(row=>row.key===sourceKey)||isInvestment&&capital?.assets.some(row=>'edit-'+row.key===sourceKey);
    const investment=isInvestment&&capital?investmentPage(capital,sourceKey,capitalLink,periods,products,workspace.capitalRights,isDraft,glossary,params):null;
    updateHistory({...historyPosition(),index:position},link([section,sourceKey].filter(Boolean).join('/')));
    const labelPeriod=(key:string)=>periods.find(item=>item.key===key)?.label??key;
    const labelProduct=(key:string)=>products.find(item=>item.key===key)?.label??key;
    const labelMarket=(key:string|null)=>key?workspace.markets.find(item=>item.key===key)?.label??key:'All markets';
    const thousandsCurrency=section?undefined:active?.currency;
    const side=(value:CalculationOutput|ScreenMetric|undefined,version:'baseline'|'current',stackUnit=false)=>{
      if(value)displayedOutputs.set(version+':'+value.id,value);
      return amountCell(value,false,version==='baseline'?'No baseline':'No forecast',stackUnit,thousandsCurrency)+trace(value,version);
    };
    const scopedDifference=product?workspace.comparison?.products[product]:workspace.comparison;
    const rowIndex=periods.findIndex(item=>item.key===period);
    const reportMetric=(data:FinanceReport|null,key:string)=>{
      const scoped=scopeFor(data,product),row=rowFor(data,product,period);
      if(period&&key==='revenue')return row?.reported_revenue;
      if(period&&['cqa.mpbitri','full_cost_management_profit'].includes(key))return row?.reported_profit;
      return scoped?.metrics[key];
    };
    const metricDelta=(key:string)=>period&&['revenue','cqa.mpbitri'].includes(key)?
      scopedDifference?.periodic[rowIndex]?.[key==='revenue'?'reported_revenue':'reported_profit']:scopedDifference?.metrics[key];
    const dashboardVersion=current?'current':'baseline';
    const returns=isReturns&&capital&&active?returnsPage(capital,{view:returnView,source:sourceKey,period,version:active.details.name},
      capitalLink,periods,products,workspace.capitalRights.returns&&isDraft,glossary,metric=>{
        if(metric)displayedOutputs.set(dashboardVersion+':'+metric.id,metric);
        return trace(metric??undefined,dashboardVersion);
      },workspace.returnChecks,workspace.returnControls):null;
    const cashOnly=active?.model==='cash_series';
    const isCommercial=section==='commercial';
    const isPurchasing=section==='bom';
    const requestedBomView=params.get('bomView');
    const bomView:PurchasingView=requestedBomView==='markets'||requestedBomView==='annual'||requestedBomView==='inputs'||requestedBomView==='parts'?
      requestedBomView:sourceKey==='new'?'inputs':market||sourceKey||params.has('part')?'parts':'markets';
    const requestedView=params.get('salesView');
    const salesView:CommercialView=requestedView==='inputs'||requestedView==='markets'||requestedView==='quotes'||requestedView==='products'?
      requestedView:params.has('part')||params.has('rows')?'inputs':period?'quotes':'products';
    const salesNavigation=isCommercial&&!sourceKey&&active?'<nav class="fin-tabs fin-sales-nav" aria-label="Commercial views">'+
      ([['products','By product'],['markets','By market / variant'],['quotes','Market quotes & price preview'],['inputs','Source inputs']] as const).map(([view,label])=>{
        const href=capitalLink('commercial','',{salesView:view,part:null,rows:null,...(view==='products'?{market:null}:{})});
        return '<a data-finance-nav id="fin-sales-'+view+'" href="'+html(href)+'"'+(salesView===view?' aria-current="page"':'')+'>'+html(label)+'</a>';
      }).join('')+'</nav>':'';
    const bomNavigation=isPurchasing&&!sourceKey&&active?'<nav class="fin-tabs fin-sales-nav" aria-label="Purchasing views">'+
      ([['markets','Market BOMs'],['parts','Parts & suppliers'],['annual','Annual material cost'],['inputs','Source inputs']] as const).map(([view,label])=>{
        const href=capitalLink('bom','',{bomView:view,part:null,rows:null,...(view==='markets'||view==='annual'?{market:null}:{})});
        return '<a data-finance-nav id="fin-bom-'+view+'" href="'+html(href)+'"'+(bomView===view?' aria-current="page"':'')+'>'+html(label)+'</a>';
      }).join('')+'</nav>':'';
    const managementKey=['cqa.mpbitri','full_cost_management_profit','operating_profit']
      .find(key=>scopeFor(active,product)?.metrics[key])??'operating_profit';
    const profitTitle=managementKey==='operating_profit'?'Operating profit':'Full-cost management profit';
    const dashboardScope=period?labelPeriod(period):'Full horizon';
    const cards=()=>{
      const metrics=[
        ...(!cashOnly?[
          {key:'revenue',title:'Revenue',route:'commercial',scope:dashboardScope},
          {key:managementKey,title:profitTitle,route:'operations',scope:managementKey==='operating_profit'?'Full horizon':dashboardScope}
        ]:[]),
        {key:'npv',title:'Net present value',route:'returns',scope:'Full horizon'},
        {key:'peak_funding_requirement',title:'Peak funding requirement',route:'returns',scope:'Full horizon'}
      ];
      return '<div class="fin-metrics fin-overview-metrics" aria-label="Key financial metrics">'+metrics.map(({key,title,route,scope})=>
        '<section class="fin-metric"><div class="fin-metric-label">'+financeUrl(link(route),title,'metric-'+(key===managementKey?'operating_profit':key))+help(glossary,key)+
        '</div><div class="fin-summary-value">'+side(reportMetric(active,key),dashboardVersion,true)+'</div><small class="fin-state">'+html(scope)+'</small></section>'
      ).join('')+'</div>';
    };
    const comparison=()=>{
      if(!baseline||!current)return empty('Version Comparison','Select a baseline and a forecast to see changes.');
      if(!workspace.comparison?.compatible)return empty('Version Comparison','The selected versions have incompatible calculation scopes.');
      const keys=['revenue','total_cost','operating_profit','operating_margin','cqa.mpbitri','npv','irr','payback_period','peak_funding_requirement'];
      return sectionPanel('Version Comparison',table(['Metric','Baseline','Forecast','Change'],keys.filter(key=>reportMetric(baseline,key)||reportMetric(current,key)).map(key=>
        '<tr><th scope="row">'+metricLabel(glossary,key)+'</th><td>'+amountCell(reportMetric(baseline,key),false,undefined,false,baseline.currency)+
        '</td><td>'+amountCell(reportMetric(current,key),false,undefined,false,current.currency)+
        '</td><td>'+varianceCell(metricDelta(key),key,undefined,thousandsCurrency)+'</td></tr>').join('')),section?'':financeUrl(link('compare'),'Open comparison','dashboard-compare'));
    };
    const budget=()=>{
      const keys=[...budgetKeys,...['draft_cost','recorded_payments','unpaid_confirmed'].filter(key=>baseline?.budget[key]||current?.budget[key])];
      return sectionPanel('Budget Execution <small>· Project total</small>',table(['Metric','Baseline','Forecast','Change'],keys.map(key=>
        '<tr><th scope="row">'+metricLabel(glossary,key)+'</th><td>'+side(baseline?.budget[key],'baseline')+'</td><td>'+side(current?.budget[key],'current')+
        '</td><td>'+varianceCell(workspace.comparison?.budget[key],key)+'</td></tr>').join('')),section?'':financeUrl(link('budget'),'Open budget'));
    };
    const chartPeriods=section?periods.slice(0,period?rowIndex+1:undefined):periods;
    const series=(section?[
      {name:'Baseline',report:baseline,key:'cumulative_cash',bars:false},{name:'Forecast',report:current,key:'cumulative_cash',bars:false}
    ]:[
      {name:'Period cash flow',report:active,key:'cash_flow',bars:true},{name:'Cumulative cash flow',report:active,key:'cumulative_cash',bars:false}
    ]).map(({name,report,key,bars})=>({name,bars,values:chartPeriods.map(p=>{
      const value=report?.currency===active?.currency?rowFor(report,product,p.key)?.[key]?.value:null;
      return value==null?null:Number(value);
    })}));
    const focusReturns=scopeFor(active,product)?.metrics;
    const peakPeriod=focusReturns?.peak_funding_requirement?.details.firstPeriod;
    const recoveryPeriod=focusReturns?.payback_period?.details.recoveryPeriod;
    const chart=()=>sectionPanel((section?'Cumulative Cash Flow':'Cash flow and payback')+' '+help(glossary,'cumulative_cash'),series.some(s=>s.values.some(v=>v!==null))?
      '<div class="fin-chart"><div class="fin-chart-legend">'+series.map((item,index)=>item.values.some(v=>v!==null)?
        '<span class="fin-series-'+index+(item.bars?' fin-series-bars':'')+'">'+item.name+'</span>':'').join('')+
      '<span>'+html(active?.currency)+'</span></div><canvas role="img"></canvas></div>'+
      (baseline&&current&&baseline.currency!==current.currency?'<p class="fin-muted">The chart shows the selected forecast currency.</p>':'')+
      '<p class="fin-muted">'+html(current?'Forecast':'Baseline')+' · Full horizon'+
      (typeof peakPeriod==='string'?' · Peak funding: '+html(labelPeriod(peakPeriod)):'')+
      (typeof recoveryPeriod==='string'?' · First recovery: '+html(labelPeriod(recoveryPeriod)):'')+
      (!section?' · Payback: '+amountCell(focusReturns?.payback_period)+
        (focusReturns?.irr?.status==='ok'?' · IRR: '+amountCell(focusReturns.irr):''):'')+'</p>':
      '<p class="fin-muted">No cumulative cash flow is available for this scope.</p>',section?'':financeUrl(link('returns'),'Open returns'));
    const productContribution=()=>{
      const rows=products.filter(item=>!product||item.key===product);
      if(cashOnly||!rows.length)return '';
      return sectionPanel('Product contribution <small>· Full horizon</small>','<div class="fin-product-contribution">'+table(['Product','Revenue','Total cost',profitTitle,'Margin'],rows.map(item=>{
        const values=scopeFor(active,item.key)?.metrics,revenue=values?.revenue,profit=values?.[managementKey];
        const margin=revenue?.value&&profit?.value!==null&&profit?.value!==undefined&&Number(revenue.value)>0?
          new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:2}).format(Number(profit.value)/Number(revenue.value)):'—';
        return '<tr><th scope="row">'+financeUrl(capitalLink('commercial','',{product:item.key,period:null,market:null}),item.label,'dashboard-product-'+item.key)+'</th>'+
          [revenue,values?.total_cost,profit].map(value=>'<td>'+side(value,dashboardVersion)+'</td>').join('')+
          '<td>'+html(margin)+'</td></tr>';
      }).join(''))+'</div>');
    };
    const reviewItems=()=>{
      const operating=reportMetric(active,'operating_profit'),irr=focusReturns?.irr;
      const draftBudget=Number(active?.budget.draft_allocation?.value)>0?active?.budget.draft_allocation:active?.budget.draft_cost;
      return [
        ...(irr&&irr.status!=='ok'?[{text:'Review IRR',metric:irr,route:'returns',id:'metric-irr'}]:[]),
        ...(!cashOnly&&operating?.status==='pending_finance'?[{text:'Confirm operating profit definition',metric:operating,route:'operations',id:'dashboard-profit-review'}]:[]),
        ...(Number(draftBudget?.value)>0?[{text:'Review draft budget',metric:draftBudget,route:'budget',id:'dashboard-budget-review'}]:[])
      ];
    };
    const dashboard=()=>{
      const items=reviewItems();
      return (cashOnly?'<p class="fin-muted">Cash-flow reconciliation version. The forecast supplies cash and return metrics.</p>':'')+cards()+
        '<div class="fin-analysis'+(items.length?'':' fin-analysis-single')+'">'+chart()+(items.length?
          sectionPanel('Needs review','<ul class="fin-review-list">'+items.map(item=>'<li>'+
            financeUrl(item.id==='metric-irr'?capitalLink('returns','',{returnDetail:'irr'}):link(item.route),item.text,item.id)+
             ' '+amountCell(item.metric,false,undefined,false,thousandsCurrency)+'</li>').join('')+'</ul>'):'')+'</div>'+productContribution();
    };
    const sectionLink=(key:string,title:string,id:string,number?:number)=>
      '<a id="'+id+'" data-finance-nav href="'+html(key==='investment'?capitalLink(key,'',{
        view:null,assetSearch:null,assetCategory:null,assetStatus:null,assetSupplier:null,cashDetail:null,period:null,market:null
      }):key==='commercial'?
        capitalLink(key,'',{salesView:'products',period:null,market:null,part:null,rows:null}):key==='bom'?
        capitalLink(key,'',{bomView:'markets',period:null,market:null,part:null,rows:null}):key==='factory-costs'?
        capitalLink(key,'',{factoryView:'breakdown',factoryCost:null,market:null,part:null,rows:null}):key==='engineering'?
        capitalLink(key,'',{engineeringView:'packages',engineeringPackage:null,validationSpec:null,period:null,market:null}):key==='prototypes'?
        capitalLink(key,'',{prototypeView:null,prototypeGroup:null,period:null,market:null}):key==='validation'?
        capitalLink(key,'',{validationView:null,validationGroup:null,validationPhase:null,period:null,market:null}):key==='returns'?
        capitalLink(key,'',{returnDetail:null,basis:null,period:null,market:null}):key==='budget'?
        capitalLink(key,'',{budgetView:null,period:null,market:null}):link(key))+'"'+
      (section===key?' aria-current="page"':'')+'>'+
      (number?'<span class="fin-section-number" aria-hidden="true">'+String(number).padStart(2,'0')+'</span>':'')+html(title)+'</a>';
    const navigation='<nav class="fin-sections" aria-label="Finance sections">'+
      sectionLink('','Project Finance Overview','fin-dashboard')+
      moduleGroups.map((group,index)=>'<div class="fin-section-group" role="group" aria-labelledby="fin-group-'+index+'">'+
        '<div class="fin-group-title" id="fin-group-'+index+'">'+html(group.title)+'</div>'+
        group.modules.map(module=>sectionLink(module[0],module[3]??module[1],'module-'+module[0],modules.indexOf(module)+1)).join('')+'</div>').join('')+
      '</nav>';
    const context='<div class="fin-context"><span>Approved baseline · <strong>'+html(workspace.versions.find(v=>v.id===workspace.approvedBaselineId)?.name??'None')+
      '</strong></span><span>Current forecast · <strong>'+html(workspace.versions.find(v=>v.id===workspace.currentVersionId)?.name??'None')+
      '</strong></span><span>Viewed as of · <strong>'+html(active?.asOf??'—')+'</strong></span><span>Currency · <strong>'+html(active?.currency??'—')+'</strong></span></div>';
    const baselineSelect='<label>Baseline<select id="fin-filter-baseline" data-filter-key="baseline">'+
      options(workspace.versions.filter(v=>v.status==='frozen').map(v=>({key:v.id,label:v.name})),baseline?.details.id??'','Use approved baseline')+'</select></label>';
    const versionFilter='<label>Forecast version<select id="fin-filter-version" data-filter-key="version">'+options(workspace.versions.map(v=>({key:v.id,label:v.name+(v.status==='draft'?' · Draft':'')})),current?.details.id??'','Use current forecast')+'</select></label>';
    const periodFilter='<label>Period<select id="fin-filter-period" data-filter-key="period">'+options(periods,period,
      isOperations||isFactory?'Default period':'All periods')+'</select></label>';
    const productFilter='<label>Product<select id="fin-filter-product" data-filter-key="product">'+options(products,product,'All products')+'</select></label>';
    const marketFilter=businessSection&&effectiveModule!=='factory'?'<label>Market<select id="fin-filter-market" data-filter-key="market">'+options(markets,market,'All markets')+'</select></label>':'';
    const salesForecast=isCommercial&&!sourceKey&&(salesView==='products'||salesView==='markets');
    const bomForecast=isPurchasing&&!sourceKey&&(bomView==='markets'||bomView==='annual');
    const opsOverview=isOperations&&!sourceKey&&opsView!=='routes';
    const factoryLanding=isFactory&&!sourceKey&&factoryView!=='inputs'&&!factoryField;
    const engineeringLanding=isEngineering&&!sourceKey&&engineeringView!=='records';
    const engineeringNavigation=isEngineering&&!sourceKey&&!engineeringPackage&&!validationSpec&&active?
      '<nav class="fin-tabs fin-sales-nav fin-engineering-nav" aria-label="Engineering views">'+
      ([['packages','Work packages'],['validation-hours','Validation hours'],['records','Cost records']] as const).map(([view,label])=>
        '<a data-finance-nav id="fin-eng-'+view+'"'+(engineeringView===view?' aria-current="page"':'')+
        ' href="'+html(capitalLink('engineering','',{engineeringView:view,engineeringPackage:null,validationSpec:null}))+'">'+html(label)+'</a>').join('')+'</nav>':'';
    const prototypeNavigation=isPrototype&&!sourceKey&&!prototypeGroup&&active&&!cashOnly?
      '<nav class="fin-tabs fin-sales-nav fin-prototype-nav" aria-label="Prototype views">'+
      ([['quotes','Quote packages'],['delivery','Delivery & evidence'],['records','Cost records']] as const).map(([view,label])=>
        '<a data-finance-nav id="fin-prototype-'+view+'"'+(prototypeView===view?' aria-current="page"':'')+
        ' href="'+html(capitalLink('prototypes','',{prototypeView:view}))+'">'+html(label)+'</a>').join('')+'</nav>':'';
    const validationNavigation=isValidation&&!sourceKey&&!validationGroup&&active&&!cashOnly?
      '<nav class="fin-tabs fin-sales-nav fin-validation-nav" aria-label="Validation views">'+
      ([['packages','Test packages'],['coverage','Certification & coverage'],['records','Cost records']] as const).map(([view,label])=>
        '<a data-finance-nav id="fin-validation-'+view+'"'+(validationView===view?' aria-current="page"':'')+
        ' href="'+html(capitalLink('validation','',{validationView:view,validationPhase:null}))+'">'+html(label)+'</a>').join('')+'</nav>':'';
    const investmentNavigation=isInvestment&&!sourceKey&&!investmentCashDetail&&capital?
      '<nav class="fin-tabs fin-sales-nav" aria-label="Investment views">'+
      ([['allocation','Investment allocation','fin-investment-allocation'],['cash','Payments & recovery','fin-investment-cash'],
        ['items','Equipment & tooling','fin-equipment-items'],['records','Capital records','fin-investment-records']] as const).map(([view,label,id])=>
        '<a data-finance-nav id="'+id+'"'+(investmentView===view?' aria-current="page"':'')+' href="'+html(capitalLink('investment','',{
          view:view==='allocation'?null:view,cashDetail:null,period:view==='cash'?period:null,
          ...(view==='items'?{}:{assetSearch:null,assetCategory:null,assetStatus:null,assetSupplier:null})
        }))+'">'+html(label)+'</a>').join('')+'</nav>':'';
    const returnsNavigation=isReturns&&!sourceKey&&returnView!=='period'&&capital?
      '<nav class="fin-tabs fin-sales-nav" aria-label="Returns views">'+
      ([['cash','Cash flow','fin-returns-cash'],['working-capital','Working capital','fin-returns-working-capital'],
        ['irr','IRR review','fin-returns-review'],['sources','Sources & settings','fin-returns-sources']] as const)
        .filter(([view])=>view!=='working-capital'||!capital.cashOnly).map(([view,label,id])=>
          '<a data-finance-nav id="'+id+'"'+(returnView===view||view==='sources'&&returnView==='full'?' aria-current="page"':'')+
          ' href="'+html(capitalLink('returns','',{returnDetail:view==='cash'?null:view,basis:null}))+'">'+html(label)+'</a>').join('')+'</nav>':'';
    const budgetNavigation=isBudget&&!sourceKey&&active?'<nav class="fin-tabs fin-sales-nav" aria-label="Budget views">'+
      (Object.entries(budgetViews) as [BudgetView,string][]).map(([view,label])=>
        '<a data-finance-nav id="fin-budget-view-'+view+'"'+(budgetView===view?' aria-current="page"':'')+
        ' href="'+html(budgetViewLink(view))+'">'+html(label)+'</a>').join('')+'</nav>':'';
    const factoryNavigation=isFactory&&!sourceKey&&!factoryField&&active?'<nav class="fin-tabs fin-sales-nav fin-factory-nav" aria-label="Factory cost views">'+
      ([['breakdown','Cost breakdown'],['annual','Annual trends'],['inputs','Source inputs']] as const).map(([view,label])=>{
        const href=capitalLink('factory-costs','',{factoryView:view,factoryCost:null,part:null,rows:null});
        return '<a data-finance-nav id="fin-factory-'+view+'" href="'+html(href)+'"'+(factoryView===view?' aria-current="page"':'')+'>'+html(label)+'</a>';
      }).join('')+'</nav>':'';
    const opsNavigation=isOperations&&!sourceKey&&active?'<nav class="fin-tabs fin-sales-nav" aria-label="Manufacturing views">'+
      ([['stations','Operations & cycle times'],['annual','Unit labor by year'],['routes','Routes & batch records']] as const).map(([view,label])=>{
        const href=capitalLink('operations','',{opsView:view,market:null});
        return '<a data-finance-nav id="fin-ops-'+view+'" href="'+html(href)+'"'+(opsView===view?' aria-current="page"':'')+'>'+html(label)+'</a>';
      }).join('')+'</nav>':'';
    const projectActions='<div class="fin-actions">'+financeUrl('/finance?choose=1','Switch Project','fin-switch')+'<a class="small-btn" href="/#projects">Project Overview</a>'+
      '<a class="small-btn" href="/projects/'+encodeURIComponent(projectId)+'/timing">Timing</a></div>';
    const filters=isBudget?(sourceKey?'':
      budgetView==='versions'?'<div class="fin-filters fin-op-scope">'+versionFilter+'</div>'+projectActions:
        '<div class="fin-filters fin-op-scope">'+productFilter+(budgetView==='policy'?'':periodFilter)+'</div>'):
      isReturns?'<div class="fin-filters fin-op-scope">'+productFilter+
      (['cash','working-capital','period','full'].includes(returnView)&&!sourceKey?periodFilter:'')+'</div>'+
      '<details class="fin-settings fin-sales-options"'+(returnOptionsOpen?' open':'')+' id="fin-more-settings"><summary>Returns options</summary><div class="fin-filters">'+
      versionFilter+(active?displayCurrencySelect(workspace):'')+'</div>'+projectActions+
      '<div class="fin-actions">'+sectionLink('compare','Version Comparison','fin-version-comparison')+'</div></details>':
      isInvestment?'<div class="fin-filters fin-op-scope">'+productFilter+(investmentView==='cash'?periodFilter:'')+'</div>'+
      '<details class="fin-settings fin-sales-options"><summary>Investment options</summary><div class="fin-filters">'+versionFilter+
      '</div>'+projectActions+'</details>':isValidation?'<div class="fin-filters fin-op-scope">'+productFilter+(validationView==='coverage'?'':periodFilter)+'</div>'+
      '<details class="fin-settings fin-sales-options"><summary>Validation options</summary><div class="fin-filters">'+versionFilter+
      '</div>'+projectActions+'</details>':isPrototype?'<div class="fin-filters fin-op-scope">'+productFilter+periodFilter+'</div>'+
      '<details class="fin-settings fin-sales-options"><summary>Prototype options</summary><div class="fin-filters">'+versionFilter+
      '</div>'+projectActions+'</details>':engineeringLanding?'<div class="fin-filters fin-op-scope">'+productFilter+(engineeringView==='validation-hours'?'':periodFilter)+'</div>'+
      '<details class="fin-settings fin-sales-options"><summary>Engineering options</summary><div class="fin-filters">'+versionFilter+
      '</div>'+projectActions+'</details>':factoryLanding?'<div class="fin-filters fin-op-scope">'+productFilter+(factoryView==='annual'?'':periodFilter)+'</div>'+
      '<details class="fin-settings fin-sales-options"><summary>Factory options</summary><div class="fin-filters">'+versionFilter+
      '</div>'+projectActions+'</details>':opsOverview?'<div class="fin-filters fin-op-scope">'+productFilter+(opsView==='annual'?'':periodFilter)+'</div>'+
      '<details class="fin-settings fin-sales-options"><summary>Manufacturing options</summary><div class="fin-filters">'+versionFilter+
      '</div>'+projectActions+'</details>':bomForecast?'<div class="fin-filters fin-sales-scope">'+productFilter+'</div>'+
      '<details class="fin-settings fin-sales-options"><summary>BOM options</summary><div class="fin-filters">'+versionFilter+(bomView==='annual'?'':periodFilter)+
      '</div>'+projectActions+'</details>':salesForecast?'<div class="fin-filters fin-sales-scope">'+productFilter+
      (salesView==='markets'?marketFilter:'')+'</div><details class="fin-settings fin-sales-options"><summary>Forecast options</summary><div class="fin-filters">'+
      versionFilter+periodFilter+(salesView==='products'?marketFilter:'')+'</div>'+projectActions+'</details>':
      '<div class="fin-filters">'+versionFilter+periodFilter+productFilter+marketFilter+'</div>';
    const unavailable=!active?empty('No finance version selected','Select an available version or return to Project Overview.'):'';
    const settings=()=>'<details class="fin-settings" id="fin-more-settings"'+(settingsOpen?' open':'')+'><summary>More settings</summary>'+
      '<div class="fin-settings-body"><div class="fin-filters">'+baselineSelect+(active?displayCurrencySelect(workspace):'')+'</div>'+
      (!workspace.approvedBaselineId?'<p class="fin-muted">No approved baseline. Select versions on the comparison page when available.</p>':'')+
      '<div class="fin-tabs">'+sectionLink('compare','Version Comparison','fin-version-comparison')+'</div>'+
      (active?versionFxPanel(workspace,active)+comparison():'')+'</div></details>';
    const module=modules.find(item=>item[0]===section);
    const driverScope=workspace.inputs.filter(input=>input.module===effectiveModule&&(!product||input.productKey===product||(!input.productKey&&effectiveModule!=='bom'))&&
      (!market||!input.marketKey||input.marketKey===market)&&(!period||input.acrossPeriods||input.periodKey===period||input.business?.assetKey));
    const picked=sourceKey?(effectiveModule==='bom'||effectiveModule==='factory'?driverScope:workspace.inputs)
      .find(input=>input.key===sourceKey&&input.module===effectiveModule):undefined;
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
      '<td>'+html([input.source?.sheet,input.source?.cell].filter(Boolean).join('!')||input.source?.reference||input.source?.key)+
      (effectiveModule==='bom'&&input.business?.assetKey?
        '<br>'+financeUrl(capitalLink('investment',input.key,{view:'items'}),'Equipment & tooling','tooling-'+input.key):'')+'</td></tr>').join('');
    const controlLink=(target:number,label:string)=>{
      const next=new URLSearchParams(params);next.set('rows',String(target));
      return financeUrl(base+'/'+section+'?'+next,label);
    };
    const anchors=businessSection||operations||development||capital||budgetExecution?'<div class="fin-actions">'+(workspace.canAdd&&!creating?financeUrl(link(section+'/new'),'Add record','fin-add-business'):'')+
      (workspace.canClone?'<button class="small-btn" type="button" id="fin-copy-draft">Create Draft</button>':'')+'</div>':'';
    const lookup=businessSection?'<form id="fin-business-search" class="fin-actions"><label>'+
      (isCommercial?'Find a commercial input':isFactory?'Find a factory cost input':isPurchasing&&bomView==='parts'?'Find a part, supplier or source':'Find input or part')+
      '<input id="fin-business-search-text" type="search" name="part" maxlength="100" value="'+html(term)+'"></label>'+
      '<button class="small-btn" type="submit">Find</button></form>':'';
    const bizIntro=effectiveModule==='bom'?'Recurring material uses quantity × (converted quote + landed adjustment per part). Supplier tooling is listed separately for Equipment & Investment.':
      effectiveModule==='commercial'?'Volume uses vehicle demand, configuration rate and units per vehicle. Annual reductions apply to the previous effective selling price.':
      'Scrap and warranty use percentage rates. Packaging and freight, launch and division allocation have separate inputs.';
    const commercial=isCommercial&&!sourceKey&&salesView!=='inputs'&&workspace.commercial?
      commercialOverview(workspace.commercial,product,market,period,salesView,labelProduct,labelMarket,(key,filters)=>capitalLink(section,key,filters)):null;
    const purchasing=isPurchasing&&!sourceKey&&bomView!=='inputs'&&!cashOnly?purchasingOverview(
      workspace.inputs.filter(input=>input.module==='bom'&&input.business),
      {product,market,term,period:workspace.businessPeriod??'',view:bomView,archived:workspace.archived,periods,
        markets:workspace.markets.map(row=>({...row,productKey:typeof row.productKey==='string'?row.productKey:null})),
        components:workspace.bomComponents??[],references:workspace.bomSourceReferences??{}},
      labelMarket,workspace.archived?'CNY':active?.details.currency??'',(key,filters)=>capitalLink('bom',key,filters),
      (key,filters)=>capitalLink('investment',key,{...filters,view:'items'}),workspace.materialSchedule,labelPeriod,labelProduct):null;
    const factory=isFactory&&!cashOnly&&(factoryField||!sourceKey&&factoryView!=='inputs')?factoryOverview(workspace.factoryCosts,
        {product,period:workspace.businessPeriod??'',field:factoryField,view:factoryView,source:sourceKey,periods},labelProduct,labelPeriod,
        (key,filters)=>capitalLink(section,key,filters),metric=>{
          displayedOutputs.set(dashboardVersion+':'+metric.id,metric);
          return trace(metric,dashboardVersion);
        }):null;
    const businessOverview=commercial?(cashOnly?empty('Commercial forecast unavailable','This version contains cash flows only. Select an operating forecast to view volume and selling prices.'):commercial.body):
      isPurchasing?(cashOnly?empty('Purchasing forecast unavailable','This version contains cash flows only. Select an operating forecast to view material costs.'):purchasing?.body??''):
      isFactory?(cashOnly?empty('Factory cost forecast unavailable','This version contains cash flows only. Select an operating forecast to view factory costs.'):factory?.body??''):'';
    const details=(module&&!isEngineering&&!isPrototype&&!isValidation&&!isInvestment&&!isReturns&&!businessSection&&!operations&&!development&&!capital&&!budgetExecution?'<p class="fin-muted">Full '+html(module[1])+' workflow is scheduled for '+module[2]+'.</p>':'')+
      (sourceKey&&!picked&&!creating&&!operation&&!routeSource&&!developmentSource&&!capitalSource&&!(budgetExecution&&isBudgetDetail(budgetExecution,sourceKey))?
        empty('Source unavailable','This input is not available for the selected version and period.'):'')+
      (budgetExecution?(budgetView==='versions'&&!sourceKey?budgetVersions(workspace.versions,active!.details.id,workspace.currentVersionId,
        workspace.approvedBaselineId,id=>budgetViewLink('allocations',id),link('compare'),
        workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        budgetPage(budgetExecution,budgetView,sourceKey,budgetLink,link(),periods,products,product,workspace.budgetRights,isDraft,
          workspace.budgetActors,glossary,period,budgetView==='execution'&&!sourceKey?budget():'',
          budgetForm?'<div id="fin-impact-mount"></div>':'')):'')+
      (investment?investment.body+(workspace.canClone&&!sourceKey&&investmentView==='records'?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        isInvestment?empty('Investment forecast unavailable',cashOnly?'This version contains cash flows only. Select an operating forecast to review investment and equipment.':
          'Select an operating forecast with investment records.'):
        returns?returns.body+(!sourceKey&&returnView==='funding'?chart():'')+
          (returnView==='sources'&&workspace.canClone&&!sourceKey?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        isReturns?empty('Return forecast unavailable','Select a version with operating forecasts or period cash records.'):'')+
      (engineering?engineering.body+(!sourceKey&&engineeringView==='records'&&workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        isEngineering&&cashOnly?empty('Engineering forecast unavailable','This version contains cash flows only. Select an operating forecast to review work packages.'):
        prototype?prototype.body+(!sourceKey&&prototypeView==='records'&&workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        isPrototype?empty('Prototype forecast unavailable',cashOnly?'This version contains cash flows only. Select an operating forecast to review sample packages.':
          'Select an operating forecast with development cost records.'):
        validation?validation.body+(!sourceKey&&validationView==='records'&&workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        isValidation?empty('Validation forecast unavailable',cashOnly?'This version contains cash flows only. Select an operating forecast to review test packages.':
          'Select an operating forecast with development cost records.'):
        development?developmentPage(development,developmentModule,sourceKey,developmentLink,periods,products,workspace.developmentRights,isDraft,glossary)+
        (workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        manufacturing?manufacturing.body+(!sourceKey&&opsView==='routes'&&workspace.canClone?'<p id="fin-business-status" role="status"></p>'+anchors:''):
        isOperations?empty('Manufacturing forecast unavailable',cashOnly?'This version contains cash flows only. Select an operating forecast to view routes and direct labor.':
          'This version has no manufacturing cost model. Select a manufacturing forecast to review its operations and labor.'):'')+
      (businessSection?(isPurchasing&&bomView==='parts'&&!sourceKey&&!cashOnly?lookup:'')+businessOverview+
        (isPurchasing&&picked?.business?.assetKey?
          '<p>'+financeUrl(capitalLink('investment',picked.key,{view:'items'}),'Open equipment and tooling record','fin-open-quoted-tooling')+'</p>':'')+
        (!sourceKey&&(isCommercial&&salesView==='inputs'||isPurchasing&&bomView==='inputs'||isFactory&&factoryView==='inputs'&&!factoryField)&&!cashOnly?
        sectionPanel(isPurchasing?'Purchasing source inputs':isCommercial?'Commercial source inputs':'Factory cost inputs',
        '<p class="fin-muted">'+html(bizIntro)+' · '+html(labelPeriod(workspace.businessPeriod??''))+'</p><p id="fin-business-status" role="status"></p>'+
        lookup+(matching.length?table(['Input','Product / market','Effective period','Value','Source'],driverRows):'<p class="fin-muted">No matching inputs in this scope.</p>')+
        (pageCount>1?'<div class="fin-actions fin-pagination">'+(page>1?controlLink(page-1,'Previous'):'')+'<span>Page '+page+' / '+pageCount+'</span>'+
          (page<pageCount?controlLink(page+1,'Next'):'')+'</div>':''),anchors):''):
        drivers.length&&(!isOperations||!sourceKey&&opsView==='routes')&&(!isReturns||!sourceKey&&returnView==='sources')?
        sectionPanel('Connected Calculation Inputs',table(['Input','Product / line','Source period','Source'],driverRows)):
        module&&!isOperations&&!development&&!capital&&section!=='budget'&&section!=='returns'?empty('Business entry pending','Connected values are available in the finance dashboard where the selected version provides them.'):'');
    const origin=historyPosition()?.parent,originPath=origin?.split('?')[0];
    const safeOrigin=originPath===base||originPath?.startsWith(base+'/');
    const comparisonOrigin=!isComparison&&params.get('compareReturn')==='1';
    const annualParent=isCommercial&&!sourceKey&&salesView==='quotes'&&product&&period;
    const factoryParent=isFactory&&!sourceKey&&(factoryField||factoryView!=='breakdown');
    const engineeringParent=isEngineering&&(!!sourceKey||!!engineeringPackage||!!validationSpec||engineeringView!=='packages');
    const prototypeParent=isPrototype&&(!!sourceKey||!!prototypeGroup||prototypeView!=='quotes');
    const validationParent=isValidation&&(!!sourceKey||!!validationGroup||validationView!=='packages');
    const investmentParent=isInvestment&&(!!sourceKey||investmentView!=='allocation');
    const returnsParent=isReturns&&(!!sourceKey||returnView!=='cash');
    const budgetParent=isBudget&&(!!sourceKey||budgetView!=='allocations');
    const returnsSourceView=sourceKey&&capital?.rows.some(row=>(row.key===sourceKey||'edit-'+row.key===sourceKey)&&row.record.kind==='terms')?
      'working-capital':'sources';
    const investmentSourceView=investmentView==='allocation'&&sourceKey?
      (capital?.assets.some(row=>row.key===sourceKey||'edit-'+row.key===sourceKey)||
        capital?.toolingQuotes.some(row=>row.key===sourceKey)||capital?.estimateDetails.some(row=>row.key===sourceKey)?'items':'records'):
      investmentView;
    const salesParent=requestedView==='inputs'||picked?.business?.businessField!=='sales_price'?'inputs':'quotes';
    const backHref=safeOrigin?origin!:comparisonOrigin?comparisonReturn(base,params):
      investmentParent?capitalLink('investment','',{
        view:sourceKey?investmentSourceView:investmentCashDetail?'cash':null,cashDetail:null,
        ...(!sourceKey&&!investmentCashDetail?{period:null,assetSearch:null,assetSupplier:null,assetCategory:null,assetStatus:null}:{})
      }):
      returnsParent?capitalLink('returns','',{returnDetail:sourceKey?returnsSourceView:null,basis:null}):
      budgetParent?budgetViewLink(sourceKey?budgetView:'allocations'):
      isOperations&&(sourceKey||opsView!=='stations')?capitalLink('operations','',{opsView:sourceKey?'routes':'stations'}):
      isPurchasing&&sourceKey?capitalLink('bom','',{bomView}):
      isPurchasing&&bomView!=='markets'?capitalLink('bom','',{bomView:'markets',market:null,part:null,rows:null}):
      isCommercial&&sourceKey?capitalLink('commercial','',{salesView:salesParent}):
      isFactory&&sourceKey?capitalLink('factory-costs','',{factoryView:factoryField?null:'inputs'}):
      engineeringParent?capitalLink('engineering','',{
        engineeringView:sourceKey&&!engineeringPackage?'records':validationSpec?'validation-hours':'packages',
        ...(!sourceKey?{engineeringPackage:null,validationSpec:null}:{})
      }):
      prototypeParent?capitalLink('prototypes','',{
        prototypeView:sourceKey&&!prototypeGroup?'records':prototypeGroup?prototypeView:null,
        prototypeGroup:sourceKey?prototypeGroup:null
      }):
      validationParent?capitalLink('validation','',{
        validationView:sourceKey&&!validationGroup?'records':validationGroup?validationView:null,
        validationGroup:sourceKey?validationGroup:null,validationPhase:sourceKey?validationPhase:null
      }):
      factoryParent?capitalLink('factory-costs','',{factoryView:'breakdown',factoryCost:null}):
      annualParent?capitalLink('commercial','',{period:null,salesView:'products'}):sourceKey?link(section):link();
    const backLabel=safeOrigin?titleFor(originPath!.slice(base.length+1).split('/')[0]):comparisonOrigin?'Version Comparison':
      sourceKey||annualParent||factoryParent||engineeringParent||prototypeParent||validationParent||investmentParent||returnsParent||budgetParent?titleFor(section):'Finance Dashboard';
    const originParams=new URLSearchParams(origin?.split('?')[1]);
    const previousSalesView=safeOrigin?originParams.get('salesView')??(originParams.has('period')?'quotes':'products'):
      sourceKey?salesParent:'products';
    const salesPageNames:Record<string,string>={products:'Annual Forecast',markets:'Market Forecast',quotes:'Market Quotes',inputs:'Source Inputs'};
    const previousBomView=safeOrigin?originParams.get('bomView')??(originParams.has('market')?'parts':'markets'):sourceKey?bomView:'markets';
    const bomPageNames:Record<string,string>={markets:'Market BOMs',parts:'Parts & Suppliers',annual:'Annual Material Cost',inputs:'Source Inputs'};
    const previousOpsView=safeOrigin?originParams.get('opsView'):sourceKey?'routes':'stations';
    const opsPageNames:Record<string,string>={stations:'Operations & Cycle Times',annual:'Annual Unit Labor',routes:'Routes & Batch Records'};
    const factoryPageNames:Record<string,string>={breakdown:'Cost Breakdown',annual:'Annual Trends',inputs:'Factory Cost Inputs'};
    const previousFactoryView=safeOrigin?originParams.get('factoryView')??'breakdown':sourceKey&&!factoryField?'inputs':'breakdown';
    const previousEngineeringView=safeOrigin?originParams.get('engineeringView'):sourceKey&&!engineeringPackage?'records':validationSpec?'validation-hours':'packages';
    const engineeringPageNames:Record<string,string>={packages:'Work Packages','validation-hours':'Validation Hours',records:'Cost Records'};
    const previousPrototypeView=safeOrigin?originParams.get('prototypeView'):sourceKey&&!prototypeGroup?'records':prototypeGroup?prototypeView:'quotes';
    const prototypePageNames:Record<string,string>={quotes:'Quote Packages',delivery:'Delivery & Evidence',records:'Cost Records'};
    const previousValidationView=safeOrigin?originParams.get('validationView'):sourceKey&&!validationGroup?'records':validationGroup?validationView:'packages';
    const validationPageNames:Record<string,string>={packages:'Test Packages',coverage:'Certification & Coverage',records:'Cost Records'};
    const previousInvestmentView=safeOrigin?originParams.get('view'):sourceKey?investmentSourceView:
      investmentCashDetail?'cash':'allocation';
    const investmentPageNames:Record<string,string>={allocation:'Investment Allocation',cash:'Payments & Recovery',items:'Equipment & Tooling Details',records:'Capital Records'};
    const previousReturnView=safeOrigin?originParams.get('returnDetail'):sourceKey?returnsSourceView:'cash';
    const returnPageNames:Record<string,string>={cash:'Cash Flow','working-capital':'Working Capital',irr:'IRR Review',sources:'Sources & Settings',
      period:'Period Cash and Sources',funding:'Funding Sources'};
    const previousBudgetView=safeOrigin?originParams.get('budgetView')??'allocations':sourceKey?budgetView:'allocations';
    const backTitle=isBudget&&backLabel===titleFor(section)?
      budgetViews[previousBudgetView as BudgetView]??backLabel:
      isReturns&&backLabel===titleFor(section)?
      returnPageNames[previousReturnView??'cash']??backLabel:
      isInvestment&&backLabel===titleFor(section)?
      investmentPageNames[previousInvestmentView??'allocation']??backLabel:
      isValidation&&backLabel===titleFor(section)?
      (safeOrigin&&originParams.has('validationGroup')||!safeOrigin&&sourceKey&&validationGroup?'Test Package':
        validationPageNames[previousValidationView??'packages']??backLabel):
      isPrototype&&backLabel===titleFor(section)?
      (safeOrigin&&originParams.has('prototypeGroup')||!safeOrigin&&sourceKey&&prototypeGroup?'Quote Package':
        prototypePageNames[previousPrototypeView??'quotes']??backLabel):
      isEngineering&&backLabel===titleFor(section)?
      (safeOrigin&&originParams.has('engineeringPackage')||!safeOrigin&&sourceKey&&engineeringPackage?'Work Package':
        engineeringPageNames[previousEngineeringView??'packages']??backLabel):
      isFactory&&backLabel===titleFor(section)?
      (safeOrigin&&originParams.has('factoryCost')||!safeOrigin&&sourceKey&&factoryField?'Cost Detail':factoryPageNames[previousFactoryView]??backLabel):
      isOperations&&(backLabel===titleFor(section)||!safeOrigin&&opsView!=='stations')?
      opsPageNames[previousOpsView??'stations']??backLabel:
      isCommercial&&backLabel===titleFor(section)?salesPageNames[previousSalesView]??backLabel:
      isPurchasing&&(!safeOrigin&&!!sourceKey||!safeOrigin&&bomView!=='markets'||backLabel===titleFor(section))?bomPageNames[previousBomView]??backLabel:backLabel;
    const pageTitle=isPurchasing&&sourceKey?(creating?'New purchasing input':picked?.business?.label??'Purchasing input'):
      isCommercial&&sourceKey?(creating?'New commercial input':picked?.label??'Commercial input'):
      isFactory&&sourceKey?(creating?'New factory cost input':picked?.label??'Factory cost input'):
      isEngineering?'Engineering & Project Management':
      isBudget?'Budget & Versions':
      equipmentView?'Equipment & Tooling Details':isReturns?'Working Capital & Returns':section?titleFor(section):'Project Finance Dashboard';
    const scopePeriod=isReturns&&returnView==='working-capital'?capital?.workingPeriod:isOperations?(opsOverview&&opsView==='annual'?'':workspace.operationPeriod):
      isFactory?(factoryLanding&&factoryView==='annual'?'':workspace.businessPeriod):
      isEngineering&&engineeringView==='validation-hours'?'':isPurchasing&&bomView!=='annual'?workspace.businessPeriod:period;
    const scope=active&&!isComparison?'<p class="fin-scope">'+html(product?labelProduct(product):'All products')+' · '+
      html(isValidation&&validationView==='coverage'?'Full workbook quote':isInvestment&&investmentView==='allocation'&&!sourceKey?'Lifecycle quote':
        isInvestment&&investmentView!=='cash'&&!sourceKey?'All periods':isReturns&&['irr','funding'].includes(returnView)?'Full horizon':
          scopePeriod?labelPeriod(scopePeriod):'All periods')+
      ((isCommercial||isPurchasing)&&market?' · '+html(labelMarket(market)):'')+' · '+
      html(isBudget?budgetExecution?.policy?.currency??active.details.currency:
        isPurchasing||isOperations||isFactory||isEngineering||isPrototype||isValidation||isInvestment?(workspace.archived?'CNY':active.details.currency):isCommercial?workspace.commercial?.currency??active.currency:active.currency)+
      (isBudget?' · '+html(active.details.name)+' · '+(isDraft?'Draft':'Frozen · read-only')+' · Revision '+active.details.revision:
        isFactory||isEngineering||isPrototype||isValidation||isInvestment||isReturns?(isDraft?' · Draft forecast':' · Frozen version'):'')+
      (!section?' · As of '+html(active.asOf):'')+'</p>':'';
    const heading='<div class="fin-heading fin-project-heading"><div><p class="fin-project-name">'+html(workspace.title)+'</p><h1>'+html(pageTitle)+'</h1>'+scope+'</div>'+
      (salesForecast||bomForecast||opsOverview||factoryLanding||engineeringLanding||isPrototype||isValidation||isInvestment||isReturns||isBudget?'':projectActions)+'</div>';
    root.innerHTML='<div class="fin-workbench">'+navigation+'<div class="fin-workbench-content">'+heading+(isComparison?context:'')+
      (section?'<a class="fin-link fin-back" data-finance-nav data-finance-back href="'+html(backHref)+'">← Back to '+html(backTitle==='Dashboard'?'Finance Dashboard':backTitle)+'</a>':'')+
      (commercial&&!cashOnly?commercial.summary:purchasing?.summary??manufacturing?.summary??factory?.summary??engineering?.summary??prototype?.summary??validation?.summary??investment?.summary??returns?.summary??'')+
      (budgetExecution&&budgetView==='allocations'&&!sourceKey?budgetSummary(budgetExecution,product,period):'')+
      (isComparison?comparisonFilters(workspace,params):'<div class="fin-toolbar">'+filters+(!section?settings():'')+'</div>')+
      salesNavigation+bomNavigation+opsNavigation+factoryNavigation+engineeringNavigation+prototypeNavigation+validationNavigation+investmentNavigation+returnsNavigation+budgetNavigation+
      (workspace.selectionAdjusted?'<p role="status">An unavailable version selection was reset.</p>':'')+
      (isComparison?comparisonPage(compareReport,base,params,glossary,fxComparison):unavailable+comparisonSource(workspace,params.has('traceKey'))+
        (active?
        (!section?dashboard():
          details+
          (!budgetForm&&(picked||creating||operation)?'<div id="fin-impact-mount"></div>':'')):''))+'</div></div>';
    const activeSection=root.querySelector<HTMLElement>('.fin-sections [aria-current="page"]');
    if(activeSection&&matchMedia('(max-width: 1180px)').matches) {
      const menu=activeSection.closest<HTMLElement>('.fin-sections')!;
      menu.scrollLeft=activeSection.offsetLeft-(menu.clientWidth-activeSection.offsetWidth)/2;
    }
    const settingsElement=root.querySelector<HTMLDetailsElement>('#fin-more-settings');
    if(settingsElement)settingsElement.ontoggle=()=>{
      if(isReturns)returnOptionsOpen=settingsElement.open;
      else settingsOpen=settingsElement.open;
    };
    const assetSearch=root.querySelector<HTMLFormElement>('#fin-asset-search');
    if(assetSearch)assetSearch.onsubmit=event=>{
      event.preventDefault();
      const query=new FormData(assetSearch);
      navigate(capitalLink('investment','',Object.fromEntries(
        ['assetSearch','assetCategory','assetStatus','assetSupplier'].map(name=>[name,String(query.get(name)??'').trim()])
      )),'fin-asset-search-submit');
    };
    if(!section&&active){
      const keys=[...groups.flatMap(group=>group.keys),'total_cost','cqa.mpbitri','full_cost_management_profit'];
      const selection=(full:Workspace)=>({period:period||null,product:product||null,
        metrics:Object.fromEntries(keys.map(key=>[key,{baseline:reportMetric(full.baseline,key)??null,forecast:reportMetric(full.current,key)??null,
          difference:metricDelta(key)??null}]))});
      fxEditor=mountVersionFx(root,workspace,active,api,'projects/'+encodeURIComponent(projectId)+'/finance',glossary,selection,()=>void load(false));
    }
    const comparisonExport=root.querySelector<HTMLButtonElement>('#fin-export-comparison');
    if(comparisonExport&&compareReport&&fxComparison)comparisonExport.onclick=()=>downloadFinanceJson('finance-comparison.json',{
      format:'finance-comparison-v1',before:compareReport.before,after:compareReport.after,cutoff:compareReport.cutoff,product:compareReport.product,...fxComparison});
    const search=root.querySelector<HTMLFormElement>('#fin-business-search');
    if(search)search.onsubmit=event=>{
      event.preventDefault();
      const next=new URLSearchParams(params),input=String(new FormData(search).get('part')??'').trim();
      if(input)next.set('part',input);else next.delete('part');next.delete('rows');
      if(isPurchasing)next.set('bomView',bomView);
      if(isFactory)next.set('factoryView','inputs');
      navigate(base+'/'+section+(next.size?'?'+next:''),'fin-business-search-text');
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
      if(salesForecast)next.set('salesView',salesView);
      if(isPurchasing)next.set('bomView',bomView);
      if(isEngineering&&filter.dataset.filterKey==='product'){
        next.delete('engineeringPackage');next.delete('validationSpec');
      }
      if(isPrototype&&filter.dataset.filterKey==='product'&&!sourceKey)next.delete('prototypeGroup');
      if(isInvestment&&investmentView==='cash'&&filter.dataset.filterKey==='product')next.delete('cashDetail');
      if(isValidation&&filter.dataset.filterKey==='product'&&!sourceKey){
        next.delete('validationGroup');next.delete('validationPhase');
      }
      if((effectiveModule==='bom'||isCommercial)&&filter.dataset.filterKey==='product'&&filter.value){
        const marketProduct=workspace.markets.find(item=>item.key===next.get('market'))?.productKey;
        if(marketProduct&&marketProduct!==filter.value)next.delete('market');
      }
      next.delete('rows');
      if(!leave()){filter.value=params.get(filter.dataset.filterKey!)??'';return;}
      savePosition(filter.id);
      const pathname=sourceKey&&(businessSection||operations||development||capital||budgetExecution)?base+'/'+section:location.pathname;
      history.pushState({[stateKey]:{index:++position,parent:historyPosition()?.parent}},'',pathname+(next.size?'?'+next:''));
      void load(false,true);
    };
    const chartNode=root.querySelector<HTMLElement>('.fin-chart');
    if(isComparison)cleanChart=mountComparisonChart(root,compareReport,fxComparison);
    else if(chartNode)cleanChart=cashChart(chartNode,series,chartPeriods.map(p=>p.label),active!.currency,!section);
    if((picked||creating||operation)&&active)impact=mountImpactPanel({root:root.querySelector('#fin-impact-mount')!,projectId,version:active,driver:picked,operation,
      entry:creating&&businessType?{module:businessType,fields:workspace.businessFields,products,markets,product,market,archived:workspace.archived}:undefined,
      dictionary:glossary,period,currencies:workspace.currencies,api,labelPeriod,labelProduct,
      onSaved:(fieldKey,accountingPeriod)=>{
        savePosition();
        if(budgetForm){
          const target=sourceKey==='policy'?'':sourceKey.startsWith('forecast-')?sourceKey.slice('forecast-'.length):fieldKey;
          updateHistory({...historyPosition(),index:position},budgetLink(target,accountingPeriod));
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
    window.removeEventListener('popstate',pop);window.removeEventListener('beforeunload',unloading);
    window.removeEventListener('scroll',positionHelp,true);window.removeEventListener('resize',positionHelp);
    root.removeEventListener('click',click);
    root.removeEventListener('focusin',onFocus);root.removeEventListener('focusout',onBlur);
    root.removeEventListener('pointerenter',onHover,true);root.removeEventListener('pointerleave',onLeave,true);
    document.removeEventListener('keydown',onKey);
  };
}
