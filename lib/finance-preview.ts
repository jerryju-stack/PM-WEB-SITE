import {financeSnapshot,fixedDecimal,financeKey} from './finance-contracts.ts';
import type {FinanceInput,FinanceSnapshot,FixedDecimal} from './finance-contracts.ts';
import type {CalculationReport} from './finance-calculation-types.ts';
import {compareCalculations} from './finance-calculation.ts';
import {invalid} from './contracts.ts';
import {addBusinessRecord,businessInputs,isBusiness,validateBusinessChange} from './finance-business.ts';
import {Decimal} from './finance-decimal.ts';
import {applyOperationsChange,operationsIndex} from './finance-operations.ts';
import {applyDevelopmentChange,isDevelopmentModule,supportsDevelopment,validateDevelopmentLinks} from './finance-development.ts';
import {applyCapitalChange,validateCapitalLinks} from './finance-capital.ts';
import {applyBudgetChange,budgetAction,hasBudgetExecution,isBudgetEvent} from './finance-budget.ts';

export type FinanceChange={collection:'inputs'|'events';key:string;value:FixedDecimal};
export type EffectivePeriod={from:string;to:string};
export const websiteDrivers=new Set(['cash_flow','volume','unit_sales','unit_material','cycle_time','people','hourly_rate','labor_efficiency','units_per_cycle','cycles_per_unit','other_cost','cash_adjustment','fx_to_base']);
export const cqaDrivers=new Set(['cqa.operations.cycle_time','cqa.operations.people','cqa.operations.hourly_rate','cqa.cqa_full.unit_material']);

export function supportsFinanceDriver(snapshot:FinanceSnapshot, metricKey:string) {
  if(snapshot.policy.rules.importFormat==='cqa-import-P05.1')return cqaDrivers.has(metricKey);
  if(snapshot.policy.rules.model==='cash_series')return metricKey==='cash_flow';
  return snapshot.policy.rules.model==='manufacturing'&&websiteDrivers.has(metricKey)&&metricKey!=='cash_flow';
}

/** The older aggregate assumptions remain in the snapshot when a detailed module takes over. */
export function replacedFinanceDriver(snapshot:FinanceSnapshot,row:FinanceInput) {
  if(snapshot.policy.rules.model!=='manufacturing'||!['volume','unit_sales','unit_material'].includes(row.metricKey))return false;
  const module=row.metricKey==='unit_material'?'bom':'commercial';
  return snapshot.inputs.some(candidate=>isBusiness(candidate)&&candidate.module===module&&
    candidate.productKey===row.productKey&&candidate.periodKey===row.periodKey&&candidate.conversion.businessField!=='tooling');
}

