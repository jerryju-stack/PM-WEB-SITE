const escapeHtml = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const modules = [
  ['commercial','Commercial & Volume'], ['bom','BOM & Purchasing'],
  ['operations','Manufacturing & Labor'], ['factory-costs','Factory Costs & Launch'],
  ['engineering','Engineering & PM Hours'], ['prototypes','Prototypes & Builds'],
  ['validation','Validation & Certification'], ['investment','Equipment & Investment'],
  ['returns','Working Capital & Returns'], ['budget','Budget & Versions']
];
const dictionary = {
  revenue:['Revenue','Total revenue from all products in the selected periods.','300,000 CNY across all products.'],
  operating_profit:['Operating Profit / Margin','Revenue less operating costs under the full-cost sample basis. Margin is total profit divided by total revenue.','22,000 / 300,000 = 7.33%.'],
  npv:['NPV','Net Present Value discounts future cash flows to Year 0 and includes the initial payment.','At 10%, −100,000, 58,000 and 60,000 CNY give NPV 2,314.05 CNY.'],
  irr:['IRR','The annual discount rate that makes the combined project cash flow NPV equal to zero.','The sample forecast IRR is 11.71%.'],
  payback:['Payback Period','Years from Year 0 until undiscounted cumulative cash flow first recovers the funding shortfall.','1 + 42,000 / 60,000 = 1.70 years.'],
  funding:['Peak Funding Requirement','The largest cumulative cash shortfall and the first period it occurs.','100,000 CNY, first occurring at Year 0.'],
  ct:['Cycle Time (CT)','Time needed to complete one operation cycle.','2 people × 36 sec × 60 CNY/hour / 3,600 = 1.20 CNY/unit.']
};
let activeController;

