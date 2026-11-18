import type {CalculationReport,InputEvidence} from './finance-calculation-types.ts';
import type {FinanceInput,FinanceEvent,FinanceSnapshot,FinanceSource} from './finance-contracts.ts';
import {archived,businessFields,businessInputs,isBusiness} from './finance-business.ts';
import {Decimal} from './finance-decimal.ts';

type Kind='input'|'event'|'source'|'policy';
type Locator={kind:Kind;key:string;route:string;row:string|null;product:string|null;period:string|null;
  market:string|null;label:string;reference:string|null;unit:string|null};
const section=(module:string)=>module==='factory'?'factory-costs':module==='version'?'returns':module;
const findArchiveModule=(source:FinanceSource|undefined)=>
  source?.sheet==='AME'?'operations':source?.sheet==='BOM'?'bom':'returns';
const caption=(key:string)=>key.replace(/[_.]/g,' ');
const comparisonPolicy=(s:FinanceSnapshot)=>({model:s.policy.rules.model,budgetComplete:s.policy.rules.budgetComplete,
  budgetIncurredBasis:s.policy.rules.budgetIncurredBasis,periods:s.periods.map(row=>[row.key,row.metadata.ordinal,row.metadata.calendarYear]),
  products:s.products.filter(row=>row.metadata.active!==false).map(row=>row.key),origin:s.policy.cashFlowOriginPeriod,
  currency:s.currency,currencyScale:s.currencyScale,basis:s.basis});
const fixed=(value:FinanceInput['value'])=>Decimal.from(value).text(value.scale);
const normalized=(value:FinanceInput['value'])=>Decimal.from(value).text().replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');

export function financeSourceIndex(snapshot:FinanceSnapshot){
  const inputs=new Map(snapshot.inputs.map(row=>[row.key,row])),events=new Map(snapshot.events.map(row=>[row.key,row])),
    sources=new Map(snapshot.sources.map(row=>[row.key,row]));
  if(archived(snapshot))for(const row of businessInputs(snapshot))if(!inputs.has(row.key))inputs.set(row.key,row);
  const bySource=new Map<string,FinanceInput>();
  for(const row of snapshot.inputs)if(!bySource.has(row.sourceKey))bySource.set(row.sourceKey,row);

  function locate(kind:Kind,key:string,evidence?:InputEvidence):Locator|null{
    if(kind==='policy'){
      if(!['discount_rate','operating_mapping','budget_policy','reporting_scope','version_metadata'].includes(key))return null;
      return {kind,key,route:key==='budget_policy'?'budget':'returns',row:null,product:null,market:null,period:null,
        label:caption(key),reference:evidence?.role??null,unit:key==='discount_rate'?'fraction':null};
    }
    const input=kind==='input'?inputs.get(key):undefined,event=kind==='event'?events.get(key):undefined;
    const inputOrEvent=input??event,source=sources.get(kind==='source'?key:inputOrEvent?.sourceKey??'');
    if(!inputOrEvent&&!(kind==='source'&&source))return null;
    const mapped=input??(kind==='source'?bySource.get(key):undefined),module=inputOrEvent?.module??mapped?.module??findArchiveModule(source);
    const record=input?.conversion as {actual?:{costKey:string};capital?:{kind:string};operations?:{type:string}}|undefined;
    const metric=input?.metricKey??event?.kind??mapped?.metricKey??source?.externalKey??key;
    const route=section(module),label=input&&isBusiness(input)?businessFields[input.conversion.businessField][1]+' · '+input.conversion.label:
      evidence?.role??caption(metric);
    const recordRoute=input&&(isBusiness(input)||!input.metricKey.startsWith('p')&&['commercial','bom','factory','operations'].includes(input.module)||
      input.metricKey==='p09.design'||input.metricKey==='p09.actual'||input.metricKey==='p10.cost'||record?.actual||
      record?.capital&&record.capital.kind!=='valuation')?
      record?.actual?.costKey??input.key:event&&module==='budget'?event.key:null;
    return {kind,key,route,row:recordRoute,product:inputOrEvent?.productKey??mapped?.productKey??null,
      market:inputOrEvent?.marketKey??mapped?.marketKey??null,unit:input?.unit??event?.currency??source?.originalUnit??null,period:evidence?.periods.length===1?evidence.periods[0]:
        inputOrEvent?.periodKey??source?.originalPeriod??null,label,
      reference:[source?.sheet,source?.cell].filter(Boolean).join('!')||source?.externalKey||evidence?.cell||null};
  }
  function forEvidence(input:InputEvidence){
    if(input.inputKey&&inputs.has(input.inputKey))return locate('input',input.inputKey,input);
    if(input.inputKey&&events.has(input.inputKey))return locate('event',input.inputKey,input);
    if(input.sourceKey)return locate('source',input.sourceKey,input);
    if(input.id==='policy:discount_rate')return locate('policy','discount_rate',input);
    return null;
  }
  function details(kind:Kind,key:string,period:string|null){
    const link=locate(kind,key);
    if(!link)return null;
    const input=kind==='input'?inputs.get(key):undefined,event=kind==='event'?events.get(key):undefined;
    const source=sources.get(kind==='source'?key:input?.sourceKey??event?.sourceKey??'');
    const overrides=input?.conversion.p06Overrides as Record<string,FinanceInput['value']>|undefined;
    const excel=source?.metadata.excel as {state?:string;value?:unknown;formula?:unknown}|undefined;
    const value=input?fixed(overrides?.[period??input.periodKey]??input.value)+' '+input.unit:event?fixed(event.amount)+' '+event.currency:
      excel?.state==='number'?String(excel.value)+' '+source?.originalUnit:null;
    const policy=kind==='policy'?key==='discount_rate'?{discountRate:snapshot.policy.rules.discountRate,reference:snapshot.policy.rules.discountSource}:
      key==='operating_mapping'?{operatingMapping:snapshot.policy.rules.operatingMapping}:
      key==='reporting_scope'?comparisonPolicy(snapshot):
      {name:snapshot.name,asOf:snapshot.asOf}:null;
    return {link,record:{value,period:period??link.period,product:link.product,market:link.market,rowKey:key,
      sourceKey:source?.key??null,reference:link.reference,system:source?.system??null,owner:source?.owner??null,
      observation:source?.observation??null,formula:typeof excel?.formula==='string'?excel.formula:null,
      fields:input?.conversion.operations??input?.conversion.cost??input?.conversion.actual??input?.conversion.capital??
        input?.conversion.scope??input?.conversion.policy??source?.metadata.execution??policy??null}};
  }
  return {inputs,events,sources,locate,forEvidence,details};
}

