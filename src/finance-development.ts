import {escapeHtml as html,financeUrl,metricLabel} from '/finance-view.js';
import type {Dictionary} from '/finance-view.js';
import type {OperationEditor} from '/finance-impact.js';
import type {DevelopmentCost,DevelopmentModule} from '../lib/finance-development.ts';
import type {developmentWorkspace} from '../lib/finance-development-calculation.ts';
import {currencyOptions} from '/finance-fx.js';

type Workspace=ReturnType<typeof developmentWorkspace>;
type Source=Workspace['rows'][number];
type Item={key:string;label:string};
type Link=(module:DevelopmentModule,key?:string)=>string;
type Rights=Partial<Record<DevelopmentModule,boolean>>;
const labels={engineering:'Engineering & PM',prototypes:'Prototype Batches',validation:'Validation & Certification'};
const categoryLabels={labor:'Development labor',travel:'Travel',sample:'Sample batch',package:'Test package',internal_test:'Internal test (person-hours)',
  external_test:'External test / laboratory',fixture:'Fixture',certification:'Certification',retest:'Retest'};
const categoryKeys={engineering:['labor','travel'],prototypes:['sample'],validation:['package','internal_test','external_test','fixture','certification','retest']};
const components={engineering:{rate:'Hourly rate / travel unit cost',travel:'Additional travel total'},
  prototypes:{material:'Material',processing:'Processing',labor:'Prototype labor',expedite:'Expedite',freight:'Shipping'},
  validation:{rate:'Rate per hour or item / package'}};
const recoveryLabel={none:'Project-funded',lump_sum:'Customer lump sum',piece_price:'Customer piece-price uplift'};
const table=(headers:string[],rows:string)=>'<div class="fin-table-scroll fin-dev-table"><table><thead><tr>'+headers.map(header=>'<th scope="col">'+header+'</th>').join('')+
  '</tr></thead><tbody>'+rows+'</tbody></table></div>';
const td=(value:string|number|null|undefined)=>'<td>'+html(value??'—')+'</td>';
const title=(value:string)=>'<h3>'+html(value)+'</h3>';
const field=(name:string,label:string,value='',attributes='required')=>'<label>'+html(label)+'<input name="'+html(name)+'" value="'+html(value)+'" '+attributes+'></label>';
const decimal=(name:string,label:string,value='',required=true)=>field(name,label,value,'inputmode="decimal" '+(required?'required':''));
const textField=(name:string,label:string,value='',limit=160)=>field(name,label,value,'required maxlength="'+limit+'"');
const select=(name:string,label:string,items:Item[],value:string)=>'<label>'+html(label)+'<select name="'+html(name)+'" required>'+
  items.map(item=>'<option value="'+html(item.key)+'" '+(value===item.key?'selected':'')+'>'+html(item.label)+'</option>').join('')+'</select></label>';
const entries=(labels:Record<string,string>)=>Object.entries(labels).map(([key,label])=>({key,label}));
const factTypes=['incurred','payment','receipt'] as const;
const factLabels={incurred:'Actual occurrence',payment:'Actual payment',receipt:'Actual customer receipt'};
const summaryKeys=['development_budget','development_gross','development_actual','development_remaining','development_recovery','net_engineering','development_cash'];

