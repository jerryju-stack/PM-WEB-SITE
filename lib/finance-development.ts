import {financeKey} from './finance-contracts.ts';
import type {FinanceInput,FinanceSnapshot,FixedDecimal} from './finance-contracts.ts';
import {Decimal,ONE,sum,ZERO} from './finance-decimal.ts';
import {archived,businessSlug} from './finance-business.ts';
import {invalid} from './contracts.ts';
import {sourceFinanceCurrency} from './finance-fx.ts';

export const DEVELOPMENT_VERSION='P10.1';
export const developmentModules=['engineering','prototypes','validation'] as const;
export type DevelopmentModule=typeof developmentModules[number];
export const isDevelopmentModule=(value:unknown):value is DevelopmentModule=>developmentModules.includes(value as DevelopmentModule);
export const isDevelopmentInput=(row:FinanceInput)=>row.key.startsWith('p10:')||row.metricKey.startsWith('p10.');
export const isDevelopmentSource=(row:{key:string})=>row.key.startsWith('p10:');
export const hasDevelopmentModel=(s:FinanceSnapshot)=>s.inputs.some(isDevelopmentInput);
export const supportsDevelopment=(s:FinanceSnapshot)=>archived(s)||s.policy.rules.model==='manufacturing';
export const developmentCurrency=(s:FinanceSnapshot)=>archived(s)?'CNY':s.currency;

export const developmentCategories={
  engineering:['labor','travel'],
  prototypes:['sample'],
  validation:['package','internal_test','external_test','fixture','certification','retest']
} as const;
export const developmentComponents={
  engineering:['rate','travel'],
  prototypes:['material','processing','labor','expedite','freight'],
  validation:['rate']
} as const;
export type Allocation={productKey:string;share:string};
export type Coverage={provider:string;quantity:string};
type RecoverySchedule={amount:string;earnedPeriod:string;receiptPeriod:string};
type Recovery={method:'none'}|({method:'lump_sum'}&RecoverySchedule)|({method:'piece_price';productKey:string}&RecoverySchedule);
export type DevelopmentCost={module:DevelopmentModule;costRef:string;title:string;group:string;category:string;role:string|null;
  stage:'DV'|'PV'|'Certification'|null;quantity:string;components:Record<string,string>;period:string;paymentPeriod:string;
  reference:string;allocationBasis:string;allocations:Allocation[];coverage:Coverage[];recovery:Recovery};
type Fact={amount:string;period:string;date:string;reference:string};
export type DevelopmentActual={costKey:string;incurred:Fact|null;payment:Fact|null;receipt:Fact|null};
type CostRow=FinanceInput&{module:DevelopmentModule;conversion:{cost:DevelopmentCost}};
type ActualRow=FinanceInput&{module:DevelopmentModule;conversion:{actual:DevelopmentActual}};

const q=Decimal.from;
const fail=(message:string):never=>invalid('Development: '+message);
const costKey=(reference:string)=>'p10:'+businessSlug(reference.toLowerCase());
const fixed=(value:Decimal,scale=8):FixedDecimal=>({coefficient:BigInt(value.text(scale).replace('.','')).toString(),scale});
const periodOrdinal=(s:FinanceSnapshot,key:string)=>Number(s.periods.find(item=>item.key===key)?.metadata.ordinal);
export const developmentCosts=(s:FinanceSnapshot)=>s.inputs.filter(row=>row.metricKey==='p10.cost') as CostRow[];
export const developmentActuals=(s:FinanceSnapshot)=>s.inputs.filter(row=>row.metricKey==='p10.actual') as ActualRow[];
export const uncoveredQuantity=(record:DevelopmentCost)=>q(record.quantity).sub(sum(record.coverage.map(link=>q(link.quantity))));
export function plannedCost(record:DevelopmentCost) {
  const unit=sum(Object.entries(record.components).filter(([name])=>record.module!=='engineering'||name!=='travel').map(([,value])=>q(value)));
  const travel=record.module==='engineering'?q(record.components.travel??'0'):ZERO;
  return uncoveredQuantity(record).mul(unit).add(travel);
}

