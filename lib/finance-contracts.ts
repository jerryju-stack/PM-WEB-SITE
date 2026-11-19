import {invalid} from './contracts.ts';
import {financeEditCapabilities} from './finance-schema.ts';
import {readFxSnapshot} from './finance-fx.ts';
import type {FinanceFxSnapshot} from './finance-fx.ts';

export type FixedDecimal={coefficient:string;scale:number};
export type FinanceModule=keyof typeof financeEditCapabilities;
export type Dimension={key:string;label:string;metadata:Record<string,unknown>};
export type FinanceSource={
  key:string;system:string;externalKey:string;fingerprint:string|null;sheet:string|null;cell:string|null;
  owner:string;observation:'measured'|'design'|'budget'|'cached'|'unknown';mappingStatus:string;
  originalCurrency:string|null;originalUnit:string;originalPeriod:string;effectiveFrom:string;effectiveTo:string|null;
  metadata:Record<string,unknown>
};
export type FinanceInput={
  key:string;module:FinanceModule;metricKey:string;productKey:string|null;marketKey:string|null;lineKey:string|null;
  periodKey:string;sourceKey:string;value:FixedDecimal;valueKind:'money'|'unit_price'|'rate'|'quantity';
  unit:string;currency:string|null;effectiveFrom:string;effectiveTo:string|null;conversion:Record<string,unknown>
};
export type FinanceEvent={
  key:string;module:FinanceModule;productKey:string|null;marketKey:string|null;lineKey:string|null;periodKey:string;sourceKey:string;
  kind:'budget'|'incurred'|'payment'|'recovery'|'etc';amount:FixedDecimal;currency:string;
  eventDate:string|null;relatedKey:string|null;evidenceKey:string
};
export type FinanceSnapshot={
  name:string;currency:string;currencyScale:number;basis:'website'|'cqa_full'|'cqa_incremental';asOf:string;
  dictionaryVersion:string;calculationVersion:string;
  policy:{currencyScales:Record<string,number>;cashFlowOriginPeriod:string;rounding:'half_away_from_zero';rules:Record<string,unknown>;fx?:FinanceFxSnapshot};
  products:Dimension[];markets:Dimension[];lines:Dimension[];periods:Dimension[];sources:FinanceSource[];
  inputs:FinanceInput[];events:FinanceEvent[]
};
export type FinanceProjectState={approvedBaselineId:string|null;currentVersionId:string|null;stateRevision:number};
export type FinanceVersionSummary={
  id:string;projectId:string;parentId:string|null;name:string;status:'draft'|'frozen';revision:number;
  currency:string;currencyScale:number;basis:FinanceSnapshot['basis'];asOf:string;dictionaryVersion:string;calculationVersion:string;
  model?:string;
  createdUid:string;updatedUid:string;approvedUid:string|null;createdAt:string;updatedAt:string;approvedAt:string|null
};
export type FinanceWriteResult=FinanceProjectState&{ok:true;id:string;projectId:string;revision:number;status:'draft'|'frozen';changeSetId:string;snapshotSha256:string};
const fail=(message:string):never=>invalid('Finance: '+message);
function obj(v:any,keys?:string[]):any {
  if(!v||typeof v!=='object'||Array.isArray(v))fail('object required');
  if(keys&&Object.keys(v).some(k=>!keys.includes(k)))fail('unknown field');
  return v;
}
function str(v:any,max=200):string {if(typeof v!=='string'||!v.trim()||v.length>max)fail('invalid text');return v;}
export function financeKey(v:any):string {if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v))fail('invalid stable key');return v;}
const nullable=(v:any,parse:(v:any)=>any)=>v===null?null:parse(v);
const choice=<T extends string>(v:any,values:readonly T[]):T=>{if(!values.includes(v))fail('invalid enum');return v;};
const currency=(v:any):string=>{if(typeof v!=='string'||!/^[A-Z]{3}$/.test(v))fail('invalid currency');return v;};
function date(v:any):string {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('invalid date');return v;
}
function range(v:any){const from=date(v.effectiveFrom),to=nullable(v.effectiveTo,date);if(to&&to<from)fail('inverted effective range');return {effectiveFrom:from,effectiveTo:to};}
function metadata(v:any):Record<string,unknown> {obj(v);if(JSON.stringify(v).length>20000)fail('metadata too large');return JSON.parse(JSON.stringify(v));}
export function fixedDecimal(v:any):FixedDecimal {
  obj(v,['coefficient','scale']);
  if(typeof v.coefficient!=='string'||! /^(0|-?[1-9][0-9]{0,59})$/.test(v.coefficient)||!Number.isInteger(v.scale)||v.scale<0||v.scale>12)fail('canonical integer string and scale 0..12 required');
  return {coefficient:v.coefficient,scale:v.scale};
}
function array<T>(v:any,parse:(v:any)=>T,limit=2000):T[] {if(!Array.isArray(v)||v.length>limit)fail('bounded array required');return v.map(parse);}
function unique<T extends {key:string}>(rows:T[]):T[] {if(new Set(rows.map(r=>r.key)).size!==rows.length)fail('duplicate stable key');return rows.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);}
const dim=(v:any):Dimension=>{obj(v,['key','label','metadata']);return {key:financeKey(v.key),label:str(v.label),metadata:metadata(v.metadata)};};
const scopeKeys=['key','module','productKey','marketKey','lineKey','periodKey','sourceKey'];
function scope(v:any) {
  return {key:financeKey(v.key),module:choice(v.module,Object.keys(financeEditCapabilities) as FinanceModule[]),
    productKey:nullable(v.productKey,financeKey),marketKey:nullable(v.marketKey,financeKey),lineKey:nullable(v.lineKey,financeKey),
    periodKey:financeKey(v.periodKey),sourceKey:financeKey(v.sourceKey)};
}
export function financeSnapshot(value:unknown,limit=2000):FinanceSnapshot {
  const v=obj(value,['name','currency','currencyScale','basis','asOf','dictionaryVersion','calculationVersion','policy','products','markets','lines','periods','sources','inputs','events']);
  const p=obj(v.policy,['currencyScales','cashFlowOriginPeriod','rounding','rules','fx']),scales:Record<string,number>={};
  if(p.fx!==undefined&&p.rules?.importFormat==='cqa-import-P05.1')fail('CQA workbook versions retain their approved workbook FX basis');
  for(const [key,scale] of Object.entries(obj(p.currencyScales))) {
    currency(key);if(!Number.isInteger(scale)||Number(scale)<0||Number(scale)>4)fail('invalid currency precision');scales[key]=Number(scale);
  }
  const result:FinanceSnapshot={
    name:str(v.name),currency:currency(v.currency),currencyScale:v.currencyScale,basis:choice(v.basis,['website','cqa_full','cqa_incremental']),
    asOf:date(v.asOf),dictionaryVersion:str(v.dictionaryVersion,100),calculationVersion:str(v.calculationVersion,100),
    policy:{currencyScales:scales,cashFlowOriginPeriod:financeKey(p.cashFlowOriginPeriod),rounding:choice(p.rounding,['half_away_from_zero']),rules:metadata(p.rules),
      ...(p.fx===undefined?{}:{fx:readFxSnapshot(p.fx,scales)})},
    products:unique(array(v.products,dim)),markets:unique(array(v.markets,dim)),lines:unique(array(v.lines,dim)),periods:unique(array(v.periods,dim)),
    sources:unique(array(v.sources,(r:any):FinanceSource=>{
      obj(r,['key','system','externalKey','fingerprint','sheet','cell','owner','observation','mappingStatus','originalCurrency','originalUnit','originalPeriod','effectiveFrom','effectiveTo','metadata']);
      return {key:financeKey(r.key),system:str(r.system),externalKey:str(r.externalKey,1000),fingerprint:nullable(r.fingerprint,x=>str(x,200)),
        sheet:nullable(r.sheet,x=>str(x)),cell:nullable(r.cell,x=>str(x)),owner:str(r.owner),observation:choice(r.observation,['measured','design','budget','cached','unknown']),
        mappingStatus:choice(r.mappingStatus,['mapped','mapped_cqa_cash','derived','mapped_cqa_gross','mapped_cqa_incremental','pending_finance','to_collect','design_only','pending_inputs','cached_external','reference_only']),
        originalCurrency:nullable(r.originalCurrency,currency),originalUnit:str(r.originalUnit),originalPeriod:str(r.originalPeriod),...range(r),metadata:metadata(r.metadata)};
    },limit)),
    inputs:unique(array(v.inputs,(r:any):FinanceInput=>{
      obj(r,[...scopeKeys,'metricKey','value','valueKind','unit','currency','effectiveFrom','effectiveTo','conversion']);
      return {...scope(r),metricKey:financeKey(r.metricKey),value:fixedDecimal(r.value),valueKind:choice(r.valueKind,['money','unit_price','rate','quantity']),
        unit:str(r.unit),currency:nullable(r.currency,currency),...range(r),conversion:metadata(r.conversion)};
    },limit)),
    events:unique(array(v.events,(r:any):FinanceEvent=>{
      obj(r,[...scopeKeys,'kind','amount','currency','eventDate','relatedKey','evidenceKey']);
      return {...scope(r),kind:choice(r.kind,['budget','incurred','payment','recovery','etc']),amount:fixedDecimal(r.amount),currency:currency(r.currency),
        eventDate:nullable(r.eventDate,date),relatedKey:nullable(r.relatedKey,financeKey),evidenceKey:str(r.evidenceKey,1000)};
    },limit))
  };
  if(!Number.isInteger(result.currencyScale)||scales[result.currency]!==result.currencyScale)fail('report currency precision must be declared');
  const sets=Object.fromEntries(['products','markets','lines','periods','sources'].map(k=>[k,new Set((result as any)[k].map((r:any)=>r.key))]));
  if(!sets.periods.has(result.policy.cashFlowOriginPeriod))fail('cash flow origin period missing');
  const ordinals=new Set<number>();
  for(const period of result.periods) {
    const n=period.metadata.ordinal;
    if(!Number.isSafeInteger(n)||Number(n)<0||ordinals.has(Number(n)))fail('period requires unique nonnegative ordinal');
    ordinals.add(Number(n));
    if(period.key===result.policy.cashFlowOriginPeriod&&n!==0)fail('cash flow origin must have ordinal zero');
  }
  function money(amount:FixedDecimal,code:string) {if(scales[code]===undefined||amount.scale!==scales[code])fail('money must use declared currency precision');}
  const byEvent=new Map(result.events.map(e=>[e.key,e]));
  for(const row of [...result.inputs,...result.events]) {
    for(const [field,table] of [['productKey','products'],['marketKey','markets'],['lineKey','lines'],['periodKey','periods'],['sourceKey','sources']]) {
      const key=(row as any)[field];if(key!==null&&!sets[table].has(key))fail('reference outside this version: '+field);
    }
    if('value' in row) {
      if(row.valueKind==='money'){if(!row.currency)fail('money requires currency');money(row.value,row.currency!);}
      if(row.valueKind==='unit_price'&&!row.currency)fail('unit price requires currency');
      if(row.currency&&scales[row.currency]===undefined)fail('undeclared currency');
    } else {
      money(row.amount,row.currency);
      if(row.relatedKey&&(!byEvent.has(row.relatedKey)||row.relatedKey===row.key))fail('invalid related event');
      if(row.kind==='payment'&&row.relatedKey&&byEvent.get(row.relatedKey)!.kind!=='incurred')fail('payment must link to an incurred event');
    }
  }
  for(const event of result.events) {
    const seen=new Set<string>();let current:FinanceEvent|undefined=event;
    while(current) {if(seen.has(current.key))fail('cyclic event linkage');seen.add(current.key);current=current.relatedKey?byEvent.get(current.relatedKey):undefined;}
  }
  return result;
}
export function financeCommand(value:unknown,keys:string[]) {
  const v=obj(value,['requestKey','reason',...keys]);
  financeKey(v.requestKey);str(v.reason,2000);
  return v as {requestKey:string;reason:string;[key:string]:any};
}
export function financeRevision(v:any):number {
  if(!Number.isSafeInteger(v)||v<0)invalid('Finance revision required',409);return v;
}
