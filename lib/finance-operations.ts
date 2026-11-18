import {financeKey} from './finance-contracts.ts';
import type {FinanceInput,FinanceSnapshot,FixedDecimal} from './finance-contracts.ts';
import {archived,businessSlug} from './finance-business.ts';
import {invalid} from './contracts.ts';
import {Decimal,ONE,sum,ZERO} from './finance-decimal.ts';

export const OPERATIONS_VERSION='P09.1';
const hour=Decimal.from(3600);
const prefix='p09.';
export const isOperationsInput=(row:FinanceInput)=>row.metricKey.startsWith(prefix)||row.key.startsWith('p09:');
export const isOperationsSource=(row:{key:string})=>row.key.startsWith('p09:');
export const hasOperationsModel=(s:FinanceSnapshot)=>s.inputs.some(isOperationsInput);
export const supportsOperations=(s:FinanceSnapshot)=>archived(s)||s.policy.rules.model==='manufacturing';
const id=(...parts:string[])=>'p09:'+businessSlug(JSON.stringify(parts));
const fail=(message:string):never=>invalid('Manufacturing: '+message);
const q=Decimal.from;

type Line={line:string;shifts:string;hours:string;days:string;allocation:string;oee:string};
type Station={station:string;operation:string;line:string;people:string;ct:string|null;output:string;repeats:string;efficiency:string};
type Design={type:'design';revision:string;lines:Line[];stations:Station[]};
type Actual={type:'actual';designKey:string;batch:string;date:string;revision:string;stage:'pilot'|'production';personHours:string;goodPieces:string;
  times:Record<string,string|null>;capacityFactors:Record<string,string|null>};
type Rate={type:'rate';rate:string};
type Selection={type:'selection';sourceKey:string;mode:'design'|'actual'|'legacy'};
export type OperationsRecord=(Design|Actual|Rate|Selection)&{reviewer:string;reference:string};
type OperationsRow=FinanceInput&{productKey:string;conversion:{operations:OperationsRecord}};
const operations=(row:FinanceInput)=>row as OperationsRow;
const keyOf=(row:OperationsRow)=>row.conversion.operations;