function renderDetails(row:Source,link:Link,periodLabel:(s:string)=>string,productLabel:(s:string)=>string,currency:string,canEdit:boolean){
  const {cost,actual}=row,recovery=cost.recovery;
  const item=(label:string,value:string)=>'<dt>'+html(label)+'</dt><dd>'+html(value)+'</dd>';
  return '<article class="fin-dev-source" id="fin-development-source">'+title(cost.title)+'<p>'+html(cost.costRef)+' · '+html(cost.group)+' · '+html(categoryLabels[cost.category])+
    (cost.stage?' · '+html(cost.stage):'')+(cost.role?' · '+html(cost.role):'')+'</p>'+
    '<dl>'+item('Evidence',cost.reference)+item('Required / covered',cost.quantity+' / '+row.coveredQuantity)+
    item('Expected payable',row.planned+' '+currency)+item('Occurrence / payment period',periodLabel(cost.period)+' / '+periodLabel(cost.paymentPeriod))+
    item('Product allocation',cost.allocations.map(item=>productLabel(item.productKey)+' '+(Number(item.share)*100).toFixed(2)+'%').join(', '))+
    item('Allocation basis',cost.allocationBasis)+item('Customer responsibility',recoveryLabel[recovery.method])+
    (recovery.method==='none'?'':item('Recovery basis',recovery.amount+' '+currency+(recovery.method==='piece_price'?'/piece · '+productLabel(recovery.productKey):'')+
      ' · Earn '+periodLabel(recovery.earnedPeriod)+' · Receive '+periodLabel(recovery.receiptPeriod)))+'</dl>'+
    '<p>'+Object.entries(cost.components).map(([key,value])=>html(components[cost.module][key])+' '+html(value)+' '+html(currency)).join(' · ')+'</p>'+
    (row.related.length?'<p>Covered by '+row.related.map(target=>financeUrl(link('validation',target.provider),target.title)+' ('+html(target.quantity)+')').join(', ')+'</p>':'')+
    (row.includes.length?'<p>Package includes '+row.includes.map(target=>financeUrl(link(target.module,target.key),target.title)+' ('+html(target.quantity)+')').join(', ')+'</p>':'')+
    (actual?table(['Execution event','Amount','Period','Date','Evidence'],factTypes.flatMap(kind=>{
      const fact=actual[kind];
      return fact?['<tr><th scope="row">'+factLabels[kind]+'</th>'+td(fact.amount+' '+row.actualCurrency)+td(periodLabel(fact.period))+td(fact.date)+td(fact.reference)+'</tr>']:[];
    }).join('')):'')+
    (canEdit?'<div class="fin-actions">'+(!actual?financeUrl(link(cost.module,'edit-'+row.key),'Edit forecast','fin-development-edit'):'')+
      financeUrl(link(cost.module,'actual-'+row.key),actual?'Review actuals':'Record actuals','fin-development-actual')+'</div>':'')+'</article>';
}

