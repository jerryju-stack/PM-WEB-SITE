import {escapeHtml as html,financeUrl,help} from '/finance-view.js';
import type {Dictionary} from '/finance-view.js';
import type {OperationEditor} from '/finance-impact.js';
import type {operationsWorkspace} from '../lib/finance-operations-calculation.ts';
import {currencyOptions} from '/finance-fx.js';

type Scope=NonNullable<ReturnType<typeof operationsWorkspace>>[number];
type Source=Scope['records'][number];
type RecordLink=(scope:Scope,source?:string)=>string;
const missing='Unavailable';
const text=(value:string|null|undefined)=>html(value??missing);
const cell=(value:string|null|undefined)=>'<td>'+text(value)+'</td>';
const display=(value:string|null,suffix:string)=>value===null?missing:html(value)+suffix;
const name=(item:Source)=>item.record.type==='design'?'Design '+item.record.revision:
  (item.record.stage==='pilot'?'Pilot':'Production')+' · '+item.record.batch+' · '+item.record.date+' · Rev '+item.record.revision;
const table=(head:string[],rows:string)=>'<div class="fin-table-scroll"><table><thead><tr>'+head.map(title=>'<th scope="col">'+title+'</th>').join('')+
  '</tr></thead><tbody>'+rows+'</tbody></table></div>';

function renderSource(scope:Scope,item:Source,dictionary:Dictionary) {
  const {record}=item;
  const measured=record.type==='actual',design=scope.records.find(row=>row.key===item.designKey);
  return '<h3>'+html(name(item))+'</h3><p>Reviewer '+html(record.reviewer)+' · Evidence '+html(record.reference)+'</p>'+
    (measured?'<p>Referenced design '+html(design?name(design):item.designKey)+' · '+html(record.personHours)+' person-hours · '+html(record.goodPieces)+' good pieces</p>':'')+
    '<p>Person-hours per good piece '+help(dictionary,'person_hours_per_piece')+' <strong>'+text(item.personHours)+'</strong> · Modeled route labor '+help(dictionary,'route_labor')+' <strong>'+text(item.modeledLabor)+' '+html(scope.currency)+'/piece</strong></p>'+
    (item.issues.length?'<ul class="fin-op-issues">'+item.issues.map(issue=>'<li>'+html(issue)+'</li>').join('')+'</ul>':'')+
    '<div class="fin-op-lines">'+item.lines.map(line=>'<section class="fin-op-line"><h4>'+html(line.line)+(line.shared?' · Shared line':'')+'</h4>'+
      '<p>'+html(line.shifts)+' shifts/day × '+html(line.hours)+' net hours/shift × '+html(line.days)+' days · Allocated share '+html(line.allocation)+help(dictionary,'allocated_line_share')+
      ' · '+(measured?'Measured availability × quality ':'Equipment OEE ')+text(line.factor)+help(dictionary,measured?'measured_capacity_factor':'oee')+'</p>'+
      '<dl class="fin-op-metrics"><div><dt>Demand takt '+help(dictionary,'demand_takt')+'</dt><dd>'+display(line.takt,' s/piece')+'</dd></div>'+
      '<div><dt>Bottleneck load '+help(dictionary,'bottleneck_load')+'</dt><dd>'+display(line.constraint,' s/piece')+'</dd></div><div><dt>Line balance '+help(dictionary,'line_balance')+'</dt><dd>'+display(line.balance,'%')+'</dd></div>'+
      '<div><dt>Effective capacity '+help(dictionary,'effective_capacity')+'</dt><dd>'+display(line.capacity,' good pieces/period')+'</dd></div></dl>'+
      table(['Station / operation','Operators '+help(dictionary,'people'),'CT s/cycle '+help(dictionary,'ct'),'Units/cycle '+help(dictionary,'units_per_cycle'),'Repeats/piece '+help(dictionary,'cycles_per_unit'),'Labor efficiency '+help(dictionary,'labor_efficiency'),'Load s/piece','Against takt'],line.stations.map((station)=>
        '<tr><th scope="row">'+html(station.station)+'<small class="fin-state">'+html(station.operation)+'</small></th>'+
        cell(station.people)+cell(station.observedCt)+cell(station.output)+cell(station.repeats)+cell(measured?'Captured in actual hours':station.efficiency)+
        cell(station.normalized)+'<td>'+html(station.overTakt===null?'Unavailable':station.overTakt?'Over takt':'Within takt')+
        (station.bottleneck?'<strong class="fin-state">Bottleneck</strong>':'')+'</td></tr>').join(''))+'</section>').join('')+'</div>';
}