function object(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Invalid record fields.');
  return value as Record<string,unknown>;
}
function label(value:unknown,field:string,max=120):string {
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail('Enter '+field+'.');
  return (value as string).trim();
}
function number(value:unknown,field:string,{zero=false,max=1000000000,integer=false}={}):string {
  if(typeof value!=='string'||!/^\d{1,10}(?:\.\d{1,8})?$/.test(value))fail('Enter a valid '+field+'.');
  const amount=q(value as string);
  if(amount.n===0n&&!zero||amount.cmp(q(max))>0||integer&&amount.d!==1n)fail('Out of range: '+field+'.');
  return amount.text((value as string).split('.')[1]?.length??0);
}
function list(value:unknown,limit:number,field:string):unknown[] {
  if(!Array.isArray(value)||!value.length||value.length>limit)fail('Enter 1 to '+limit+' '+field+'.');
  return value as unknown[];
}
const validDate=(value:unknown)=>{
  const date=label(value,'batch date',10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Enter a valid batch date.');
  return date;
};
const nullableTime=(value:unknown)=>value===null?null:number(value,'cycle time in seconds');
const fraction=(value:unknown,name:string)=>number(value,name,{max:1});

export function applyOperationsChange(s:FinanceSnapshot,raw:unknown,periods:string[]) {
  if(!supportsOperations(s)||periods.length!==1)fail('Choose one production period in a manufacturing version.');
  const change=object(raw,['collection','productKey','record']);
  const product=financeKey(change.productKey),period=periods[0];
  if(!s.products.some(p=>p.key===product&&p.metadata.active!==false)||!s.periods.some(p=>p.key===period&&Number(p.metadata.ordinal)>0))fail('Choose an active product and production period.');
  const rawRecord=change.record as Record<string,unknown>|undefined;
  const type=rawRecord?.type;
  const fields={
    design:['revision','lines','stations'],actual:['designKey','batch','date','revision','stage','personHours','goodPieces','times','capacityFactors'],
    rate:['rate'],selection:['sourceKey','mode']
  };
  if(typeof type!=='string'||!Object.hasOwn(fields,type))return fail('Unknown operations action.');
  const rec=object(rawRecord,['type','reviewer','reference',...fields[type as keyof typeof fields]]);
  const reviewer=label(rec.reviewer,'reviewer'),reference=label(rec.reference,'source evidence',200);
  const scope=s.inputs.filter(r=>isOperationsInput(r)&&r.productKey===product&&r.periodKey===period).map(operations);
  const find=(key:string,kind:string)=>scope.find(row=>row.key===key&&keyOf(row).type===kind);
  let payload:Design|Actual|Rate|Selection,identity:string[]=[];
  if(type==='design'){
    const revision=label(rec.revision,'design revision');
    const lines=list(rec.lines,20,'physical lines').map(value=>{
      const r=object(value,['line','shifts','hours','days','allocation','oee']);
      const shifts=number(r.shifts,'shifts per day',{max:24,integer:true}),hours=number(r.hours,'net hours per shift',{max:24});
      if(q(shifts).mul(q(hours)).cmp(q(24))>0)fail('Daily net hours cannot exceed 24.');
      return {line:financeKey(r.line),shifts,hours,days:number(r.days,'working days',{max:366,integer:true}),
        allocation:fraction(r.allocation,'allocated line share'),oee:number(r.oee,'equipment OEE',{zero:true,max:1})};
    });
    const stations=list(rec.stations,45,'stations').map(value=>{
      const r=object(value,['station','operation','line','people','ct','output','repeats','efficiency']);
      return {station:financeKey(r.station),operation:label(r.operation,'operation'),line:financeKey(r.line),
        people:number(r.people,'operators',{zero:true,max:1000}),ct:nullableTime(r.ct),output:number(r.output,'units per cycle',{integer:true}),
        repeats:number(r.repeats,'repeats per piece',{integer:true}),efficiency:fraction(r.efficiency,'independent labor efficiency')};
    });
    if(new Set(lines.map(row=>row.line)).size!==lines.length||new Set(stations.map(row=>row.station)).size!==stations.length||
      stations.some(row=>!lines.some(line=>line.line===row.line))||lines.some(line=>!stations.some(row=>row.line===line.line)))
      fail('Use unique line and station IDs and assign every station to a declared line.');
    payload={type,revision,lines,stations};
    identity=[revision];
  } else if(type==='actual'){
    const designKey=financeKey(rec.designKey),design=find(designKey,'design');
    if(!design)return fail('The batch must reference a design for this product and period.');
    const {stations,lines}=keyOf(design) as Design;
    const times=object(rec.times,stations.map(station=>station.station));
    const factors=object(rec.capacityFactors,lines.map(line=>line.line));
    const batch=label(rec.batch,'lot or batch'),revision=label(rec.revision,'measurement revision');
    const stage=rec.stage,date=validDate(rec.date);
    if(stage!=='pilot'&&stage!=='production')return fail('Choose pilot or production.');
    payload={type,designKey,batch,date,revision,stage,personHours:number(rec.personHours,'actual person-hours',{zero:true}),
      goodPieces:number(rec.goodPieces,'good pieces',{zero:true,integer:true}),
      times:Object.fromEntries(stations.map(row=>[row.station,nullableTime(Object.hasOwn(times,row.station)?times[row.station]:null)])),
      capacityFactors:Object.fromEntries(lines.map(({line})=>[line,Object.hasOwn(factors,line)&&factors[line]!==null?
        number(factors[line],'independent measured availability × quality',{zero:true,max:1}):null]))};
    identity=[stage,batch,date,revision];
  } else if(type==='rate'){
    payload={type,rate:number(rec.rate,'calibrated hourly rate',{zero:true})};
  } else {
    const mode=rec.mode;
    if(mode!=='design'&&mode!=='actual'&&mode!=='legacy')return fail('Choose an operations basis.');
    const sourceKey=mode==='legacy'?'':financeKey(rec.sourceKey);
    if(mode!=='legacy'&&!find(sourceKey,mode))fail('Choose an available source for this product and period.');
    payload={type:'selection',mode,sourceKey};
  }
  const key=id(product,period,type,...identity),sourceKey=key+':source',previous=find(key,type);
  if(previous&&(type==='design'||type==='actual'))fail('This record already exists. Use a new design or measurement revision.');
  const content:OperationsRecord={...payload,reviewer,reference};
  const day=payload.type==='actual'?payload.date:s.asOf;
  const currency=archived(s)?'CNY':s.currency;
  const unit=payload.type==='rate'?currency+'/person-hour':'record';
  const value:FixedDecimal=payload.type==='rate'?{coefficient:BigInt(payload.rate.replace('.','')).toString(),scale:payload.rate.split('.')[1]?.length??0}:{coefficient:'1',scale:0};
  const source={key:sourceKey,system:'Manufacturing route',externalKey:reference,fingerprint:null,sheet:null,cell:null,owner:reviewer,
    observation:payload.type==='actual'?'measured' as const:'design' as const,mappingStatus:'mapped',originalCurrency:payload.type==='rate'?currency:null,
    originalUnit:unit,originalPeriod:period,effectiveFrom:day,effectiveTo:null,metadata:{reviewer}};
  const row:OperationsRow={key,module:'operations',metricKey:prefix+type,productKey:product,marketKey:null,lineKey:null,periodKey:period,sourceKey,
    value,valueKind:payload.type==='rate'?'unit_price':'quantity',unit,currency:source.originalCurrency,effectiveFrom:day,effectiveTo:null,conversion:{operations:content}};
  s.sources=s.sources.filter(item=>item.key!==sourceKey).concat(source);
  s.inputs=s.inputs.filter(item=>item.key!==key).concat(row);
  const describe=(record:OperationsRecord)=>{
    const selected=record.type==='selection'?find(record.sourceKey,record.mode):undefined;
    return recordLabel(selected?keyOf(selected):record);
  };
  return {collection:'operations',key,metricKey:row.metricKey,period,productKey:product,sourceKey,unit,currency:row.currency,
    before:previous?.value??null,after:value,beforeLabel:previous?describe(keyOf(previous)):type==='selection'?'Existing labor basis':null,afterLabel:describe(content)};
}

function recordLabel(record:OperationsRecord) {
  if(record.type==='design')return 'Design '+record.revision;
  if(record.type==='actual')return (record.stage==='pilot'?'Pilot':'Production')+' · '+record.batch+' · '+record.date+' · Rev '+record.revision;
  if(record.type==='rate')return record.rate;
  return {design:'Design',actual:'Measured',legacy:'Existing labor basis'}[record.mode];
}

export function operationsIndex(s:FinanceSnapshot) {
  const records=s.inputs.filter(isOperationsInput).map(operations);
  const byKey=new Map(records.map(row=>[row.key,row]));
  function scope(product:string,period:string) {
    const items=records.filter(row=>row.productKey===product&&row.periodKey===period);
    const rate=items.find(row=>keyOf(row).type==='rate');
    const selection=items.find(row=>keyOf(row).type==='selection');
    const choice=selection&&keyOf(selection) as Selection|undefined;
    const selected=choice&&byKey.get(choice.sourceKey);
    const record=selected&&keyOf(selected);
    const design=record?.type==='actual'?byKey.get(record.designKey):selected;
    return {items,rate,selection,selected,record,design};
  }
  const allocated=new Map<string,{product:string;line:Line}[]>();
  const pool=(period:string,line:string)=>period+'|'+line;
  for(const row of records.filter(item=>keyOf(item).type==='selection')){
    const design=scope(row.productKey,row.periodKey).design;
    if(design)for(const line of (keyOf(design) as Design).lines){
      const key=pool(row.periodKey,line.line);
      allocated.set(key,[...allocated.get(key)??[],{product:row.productKey,line}]);
    }
  }
  function evaluate(design:OperationsRow,actual:Actual|undefined,demand:Decimal|null) {
    const model=keyOf(design) as Design;
    const workSeconds=(line:Line)=>q(line.days).mul(q(line.shifts)).mul(q(line.hours)).mul(hour);
    const lines=model.lines.map(line=>{
      const other=(allocated.get(pool(design.periodKey,line.line))??[]).filter(item=>item.product!==design.productKey);
      const overbooked=sum([q(line.allocation),...other.map(item=>q(item.line.allocation))]).cmp(ONE)>0;
      const scheduleConflict=other.some(item=>workSeconds(item.line).cmp(workSeconds(line))!==0);
      const usable=workSeconds(line).mul(q(line.allocation)),takt=demand&&demand.n>0n?usable.div(demand):null;
      const stations=model.stations.filter(row=>row.line===line.line).map(row=>{
        const ct=actual?actual.times[row.station]:row.ct;
        const work=ct===null?null:q(ct).mul(q(row.repeats)).div(q(row.output));
        return {row,ct,work};
      });
      const complete=stations.every(s=>s.work!==null);
      const longest=complete?stations.reduce((max,s)=>s.work!.cmp(max)>0?s.work!:max,ZERO):null;
      const bottlenecks=longest?stations.filter(s=>s.work!.cmp(longest)===0):[];
      const factor=actual?actual.capacityFactors[line.line]:line.oee;
      const capacity=longest&&factor!==null&&!overbooked&&!scheduleConflict?usable.mul(q(factor)).div(longest):null;
      const balance=longest?sum(stations.map(s=>s.work!)).div(longest.mul(q(stations.length))):null;
      return {line,stations,takt,longest,capacity,balance,bottlenecks,overbooked,scheduleConflict,factor,shared:other.length>0||q(line.allocation).cmp(ONE)<0};
    });
    const issues=lines.flatMap(line=>[
      ...line.stations.filter(s=>s.work===null).map(s=>'Missing cycle time at '+s.row.station+'.'),
      ...(line.overbooked?['Shared line '+line.line.line+' exceeds 100% of its available schedule.']:[]),
      ...(line.scheduleConflict?['Shared line '+line.line.line+' has conflicting net schedules.']:[])
    ]);
    if(actual&&q(actual.goodPieces).n===0n)issues.push('The batch has no good pieces for the labor denominator.');
    const personHours=actual?q(actual.goodPieces).n>0n?q(actual.personHours).div(q(actual.goodPieces)):null:model.stations.every(s=>s.ct!==null)?
      sum(model.stations.map(s=>q(s.ct!).mul(q(s.repeats)).mul(q(s.people)).div(hour).div(q(s.output)).div(q(s.efficiency)))):null;
    return {lines,issues,personHours};
  }
  return {scope,evaluate};
}