function departmentOverview(data:Workspace,module:DevelopmentModule,link:Link,periodLabel:(key:string)=>string,productLabel:(key:string)=>string){
  const money=(value:string|null|undefined,code:string)=>value==null?null:
    new Intl.NumberFormat('en',{minimumFractionDigits:data.currencies[code],maximumFractionDigits:data.currencies[code]}).format(Number(value))+' '+code;
  const product=(row:Workspace['rows'][number])=>row.cost.allocations.map(item=>productLabel(item.productKey)).join(', ');
  const panel=(title:string,body:string)=>'<section class="fin-panel fin-business-overview"><h2>'+title+'</h2>'+body+'</section>';
  const source=(row:Workspace['rows'][number])=>financeUrl(link(module,row.key),row.cost.reference,'department-source-'+row.key);
  const scope=(row:Workspace['rows'][number])=>row.modelScope?'Quote specification '+row.modelScope:row.cost.group;
  if(!data.rows.length)return '';
  if(module==='engineering'){
    const pm=data.pmTotals;
    return panel('Engineering work packages', (pm?'<dl class="fin-op-metrics">'+[
      ['PM hours',new Intl.NumberFormat('en').format(Number(pm.hours))],
      ['PM labor',money(pm.labor,pm.currency)],['PM travel',money(pm.travel,pm.currency)],['PM planned cost',money(pm.total,pm.currency)]
    ].map(([label,value])=>'<div><dt>'+html(label)+'</dt><dd>'+html(value)+'</dd></div>').join('')+'</dl>':'')+
      table(['Product / source','Role','Period','Hours','Hourly rate','Labor','Travel','Planned cost'],data.rows.map(row=>
        '<tr><th scope="row">'+html(product(row))+'<small class="fin-state">'+source(row)+'</small></th>'+
        td(row.cost.role??row.cost.category)+td(periodLabel(row.cost.period))+td(row.labor===null?null:row.cost.quantity)+
        td(row.labor===null?null:money(row.cost.components.rate,row.originalCurrency))+
        td(money(row.labor,row.originalCurrency))+td(money(row.travel,row.originalCurrency))+
        td(money(row.planned,row.originalCurrency))+'</tr>').join('')));
  }
  if(module==='prototypes')return panel('Sample quotes and delivery',
    table(['Product / source','Specification / batch','Quote scope','Physical pieces','Original quote','Reporting amount','Delivery evidence'],data.rows.map(row=>{
      const coverage=row.related.map(item=>financeUrl(link(item.module,item.provider),item.title)).join(' · ');
      return '<tr><th scope="row">'+html(product(row))+'<small class="fin-state">'+source(row)+'</small></th>'+
        td(scope(row))+'<td>'+html(row.quoteBundle?'Quoted cost package':'Sample quantity')+
        (coverage?'<small class="fin-state">Covered by '+coverage+'</small>':'')+'</td>'+
        td(row.quoteBundle?'To collect':row.cost.quantity)+td(money(row.planned,row.originalCurrency))+td(money(row.reporting,data.currency))+
        td(row.actual?.payment?'Payment evidence recorded. Delivery date and acceptance evidence to collect.':
          'Delivery date and acceptance evidence to collect')+'</tr>';
    }).join(''))+
    '<p class="fin-muted">Samples or fixtures included in a validation package stay with its paying package.</p>');
  const rows=new Map(data.rows.map(row=>[row.key,row]));
  const detail=data.validationGroups.map(group=>{
    const costRows=group.items.map(key=>rows.get(key)!);
    const included=costRows.filter(row=>/含样件及夹具|includes samples and fixtures/i.test(row.cost.title)||row.includes.length>0);
    const archivedCoverage=group.scope&&group.stage==='PV'&&costRows.some(row=>/^PV cost!Y\d+/.test(row.cost.reference))?
      '<small class="fin-state">3C, ECE and FMVSS covered by DV · PV cost!V'+html(group.scope)+':X'+html(group.scope)+'</small>':'';
    return '<tr><th scope="row">'+html(group.scope?'Quote specification '+group.scope:costRows[0].cost.group)+'</th>'+
      td(group.products.map(productLabel).join(', '))+td(group.region??'Not specified')+td(group.stage)+
      td(money(group.original,group.currency))+td(money(group.reporting,data.currency))+
      '<td><details><summary>Quote evidence</summary>'+costRows.map(row=>'<span class="fin-detail-link">'+source(row)+'</span>').join('')+
      '</details>'+(included.length?'<small class="fin-state">Includes covered samples or fixtures</small>':'')+archivedCoverage+'</td>'+
      td('Test report or certificate to collect')+'</tr>';
  });
  return panel('Validation by specification and stage',table(['Specification','Product','Region','Phase','Original quote','Reporting amount',
    'Coverage and sources','Execution evidence'],detail.join(''))+
    '<p class="fin-muted">Use the validation package once. Archived PV columns V–X identify items already covered by DV where the workbook supplies them.</p>');
}

export function developmentPage(data:Workspace,module:DevelopmentModule,source:string,link:Link,periods:Item[],products:Item[],rights:Rights,activeDraft:boolean,dictionary:Dictionary){
  const label=(list:Item[],key:string)=>list.find(item=>item.key===key)?.label??key;
  const periodLabel=(key:string)=>label(periods,key),productLabel=(key:string)=>label(products,key);
  const row=data.rows.find(item=>item.key===source||'actual-'+item.key===source||'edit-'+item.key===source);
  const archive=data.archivedRows.length?'<details class="fin-dev-archive" open><summary>P05 workbook sources</summary>'+
    '<p>DV includes samples and fixtures. PV columns V–X are covered by DV and excluded from the PV total. PM routes EU/NA shares to Financials 426. Financials 427 records customer recovery separately.</p>'+
    table(['Original source','Product','Value','Scope'],data.archivedRows.map(item=>'<tr><th scope="row">'+html(item.source)+'</th>'+
      td(item.productKey?productLabel(item.productKey):'Shared')+td(item.amount+' '+item.unit)+td(item.covered?'Covered by DV':'Archived forecast')+'</tr>').join(''))+'</details>':'';
  const actions=activeDraft?'<div class="fin-actions">'+(rights[module]?financeUrl(link(module,'new'),'New cost','fin-development-new'):'')+
    (data.editable.some(item=>rights[item.cost.module])?financeUrl(link(module,'combine'),'Preview multiple costs','fin-development-combine'):'')+'</div>':'';
  const metrics=table(['Period',...summaryKeys.map(key=>metricLabel(dictionary,key))],data.series.map(period=>'<tr><th scope="row">'+html(periodLabel(period.period))+'</th>'+
    summaryKeys.map(key=>td(period.metrics[key]==null?null:period.metrics[key]+' '+data.currency)).join('')+'</tr>').join(''));
  const list=data.rows.length?table(['Source row','Stage / batch / round','Occurrence','Payment','Net payable forecast'],data.rows.map(item=>
    '<tr><th scope="row">'+financeUrl(link(module,item.key),item.cost.title,'development-'+item.key)+'<small class="fin-state">'+html(item.cost.costRef)+'</small></th>'+
    td(item.cost.group)+td(periodLabel(item.cost.period))+td(periodLabel(item.cost.paymentPeriod))+td(item.planned+' '+item.originalCurrency)+'</tr>').join('')):'<p>No development records in this scope.</p>';
  return departmentOverview(data,module,link,periodLabel,productLabel)+
    '<section class="fin-panel"><div class="fin-panel-head"><h2>'+labels[module]+'</h2></div><div class="fin-actions">'+
    (Object.keys(labels) as DevelopmentModule[]).filter(key=>key!==module).map(key=>financeUrl(link(key),labels[key])).join('')+'</div>'+
    '<h3>Development by period</h3>'+metrics+(archive?'<p class="fin-muted">Gross development and development cash here show added detail. Net engineering includes the archived Financials schedule.</p>':'')+
    actions+list+(row?renderDetails(row,link,periodLabel,productLabel,row.originalCurrency,!!rights[module]&&activeDraft):'')+archive+'</section>';
}