/** Compact edits cannot replace sources, dimensions, formulas or controls, including on large P05 versions. */
export function applyFinanceChanges(before:FinanceSnapshot,raw:unknown,effective:any,actorUid?:string) {
  if(!Array.isArray(raw)||raw.length>200||!raw.length)invalid('Finance changeSet must contain 1..200 changes.');
  if(!effective||typeof effective!=='object'||Array.isArray(effective)||Object.keys(effective).some(k=>!['from','to'].includes(k)))invalid('Finance effectivePeriod requires from and to period keys.');
  const periods=[...before.periods].sort((a,b)=>Number(a.metadata.ordinal)-Number(b.metadata.ordinal));
  const from=periods.findIndex(p=>p.key===effective.from),to=periods.findIndex(p=>p.key===effective.to);
  if(from<0||to<from)invalid('Finance effectivePeriod is outside this version or inverted.');
  const selected=periods.slice(from,to+1).map(p=>p.key),candidate=structuredClone(before),seen=new Set<string>(),fields:any[]=[];
  if(budgetAction(raw)){
    const field=applyBudgetChange(candidate,(raw as unknown[])[0],selected,actorUid);
    return {candidate:financeSnapshot(candidate,50000),fields:[field],effectivePeriod:{from:effective.from,to:effective.to} as EffectivePeriod};
  }
  const isCqa=before.policy.rules.importFormat==='cqa-import-P05.1';
  const editedAggregates=new Set<string>();
  let business:ReturnType<typeof businessInputs>|undefined;
  const development=new Set<string>();
  const capital=new Set<string>();
  const recordField=(row:ReturnType<typeof businessInputs>[number],old:FixedDecimal|null,value:FixedDecimal,oldCurrency:string|null)=>{
    fields.push({collection:'inputs',key:row.key,metricKey:row.metricKey,period:row.periodKey,productKey:row.productKey,marketKey:row.marketKey,
      sourceKey:row.sourceKey,unit:row.unit,currency:row.currency,beforeCurrency:oldCurrency,before:old,after:value});
  };
  for(const change of raw as any[]) {
    if(!change||typeof change!=='object'||Array.isArray(change))invalid('Unsupported finance change shape.');
    if(change.collection==='development'){
      fields.push(applyDevelopmentChange(candidate,change,selected,development));
      continue;
    }
    if(change.collection==='capital'){
      fields.push(applyCapitalChange(candidate,change,selected,capital));
      continue;
    }
    if(change.collection==='operations'){
      if((raw as unknown[]).length!==1)invalid('Preview one manufacturing route action at a time.');
      fields.push(applyOperationsChange(candidate,change,selected));
      continue;
    }
    if(change.collection==='business'){
      const added=addBusinessRecord(candidate,change,selected);
      for(const row of added){seen.add('inputs:'+row.key);recordField(row,null,row.value,null);}
      business=undefined;
      continue;
    }
    if(Object.keys(change).some(k=>!['collection','key','value','currency'].includes(k))||!['inputs','events'].includes(change.collection))invalid('Unsupported finance change shape.');
    financeKey(change.key);const value=fixedDecimal(change.value),identity=change.collection+':'+change.key;
    if(seen.has(identity))invalid('Duplicate field in finance changeSet.');seen.add(identity);
    if(change.collection==='inputs'&&change.key.startsWith('p08:')){
      business??=businessInputs(candidate);
      const base=business.find(row=>row.key===change.key);
      if(!base)invalid('Business source row is outside this version.');
      if(!selected.includes(base!.periodKey))invalid('The source period must be in the selected effective range.');
      const targets=business.filter(row=>row.conversion.businessGroup===base!.conversion.businessGroup&&row.metricKey===base!.metricKey&&selected.includes(row.periodKey));
      if(targets.length!==selected.length)invalid('The source field must exist in every selected period.');
      if(change.currency!==undefined&&typeof change.currency!=='string')invalid('Invalid quote currency.');
      for(const row of targets){
        const target='inputs:'+row.key;
        if(row.key!==change.key&&seen.has(target))invalid('Overlapping business field changes.');
        seen.add(target);
        const oldValue=row.value,oldCurrency=row.currency,newCurrency=change.currency??row.currency;
        if(row.valueKind==='money'&&value.scale!==before.policy.currencyScales[newCurrency])invalid('Finance money precision must match its declared currency.');
        validateBusinessChange(candidate,row,value,change.currency);
        const updated={...row,value,currency:newCurrency,unit:row.currency&&newCurrency!==row.currency?row.unit.replace(row.currency,newCurrency):row.unit};
        const index=candidate.inputs.findIndex(input=>input.key===row.key);
        if(index<0)candidate.inputs.push(updated);else candidate.inputs[index]=updated;
        recordField(updated,oldValue,value,oldCurrency);
      }
      business=undefined;
      continue;
    }
    const collection=change.collection as 'inputs'|'events',row=candidate[collection].find(r=>r.key===change.key);
    if(!row)invalid('Finance change references an unavailable field: '+change.key);
    if('value' in row!) {
      const input=row!;
      const supported=supportsFinanceDriver(before,input.metricKey);
      if(!supported)invalid('Unsupported calculation driver: '+input.metricKey+'. Its dependency model must be implemented before preview/save.');
      if(['volume','unit_sales','unit_material'].includes(input.metricKey))editedAggregates.add(input.key);
      if(input.metricKey==='fx_to_base'&&Decimal.from(value).n<=0n)invalid('An approved FX rate must be positive.');
      if(input.metricKey==='fx_to_base'&&before.policy.fx)invalid('Edit the version FX snapshot to change the active exchange rates.');
      if(input.module==='operations'&&before.inputs.some(row=>row.metricKey==='p09.selection')){
        const routes=operationsIndex(before);
        if(before.products.some(product=>(!input.productKey||product.key===input.productKey)&&
          selected.some(period=>routes.scope(product.key,period).selected)))invalid('Use the active route source to change manufacturing labor for these periods.');
      }
      if(!isCqa&&!selected.includes(input.periodKey))invalid('Finance input period falls outside the requested effectivePeriod.');
      const nextCurrency=change.currency??input.currency;
      if(change.currency!==undefined&&(isCqa||!input.currency||typeof nextCurrency!=='string'||!Object.hasOwn(before.policy.currencyScales,nextCurrency)))
        invalid('Choose a configured original currency for a native monetary input.');
      if(input.valueKind==='money'&&value.scale!==before.policy.currencyScales[nextCurrency!])invalid('Finance money precision must match its declared currency.');
      if(isCqa) {
        const applicable=input.metricKey.startsWith('cqa.operations.')?selected:selected.filter(p=>p===input.periodKey);
        if(!applicable.length)invalid('CQA annual input is outside the requested effectivePeriod.');
        const overrides={...((input.conversion.p06Overrides??{}) as Record<string,FixedDecimal>)};
        for(const period of applicable) {fields.push({collection,key:input.key,metricKey:input.metricKey,period,productKey:input.productKey,lineKey:input.lineKey,sourceKey:input.sourceKey,unit:input.unit,currency:input.currency,before:overrides[period]??input.value,after:value});overrides[period]=value;}
        input.conversion={...input.conversion,p06Overrides:overrides};
      } else {
        const previousCurrency=input.currency;
        if(previousCurrency&&nextCurrency!==previousCurrency)input.unit=nextCurrency+input.unit.slice(previousCurrency.length);
        fields.push({collection,key:input.key,metricKey:input.metricKey,period:input.periodKey,productKey:input.productKey,lineKey:input.lineKey,
          sourceKey:input.sourceKey,unit:input.unit,currency:nextCurrency,beforeCurrency:previousCurrency,before:input.value,after:value});
        input.currency=nextCurrency;input.value=value;
      }
    } else {
      const event=row!;
      if(change.currency!==undefined)invalid('Use the budget posting workflow to maintain event currencies.');
      if(hasBudgetExecution(before)&&!isBudgetEvent(event)&&!(event.kind==='budget'&&isDevelopmentModule(event.module)&&supportsDevelopment(before)))
        invalid('Edit the active budget execution scope or posting for this version.');
      if(isBudgetEvent(event))invalid('Use the budget execution workflow for this posting.');
      if(isCqa||!['budget','incurred','etc'].includes(event.kind))invalid('This event is not an editable budget calculation driver.');
      if(!selected.includes(event.periodKey))invalid('Finance event period falls outside the requested effectivePeriod.');
      if(value.scale!==before.policy.currencyScales[event.currency])invalid('Finance event currency precision mismatch.');
      fields.push({collection,key:event.key,metricKey:event.kind,period:event.periodKey,productKey:event.productKey,lineKey:event.lineKey,sourceKey:event.sourceKey,unit:event.currency,currency:event.currency,before:event.amount,after:value});event.amount=value;
    }
  }
  if(candidate.inputs.some(row=>editedAggregates.has(row.key)&&replacedFinanceDriver(candidate,row)))
    invalid('Edit the active Commercial or BOM source rows for this product and period.');
  const detailed=candidate.inputs.filter(isBusiness);
  for(const row of detailed.filter(row=>row.conversion.origin&&['sales_price','annual_reduction'].includes(row.conversion.businessField))) {
    if(detailed.some(other=>other.key!==row.key&&other.conversion.businessGroup===row.conversion.businessGroup&&other.periodKey===row.periodKey&&['sales_price','annual_reduction'].includes(other.conversion.businessField)))
      invalid('Use either a price override or an annual reduction for this market and period.');
  }
  for(const row of detailed.filter(row=>row.module==='bom'&&row.conversion.businessField!=='tooling')) {
    const legacy=candidate.inputs.find(input=>input.metricKey==='cqa.cqa_full.unit_material'&&input.productKey===row.productKey&&input.periodKey===row.periodKey);
    if(legacy&&(legacy.conversion.p06Overrides as Record<string,unknown>|undefined)?.[row.periodKey])invalid('The detailed BOM and an existing aggregate material override overlap. Use a draft without that aggregate override.');
  }
  if(development.size)validateDevelopmentLinks(candidate);
  if(capital.size)validateCapitalLinks(candidate);
  return {candidate:financeSnapshot(candidate,50000),fields,effectivePeriod:{from:effective.from,to:effective.to} as EffectivePeriod};
}