const entries=(v:unknown,prefix=''):Record<string,string>=>{
  if(v===undefined)return {};
  if(v===null||typeof v!=='object')return {[prefix]:String(v)};
  return Object.fromEntries(Object.entries(v).flatMap(([key,item])=>Object.entries(entries(item,prefix?prefix+'.'+key:key))));
};
const compareFields=(before:unknown,after:unknown,unit:string|null)=>{
  const a=entries(before),z=entries(after);
  return [...new Set([...Object.keys(a),...Object.keys(z)])].filter(key=>a[key]!==z[key])
    .map(key=>{
      const before=a[key]??null,after=z[key]??null;
      const rate=/(?:^|\.)(discount|tax|configuration|oee|efficiency|share)$/.test(key)||
        unit==='fraction'&&(key==='value'||key.startsWith('overrides.'));
      const read=(value:string|null)=>{try{return value===null?null:Decimal.from(value);}catch{return null;}};
      const original=rate?read(before):null,revised=rate?read(after):null;
      const percentagePoints=original&&revised?revised.sub(original).mul(Decimal.from(100)).text(2):null;
      return {key,before,after,percentagePoints};
    });
};
const inputFields=(row:FinanceInput|undefined)=>{
  if(!row)return undefined;
  const {conversion,...rest}=row;
  if(isBusiness(row))return {value:normalized(row.value),currency:row.currency,product:row.productKey,market:row.marketKey,
    period:row.periodKey,source:row.sourceKey,partNumber:conversion.partNumber,assetKey:conversion.assetKey};
  const structured=conversion.operations??conversion.cost??conversion.actual??conversion.capital??conversion.policy??conversion.scope;
  if(structured)return {record:structured,product:row.productKey,period:row.periodKey};
  const overrides=conversion.p06Overrides as Record<string,FinanceInput['value']>|undefined;
  return {...rest,value:Decimal.from(row.value).text(),overrides:overrides&&Object.fromEntries(Object.entries(overrides)
    .filter(([,value])=>Decimal.from(value).cmp(Decimal.from(row.value))!==0).map(([period,value])=>[period,Decimal.from(value).text()]))};
};
const eventFields=(event:FinanceEvent|undefined,source:FinanceSource|undefined)=>
  event&&{...event,amount:Decimal.from(event.amount).text(),record:source?.metadata.execution};
