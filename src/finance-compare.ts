import {amountCell,cashChart,escapeHtml as html,financeUrl,help,metricLabel} from '/finance-view.js';
import type {Dictionary,FinanceAmount,Workspace} from '/finance-view.js';

type Comparison=NonNullable<Workspace['comparisonReport']>;
type ComparisonData=NonNullable<Comparison['data']>;
type Bridge=NonNullable<ComparisonData['profit']>;
type Locator=NonNullable<Comparison['changes'][number]['before']>;
type Link=(href:string,title:string,id?:string)=>string;
const panel=(title:string,body:string)=>'<section class="fin-panel"><div class="fin-panel-head"><h2>'+title+'</h2></div>'+body+'</section>';
const table=(headers:string[],rows:string)=>
  '<div class="fin-table-scroll"><table class="fin-comparison-table"><thead><tr>'+headers.map(header=>'<th scope="col">'+header+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
const row=(name:string,cells:string[],className='')=>'<tr'+(className?' class="'+className+'"':'')+'><th scope="row">'+name+'</th>'+
  cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>';
const amounts=(metric:{before:FinanceAmount|null;after:FinanceAmount|null;delta:FinanceAmount})=>
  [amountCell(metric.before),amountCell(metric.after),amountCell(metric.delta,true)];
const selector=(label:string,key:string,rows:{key:string;label:string}[],selected:string|null,placeholder?:string)=>
  '<label>'+label+'<select id="fin-compare-'+key+'" data-filter-key="'+key+'">'+
  (placeholder?'<option value="">'+html(placeholder)+'</option>':'')+rows.map(item=>
    '<option value="'+html(item.key)+'"'+(selected===item.key?' selected':'')+'>'+html(item.label)+'</option>').join('')+'</select></label>';

export function comparisonFilters(workspace:Workspace,params:URLSearchParams){
  const comparison=workspace.comparisonReport,versions=workspace.versions.map(version=>({key:version.id,label:version.name+
    (version.status==='draft'?(version.id===workspace.currentVersionId?' · Current draft':' · Draft'):' · Frozen')}));
  const pick=(key:string,id:string|undefined)=>{
    const value=params.get(key)??id??null;
    return selector(key==='from'?'Before version':'After version',key,versions,value,value&&!versions.some(row=>row.key===value)?'Select an available version':undefined);
  };
  if(!versions.length)return '';
  return '<div class="fin-filters">'+pick('from',comparison?.before.id)+pick('to',comparison?.after.id)+
    (comparison?selector('Through period','cutoff',comparison.periods,comparison.cutoff)+
      selector('Product','compareProduct',comparison.products,comparison.product,'All products'):'')+'</div>';
}

export function comparisonReturn(base:string,params:URLSearchParams) {
  const q=new URLSearchParams();
  for(const key of ['from','to','cutoff','compareProduct','baseline','compareExample']){
    const value=params.get(key);if(value)q.set(key,value);
  }
  return base+'/compare'+(q.size?'?'+q:'');
}

export function comparisonPage(comparison:Comparison|null,base:string,params:URLSearchParams,dictionary:Dictionary){
  if(!comparison)return panel('Select two versions','<p class="fin-muted">Choose an available Before and After version for this project.</p>');
  const {data,before,after,currency,cutoff,periods,products}=comparison;
  const periodLabel=(key:string)=>periods.find(period=>period.key===key)?.label??key;
  const productLabel=(key:string)=>products.find(product=>product.key===key)?.label??key;
  const versionName=(version:typeof before)=>html(version.name)+' <small class="fin-state">'+
    (version.status==='frozen'?'Frozen':'Draft')+' · Revision '+version.revision+' · As of '+html(version.asOf)+' · '+html(version.currency)+'</small>';
  const scope='<div class="fin-compare-versions"><div><span>Before</span><strong>'+versionName(before)+'</strong></div>'+
    '<div><span>After</span><strong>'+versionName(after)+'</strong></div></div>'+
    '<p class="fin-muted">Changes are After minus Before.'+(cutoff?' Cash valuation and operating results cover Year 0 through '+html(periodLabel(cutoff))+'.':'')+
    (data?' Reporting currency '+html(currency)+'.':'')+'</p>';
  if(!data)return panel('Comparison scope',scope+'<p role="status">'+html(comparison.reason)+'</p>');

  const sourceLink=(location:Locator,side:'before'|'after',id:string,link:Link=financeUrl)=>{
    const version=side==='before'?before:after,next=new URLSearchParams(params);
    for(const key of ['period','product','market','part','rows','basis'])next.delete(key);
    next.set('version',version.id);
    if(location.product)next.set('product',location.product);
    if(location.period)next.set('period',location.period);
    if(location.market)next.set('market',location.market);
    next.set('traceKind',location.kind);next.set('traceKey',location.key);next.set('traceRevision',String(version.revision));
    if(location.period)next.set('tracePeriod',location.period);
    next.set('compareReturn','1');
    return link(base+'/'+location.route+(location.row?'/'+location.row:'')+'?'+next,
      (side==='before'?'Before':'After')+' · '+location.label+(location.reference?' · '+location.reference:''),id);
  };
  const measureHeaders=['Metric','Before','After','Change'];
  const metrics=panel('Version totals',scope+table(measureHeaders,Object.entries(data.metrics)
    .map(([key,metric])=>row(metricLabel(dictionary,key),amounts(metric))).join('')));
  const running=(bridge:Bridge)=>{
    let step=Number(bridge.metric.before?.value??0);
    const start=step,values=bridge.byDriver.map(driver=>{const from=step;step+=Number(driver.value.value);return [from,step];});
    const low=Math.min(0,start,...values.flat()),high=Math.max(0,start,...values.flat());
    return values.map(([a,z])=>({left:100*(Math.min(a,z)-low)/(high-low||1),width:100*Math.abs(z-a)/(high-low||1)}));
  };
  const bridgePanel=(kind:'profit'|'npv',title:string,bridge:Bridge|null)=>{
    if(!bridge)return panel(title,'<p class="fin-muted">A comparable total is unavailable for this scope. See the statuses in Version totals and the period table.</p>');
    const bars=running(bridge);
    const rows=bridge.byDriver.map((driver,i)=>{
      const details=driver.details.map((detail,j)=>{
        const prefix='bridge-'+kind+'-'+driver.key+'-'+j;
        const refs=(items:Locator[],side:'before'|'after')=>items
          .map((location,k)=>sourceLink(location,side,prefix+'-'+side+'-'+k)).join('');
        return row(html(productLabel(detail.product))+' · '+html(periodLabel(detail.period)),
          [amountCell(detail.value,true),'<div class="fin-compare-source-links">'+refs(detail.before,'before')+refs(detail.after,'after')+'</div>']);
      }).join('');
      return row('<details><summary>'+html(driver.label)+'</summary>'+help(dictionary,driver.key)+
        '<ul class="fin-product-delta">'+driver.products.map(item=>'<li>'+html(productLabel(item.key))+' '+amountCell(item.value,true)+'</li>').join('')+'</ul>'+
        table(['Product and period','Contribution','Sources'],details)+'</details>',
        ['<div class="fin-waterfall-track" aria-hidden="true"><span class="'+(Number(driver.value.value)<0?'is-negative':'')+'" style="--left:'+
          bars[i].left+'%;--width:'+bars[i].width+'%"></span></div>',amountCell(driver.value,true)]);
    }).join('');
    const roundoff=Number(bridge.roundoff.value)?row('Display rounding '+help(dictionary,'display_rounding'),['',amountCell(bridge.roundoff,true)]):'';
    return panel(title,table(['Driver','Bridge position','Amount'],row('Before',['',amountCell(bridge.metric.before)])+
      (rows||row('No movement',['',html(currency)]))+roundoff+row('Total change',['',amountCell(bridge.metric.delta,true)],'fin-compare-total')+
      row('After',['',amountCell(bridge.metric.after)]))+
      '<p class="fin-muted" role="status">'+(bridge.reconciled?'Driver contributions reconcile to the version change.':'Driver contributions do not reconcile.')+
      (bridge.unexplained?' An unexplained residual is listed above.':'')+'</p>'+
      (bridge.products.length?'<details class="fin-product-totals"><summary>Net contribution by product</summary>'+
        table(['Product','Net contribution'],bridge.products.map(item=>row(html(productLabel(item.key)),[amountCell(item.value,true)])).join(''))+'</details>':''));
  };

  const chart=panel('Cumulative Cash Flow','<div class="fin-chart fin-compare-cash"><div class="fin-chart-legend">'+
    '<span class="fin-series-0">Before · '+html(before.name)+'</span><span class="fin-series-1">After · '+html(after.name)+'</span><span>'+
    html(currency)+'</span></div><canvas role="img"></canvas></div>');
  const periodRows=data.periodic.map(item=>row(html(periodLabel(item.period)),[
    ...amounts(item.metrics.reported_profit),...amounts(item.metrics.cash_flow),...amounts(item.metrics.cumulative_cash),...amounts(item.metrics.present_value)
  ])).join('');
  const headers=['Period',...[['Profit','reported_profit'],['Cash','cash_flow'],['Cumulative cash','cumulative_cash'],['Present value','present_value']]
    .flatMap(([label,key])=>[label+' before '+help(dictionary,key),label+' after','Δ '+label])];
  const budget=panel('Budget execution · project ledger','<p class="fin-muted">Budget figures use each selected version’s recorded execution cutoff and project scope.</p>'+
    table(measureHeaders,Object.entries(data.budget).map(([key,metric])=>row(metricLabel(dictionary,key),amounts(metric))).join('')));
  const changeRows=comparison.changes.map((change,i)=>{
    const location=change.after??change.before!;
    const allFields=change.fields.map(field=>{
      const delta=field.percentagePoints!==null?' · '+field.percentagePoints+' pp':'';
      return '<li>'+html(field.key)+' · '+html(field.before??'—')+' → '+html(field.after??'—')+html(delta)+'</li>';
    }).join('');
    return row('<details><summary>'+html(location.label)+'</summary><ul>'+allFields+'</ul></details>',
      [html(location.period?periodLabel(location.period):'Version scope'),
        change.scope==='evidence'?'Evidence only · 0 financial change':change.scope==='capacity'?'Capacity only · 0 financial change':'Business or ledger input',
        change.before?sourceLink(change.before,'before','change-before-'+i):'—',
        change.after?sourceLink(change.after,'after','change-after-'+i):'—']);
  }).join('');
  const sources=panel('Changed version records','<p class="fin-muted">Records include saved assumptions and evidence across the selected versions. The bridges use the valuation period shown above.</p>'+
    (changeRows?table(['Record','Source period','Impact scope','Before source','After source'],changeRows):
      '<p class="fin-muted">There are no changed records in this selection.</p>'));
  return metrics+
    '<p class="fin-muted">Volume or hours at the Before rate, then rate at the Before quantity, then their joint effect. Cash timing pairs offsetting movements on the same source. NPV values cash changes at the Before rate, then applies the After discount rate to After cash. IRR and other returns use each complete cash series through the selected period.</p>'+
    bridgePanel('profit',(data.profitKey==='cqa.mpbitri'?'CQA MPBITRI':'Operating Profit')+' Bridge',data.profit)+
    bridgePanel('npv','NPV Bridge',data.npv)+chart+panel('Period values',table(headers,periodRows))+sources+budget;
}

export function mountComparisonChart(root:HTMLElement,comparison:Comparison|null){
  const chart=root.querySelector<HTMLElement>('.fin-compare-cash'),data=comparison?.data;
  if(!comparison||!chart||!data)return ()=>{};
  const values=(side:'before'|'after')=>data.periodic.map(item=>{
    const value=item.metrics.cumulative_cash[side]?.value;
    return value==null?null:Number(value);
  });
  const clean=cashChart(chart,[{name:comparison.before.name,values:values('before')},{name:comparison.after.name,values:values('after')}],
    data.periodic.map(row=>comparison.periods.find(period=>period.key===row.period)?.label??row.period),comparison.currency);
  chart.querySelector('canvas')?.setAttribute('aria-label','Cumulative cash flow, '+comparison.currency+'. Exact values are in Period values.');
  return clean;
}

export function comparisonSource(workspace:Workspace,requested:boolean){
  if(!requested)return '';
  const source=workspace.sourceTrace;
  if(!source)return panel('Comparison source','<p role="status">The exact source record is unavailable in this revision.</p>');
  const {record,link}=source,version=workspace.current?.details??workspace.baseline?.details;
  const info=[['Version',version?.name],['Revision',version?.revision],['Record key',record.rowKey],['Source key',record.sourceKey],
    ['Source reference',record.reference],['Period',record.period],['Product',record.product],['Market',record.market],['Stored value',record.value],
    ['Source system',record.system],['Owner',record.owner],['Observation',record.observation],['Original formula',record.formula]];
  return panel('Comparison source',
    (workspace.sourceRevisionChanged?'<p role="status">This draft has changed since the comparison. The source below reflects the displayed revision.</p>':'')+
    '<h3>'+html(link.label)+'</h3><dl class="fin-compare-record">'+info.filter(([,value])=>value!=null).map(([label,value])=>
      '<div><dt>'+label+'</dt><dd>'+html(value)+'</dd></div>').join('')+'</dl>'+
    (record.fields?'<details open><summary>Source fields</summary><pre tabindex="0">'+html(JSON.stringify(record.fields,null,2))+'</pre></details>':''));
}