function editCost(data:Workspace,module:DevelopmentModule,cost:DevelopmentCost|undefined,periods:Item[],products:Item[],period:string,product:string,currency:string){
  const category=cost?.category??categoryKeys[module][0],cash=cost?.recovery;
  const unitLabels=module==='prototypes'?'Each component is a rate per sample.':'Set the quantity to one for a fixed charge.';
  return field('costRef','Unique cost / commitment reference',cost?.costRef,'maxlength="100" required'+(cost?' readonly data-fixed':''))+
    textField('title','Source row title',cost?.title)+textField('group',module==='engineering'?'Development stage':module==='prototypes'?'Batch ID':'Validation round',cost?.group)+
    select('category','Cost category',categoryKeys[module].map(key=>({key,label:categoryLabels[key]})),category)+
    (module==='engineering'?textField('role','Role / discipline',cost?.role??''):'')+
    (module==='validation'?select('stage','Validation stage',['DV','PV','Certification'].map(key=>({key,label:key})),cost?.stage??'DV'):'')+
    decimal('quantity',module==='engineering'?'Hours or travel units':module==='prototypes'?'Required samples':'Hours or units',cost?.quantity)+
    '<p>'+html(unitLabels)+'</p><label>Source currency<select name="currency">'+currencyOptions(data.currencies,currency)+'</select></label>'+
    Object.entries(components[module]).map(([key,label])=>decimal('component:'+key,label,cost?.components[key],false)).join('')+
    select('incurrence','Occurrence period',periods,cost?.period??period)+select('payment','Payment period',periods,cost?.paymentPeriod??period)+
    textField('reference','Evidence reference',cost?.reference,240)+textField('allocationBasis','Allocation basis',cost?.allocationBasis,240)+
    '<fieldset><legend>Product shares (total 1)</legend>'+products.map(item=>decimal('allocation:'+item.key,item.label,
      cost?.allocations.find(a=>a.productKey===item.key)?.share??(!cost&&item.key===product?'1':''),false)).join('')+'</fieldset>'+
    (module!=='engineering'&&data.packages.length?'<fieldset><legend>Covered quantities by paying package</legend>'+
      data.packages.map(pkg=>decimal('coverage:'+pkg.key,pkg.title+' · '+pkg.ref,cost?.coverage.find(link=>link.provider===pkg.key)?.quantity??'',false)).join('')+'</fieldset>':'')+
    select('method','Customer responsibility',entries(recoveryLabel),cash?.method??'none')+
    decimal('recovery','Recovery amount / rate',cash&&cash.method!=='none'?cash.amount:'',false)+
    select('recovery-product','Piece-price recovery product',products,cash?.method==='piece_price'?cash.productKey:product)+
    select('earned','Recovery earned period',periods,cash&&cash.method!=='none'?cash.earnedPeriod:period)+
    select('receipt','Forecast receipt period',periods,cash&&cash.method!=='none'?cash.receiptPeriod:period)+
    '<p>Enter only the uplift beyond the commercial quote. Piece-price recovery uses the selected product’s sales volume for the earned period.</p>';
}