const sourceFields=(source:FinanceSource|undefined)=>source&&{
  externalKey:source.externalKey,sheet:source.sheet,cell:source.cell,owner:source.owner,observation:source.observation,
  mapping:source.mappingStatus,period:source.originalPeriod,currency:source.originalCurrency,unit:source.originalUnit,
  excel:source.metadata.excel
};
const metadataPath=/(?:^|\.)(?:reference|owner|observation|title|stage|reviewer|revision|operation|role|group|system|externalKey|purchaseReference|meReference|allocationBasis|basis|documentId|evidenceKey|decisionReference|date|eventDate|category)(?:$|\.)/i;
const operationalPath=/(?:^|\.)(?:oee|shifts|hours|days|allocation|capacityFactors|times)(?:$|\.)/;

export function comparisonSources(before:FinanceSnapshot,after:FinanceSnapshot,left:CalculationReport,right:CalculationReport){
  const a=financeSourceIndex(before),z=financeSourceIndex(after);
  type Change={before:Locator|null;after:Locator|null;fields:ReturnType<typeof compareFields>;scope:'evidence'|'capacity'|'driver'};
  const changes:Change[]=[],changed=new Set<string>();
  function compare(kind:Kind,key:string,old:unknown,next:unknown,scope?:Change['scope']){
    const oldLink=a.locate(kind,key),newLink=z.locate(kind,key);
    const fields=compareFields(old,next,newLink?.unit??oldLink?.unit??null);
    if(!fields.length)return;
    changed.add(kind+':'+key);
    if(!oldLink&&!newLink)return;
    const effective=scope??(fields.every(field=>metadataPath.test(field.key))?'evidence':
      [oldLink?.route,newLink?.route].includes('operations')&&fields.every(field=>metadataPath.test(field.key)||operationalPath.test(field.key))?'capacity':'driver');
    changes.push({before:oldLink,after:newLink,fields,scope:effective});
  }
  const keys=(a:Map<string,unknown>,z:Map<string,unknown>)=>[...new Set([...a.keys(),...z.keys()])].sort();
  for(const key of keys(a.inputs,z.inputs)){
    const old=a.inputs.get(key),next=z.inputs.get(key);
    compare('input',key,inputFields(old),inputFields(next));
  }
  for(const key of keys(a.events,z.events)){
    const old=a.events.get(key),next=z.events.get(key);
    compare('event',key,eventFields(old,a.sources.get(old?.sourceKey??'')),eventFields(next,z.sources.get(next?.sourceKey??'')));
  }
  // Imported statements can change a raw cell without changing its mapped input row.
  const used=new Set([...Object.values(left.inputs),...Object.values(right.inputs)].map(input=>input.sourceKey).filter(Boolean));
  for(const key of used)if(key)compare('source',key,sourceFields(a.sources.get(key)),sourceFields(z.sources.get(key)));
  compare('policy','discount_rate',{discount:before.policy.rules.discountRate,reference:before.policy.rules.discountSource},
    {discount:after.policy.rules.discountRate,reference:after.policy.rules.discountSource});
  compare('policy','operating_mapping',before.policy.rules.operatingMapping,after.policy.rules.operatingMapping);
  compare('policy','version_metadata',{name:before.name,asOf:before.asOf},{name:after.name,asOf:after.asOf},'evidence');
  compare('policy','reporting_scope',comparisonPolicy(before),comparisonPolicy(after));
  const links=(side:'before'|'after',ids:string[],period:string)=>{
    const report=side==='before'?left:right,index=side==='before'?a:z;
    const selected=new Map<string,{location:Locator;changed:boolean}>();
    for(const id of ids){
      const item=report.inputs[id],location=item&&index.forEvidence(item);
      if(!location)continue;
      const key=location.kind+':'+location.key+':'+(location.period??period);
      const isChanged=changed.has(location.kind+':'+location.key)||!!item.sourceKey&&changed.has('source:'+item.sourceKey);
      if(!selected.has(key))selected.set(key,{location,changed:isChanged});
    }
    const all=[...selected.values()];
    return all.filter(item=>!all.some(row=>row.changed)||item.changed).map(item=>item.location);
  };
  return {changes,links};
}
