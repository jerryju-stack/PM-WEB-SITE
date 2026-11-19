import {escapeHtml as html,financeUrl,help} from '/finance-view.js';
import type {Dictionary} from '/finance-view.js';
import type {OperationEditor} from '/finance-impact.js';
import type {operationsWorkspace} from '../lib/finance-operations-calculation.ts';
import {currencyOptions} from '/finance-fx.js';

type Scope=NonNullable<ReturnType<typeof operationsWorkspace>>[number];
type Source=Scope['records'][number];
type RecordLink=(scope:Pick<Scope,'productKey'|'period'>,source?:string,view?:OperationsView)=>string;
type LinkedAssets=(scope:Scope,line:string)=>{href:string;title:string}[];
const missing='Unavailable';
const text=(value:string|null|undefined)=>html(value??missing);
const cell=(value:string|null|undefined)=>'<td>'+text(value)+'</td>';
const display=(value:string|null,suffix:string)=>value===null?missing:html(value)+suffix;
const name=(item:Source)=>item.record.type==='design'?'Design '+item.record.revision:
  (item.record.stage==='pilot'?'Pilot':'Production')+' · '+item.record.batch+' · '+item.record.date+' · Rev '+item.record.revision;
const table=(head:string[],rows:string,label='')=>'<div class="fin-table-scroll'+(label?' fin-annual-scroll fin-op-scroll" tabindex="0" role="region" aria-label="'+html(label):'')+'"><table><thead><tr>'+head.map(title=>'<th scope="col">'+title+'</th>').join('')+
  '</tr></thead><tbody>'+rows+'</tbody></table></div>';

function renderSource(scope:Scope,item:Source,dictionary:Dictionary,link:RecordLink,linkedAssets:LinkedAssets) {
  const {record}=item;
  const measured=record.type==='actual',design=scope.records.find(row=>row.key===item.designKey);
  return '<h3>'+html(name(item))+'</h3><p>Reviewer '+html(record.reviewer)+' · Evidence '+html(record.reference)+'</p>'+
    (measured?'<p>Referenced design '+(design?financeUrl(link(scope,design.key),name(design),'referenced-design-'+item.key):html(item.designKey))+
      ' · '+html(record.personHours)+' person-hours · '+html(record.goodPieces)+' good pieces</p>':'')+
    '<p>Person-hours per good piece '+help(dictionary,'person_hours_per_piece')+' <strong>'+text(item.personHours)+'</strong> · Modeled route labor '+help(dictionary,'route_labor')+' <strong>'+text(item.modeledLabor)+' '+html(scope.currency)+'/piece</strong></p>'+
    (item.issues.length?'<ul class="fin-op-issues">'+item.issues.map(issue=>'<li>'+html(issue)+'</li>').join('')+'</ul>':'')+
    '<details class="fin-op-archive"><summary>Calculation basis</summary><p>Station load is CT × repeats ÷ units per cycle. Demand takt uses allocated net time and demand. '+
    'Line balance uses the number of stations and the bottleneck load. Capacity applies the equipment loss factor once. '+
    'Design labor uses independent labor efficiency. Measured labor uses actual person-hours divided by good pieces.</p></details>'+
    '<div class="fin-op-lines">'+item.lines.map(line=>{
      const equipment=linkedAssets(scope,line.line);
      return '<section class="fin-op-line"><h4>'+html(line.line)+(line.shared?' · Shared line':'')+'</h4>'+
      '<p>Equipment · '+(equipment.length?equipment.map((asset,index)=>financeUrl(asset.href,asset.title,
        'route-equipment-'+item.key+'-'+line.line+'-'+index)).join(' · '):'No linked asset in this version.')+'</p>'+
      '<p>'+html(line.shifts)+' shifts/day × '+html(line.hours)+' net hours/shift × '+html(line.days)+' days · Allocated share '+html(line.allocation)+help(dictionary,'allocated_line_share')+
      ' · '+(measured?'Measured availability × quality ':'Equipment OEE ')+text(line.factor)+help(dictionary,measured?'measured_capacity_factor':'oee')+'</p>'+
      '<dl class="fin-op-metrics"><div><dt>Demand takt '+help(dictionary,'demand_takt')+'</dt><dd>'+display(line.takt,' s/piece')+'</dd></div>'+
      '<div><dt>Bottleneck load '+help(dictionary,'bottleneck_load')+'</dt><dd>'+display(line.constraint,' s/piece')+'</dd></div><div><dt>Line balance '+help(dictionary,'line_balance')+'</dt><dd>'+display(line.balance,'%')+'</dd></div>'+
      '<div><dt>Effective capacity '+help(dictionary,'effective_capacity')+'</dt><dd>'+display(line.capacity,' good pieces/period')+'</dd></div></dl>'+
      table(['Station / operation',(measured?'Design operators':'Operators')+' '+help(dictionary,'people'),'CT s/cycle '+help(dictionary,'ct'),'Units/cycle '+help(dictionary,'units_per_cycle'),'Repeats/piece '+help(dictionary,'cycles_per_unit'),'Labor efficiency '+help(dictionary,'labor_efficiency'),'Load s/piece','Against takt'],line.stations.map((station)=>
        '<tr><th scope="row">'+html(station.station)+'<small class="fin-state">'+html(station.operation)+'</small></th>'+
        cell(station.people)+cell(station.observedCt)+cell(station.output)+cell(station.repeats)+cell(measured?'Captured in actual hours':station.efficiency)+
        cell(station.normalized)+'<td>'+html(station.overTakt===null?'Unavailable':station.overTakt?'Over takt':'Within takt')+
        (station.bottleneck?'<strong class="fin-state">Bottleneck</strong>':'')+'</td></tr>').join(''))+'</section>';
    }).join('')+'</div>';
}