export function developmentEditor(data:Workspace,module:DevelopmentModule,source:string,periods:Item[],products:Item[],period:string,product:string,rights:Rights,draft:boolean):OperationEditor|undefined{
  if(!draft||!source||!periods.length)return;
  const defaultPeriod=period||periods[0].key;
  const wrap=(title:string,markup:string,submit:OperationEditor['submit']):OperationEditor=>({
    period:defaultPeriod,range:{from:periods[0].key,to:periods.at(-1)!.key},development:true,title,markup,submit
  });
  if(source==='combine'){
    const eligible=data.editable.filter(row=>rights[row.cost.module]).slice(0,100);
    if(!eligible.length)return;
    return wrap('Preview multiple development costs','<p>Enter new quantities for the source rows you want to change together. Leave the other rows blank.</p>'+
      eligible.map(row=>decimal('change:'+row.key,row.cost.title+' · current '+row.cost.quantity,'',false)).join(''),form=>
      eligible.filter(row=>String(form.get('change:'+row.key)).trim()).map(row=>({collection:'development',action:'quantity',key:row.key,quantity:form.get('change:'+row.key)})));
  }
  if(!rights[module])return;
  const row=data.rows.find(item=>'edit-'+item.key===source||'actual-'+item.key===source);
  if(row&&source.startsWith('actual-')){
    return wrap('Record execution · '+row.cost.title,'<p>For each event, enter the amount, date and evidence. Leave events awaiting evidence blank.</p>'+
      '<label>Posting currency<select name="currency">'+currencyOptions(data.currencies,row.actualCurrency)+'</select></label>'+
      factTypes.filter(kind=>kind!=='receipt'||row.cost.recovery.method!=='none').map(kind=>{
        const fact=row.actual?.[kind];
        const fallback=kind==='incurred'?row.cost.period:kind==='payment'?row.cost.paymentPeriod:row.cost.recovery.method!=='none'?row.cost.recovery.receiptPeriod:row.cost.period;
        return '<fieldset><legend>'+factLabels[kind]+'</legend>'+decimal(kind+'-amount','Amount',fact?.amount,false)+
          select(kind+'-period','Period',periods,fact?.period??fallback)+field(kind+'-date','Date',fact?.date,'type="date"')+
          field(kind+'-reference','Evidence',fact?.reference,'maxlength="240"')+'</fieldset>';
      }).join(''),form=>{
        const record=Object.fromEntries(factTypes.map(kind=>{
          const amount=form.get(kind+'-amount');
          return [kind,amount?{amount,period:form.get(kind+'-period'),date:form.get(kind+'-date'),reference:form.get(kind+'-reference')}:null];
        }));
        return {collection:'development',action:'actual',key:row.key,currency:form.get('currency'),record};
      });
  }
  if(source!=='new'&&(!row||row.actual))return;
  const original=row?.cost;
  return wrap(original?'Edit forecast · '+original.title:'New development cost',editCost(data,module,original,periods,products,defaultPeriod,product||products[0]?.key,row?.originalCurrency??data.currency),form=>{
    const numbers=(prefix:string)=>[...form].filter(([name,value])=>name.startsWith(prefix)&&String(value).trim()).map(([name,value])=>[name.slice(prefix.length),value]);
    return {collection:'development',action:original?'edit':'new',module,costRef:form.get('costRef'),currency:form.get('currency'),...(row?{key:row.key}:{}),
      record:{title:form.get('title'),group:form.get('group'),category:form.get('category'),role:form.get('role'),stage:form.get('stage'),
        quantity:form.get('quantity'),components:Object.fromEntries(numbers('component:')),period:form.get('incurrence'),paymentPeriod:form.get('payment'),
        reference:form.get('reference'),allocationBasis:form.get('allocationBasis'),allocations:numbers('allocation:').map(([productKey,share])=>({productKey,share})),
        coverage:numbers('coverage:').map(([provider,quantity])=>({provider,quantity})),
        recovery:{method:form.get('method'),amount:form.get('recovery'),productKey:form.get('recovery-product'),earnedPeriod:form.get('earned'),receiptPeriod:form.get('receipt')}}};
  });
}