export function previewImpact(before:CalculationReport,after:CalculationReport,fields:{key:string;[key:string]:any}[]) {
  const comparison=compareCalculations(before,after),affectedProducts:string[]=[],affectedPeriods=new Set<string>();
  for(const product of after.productScope) {
    let affected=false;
    after.products[product].periodic.forEach((row,i)=>{
      const old=before.products[product]?.periodic[i]??{};
      if(Object.entries(row).some(([key,v])=>v.value!==old[key]?.value||v.status!==old[key]?.status)) {affected=true;affectedPeriods.add(after.periods[i]);}
    });if(affected)affectedProducts.push(product);
  }
  // Budget changes have their own financial scope even when operating cash stays unchanged.
  for(const field of fields.filter(f=>f.collection==='events')) {
    if(field.period)affectedPeriods.add(field.period);
    for(const product of field.productKey?[field.productKey]:after.productScope)if(!affectedProducts.includes(product))affectedProducts.push(product);
  }
  affectedProducts.sort();
  const paths=[...new Set(fields.map(f=>f.key))].map(key=>{
    const upstream=new Set([...Object.values(before.inputs),...Object.values(after.inputs)].filter(v=>v.inputKey===key).map(v=>v.id));
    const outputs=Object.values(after.outputs).filter(v=>v.upstreamInputs.some(id=>upstream.has(id)));
    const ids=new Set(outputs.map(v=>v.id));
    return {fieldKey:key,upstreamInputs:[...upstream],nodes:outputs.map(v=>({id:v.id,metricKey:v.metricKey,basis:v.basis,unit:v.unit,periods:v.periods,productScope:v.productScope})),edges:outputs.flatMap(v=>v.dependencies.filter(id=>ids.has(id)||upstream.has(id)).map(id=>({from:id,to:v.id}))),status:outputs.length?'connected':'no_financial_effect'};
  });
  return {comparison,fields,affectedProducts,affectedPeriods:after.periods.filter(p=>affectedPeriods.has(p)),paths,
    errors:[...before.issues.map(e=>({...e,phase:'before'})),...after.issues.map(e=>({...e,phase:'candidate'}))]};
}