export type OperationsView='stations'|'annual'|'routes';
type OperationPageOptions={
  source:string;view:OperationsView;periodLabel:string;periods:{key:string;label:string}[];
  canOperate:boolean;canCalibrate:boolean;draft:boolean;dictionary:Dictionary;linkedAssets:LinkedAssets;
};
const selectedRecord=(scope:Scope)=>scope.records.find(record=>record.key===scope.selectedKey);
const shownDesign=(scope:Scope)=>selectedRecord(scope)??scope.records.find(record=>record.record.type==='design');
const numbering=new Intl.NumberFormat('en');
const amount=(value:number,places:number)=>new Intl.NumberFormat('en',{minimumFractionDigits:places,maximumFractionDigits:places}).format(value);
const percentages=new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:2});
const percentage=(value:string|null|undefined)=>value==null?missing:percentages.format(Number(value));

function stationOverview(scopes:Scope[],link:RecordLink,periodLabel:string) {
  const rows=scopes.flatMap(scope=>{
    const shown=shownDesign(scope),rate=scope.hourlyRate??scope.archive?.rate.value??null;
    const product=(first:boolean)=>financeUrl(link(scope),scope.label,first?'operations-product-'+scope.productKey:'');
    const unitCost=Number(scope.demand)===0&&scope.demand!==null?'—':scope.currentUnitLabor;
    const laborCells=[rate===null?null:amount(Number(rate),4),unitCost];
    if(shown){
      const record=shown.record,measured=record.type==='actual';
      const origin=(shown.key===scope.selectedKey?'':'Reference · ')+(measured?'Measured · '+record.date:'Design · '+record.revision);
      return shown.lines.flatMap(line=>line.stations.map(station=>
        '<tr><th scope="row">'+product(line===shown.lines[0]&&station===line.stations[0])+
        '<small class="fin-state">'+financeUrl(link(scope,shown.key),station.operation,'operation-'+scope.productKey+'-'+station.station)+'</small>'+
        '<small class="fin-state">'+html(line.line)+(line.shared?' · Shared line':'')+'</small></th>'+
        [measured?'—':station.people,measured?station.observedCt:station.ct,station.repeats,
          measured&&line.factor!==null?percentage(line.factor)+' A × Q':percentage(measured?null:line.oee),measured?'Actual hours':percentage(station.efficiency),
          ...laborCells,origin].map(cell).join('')+'</tr>'));
    }
    return scope.archive?.operations.map((row,index)=>'<tr><th scope="row">'+product(index===0)+
      '<small class="fin-state">'+financeUrl(link(scope),row.line)+(row.shared?' · Shared line':'')+'</small></th>'+
      [row.people.value,row.ct.value,row.repeats,percentage(row.oee?.value),percentage(row.efficiency.value),...laborCells,'Archived design']
        .map(cell).join('')+'</tr>')??[];
  });
  const total=(values:(string|null)[])=>values.length&&values.every(value=>value!==null)?
    values.reduce((sum,value)=>sum+Number(value),0):null;
  const direct=total(scopes.map(scope=>scope.laborTotal)),volume=total(scopes.map(scope=>scope.demand));
  const batches=scopes.reduce((sum,scope)=>sum+scope.records.filter(item=>item.record.type==='actual').length,0);
  const selectedMeasured=scopes.filter(scope=>selectedRecord(scope)?.record.type==='actual').length;
  const currency=scopes[0]?.currency??'';
  const cards=[
    ['Direct labor cost',direct===null?'—':amount(direct,2),currency+' · '+periodLabel],
    ['Weighted labor per piece',direct===null||volume===null||volume===0?'—':amount(direct/volume,4),
      volume===0?'No forecast volume':currency+' / good piece · '+periodLabel],
    ['Product operations',numbering.format(rows.length),periodLabel+' · product route steps'],
    ['Measured batches',batches?numbering.format(batches):volume===0?'No production':'Pending',
      batches?(selectedMeasured===1?'1 product uses measured labor':numbering.format(selectedMeasured)+' products use measured labor'):
        'No recorded batches for this scope']
  ];
  const summary='<div class="fin-metrics fin-overview-metrics" aria-label="Manufacturing summary">'+cards.map(([label,value,caption])=>
    '<section class="fin-metric"><div class="fin-metric-label">'+html(label)+'</div><div class="fin-summary-value"><strong class="fin-value">'+
    html(value)+'</strong></div><small class="fin-state">'+html(caption)+'</small></section>').join('')+'</div>';
  const body='<section class="fin-panel fin-business-overview fin-op-overview"><h2>Operations and direct labor</h2>'+
    '<p class="fin-muted">'+html(periodLabel)+' · '+html(currency)+' · Select a product for route and batch records, or a station to open its evidence.</p>'+
    (rows.length?table(['Product / operation','Operators','CT (s/cycle)','Cycles / piece',selectedMeasured?'Equipment OEE / A × Q':'Equipment OEE','Labor efficiency',
      'Rate / person-hour','Labor / good piece','Evidence basis'],rows.join(''),'Product operations and cycle times')+
      (selectedMeasured?'<p class="fin-muted">A × Q is measured availability × quality. Measured route labor uses actual person-hours.</p>':''):
      '<p class="fin-muted">No station assumptions are recorded for this period. Route records and legacy inputs can be reviewed separately.</p>')+'</section>';
  return {summary,body};
}