function object(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Invalid record fields.');
  return value as Record<string,unknown>;
}
function label(value:unknown,field:string,max=160):string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail('Enter '+field+'.');
  return (value as string).trim();
}
function number(value:unknown,field:string,scale=8):string {
  if(typeof value!=='string'||!/^\d{1,10}(?:\.\d{1,8})?$/.test(value)||((value as string).split('.')[1]?.length??0)>scale)fail('Enter a valid '+field+'.');
  const digits=(value as string).split('.')[1]?.length??0;
  return q(value as string).text(digits);
}
function list(value:unknown,limit:number,min:number,field:string):unknown[] {
  if(!Array.isArray(value)||value.length<min||value.length>limit)fail('Enter '+min+' to '+limit+' '+field+'.');
  return value as unknown[];
}
function periodKey(s:FinanceSnapshot,value:unknown) {
  const key=financeKey(value);
  if(!s.periods.some(item=>item.key===key))fail('Use a period in this version.');
  return key;
}
function parseQuantity(value:unknown,module:DevelopmentModule,category:string) {
  return number(value,'quantity or hours',module==='engineering'||category==='internal_test'?8:0);
}
function parseCost(s:FinanceSnapshot,module:DevelopmentModule,ref:string,raw:unknown,currency:string):DevelopmentCost {
  const record=object(raw,['title','group','category','role','stage','quantity','components','period','paymentPeriod','reference','allocationBasis','allocations','coverage','recovery']);
  const category=label(record.category,'cost category');
  if(!(developmentCategories[module] as readonly string[]).includes(category))fail('Choose a category for this page.');
  const stage=module==='validation'?record.stage:null;
  if(stage!==null&&stage!=='DV'&&stage!=='PV'&&stage!=='Certification'||module==='validation'&&stage===null)fail('Choose the validation stage.');
  const role=module==='engineering'?label(record.role,'role'):null;
  const components=Object.fromEntries(Object.entries(object(record.components,developmentComponents[module])).map(([k,v])=>[k,number(v,k)]));
  if(!Object.keys(components).length)fail('Enter at least one cost component.');
  const allocations=list(record.allocations,12,1,'product allocations').map(raw=>{
    const item=object(raw,['productKey','share']),productKey=financeKey(item.productKey),share=number(item.share,'allocation share');
    if(q(share).n<=0n||!s.products.some(product=>product.key===productKey&&product.metadata.active!==false))fail('Allocate to an active product with a positive share.');
    return {productKey,share:q(share).text(8)};
  }).sort((a,b)=>a.productKey.localeCompare(b.productKey));
  if(new Set(allocations.map(a=>a.productKey)).size!==allocations.length||sum(allocations.map(a=>q(a.share))).cmp(ONE)!==0)fail('Unique product allocation shares must add to 1.');
  const coverage=list(record.coverage,15,0,'coverage links').map(raw=>{
    const item=object(raw,['provider','quantity']),quantity=parseQuantity(item.quantity,module,category);
    if(q(quantity).n<=0n)fail('Enter a positive covered quantity.');
    return {provider:financeKey(item.provider),quantity};
  });
  const recoveryRaw=object(record.recovery,['method','amount','earnedPeriod','receiptPeriod','productKey']);
  const method=recoveryRaw.method;
  let recovery:Recovery={method:'none'};
  if(method==='lump_sum'||method==='piece_price'){
    const earnedPeriod=periodKey(s,recoveryRaw.earnedPeriod),receiptPeriod=periodKey(s,recoveryRaw.receiptPeriod);
    if(method==='piece_price'&&periodOrdinal(s,receiptPeriod)<periodOrdinal(s,earnedPeriod))fail('Forecast piece-price receipts must follow sales recognition. Record any actual advance separately.');
    const schedule={amount:number(recoveryRaw.amount,'customer recovery rate or amount',method==='piece_price'?8:s.policy.currencyScales[currency]),
      earnedPeriod,receiptPeriod};
    if(method==='piece_price'){
      const productKey=financeKey(recoveryRaw.productKey??(allocations.length===1?allocations[0].productKey:null));
      if(!allocations.some(item=>item.productKey===productKey))fail('Piece-price recovery must reference one allocated product.');
      recovery={method,productKey,...schedule};
    }else recovery={method,...schedule};
  }else if(method!=='none')fail('Choose a customer recovery method.');
  return {module,costRef:ref,title:label(record.title,'cost title'),group:label(record.group,'stage, batch or round'),category,role,
    stage:stage as DevelopmentCost['stage'],quantity:parseQuantity(record.quantity,module,category),components,period:periodKey(s,record.period),
    paymentPeriod:periodKey(s,record.paymentPeriod),reference:label(record.reference,'source evidence',240),
    allocationBasis:label(record.allocationBasis,'allocation basis',240),allocations,coverage,recovery};
}

