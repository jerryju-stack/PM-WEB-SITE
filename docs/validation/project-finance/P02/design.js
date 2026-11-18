const $ = selector => document.querySelector(selector);
const fmt = (v, digits=2) => v.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
function npv(cash) { return cash.reduce((sum, value, t) => sum + value / 1.1 ** t, 0); }
function irr(cash) {
  let lo=-0.99, hi=2;
  for(let i=0;i<100;i++) {
    const r=(lo+hi)/2;
    const value=cash.reduce((sum,x,t)=>sum+x/(1+r)**t,0);
    if(value>0) lo=r; else hi=r;
  }
  return (lo+hi)/2*100;
}
function result(ct) {
  const cost=(ct-30)*1000/3;
  const cash=[-100000,60000-cost,60000];
  return {revenue:300000,operating_profit:24000-cost,operating_margin:(24000-cost)/3000,
    npv:npv(cash),irr:irr(cash),payback_period:1+(40000+cost)/60000,
    peak_funding_requirement:100000,cash,cost};
}
const baseline=result(30), current=result(36);
const groups=FIXTURE.groups;
function metrics() {
  return groups.map(g=>{
    const k=g.metrics[0], m=FIXTURE.metrics[k];
    const unit=k==='irr'?'%':k==='payback_period'?'years':'CNY';
    const delta=current[k]-baseline[k];
    const beneficial=k==='payback_period'||k==='peak_funding_requirement'?delta<0:delta>0;
    const change=delta===0?'No change':(beneficial?'Favorable ':'Unfavorable ')+(delta>0?'+':'−')+fmt(Math.abs(delta))+(k==='irr'?' pp':k==='payback_period'?' years':' CNY');
    return '<article class="metric" data-metric="'+k+'"><div class="metric-title">'+m.en+' <button class="info" data-info="'+k+'" aria-label="'+m.en+' definition">i</button></div><div class="value">'+fmt(current[k])+'<span class="unit">'+unit+'</span></div><div class="base">Baseline '+fmt(baseline[k])+(k==='irr'?'%':'')+'</div><div class="delta '+(delta===0?'neutral':beneficial?'good':'bad')+'">'+change+(k==='operating_profit'?'<br>Margin '+fmt(current.operating_margin)+'% · <span class="bad">−0.67 pp</span>':k==='peak_funding_requirement'?' · First at Year 0':'')+'</div></article>';
  }).join('');
}
const modules=['Commercial & Volume','BOM & Purchasing','Manufacturing & Labor','Factory Costs & Launch','Engineering & PM Hours','Prototypes & Builds','Validation & Certification','Equipment & Investment','Working Capital & Returns','Budget & Versions'];
function moduleTiles(){return modules.map((m,i)=>'<button data-module="'+i+'">'+m+'<small>'+['Volume · Pricing · Reductions','Quantity · Landed cost · Tooling','Staffing · CT · Line balance','Rates · Launch · Allocation','Roles · Hours · Rates','Batches · Quantity · Delivery','DV / PV · Cost coverage','Capex · Payments · Recovery','Working capital · Tax · Discount rate','Actuals · ETC · Variance'][i]+' ↗</small></button>').join('')}
function cashPanel(){return '<section class="panel"><div class="panelhead"><h2>Cumulative Project Cash Flow</h2><div class="legend"><span>Approved baseline</span><span>Current forecast</span></div></div><div class="chart"><canvas aria-label="Cumulative cash flow in CNY. Baseline: −100,000, −40,000, 20,000. Forecast: −100,000, −42,000, 18,000." role="img"></canvas></div><div class="chartnotes"><span>Lowest balance CNY −100,000.00 · Year 0</span><span>First payback 1.70 years</span></div></section>'}
function variancePanel(){return '<section class="panel"><div class="panelhead"><h2>Changes vs. Approved Baseline</h2><button data-action="preview">View Impact ↗</button></div><table><thead><tr><th>Change driver</th><th>Profit change / CNY</th></tr></thead><tbody><tr><td><button class="rowlink" data-action="preview">Assembly CT 30 → 36 sec</button></td><td class="bad">−2,000.00 Unfavorable</td></tr><tr><td>Volume & pricing</td><td class="neutral">0.00 No change</td></tr><tr><td>Materials & other</td><td class="neutral">0.00 No change</td></tr><tr><td>Total change</td><td class="bad">−2,000.00</td></tr></tbody></table><p style="margin-top:16px">NPV decreases by <span class="bad">1,818.18 CNY</span>. Labor payments increase in Year 1.</p></section>'}
function budgetPanel(){return '<section class="panel" id="budget"><div class="panelhead"><h2>Budget Execution</h2><button data-report="budget">View Report ↗</button></div><div class="budgetgrid"><div><span class="muted">Approved budget</span><b>100,000</b></div><div><span class="muted">Confirmed actuals</span><b>40,000</b></div><div><span class="muted">Estimate to complete (ETC)</span><b>52,000</b></div><div><span class="muted">Forecast surplus</span><b class="good">8,000</b></div></div><div class="progress"><i></i></div><span class="muted">CNY · EAC 92,000 · Budget less confirmed actuals 60,000</span></section>'}
function callout(){return '<div class="impact-call"><div><strong>Assembly CT increases by 6 seconds</strong><p>Unit labor +CNY 0.20 → Operating profit −CNY 2,000 → NPV −CNY 1,818.18</p></div><button class="primary" data-action="preview">Preview Change</button></div>'}
function waterfall(){return '<section class="panel"><div class="panelhead"><h2>Operating Profit Bridge</h2><span class="muted">Amount / CNY</span></div><div class="waterfall" role="img" aria-label="Baseline profit 24,000. Additional labor reduces profit by 2,000. Forecast profit 22,000."><div class="bar-wrap"><div class="bar"><span>24,000</span></div><div class="bar-name">Approved baseline</div></div><div class="bar-wrap"><div class="bar negative"><span class="bad">−2,000</span></div><div class="bar-name">Manufacturing labor</div></div><div class="bar-wrap"><div class="bar end"><span>22,000</span></div><div class="bar-name">Current forecast</div></div></div><div class="chartnotes"><span>Explained −2,000.00</span><span>Unexplained 0.00</span></div>'+callout()+'</section>'}
const design=document.body.dataset.design;
$('#metrics').innerHTML=metrics();
if(design==='A') $('#analysis').innerHTML='<div class="split">'+cashPanel()+variancePanel()+'</div>'+budgetPanel();
if(design==='B') $('#analysis').innerHTML='<div class="split">'+cashPanel()+budgetPanel()+'</div>'+callout();
if(design==='C') {$('#waterfall').innerHTML=waterfall()+cashPanel();$('#analysis').innerHTML='<div class="split">'+variancePanel()+budgetPanel()+'</div>';}
$('#modules').innerHTML=moduleTiles();
const dialog=$('#preview');
function openPreview() {
  $('#ct').value=36; updatePreview();
  if(!dialog.open)dialog.showModal();
}
function updatePreview() {
  const ct=Number($('#ct').value);
  if(!Number.isFinite(ct)||ct<1||ct>60){$('#preview-result').textContent='Enter a cycle time between 1 and 60 seconds.';return;}
  const next=result(ct);
  const dir=next.cost>0?'bad':next.cost<0?'good':'neutral';
  $('#preview-result').innerHTML='<div class="flow">CT '+fmt(ct,0)+' sec → Unit labor '+fmt(ct/30)+' CNY → Year 1 direct labor '+fmt(ct/30*10000)+' CNY</div><div class="scrolltable"><table><thead><tr><th>Metric</th><th>Before</th><th>Candidate</th><th>Change</th></tr></thead><tbody>'+[['operating_profit','Operating profit / CNY'],['npv','NPV / CNY'],['irr','IRR / %'],['payback_period','Payback / years'],['peak_funding_requirement','Peak funding / CNY']].map(([k,label])=>{const delta=next[k]-baseline[k];return '<tr><td>'+label+'</td><td>'+fmt(baseline[k])+'</td><td>'+fmt(next[k])+'</td><td class="'+(delta===0?'neutral':dir)+'">'+(delta>0?'+':'')+fmt(delta)+(k==='irr'?' pp':'')+'</td></tr>'}).join('')+'</tbody></table></div><p class="'+dir+'" style="margin-top:16px">'+(next.cost>0?'Unfavorable':next.cost<0?'Favorable':'No change')+' · Annual labor change '+fmt(next.cost)+' CNY. Revenue change CNY 0.00.</p>';
}
$('#ct').addEventListener('input',updatePreview);
document.addEventListener('click',e=>{
  const button=e.target.closest('button,a');
  if(!button)return;
  if(button.dataset.action==='preview')openPreview();
  if(button.dataset.close)button.closest('dialog').close();
  if(button.dataset.info){
    const m=FIXTURE.metrics[button.dataset.info];
    $('#detail-title').textContent=m.en;
    $('#detail-content').innerHTML='<p>'+m.definition+'</p><div class="flow">'+m.example+'</div><p>Fictional data. Annual discount rate 10%. Year 0 and two subsequent year-ends. Amounts in CNY.</p>';
    $('#detail').showModal();
  }
  if(button.dataset.module!==undefined){
    if(button.dataset.module==='2')return openPreview();
    $('#detail-title').textContent=modules[Number(button.dataset.module)];
    $('#detail-content').innerHTML='<p>This panel demonstrates the module entry.</p><p>Project: Sample Project · New Platform Assembly. Comparison: approved baseline B01 vs. current forecast F02.</p>';
    $('#detail').showModal();
  }
  if(button.dataset.report){
    e.preventDefault();const report=button.dataset.report;
    $('#detail-title').textContent={budget:'Budget Execution',returns:'Project Returns',compare:'Version Comparison'}[report];
    $('#detail-content').innerHTML=report==='budget'?budgetPanel():report==='returns'?'<div class="scrolltable"><table><thead><tr><th>Period</th><th>Baseline cash flow / CNY</th><th>Forecast cash flow / CNY</th></tr></thead><tbody><tr><td>Year 0</td><td>−100,000</td><td>−100,000</td></tr><tr><td>Year 1 end</td><td>60,000</td><td>58,000</td></tr><tr><td>Year 2 end</td><td>60,000</td><td>60,000</td></tr></tbody></table></div>':variancePanel();
    $('#detail').showModal();
  }
});
function draw() {
  for(const canvas of document.querySelectorAll('canvas')){
    const w=canvas.clientWidth,h=canvas.clientHeight;
    canvas.width=w*devicePixelRatio;canvas.height=h*devicePixelRatio;
    const ctx=canvas.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);
    const left=54,right=w-20,top=26,bottom=h-32;
    const y=v=>top+(20000-v)/120000*(bottom-top), x=t=>left+t*(right-left)/2;
    ctx.font='12px "Segoe UI","Microsoft YaHei",sans-serif';
    [-100000,-50000,0,20000].forEach(value=>{
      ctx.strokeStyle=value===0?'#64606e':'#303138';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(left,y(value));ctx.lineTo(right,y(value));ctx.stroke();
      ctx.fillStyle='#9699a6';ctx.fillText(value===0?'0':(value/1000)+'k',4,y(value)+4);
    });
    [[[-100000,-40000,20000],'#9699a6',true],[[-100000,-42000,18000],'#a59fff',false]].forEach(([values,color,dash])=>{
      ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.setLineDash(dash?[5,5]:[]);
      ctx.beginPath();values.forEach((v,t)=>t?ctx.lineTo(x(t),y(v)):ctx.moveTo(x(t),y(v)));ctx.stroke();ctx.setLineDash([]);
      values.forEach((v,t)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(t),y(v),3.5,0,Math.PI*2);ctx.fill()});
    });
    ctx.fillStyle='#b6b8c2';['Year 0','Year 1 end','Year 2 end'].forEach((label,t)=>{ctx.textAlign=t===2?'right':'center';ctx.fillText(label,x(t),h-8)});
  }
}
new ResizeObserver(draw).observe($('#analysis')); draw();