function annualLabor(scopes:Scope[],periods:OperationPageOptions['periods'],link:RecordLink) {
  const forecast=periods.filter(year=>scopes.some(scope=>Number(scope.laborByPeriod.find(row=>row.period===year.key)?.volume)>0));
  const rows=scopes.map(scope=>'<tr><th scope="row">'+html(scope.label)+'</th>'+forecast.map(year=>{
    const row=scope.laborByPeriod.find(item=>item.period===year.key);
    if(row?.volume==='0')return '<td>—<small class="fin-state">No forecast volume</small></td>';
    if(row?.value==null||row.volume==null)return '<td>—<small class="fin-state">Labor forecast unavailable</small></td>';
    return '<td>'+financeUrl(link({productKey:scope.productKey,period:year.key},undefined,'stations'),row.value,'labor-year-'+scope.productKey+'-'+year.key)+'</td>';
  }).join('')+'</tr>').join('');
  return '<section class="fin-panel fin-op-overview"><h2>Unit labor by year</h2>'+
    (forecast.length?'<p class="fin-muted">'+html(scopes[0].currency)+' per good piece · Forecast production periods. Select a year and product to review its station assumptions.</p>'+
      table(['Product',...forecast.map(year=>html(year.label))],rows,'Annual unit labor forecast'):
      '<p class="fin-muted">No production demand is available for the selected products and version.</p>')+'</section>';
}