export async function mountFinance({root, api}) {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const signal = controller.signal;
  document.documentElement.lang = 'en';
  if(!document.querySelector('#finance-prototype-style')) {
    const style = document.createElement('link');
    style.id = 'finance-prototype-style';
    style.rel = 'stylesheet';
    style.href = '/finance-prototype.css';
    document.head.append(style);
  }
  root.innerHTML = '<p role="status">Loading sample finance workspace…</p>';
  const projects = [];
  let cursor = '';
  do {
    const page = await api('data?limit=100' + (cursor ? '&projectsCursor='+encodeURIComponent(cursor) : ''));
    if(signal.aborted) return;
    projects.push(...page.projects);
    cursor = page.projectsPage.nextCursor;
  } while(cursor);

  let index = history.state?.fpIndex ?? 0;
  let currentUrl = location.pathname + location.search;
  let dirty = false;
  let ct = 36;
  let retest = 2000;
  let loadedCt = 36;
  let loadedRetest = 2000;
  let repairAction;
  history.scrollRestoration = 'manual';
  history.replaceState({...history.state, fpIndex:index}, '', location.href);

  const route = () => {
    const match = /^\/projects\/([^/]+)\/finance(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(location.pathname);
    return {project:projects.find(p=>p.id===match?.[1]), section:match?.[2] || '', row:match?.[3] || ''};
  };
  const context = () => {
    const params = new URLSearchParams(location.search);
    return {baseline:params.get('baseline')==='B00'?'B00':'B01',
      version:params.get('version')==='F01'?'F01':'F02',
      period:['year1','year2'].includes(params.get('period'))?params.get('period'):'all',
      product:['outboard','center'].includes(params.get('product'))?params.get('product'):'all'};
  };
  const path = (suffix='', projectId=route().project?.id) => {
    const query = new URLSearchParams(context());
    return '/projects/'+encodeURIComponent(projectId)+'/finance'+suffix+'?'+query;
  };
  const link = (href, text, id='', className='') =>
    '<a data-fp-link href="'+escapeHtml(href)+'"'+(id?' id="'+id+'"':'')+' class="'+className+'">'+text+'</a>';
  const snapshot = () => history.replaceState({...history.state, fpIndex:index, scrollY:window.scrollY,
    focusId:document.activeElement?.id}, '', location.href);

  function askDiscard(action) {
    const dialog = root.querySelector('#fp-discard');
    dialog.showModal();
    dialog.querySelector('[data-discard]').onclick = () => {
      dirty = false;
      dialog.close();
      action();
    };
    dialog.querySelector('[data-keep]').onclick = () => dialog.close();
  }
  function navigate(url, returning=false) {
    if(dirty) return askDiscard(()=>navigate(url, returning));
    snapshot();
    const previous = {url:currentUrl, index, scrollY:window.scrollY, focusId:document.activeElement?.id};
    index++;
    history.pushState({fpIndex:index, origin:returning?undefined:previous}, '', url);
    currentUrl = location.pathname + location.search;
    render();
  }
  function back() {
    const origin = history.state?.origin;
    if(origin && origin.url.startsWith('/')) {
      if(dirty) return askDiscard(back);
      snapshot();
      history.back();
    } else {
      const {section,row}=route();
      navigate(path(row?'/'+section:''), true);
    }
  }
  window.addEventListener('popstate', event => {
    if(repairAction) {
      const action=repairAction;
      repairAction=undefined;
      action();
      return;
    }
    const targetIndex=event.state?.fpIndex ?? index-1;
    if(dirty) {
      const distance=index-targetIndex;
      repairAction=()=>askDiscard(()=>history.go(-distance));
      history.go(distance);
      return;
    }
    index=targetIndex;
    currentUrl=location.pathname+location.search;
    render(true);
  }, {signal});
  window.addEventListener('beforeunload', event => {
    if(dirty) {event.preventDefault(); event.returnValue='';}
  }, {signal});

  function info(key) {
    return '<span class="fp-help-wrap"><button class="fp-help" type="button" data-help="'+key+'" aria-label="'+dictionary[key][0]+' definition" aria-expanded="false">i</button></span>';
  }
  function numbers(cycle=36) {
    const cost=(cycle-30)*1000/3;
    const cash=[-100000,60000-cost,60000];
    const npv=cash.reduce((sum,x,t)=>sum+x/1.1**t,0);
    let low=-0.99, high=2;
    for(let i=0;i<80;i++) {
      const rate=(low+high)/2;
      const value=cash.reduce((sum,x,t)=>sum+x/(1+rate)**t,0);
      if(value>0) low=rate; else high=rate;
    }
    return {revenue:300000,operating_profit:24000-cost,npv,irr:(low+high)*50,payback:1+(40000+cost)/60000,funding:100000};
  }
  function filters() {
    const current=context();
    const select=(key,label,options)=>'<label>'+label+'<select data-filter="'+key+'" id="filter-'+key+'">'+options.map(([value,text])=>'<option value="'+value+'"'+(current[key]===value?' selected':'')+'>'+text+'</option>').join('')+'</select></label>';
    return '<div class="fp-filters">'+select('baseline','Approved Baseline',[['B01','B01'],['B00','B00 · sample alternate']])+
      select('version','Current Forecast',[['F02','F02'],['F01','F01 · sample alternate']])+
      select('period','Period',[['all','Year 0–2'],['year1','Year 1'],['year2','Year 2']])+
      select('product','Product',[['all','All products'],['outboard','Outboard'],['center','Center']])+
      '<span>As of <b>2026-11-17</b><br>Currency <b>CNY</b></span></div>'+
      '<p class="fp-scope-note">Filters retain navigation context. Metric cards illustrate the complete project sample.</p>';
  }
  function cardTarget(key) {
    if(key==='revenue') return '/commercial';
    if(key==='operating_profit') return '/operations';
    return '/returns';
  }
  function metrics() {
    const values=numbers(), baseline=numbers(30);
    return '<div class="fp-metrics">'+Object.entries(dictionary).filter(([key])=>key!=='ct').map(([key,[title]])=>{
      const suffix=key==='irr'?'%':key==='payback'?'years':'CNY';
      const delta=values[key]-baseline[key];
      const change=delta===0?'No change':'Unfavorable '+(delta>0?'+':'')+money(delta)+(key==='irr'?' pp':key==='payback'?' years':' CNY');
      return '<article class="fp-metric"><div class="fp-metric-label">'+title+info(key)+'</div>'+
        link(path(cardTarget(key)),money(values[key]),'metric-'+key,'fp-number')+
        '<span>'+suffix+'</span><small>Baseline '+money(baseline[key])+'</small><small class="'+(delta===0?'fp-muted':'fp-bad')+'">'+change+'</small>'+
        (key==='operating_profit'?'<small>Margin 7.33% · <span class="fp-bad">−0.67 pp</span></small>':'')+
        (key==='funding'?'<small>First at Year 0</small>':'')+'</article>';
    }).join('')+'</div>';
  }
  function cash() {
    return '<section class="fp-panel"><div class="fp-panel-title"><h2>Cumulative Project Cash Flow</h2><span>Baseline / Forecast</span></div>'+
      '<div class="fp-cash" role="img" aria-label="Year 0: minus 100,000. Year 1: minus 42,000. Year 2: 18,000 CNY.">'+
      '<canvas id="fp-cash-canvas"></canvas></div><div class="fp-cash-notes"><span>Lowest balance −100,000 CNY · Year 0</span><span>First payback 1.70 years</span></div></section>';
  }
  function budget() {
    return '<section class="fp-panel"><div class="fp-panel-title"><h2>Budget Execution</h2>'+link(path('/budget'),'View Report →')+'</div>'+
      '<div class="fp-budget">'+[['Approved budget','100,000'],['Confirmed actuals','40,000'],['ETC','52,000'],['Forecast surplus','8,000']].map(([name,value])=>'<div>'+name+'<b>'+value+'</b></div>').join('')+'</div><p>Amounts in CNY · EAC 92,000 · Budget less actuals 60,000</p></section>';
  }
  function dashboard() {
    return metrics()+'<div class="fp-columns">'+cash()+'<section class="fp-panel"><h2>Changes vs. Approved Baseline</h2>'+
      '<table><thead><tr><th>Change driver</th><th>Profit change / CNY</th></tr></thead><tbody>'+
      '<tr><td>'+link(path('/operations'),'Assembly CT 30 → 36 sec','dashboard-labor')+'</td><td class="fp-bad">−2,000.00</td></tr>'+
      '<tr><td>'+link(path('/compare'),'Validation cost · source review','dashboard-validation')+'</td><td>0.00</td></tr></tbody></table>'+
      '<p>NPV decreases by <span class="fp-bad">1,818.18 CNY</span>.</p>'+link(path('/compare'),'Version Comparison →','dashboard-compare')+'</section></div>'+budget()+
      '<h2 class="fp-section">Business Modules</h2><div class="fp-modules">'+modules.map(([id,title])=>link(path('/'+id),title+' ↗','module-'+id)).join('')+'</div>';
  }
  function operations(detail) {
    if(!detail) return '<section class="fp-panel"><h2>Manufacturing & Labor</h2><p>Sample process route · Outboard · Year 1</p>'+
      '<table><thead><tr><th>Operation</th><th>CT / sec</th><th>People</th><th>Unit labor / CNY</th></tr></thead><tbody>'+
      '<tr id="assembly-row"><td>'+link(path('/operations/assembly-01'),'Assembly · Station 01','assembly-link')+'</td><td>36</td><td>2</td><td>1.20</td></tr></tbody></table></section>';
    return '<div class="fp-columns fp-editor"><section class="fp-panel"><h2>Assembly · Station 01</h2><p>Design assumption · Sample source OP-01 · Outboard · Effective Year 1</p>'+
      '<label>Cycle Time (CT) '+info('ct')+'<input id="edit-ct" type="number" value="'+ct+'" min="1" max="60" step="1"></label>'+
      '<p>2 people · 100% labor efficiency · 1 good unit per cycle<br>60 CNY per labor hour · 10,000 units in Year 1</p>'+
      '<p>Baseline 30 sec · Current forecast 36 sec</p><div class="fp-actions"><button id="preview-change" class="fp-primary">Preview Change</button><button id="save-demo">Save Demo Draft</button></div>'+
      '<p id="draft-status" role="status">Sample editor · No pending changes</p></section><section class="fp-panel fp-impact"><h2>Change Impact</h2><p>Compare with <select id="compare-with"><option value="36">Before edit · F02</option><option value="30">Approved baseline · B01</option></select></p><div id="impact-output">Edit CT and select Preview Change.</div></section></div>';
  }
  function comparison() {
    return cash()+'<section class="fp-panel"><h2>Version Comparison</h2><p>'+escapeHtml(context().baseline)+' → '+escapeHtml(context().version)+' · Sample source reviews</p>'+
      '<table><thead><tr><th>Source</th><th>Profit change / CNY</th><th>Status</th></tr></thead><tbody>'+
      '<tr id="variance-labor"><td>'+link(path('/operations/assembly-01'),'Assembly CT · OP-01','variance-labor-link')+'</td><td class="fp-bad">−2,000.00</td><td>Unfavorable</td></tr>'+
      '<tr id="variance-dv"><td>'+link(path('/validation/dv-01'),'DV retest package · VAL-01','variance-dv-link')+'</td><td>0.00</td><td>Source review</td></tr></tbody></table></section>';
  }
  function validation(detail) {
    if(!detail) return '<section class="fp-panel"><h2>Validation & Certification</h2><p>Sample validation round · DV</p>'+link(path('/validation/dv-01'),'Open DV retest package · VAL-01','validation-link')+'</section>';
    return '<section class="fp-panel"><h2>DV Retest Package · VAL-01</h2><p>Sample source · DV round 2 · Includes 4 prototypes · Cost owner: Validation</p>'+
      '<label>Retest cost / CNY<input id="edit-retest" type="number" value="'+retest+'" min="0" max="100000" step="100"></label>'+
      '<div class="fp-actions"><button id="preview-validation" class="fp-primary">Preview Change</button><button id="save-demo">Save Demo Draft</button></div>'+
      '<div id="validation-impact" aria-live="polite">Before edit 2,000.00 CNY · Paid at Year 1 end in this sample.</div><p id="draft-status" role="status">Sample editor · No pending changes</p></section>';
  }
  function returns() {
    return '<section class="fp-panel"><h2>Project Returns</h2><p>Annual discount rate 10% · Year 0 is undiscounted</p>'+
      '<table><thead><tr><th>Period</th><th>Baseline cash flow / CNY</th><th>Forecast cash flow / CNY</th><th>Cumulative forecast / CNY</th></tr></thead><tbody>'+
      '<tr><td>Year 0</td><td>−100,000</td><td>−100,000</td><td>−100,000</td></tr>'+
      '<tr><td>Year 1 end</td><td>60,000</td><td>58,000</td><td>−42,000</td></tr><tr><td>Year 2 end</td><td>60,000</td><td>60,000</td><td>18,000</td></tr></tbody></table></section>'+cash();
  }
  function modulePage(section) {
    const title=modules.find(([id])=>id===section)?.[1] || 'Finance module';
    const examples={
      commercial:['Market / product','Unit price / CNY','Forecast units','Sample market · Outboard','20.00','10,000'],
      bom:['Material / source','Quantity per unit','Landed cost / CNY','Sample component · BOM-01','2','1.00'],
      'factory-costs':['Cost / source','Rate / CNY per unit','Period','Variable overhead · OH-01','0.50','Year 1'],
      engineering:['Role / source','Hours','Rate / CNY per hour','Application engineer · ENG-01','40','60.00'],
      prototypes:['Batch / source','Prototype count','Cost / CNY','Build 01 · PROTO-01','6','1,800.00'],
      investment:['Asset / source','Payment / CNY','Payment period','Assembly equipment · CAPEX-01','100,000.00','Year 0']
    };
    const row=examples[section];
    if(!row) return '<section class="fp-panel"><h2>Route unavailable</h2><p>Select a listed business module.</p></section>';
    return '<section class="fp-panel"><h2>'+title+'</h2><p>Illustrative source row · Fictional data for navigation review</p><table><thead><tr>'+row.slice(0,3).map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody><tr>'+row.slice(3).map(x=>'<td>'+x+'</td>').join('')+'</tr></tbody></table>'+link(path('/compare'),'Review Version Comparison →')+'</section>';
  }
  function render(restoring=false) {
    dirty=false;
    ct=36;
    retest=2000;
    const {project,section,row}=route();
    if(project) {
      try {
        const draft=JSON.parse(sessionStorage.getItem('p03-demo-'+project.id)||'null');
        if(draft?.source===section) {
          if(Number.isFinite(draft.ct)&&draft.ct>=1&&draft.ct<=60) ct=draft.ct;
          if(Number.isFinite(draft.retest)&&draft.retest>=0&&draft.retest<=100000) retest=draft.retest;
        }
      } catch { /* A missing or damaged browser draft starts with the sample defaults. */ }
    }
    loadedCt=ct;
    loadedRetest=retest;
    const content=location.pathname==='/finance'
      ? '<h1>Project Finance</h1><p>Select a website project to review the sample finance prototype.</p><div class="fp-projects">'+(projects.length?projects.map(p=>'<section class="fp-panel"><h2>'+escapeHtml(p.title)+'</h2><p>Sample finance · Existing project context</p>'+link(path('',p.id),'Open Finance Dashboard →','project-'+p.id)+'</section>').join(''):'<p>No projects are available in your current website context.</p>')+'</div>'
      : !project ? '<h1>Project unavailable</h1><p>This project is outside the visible project list.</p>'+link('/finance','Switch Project')
      : '<div class="fp-heading"><div><p>'+escapeHtml(project.title)+'</p><h1>'+escapeHtml(row?(section==='operations'?'Assembly · Station 01':'DV Retest Package'):section?modules.find(([id])=>id===section)?.[1]||'Version Comparison':'Project Finance Dashboard')+'</h1></div>'+
        '<div class="fp-actions">'+link('/finance','Switch Project','switch-project')+link('/#projects','Project Overview','project-overview')+'</div></div>'+
        filters()+'<nav class="fp-tabs">'+link(path(),'Overview','tab-overview')+link(path('/budget'),'Budget Execution','tab-budget')+link(path('/returns'),'Project Returns','tab-returns')+link(path('/compare'),'Version Comparison','tab-compare')+'</nav>'+
        (section?'<div class="fp-actions"><button id="fp-back">← '+(history.state?.origin?.url.includes('/compare')?'Back to Version Comparison':row?'Back to '+(section==='operations'?'Manufacturing & Labor':'Validation'):'Back to Finance Dashboard')+'</button>'+link(path(),'Finance Dashboard','back-dashboard')+'</div>':'')+
        (section==='operations'?operations(row):section==='validation'?validation(row):section==='compare'?comparison():section==='returns'?returns():section==='budget'?budget():section?modulePage(section):dashboard());
    root.innerHTML='<div class="fp"><aside class="fp-sidebar"><a class="fp-brand" href="/#projects">Project Station</a>'+link('/#projects','Project Overview')+link('/finance','Project Finance','','fp-active')+
      '<p>Financial Reports</p>'+(project?link(path('/budget'),'Budget Execution')+link(path('/returns'),'Project Returns')+link(path('/compare'),'Version Comparison')+
      '<a href="/projects/'+encodeURIComponent(project.id)+'/timing">Timing ↗</a>':'')+'<small>Sample workspace · P03</small></aside>'+
      '<div class="fp-shell"><header class="fp-header">Project Station / Project Finance <span class="fp-badge">SAMPLE DATA · P03</span></header>'+
      '<main class="fp-main"><div class="fp-sample">Sample data · Interactive review · Demo drafts stay in this browser session</div>'+content+
      '<footer>Sample full-cost basis · English interface · P02 layout A</footer></main></div>'+
      '<div id="fp-tooltip" class="fp-tooltip" role="tooltip" hidden></div>'+
      '<dialog id="fp-discard"><h2>Unsaved changes</h2><p>Discard the candidate changes and leave this source?</p><div class="fp-actions"><button data-keep>Keep Editing</button><button data-discard class="fp-primary">Discard Changes</button></div></dialog></div>';
    document.title='Project Finance · Sample · Project Station';
    drawCash();
    const state=history.state;
    requestAnimationFrame(()=>{
      if(restoring) {
        const node=state?.focusId && document.getElementById(state.focusId);
        node?.focus({preventScroll:true});
        window.scrollTo(0,state?.scrollY||0);
      } else {
        window.scrollTo(0,0);
        const title=root.querySelector('h1');
        title?.setAttribute('tabindex','-1');
        title?.focus({preventScroll:true});
      }
    });
  }
  function previewLabor() {
    const input=root.querySelector('#edit-ct');
    if(!input.checkValidity()) { input.reportValidity(); return; }
    const next=numbers(ct);
    const before=numbers(Number(root.querySelector('#compare-with').value));
    root.querySelector('#impact-output').innerHTML='<p>CT '+ct+' sec → Unit labor '+money(ct/30)+' CNY → Year 1 labor '+money(ct/30*10000)+' CNY</p>'+
      '<div class="fp-table-scroll"><table><thead><tr><th>Metric</th><th>Before</th><th>Candidate</th><th>Change</th></tr></thead><tbody>'+
      ['operating_profit','npv','irr','payback','funding'].map(key=>'<tr><td>'+dictionary[key][0]+'</td><td>'+money(before[key])+'</td><td>'+money(next[key])+'</td><td>'+money(next[key]-before[key])+(key==='irr'?' pp':'')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p class="'+(ct>Number(root.querySelector('#compare-with').value)?'fp-bad':'fp-good')+'">'+(ct>Number(root.querySelector('#compare-with').value)?'Unfavorable':'Favorable')+' · Sample calculation</p>';
  }
  root.addEventListener('click',event=>{
    const target=event.target.closest('a,button');
    if(!target) return;
    if(target.matches('[data-fp-link]')) {
      if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey) return;
      event.preventDefault();
      const url=new URL(target.href);
      if(url.pathname==='/'&&dirty) return askDiscard(()=>location.assign(target.href));
      if(url.pathname==='/') return location.assign(target.href);
      navigate(url.pathname+url.search);
    }
    if(target.id==='fp-back') back();
    if(target.id==='preview-change') previewLabor();
    if(target.id==='preview-validation') {
      const input=root.querySelector('#edit-retest');
      if(!input.checkValidity()) { input.reportValidity(); return; }
      const change=retest-2000;
      root.querySelector('#validation-impact').innerHTML='<p>Retest cost 2,000.00 → '+money(retest)+' CNY</p><p>Operating profit change '+money(-change)+' CNY · Year 1 cash flow change '+money(-change)+' CNY · NPV change '+money(-change/1.1)+' CNY</p>';
    }
    if(target.id==='save-demo') {
      const input=root.querySelector('#edit-ct,#edit-retest');
      if(!input.checkValidity()) {input.reportValidity(); return;}
      sessionStorage.setItem('p03-demo-'+route().project.id, JSON.stringify({ct,retest,source:route().section}));
      loadedCt=ct;
      loadedRetest=retest;
      dirty=false;
      root.querySelector('#draft-status').textContent='Demo draft saved in this browser session.';
    }
    if(target.dataset.help) showHelp(target,true);
  },{signal});
  root.addEventListener('input',event=>{
    if(!['edit-ct','edit-retest'].includes(event.target.id)) return;
    const input=event.target;
    if(!input.validity.valid || !input.value) {
      dirty=true;
      root.querySelector('#draft-status').textContent='Unsaved candidate · Enter a valid value to preview.';
      return;
    }
    if(input.id==='edit-ct') ct=Number(input.value); else retest=Number(input.value);
    dirty=ct!==loadedCt || retest!==loadedRetest;
    root.querySelector('#draft-status').textContent=dirty?'Unsaved candidate changes':'Sample editor · No pending changes';
  },{signal});
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-filter]')) {
      const params=new URLSearchParams(context());
      params.set(event.target.dataset.filter,event.target.value);
      navigate(location.pathname+'?'+params);
    }
    if(event.target.id==='compare-with') previewLabor();
  },{signal});

  let helpTrigger;
  let helpPinned=false;
  let restoringHelpFocus=false;
  function showHelp(trigger,pin=false) {
    if(pin && helpTrigger===trigger && helpPinned) return hideHelp(true);
    if(helpTrigger) helpTrigger.setAttribute('aria-expanded','false');
    helpTrigger=trigger;
    helpPinned=pin;
    const [title,definition,example]=dictionary[trigger.dataset.help];
    const tooltip=root.querySelector('#fp-tooltip');
    tooltip.innerHTML='<strong>'+title+'</strong><p>'+definition+'</p><p>'+example+'</p><button id="close-help">Close</button>';
    tooltip.hidden=false;
    trigger.setAttribute('aria-expanded','true');
    trigger.setAttribute('aria-describedby','fp-tooltip');
    const rect=trigger.getBoundingClientRect();
    tooltip.style.left=Math.max(8,Math.min(rect.left,innerWidth-336))+'px';
    tooltip.style.top=Math.max(8,Math.min(rect.bottom+8,innerHeight-260))+'px';
  }
  function hideHelp(restore=false) {
    root.querySelector('#fp-tooltip').hidden=true;
    helpTrigger?.setAttribute('aria-expanded','false');
    helpTrigger?.removeAttribute('aria-describedby');
    if(restore) {
      restoringHelpFocus=true;
      helpTrigger?.focus();
      restoringHelpFocus=false;
    }
    helpTrigger=undefined;
    helpPinned=false;
  }
  root.addEventListener('mouseover',event=>{
    const trigger=event.target.closest('[data-help]');
    if(trigger && !helpPinned) showHelp(trigger);
  },{signal});
  root.addEventListener('mouseout',event=>{
    if(helpPinned) return;
    const next=event.relatedTarget;
    if(!next?.closest?.('.fp-help-wrap,#fp-tooltip')) hideHelp();
  },{signal});
  root.addEventListener('focusin',event=>{
    if(!restoringHelpFocus && event.target.matches('[data-help]')) showHelp(event.target);
  },{signal});
  root.addEventListener('focusout',event=>{
    if(!helpPinned && !event.relatedTarget?.closest?.('#fp-tooltip')) hideHelp();
  },{signal});
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape' && helpTrigger) {event.preventDefault();hideHelp(true);}
  },{signal});
  root.addEventListener('click',event=>{
    if(event.target.id==='close-help') hideHelp(true);
    else if(!event.target.closest('[data-help],#fp-tooltip')) hideHelp();
  },{signal});
  function drawCash() {
    const canvas=root.querySelector('#fp-cash-canvas');
    if(!canvas) return;
    const width=canvas.parentElement.clientWidth, height=220;
    canvas.width=width*devicePixelRatio;
    canvas.height=height*devicePixelRatio;
    const ctx=canvas.getContext('2d');
    ctx.scale(devicePixelRatio,devicePixelRatio);
    const x=t=>50+t*(width-75)/2;
    const y=value=>20+(20000-value)/120000*165;
    ctx.font='12px "Segoe UI", sans-serif';
    for(const value of [-100000,-50000,0,20000]) {
      ctx.strokeStyle='#3a3b44';
      ctx.beginPath();ctx.moveTo(50,y(value));ctx.lineTo(width-25,y(value));ctx.stroke();
      ctx.fillStyle='#b6b8c2';ctx.fillText((value/1000)+'k',0,y(value)+4);
    }
    for(const [values,color,dash] of [[[-100000,-40000,20000],'#9699a6',[5,5]],[[-100000,-42000,18000],'#a59fff',[]]]) {
      ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.setLineDash(dash);ctx.beginPath();
      values.forEach((value,t)=>t?ctx.lineTo(x(t),y(value)):ctx.moveTo(x(t),y(value)));
      ctx.stroke();
    }
    ctx.setLineDash([]);ctx.fillStyle='#b6b8c2';
    ['Year 0','Year 1 end','Year 2 end'].forEach((label,t)=>{
      ctx.textAlign=t===2?'right':'center';ctx.fillText(label,x(t),212);
    });
  }
  window.addEventListener('resize',drawCash,{signal});
  render();
}