export function validateDevelopmentLinks(s:FinanceSnapshot) {
  const costs=developmentCosts(s),byKey=new Map(costs.map(row=>[row.key,row.conversion.cost]));
  for(const {conversion:{cost}} of costs) {
    if(uncoveredQuantity(cost).n<0n||new Set(cost.coverage.map(item=>item.provider)).size!==cost.coverage.length)fail('Covered quantity exceeds the required quantity or repeats a package.');
    if(cost.coverage.length&&(cost.module==='engineering'||cost.category==='package'))fail('Only sample and validation detail can be covered by a package.');
    for(const {provider} of cost.coverage){
      const pkg=byKey.get(provider);
      if(!pkg||pkg.category!=='package'||q(pkg.quantity).n===0n||pkg.stage!=='DV'&&cost.stage==='PV'||
        pkg.allocations.length!==cost.allocations.length||pkg.allocations.some((item,i)=>item.productKey!==cost.allocations[i].productKey||q(item.share).cmp(q(cost.allocations[i].share))!==0))
        fail('Coverage requires an active package with matching allocations. PV coverage must reference a DV package.');
    }
    if(cost.recovery.method!=='none'&&uncoveredQuantity(cost).n===0n)fail('Record recovery for fully covered work on the paying package.');
  }
  for(const {conversion:{actual}} of developmentActuals(s)){
    const cost=byKey.get(actual.costKey)!;
    if(actual.incurred&&q(actual.incurred.amount).n>0n&&uncoveredQuantity(cost).n===0n||
      actual.payment&&q(actual.payment.amount).n>0n&&uncoveredQuantity(cost).n===0n)fail('Record actual cost for fully covered work on the paying package.');
    if(actual.receipt&&cost.recovery.method==='none')fail('Record an agreed customer recovery before entering a receipt.');
  }
}