function routeRegistry(scopes:Scope[],link:RecordLink,options:OperationPageOptions) {
  const {periodLabel,canOperate,canCalibrate,draft,linkedAssets}=options;
  return '<section class="fin-panel"><h2>Routes &amp; Batch Measurements</h2>'+
    '<p class="fin-muted">'+html(periodLabel)+' · '+(draft?'Draft version':'Frozen version')+'</p>'+
    scopes.map(scope=>{
      const selected=selectedRecord(scope),archive=scope.archive;
      const actions=canOperate&&draft?'<div class="fin-actions">'+financeUrl(link(scope,'new-design'),'Submit design','fin-design-'+scope.productKey)+
        (canCalibrate?financeUrl(link(scope,'rate'),'Calibrate rate','fin-rate-'+scope.productKey):'')+'</div>':'';
      const archived=archive?'<details class="fin-op-archive"><summary>Archived AME / Financials design</summary>'+
        '<p>Archived SOP labor '+text(archive.labor.value)+' '+html(scope.currency)+'/piece · '+html(archive.labor.reference)+
        '<br>Archived rate '+text(archive.rate.value)+' '+html(scope.currency)+'/person-hour · '+html(archive.rate.reference)+'</p>'+
        table(['Line / Financials','Operators','CT (s)','Repeats/piece','Equipment OEE','Labor efficiency / allowance'],
          archive.operations.map(row=>'<tr><th scope="row">'+html(row.line)+(row.shared?' · Shared':'')+'<small class="fin-state">'+html(row.financials)+'</small>'+
          (row.lineKey?linkedAssets(scope,row.lineKey).map(asset=>financeUrl(asset.href,asset.title)).join(' · '):'')+'</th>'+
          [row.people,row.ct,{value:row.repeats,reference:null},row.oee].map(field=>'<td>'+text(field?.value)+(field?.reference?'<small class="fin-state">'+html(field.reference)+'</small>':'')+'</td>').join('')+
          '<td>'+text(row.efficiency.value)+' / '+text(row.allowance.value)+'<small class="fin-state">'+html(row.efficiency.reference)+' · '+html(row.allowance.reference)+'</small></td></tr>').join(''))+'</details>':'';
      const records=scope.records.length?table(['Source revision / batch','Reviewer','Evidence','Timing coverage','Use'],scope.records.map(item=>
        '<tr><th scope="row">'+financeUrl(link(scope,item.key),name(item),'route-'+item.key)+'</th>'+cell(item.record.reviewer)+cell(item.record.reference)+
        cell(item.issues.length?item.issues.join(' '):'Complete')+(item.key===scope.selectedKey?'<td><strong>Active '+(item.record.type==='actual'?'measured':'design')+'</strong></td>':'<td>Available for review</td>')+
        '</tr>').join('')):'<p>No station route or measured batch has been recorded for this period.</p>';
      const hasMeasurement=scope.records.some(item=>item.record.type==='actual');
      return '<section class="fin-op-product"><h3>'+html(scope.label)+'</h3><p>Demand '+text(scope.demand)+' good pieces · Labor basis '+
        html(selected?name(selected):archive?'Archived design':'Existing labor basis')+'</p>'+
        (scope.rate?'<p>Calibrated rate '+html(scope.rate.rate)+' '+html(scope.rateCurrency)+'/person-hour · '+html(scope.rate.reviewer)+' · '+html(scope.rate.reference)+'</p>':'')+
        (scope.selection?'<p>Basis reviewed by '+html(scope.selection.reviewer)+' · '+html(scope.selection.reference)+'</p>':'')+
        actions+archived+records+(hasMeasurement?'':'<p class="fin-muted">No measured batch recorded for this product and period.</p>')+'</section>';
    }).join('')+'</section>';
}