export function operationsPage(scopes:Scope[],source:string,link:RecordLink,periodLabel:string,canOperate:boolean,canCalibrate:boolean,draft:boolean,
  dictionary:Dictionary,yearLabel:(key:string)=>string,linkedAsset:(scope:Scope,line:string)=>string|null) {
  const percent=(value:string|null|undefined)=>value==null?'—':new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:2}).format(Number(value));
  const rows=scopes.flatMap(scope=>{
    const selected=scope.records.find(row=>row.key===scope.selectedKey);
    const rate=scope.hourlyRate??scope.archive?.rate.value??null;
    if(selected)return selected.lines.flatMap(line=>line.stations.map(station=>{
      const asset=linkedAsset(scope,line.line);
      const origin=selected.record.type==='actual'?'Measured · '+selected.record.date:'Design · '+selected.record.revision;
      return '<tr><th scope="row">'+html(scope.label)+'<small class="fin-state">'+
        financeUrl(link(scope,selected.key),station.operation)+'</small></th><td>'+
        (asset?financeUrl(asset,line.line):html(line.line))+(line.shared?' · Shared':'')+'</td>'+
        [station.people,station.observedCt??station.ct,station.repeats,percent(line.oee),percent(station.efficiency),
          rate?rate+' '+scope.currency:null,scope.currentUnitLabor?scope.currentUnitLabor+' '+scope.currency:null,origin].map(cell).join('')+'</tr>';
    }));
    return scope.archive?.operations.map(row=>'<tr><th scope="row">'+html(scope.label)+'</th>'+
      [row.line+(row.shared?' · Shared':''),row.people.value,row.ct.value,row.repeats,percent(row.oee?.value),percent(row.efficiency.value),
        rate?rate+' '+scope.currency:null,scope.currentUnitLabor?scope.currentUnitLabor+' '+scope.currency:null,row.financials].map(cell).join('')+'</tr>')??[];
  });
  const years=[...new Set(scopes.flatMap(scope=>scope.laborByPeriod.filter(item=>item.value!==null&&Number(item.value)>0).map(item=>item.period)))];
  const overview='<section class="fin-panel fin-business-overview"><h2>Operations and direct labor</h2>'+
    '<p class="fin-muted">'+html(periodLabel)+' · Hourly rates per person-hour, unit labor per good piece.</p>'+
    (rows.length?table(['Product / operation','Line','Operators','Cycle time (s)','Cycles / piece','Equipment OEE','Labor efficiency',
      'Hourly rate','Product unit labor','Evidence basis'],rows.join('')):'<p class="fin-muted">No station assumptions are recorded for this period.</p>')+
    (years.length?'<details><summary>Unit labor by year</summary>'+table(['Product',...years.map(yearLabel)],scopes.map(scope=>
      '<tr><th scope="row">'+html(scope.label)+'</th>'+years.map(year=>cell(scope.laborByPeriod.find(item=>item.period===year)?.value??null)).join('')+'</tr>'
    ).join(''))+'</details>':'')+'</section>';
  return overview+'<section class="fin-panel"><div class="fin-panel-head"><h2>Routes &amp; Batch Measurements</h2></div>'+
    '<p>Production period <strong>'+html(periodLabel)+'</strong> · '+(draft?'Draft':'Approved version')+'</p>'+
    '<p class="fin-muted">Station load is CT × repeats ÷ units per cycle. Demand takt uses allocated net time and demand. Line balance divides total station load by the number of stations and the bottleneck load. '+
    'Effective capacity applies the equipment loss factor once. Design labor uses independent labor efficiency. Measured labor uses actual person-hours and good pieces.</p>'+
    scopes.map(scope=>{
      const selected=scope.records.find(item=>item.key===scope.selectedKey),picked=scope.records.find(item=>item.key===source);
      const actions=canOperate&&draft?'<div class="fin-actions">'+financeUrl(link(scope,'new-design'),'Submit design','fin-design-'+scope.productKey)+
        (canCalibrate?financeUrl(link(scope,'rate'),'Calibrate rate','fin-rate-'+scope.productKey):'')+'</div>':'';
      const archive=scope.archive;
      const archiveTable=archive?'<details class="fin-op-archive"><summary>Archived AME / Financials design</summary>'+
        '<p>Archived SOP labor '+text(archive.labor.value)+' '+html(scope.currency)+'/piece · '+html(archive.labor.reference)+
        '<br>Archived rate '+text(archive.rate.value)+' '+html(scope.currency)+'/person-hour · '+html(archive.rate.reference)+'</p>'+
        '<p>AME records aggregate design assumptions. Station balancing and measured capacity require a station route. The modeled route covers the two mapped assembly operations shown here.</p>'+
        table(['Line / Financials','Operators','CT (s)','Repeats/piece','Equipment OEE','Labor efficiency / allowance'],
          archive.operations.map(row=>'<tr><th scope="row">'+html(row.line)+(row.shared?' · Shared':'')+'<small class="fin-state">'+html(row.financials)+'</small></th>'+
          [row.people,row.ct,{value:row.repeats,reference:null},row.oee].map(field=>'<td>'+text(field?.value)+(field?.reference?'<small class="fin-state">'+html(field.reference)+'</small>':'')+'</td>').join('')+
          '<td>'+text(row.efficiency.value)+' / '+text(row.allowance.value)+'<small class="fin-state">'+html(row.efficiency.reference)+' · '+html(row.allowance.reference)+'</small></td></tr>').join(''))+'</details>':'';
      const records=scope.records.length?table(['Source revision / batch','Reviewer','Evidence','Timing coverage','Use'],scope.records.map(item=>
        '<tr><th scope="row">'+financeUrl(link(scope,item.key),name(item),'route-'+item.key)+'</th>'+cell(item.record.reviewer)+cell(item.record.reference)+
        cell(item.issues.length?item.issues.join(' '):'Complete')+(item.key===scope.selectedKey?'<td><strong>Active '+(item.record.type==='actual'?'measured':'design')+'</strong></td>':'<td>Available for review</td>')+
        '</tr>').join('')):'<p>No station route or measured batch has been recorded for this period.</p>';
      return '<section class="fin-op-product"><h3>'+html(scope.label)+'</h3><p>Demand '+text(scope.demand)+' good pieces · Current unit labor <strong>'+
        text(scope.currentUnitLabor)+' '+html(scope.currency)+'/piece</strong> · '+html(selected?name(selected):archive?'Archived design':'Existing labor basis')+'</p>'+
        (scope.rate?'<p>Calibrated rate '+html(scope.rate.rate)+' '+html(scope.rateCurrency)+'/person-hour · '+html(scope.rate.reviewer)+' · '+html(scope.rate.reference)+'</p>':'')+
        (scope.selection?'<p>Basis reviewed by '+html(scope.selection.reviewer)+' · '+html(scope.selection.reference)+'</p>':'')+
        actions+archiveTable+records+
        (picked&&canOperate&&draft&&picked.record.type==='design'?'<p>'+financeUrl(link(scope,'batch-'+picked.key),'Record measured batch','fin-record-batch')+'</p>':'')+
        (picked||selected?renderSource(scope,(picked??selected)!,dictionary):'')+'</section>';
    }).join('')+'</section>';
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