export function applyDevelopmentChange(s:FinanceSnapshot,raw:unknown,selected:string[],seen:Set<string>) {
  if(!supportsDevelopment(s))fail('Development costs require a manufacturing or CQA version.');
  const change=object(raw,['collection','action','module','costRef','key','record','quantity','currency']);
  const rows=developmentCosts(s),action=change.action;
  let key:string,cost:DevelopmentCost,actual:DevelopmentActual|undefined,previous:FinanceInput|undefined,currency:string;
  if(action==='new'||action==='edit'){
    const module=change.module;
    if(!isDevelopmentModule(module))return fail('Choose a development page.');
    const ref=label(change.costRef,'unique cost / commitment reference',100);
    financeKey(ref);key=costKey(ref);
    const existing=rows.find(row=>row.key===key);
    if(action==='new'&&existing)fail('This cost / commitment reference is already recorded. Open its source row.');
    if(action==='edit'&&(!existing||existing.module!==module||existing.key!==change.key))fail('Use the original cost identity and page.');
    if(action==='edit'&&developmentActuals(s).some(row=>row.conversion.actual.costKey===key))fail('Correct the actual source after execution has been recorded.');
    previous=existing;
    currency=sourceFinanceCurrency(s,change.currency,existing?.currency??developmentCurrency(s));
    cost=parseCost(s,module,ref,change.record,currency);
  } else {
    key=financeKey(change.key);
    const existing=rows.find(row=>row.key===key);
    if(!existing)return fail('This cost is outside the selected version.');
    cost=existing.conversion.cost;previous=existing;
    currency=sourceFinanceCurrency(s,existing.currency,developmentCurrency(s));
    if(action==='quantity'){
      if(developmentActuals(s).some(row=>row.conversion.actual.costKey===key))fail('Correct the actual source after execution has been recorded.');
      cost={...cost,quantity:parseQuantity(change.quantity,cost.module,cost.category)};
    } else if(action==='actual'){
      previous=developmentActuals(s).find(row=>row.key===key+':actual');
      currency=sourceFinanceCurrency(s,change.currency,previous?.currency??currency);
      const record=object(change.record,['incurred','payment','receipt']);
      const fact=(value:unknown):Fact|null=>{
        if(value===null)return null;
        const row=object(value,['amount','period','date','reference']),period=periodKey(s,row.period),date=label(row.date,'event date',10);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Enter a valid event date.');
        const year=s.periods.find(item=>item.key===period)?.metadata.calendarYear;
        if(Number.isInteger(year)&&Number(date.slice(0,4))!==year)fail('Event date and fiscal year do not align.');
        return {amount:number(row.amount,'actual amount',s.policy.currencyScales[currency]),period,date,reference:label(row.reference,'event evidence',240)};
      };
      actual={costKey:key,incurred:fact(record.incurred),payment:fact(record.payment),receipt:fact(record.receipt)};
      if(!actual.incurred&&!actual.payment&&!actual.receipt)fail('Record at least one execution event.');
      key+=':actual';
    } else return fail('Unsupported development action.');
  }
  if(!selected.includes(cost.period))fail('The cost occurrence period is outside the preview range.');
  if(seen.has(key))fail('A cost or actual record may only be changed once per preview.');
  seen.add(key);
  const sourceKey=key+':source',observation=actual?'measured':'budget',sourceFact=actual?.incurred??actual?.payment??actual?.receipt;
  const period=sourceFact?.period??cost.period,date=sourceFact?.date??s.asOf;
  const reference=sourceFact?.reference??cost.reference;
  const amount=actual?q(sourceFact!.amount):plannedCost(cost);
  const value=fixed(amount,s.policy.currencyScales[currency]);
  const productKey=cost.allocations.length===1?cost.allocations[0].productKey:null;
  const source={key:sourceKey,system:'Development costs',externalKey:reference,fingerprint:null,sheet:null,cell:null,owner:cost.module,
    observation:observation as 'measured'|'budget',mappingStatus:'mapped',originalCurrency:currency,originalUnit:currency,originalPeriod:period,
    effectiveFrom:date,effectiveTo:null,metadata:{costRef:cost.costRef}};
  const row:FinanceInput={key,module:cost.module,metricKey:actual?'p10.actual':'p10.cost',productKey,marketKey:null,lineKey:null,periodKey:period,
    sourceKey,value,valueKind:'money',unit:currency,currency,effectiveFrom:date,effectiveTo:null,conversion:actual?{actual}:{cost}};
  s.sources=s.sources.filter(item=>item.key!==sourceKey).concat(source);
  s.inputs=s.inputs.filter(item=>item.key!==key).concat(row);
  return {collection:'development',key,metricKey:row.metricKey,sourceKey,period,productKey,productKeys:cost.allocations.map(item=>item.productKey),
    unit:currency,currency,before:previous?.value??null,after:value,afterLabel:cost.title+' · '+valueText(value)};
}

const valueText=(value:FixedDecimal)=>Decimal.from(value).text(value.scale);
export const laterPeriod=(s:FinanceSnapshot,a:string,b:string)=>periodOrdinal(s,a)>=periodOrdinal(s,b)?a:b;