export function operationsPage(scopes:Scope[],link:RecordLink,options:OperationPageOptions) {
  if(!options.source){
    if(options.view==='stations')return stationOverview(scopes,link,options.periodLabel);
    return {summary:'',body:options.view==='annual'?annualLabor(scopes,options.periods,link):routeRegistry(scopes,link,options)};
  }
  const scope=scopes.find(scope=>scope.records.some(record=>record.key===options.source));
  const record=scope?.records.find(record=>record.key===options.source);
  if(!scope||!record)return {summary:'',body:''};
  const actions=options.canOperate&&options.draft&&record.record.type==='design'?
    '<p>'+financeUrl(link(scope,'batch-'+record.key),'Record measured batch','fin-record-batch')+'</p>':'';
  const status=record.key===scope.selectedKey?(record.record.type==='actual'?'Active measured basis':'Active design basis'):'Reference record';
  const access=!options.canOperate?' · Read-only access':options.draft?'':' · Frozen version · Preview only';
  return {summary:'',body:'<section class="fin-panel fin-op-product"><p class="fin-muted">'+html(status)+
    access+' · Current unit labor '+text(scope.currentUnitLabor)+' '+html(scope.currency)+'/piece</p>'+
    '<p>'+financeUrl(link(scope),'Route and batch records','fin-operation-records')+'</p>'+actions+
    renderSource(scope,record,options.dictionary,link,options.linkedAssets)+'</section>'};
}

const input=(name:string,label:string,value='',extra='required')=>'<label>'+html(label)+'<input name="'+name+'" value="'+html(value)+'" '+extra+'></label>';
const decimal=(name:string,label:string,value='',optional=false)=>input(name,label,value,'inputmode="decimal" '+(optional?'':'required'));
const identity=(name:string,label:string)=>input(name,label,'','maxlength="160" required pattern="[A-Za-z0-9][A-Za-z0-9_.:\\-]*"');
const evidence=input('reviewer','Reviewed by','','maxlength="120" required')+input('reference','Evidence reference','','maxlength="200" required');
const lineFields=()=>identity('line','Physical line ID')+decimal('shifts','Shifts/day','1')+
  decimal('hours','Net hours/shift before OEE')+decimal('days','Working days/period')+decimal('allocation','Allocated line share (0–1)','1')+
  decimal('oee','Equipment OEE (0–1)','1');
const stationFields=()=>identity('station','Station ID')+input('operation','Operation','','maxlength="120" required')+identity('line','Physical line ID')+
  decimal('people','Operators')+decimal('ct','Standard CT (seconds)',undefined,true)+decimal('output','Units/cycle','1')+
  decimal('repeats','Repeats/piece','1')+decimal('efficiency','Independent labor efficiency (>0, up to 1)','1');
const fields=(group:string)=>group==='line'?lineFields():stationFields();
const block=(group:string)=>'<fieldset data-ops-group="'+group+'"><legend>'+(group==='line'?'Physical line':'Station in route order')+'</legend>'+
  fields(group)+'<button type="button" class="small-btn" data-op-remove>Remove</button></fieldset>';
const builder=(group:string)=>'<div data-ops-list="'+group+'">'+block(group)+'</div><button type="button" class="small-btn" data-op-add="'+group+'">Add '+group+'</button>';
const entries=(form:HTMLFormElement,group:string)=>[...form.querySelectorAll('[data-ops-group="'+group+'"]')].map(node=>
  Object.fromEntries([...node.querySelectorAll('input')].map(field=>[field.name,field.value.trim()||null])));

export function operationsEditor(scope:Scope,source:string,canOperate:boolean,canCalibrate:boolean,draft:boolean):OperationEditor|undefined {
  if(!canOperate||!source)return;
  const wrap=(title:string,markup:string,serialize:(data:FormData,form:HTMLFormElement)=>Record<string,unknown>,bind?:OperationEditor['bind']):OperationEditor=>({
    period:scope.period,title,markup:markup+evidence,submit:(data,form)=>({collection:'operations',productKey:scope.productKey,record:{
      ...serialize(data,form),reviewer:data.get('reviewer'),reference:data.get('reference')
    }}),bind
  });
  if(source==='new-design'&&draft)return wrap('Submit route design',
    '<p>Use the same physical line ID across products sharing its schedule. Enter net time after breaks. Standard CT and equipment OEE must account for each equipment loss once.</p>'+
    (scope.archive?'<p>Cover both AME-linked assembly operations. Preserve repeat counts or document changes in the design evidence.</p>':'')+
    input('revision','Design revision','','maxlength="120" required')+builder('line')+builder('station'),
    (data,form)=>({type:'design',revision:data.get('revision'),lines:entries(form,'line'),stations:entries(form,'station')}),(form,clear)=>{
      form.addEventListener('click',event=>{
        const target=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-op-add],[data-op-remove]');
        if(!target)return;
        const group=target.dataset.opAdd;
        if(group){
          const container=form.querySelector('[data-ops-list="'+group+'"]')!;
          if(container.childElementCount>=(group==='line'?20:45))return;
          container.insertAdjacentHTML('beforeend',block(group));
          container.lastElementChild?.querySelector('input')?.focus();
        }else{
          const fieldset=target.closest('fieldset')!;
          if(fieldset.parentElement!.childElementCount===1)return;
          fieldset.remove();
        }
        clear();
      });
    });
  if(source==='rate'&&canCalibrate&&draft)return wrap('Calibrate hourly rate',
    '<label>Source currency<select name="currency">'+currencyOptions(scope.currencies,scope.rateCurrency)+'</select></label>'+
    decimal('hourly-rate','Hourly rate per person-hour',scope.rate?.rate),
    data=>({type:'rate',rate:data.get('hourly-rate'),currency:data.get('currency')}));
  const target=scope.records.find(record=>record.key===source||'batch-'+record.key===source);
  if(!target)return;
  if(source.startsWith('batch-')&&draft&&target.record.type==='design'){
    const design=target.record;
    return wrap('Record measured batch · '+name(target),
      input('batch','Batch / lot','','maxlength="120" required')+input('date','Measurement date','','type="date" required')+
      input('revision','Measurement revision','1','maxlength="120" required')+
      '<label>Stage<select name="stage"><option value="pilot">Pilot</option><option value="production">Production</option></select></label>'+
      '<p>Enter direct person-hours and good pieces for the whole route and this product, including allocated shared labor. Enter running CT for each station. Leave missing readings blank. '+
      'Capacity uses only the measured availability × quality factor on this CT basis. Use 1 if the CT already captures those losses.</p>'+
      decimal('person-hours','Actual person-hours')+decimal('good-pieces','Good pieces')+
      design.stations.map(station=>decimal('ct-'+station.station,'CT seconds · '+station.station+' / '+station.operation,undefined,true)).join('')+
      design.lines.map(line=>decimal('factor-'+line.line,'Availability × quality (0–1) · '+line.line,undefined,true)).join(''),
      data=>({type:'actual',designKey:target.key,batch:data.get('batch'),date:data.get('date'),revision:data.get('revision'),stage:data.get('stage'),personHours:data.get('person-hours'),
        goodPieces:data.get('good-pieces'),times:Object.fromEntries(design.stations.map(s=>[s.station,data.get('ct-'+s.station)||null])),
        capacityFactors:Object.fromEntries(design.lines.map(l=>[l.line,data.get('factor-'+l.line)||null]))}));
  }
  if(source!==target.key)return;
  return wrap('Labor basis · Design / Measured','<label>Design / Measured<select name="operation-source" required>'+
    '<option value="">Choose source</option><option value="legacy">'+(scope.archive?'Archived design':'Existing labor basis')+'</option>'+
    scope.records.map(item=>'<option value="'+html(item.key)+'" '+(item.key===target.key?'selected':'')+'>'+html(name(item))+'</option>').join('')+
    '</select></label>',data=>{
      const sourceKey=String(data.get('operation-source'));
      const mode=scope.records.find(item=>item.key===sourceKey)?.record.type??'legacy';
      return {type:'selection',sourceKey,mode};
    });
}
