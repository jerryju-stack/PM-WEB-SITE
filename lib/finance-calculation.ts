import type {FinanceSnapshot,FinanceInput} from './finance-contracts.ts';
import {financeSnapshot} from './finance-contracts.ts';
import {Decimal,ZERO,ONE,sum} from './finance-decimal.ts';
import {CalculationBuilder,FINANCE_CALCULATION_VERSION} from './finance-calculation-types.ts';
import type {Value,CalculationReport,CalculationOutput} from './finance-calculation-types.ts';
import {calculateReturns} from './finance-returns.ts';
import {bridgeInput,bridgePeriodKey,cost} from './finance-bridge-inputs.ts';
import type {FinanceBridgeInputs} from './finance-bridge-inputs.ts';
import {cqaCalculation} from './finance-cqa-calculation.ts';
import {BUSINESS_VERSION,hasBusinessModel} from './finance-business.ts';
import {createBusinessCalculation} from './finance-business-calculation.ts';
import {createOperationsCalculation} from './finance-operations-calculation.ts';
import {hasOperationsModel,OPERATIONS_VERSION} from './finance-operations.ts';
import {createDevelopmentCalculation,developmentBudget,developmentMetrics} from './finance-development-calculation.ts';
import {developmentCurrency,DEVELOPMENT_VERSION,hasDevelopmentModel,supportsDevelopment} from './finance-development.ts';
import {CAPITAL_VERSION,capitalCurrency,hasCapitalModel,supportsCapital} from './finance-capital.ts';
import {capitalDiscount,capitalLifetime,capitalMetrics,createCapitalCalculation,createWorkingCapital} from './finance-capital-calculation.ts';
import {BUDGET_VERSION,hasBudgetExecution} from './finance-budget.ts';
import {calculateBudgetExecution} from './finance-budget-calculation.ts';

const FX_CALCULATION_VERSION='P15.1';
const calculationVersions=[FINANCE_CALCULATION_VERSION,BUSINESS_VERSION,OPERATIONS_VERSION,DEVELOPMENT_VERSION,CAPITAL_VERSION,BUDGET_VERSION,FX_CALCULATION_VERSION];
export const financeCalculationVersion=(s:FinanceSnapshot)=>s.policy.fx?FX_CALCULATION_VERSION:hasBudgetExecution(s)?BUDGET_VERSION:hasCapitalModel(s)?CAPITAL_VERSION:hasDevelopmentModel(s)?DEVELOPMENT_VERSION:
  hasOperationsModel(s)?OPERATIONS_VERSION:hasBusinessModel(s)?BUSINESS_VERSION:FINANCE_CALCULATION_VERSION;

function websiteCalculation(b:CalculationBuilder) {
  const s=b.snapshot,periods=[...s.periods].sort((a,c)=>Number(a.metadata.ordinal)-Number(c.metadata.ordinal));
  const business=createBusinessCalculation(b);
  const routeLabor=createOperationsCalculation(b);
  const development=createDevelopmentCalculation(b);
  const capital=createCapitalCalculation(b),workingCapital=createWorkingCapital(b);
  const sourceMap=new Map(s.sources.map(v=>[v.key,v]));
  function input(key:string,product:string,period:string,unit:string,line:string|null=null):Value {
    const matches=s.inputs.filter(v=>v.metricKey===key&&v.productKey===product&&v.periodKey===period&&v.lineKey===line),r=matches[0];
    const source=r&&sourceMap.get(r.sourceKey),currency=unit.startsWith(s.currency)?s.currency:null;
    let q:Decimal|null=null;
    const expectedUnit=currency&&r?.currency?r.currency+unit.slice(currency.length):unit;
    if(matches.length===1&&source&&source.mappingStatus!=='to_collect'&&source.mappingStatus!=='pending_inputs'&&r.unit===expectedUnit&&
      (currency?!!r.currency:r.currency===null))q=Decimal.from(r.value);
    const evidence={id:'input:'+(r?.key??product+':'+period+':'+line+':'+key),sourceKey:source?.key??null,inputKey:r?.key??null,
      role:matches.length>1?'duplicate input scope':'business input',unit:r?.unit??unit,currency:r?.currency??null,periods:[period],
      value:q?.text()??null,status:q===null?'missing_input' as const:'ok' as const,sheet:source?.sheet,cell:source?.cell};
    return currency?b.money(evidence,q,currency,period):b.input(evidence,q);
  }
  let discount:Decimal|null=null;try{if(s.policy.rules.discountRate)discount=Decimal.from(s.policy.rules.discountRate as any);}catch{}
  const rate=b.input({id:'policy:discount_rate',sourceKey:null,inputKey:null,role:String(s.policy.rules.discountSource??'annual discount assumption'),unit:'fraction',currency:null,periods:periods.map(p=>p.key),value:discount?.text()??null,status:discount===null?'missing_input':discount.cmp(Decimal.from(-1))<=0?'invalid_rate':'ok'},discount&&discount.cmp(Decimal.from(-1))>0?discount:null);
  const products:Record<string,{periodic:Record<string,Value>[]}>={};
  for(const product of s.products.filter(p=>p.metadata.active!==false)) {
    const periodic:Record<string,Value>[]=[];
    for(const [ordinal,period] of periods.entries()) {
      const p=period.key,record:Record<string,Value>={},prefix=product.key+':'+p;
      const get=(key:string,unit:string=s.currency,line:string|null=null)=>input(key,product.key,p,unit,line);
      const def=(key:string,deps:Value[],fn:(a:Decimal[])=>Decimal,extra:Partial<CalculationOutput>={})=>{
        const v=b.calc(prefix+':'+key,key,deps,fn,{periods:[p],productScope:[product.key],basis:'website',...extra});record[key]=v;return v;
      };
      if(s.policy.rules.model==='cash_series') {
        const cash=def('cash_flow',[get('cash_flow')],([v])=>v,{formula:'Explicit complete period cash-flow input; no events added again'});
        b.bridge?.periods.set(bridgePeriodKey(product.key,p),{profit:[],cash:[bridgeInput('cash_series',cash)]});
        for(const key of ['reported_revenue','reported_profit'])record[key]=b.make(prefix+':'+key,key,null,[],{status:'missing_input',periods:[p],productScope:[product.key],details:{message:'A cash-only scenario does not supply an operating statement.'}});
      } else if(s.policy.rules.model==='manufacturing') {
        const model=business?.(product.key,p,ordinal,def);
        const volume=model?.volume??get('volume','pieces'),price=model?.price??get('unit_sales',s.currency+'/piece'),materialUnit=model?.material??get('unit_material',s.currency+'/piece');
        record.volume=volume;
        const dev=development(product.key,p,volume,def);
        const engineering=def('net_engineering',[dev.gross,dev.recovery],([gross,recovery])=>gross.sub(recovery));
        Object.assign(record,developmentBudget(b,prefix,p,dev.gross,[product.key],product.key));
        const detailed=routeLabor(product.key,p,volume),operations:Value[]=[];
        if(detailed)operations.push(detailed);
        if(!detailed&&volume.q?.n!==0n)for(const line of s.lines.filter(l=>l.metadata.productKey===product.key)) {
          const deps=[get('cycle_time','seconds/cycle',line.key),get('people','persons',line.key),get('hourly_rate',s.currency+'/person-hour',line.key),get('labor_efficiency','fraction',line.key),get('units_per_cycle','pieces/cycle',line.key),get('cycles_per_unit','cycles/piece',line.key)];
          const hours=([ct,people,,eff,units,cycles]:Decimal[])=>ct.mul(people).mul(cycles).div(Decimal.from(3600)).div(eff).div(units);
          const operation=def('operation_'+line.key,deps,([ct,people,hourly,eff,units,cycles])=>{
            if(eff.n===0n||units.n===0n)throw new Error('zero_denominator');
            if([ct,people,hourly,cycles].some(v=>v.n<0n)||eff.n<0n||eff.cmp(ONE)>0||units.n<0n)throw new Error('Invalid manufacturing assumption.');
            return hours([ct,people,hourly,eff,units,cycles]).mul(hourly);
          },{unit:s.currency+'/piece',currency:s.currency,formula:'CT × people × hourly rate × cycles per piece / (3600 × labor efficiency × good units per cycle)'});
          operations.push(operation);
          if(b.bridge&&operation.q)b.bridge.labor.set(operation,{quantity:hours(deps.map(v=>v.q!)),rate:deps[2].q});
        }
        let unitLabor:Value;
        if(volume.q?.n===0n)unitLabor=def('unit_labor',[volume],()=>ZERO,{unit:s.currency+'/piece',currency:s.currency});
        else if(!operations.length) {unitLabor=b.make(prefix+':unit_labor','unit_labor',null,[volume],{unit:s.currency+'/piece',currency:s.currency,status:'missing_input',details:{message:'A manufacturing product requires its operation lines.'}});record.unit_labor=unitLabor;}
        else unitLabor=def('unit_labor',operations,sum,{unit:s.currency+'/piece',currency:s.currency});
        const revenue=def('revenue',[volume,price],([v,u])=>v.mul(u)),material=def('material',[volume,materialUnit],([v,u])=>v.mul(u)),labor=def('labor',[volume,unitLabor],([v,u])=>v.mul(u));
        if(model?.material)record.unit_material=model.material;
        if(model?.price)record.unit_sales=model.price;
        if(model?.partCosts.length){
          for(const part of model.partCosts)record[part.out.id]=part;
        }
        const categories=['variable','fixed','scrap','warranty','packaging','launch','allocation'] as const;
        const hasFactory=categories.some(category=>model?.factoryCost(category));
        const categoryCosts=hasFactory?categories.map(key=>{
          const input=model?.factoryCost(key);
          if(!input)return def('factory_'+key,[],()=>ZERO,{formula:'No separate amount recorded for this category'});
          if(key==='scrap'||key==='warranty')return def('factory_'+key,[input,revenue],([rate,sales])=>rate.mul(sales));
          if(key==='variable'||key==='packaging')return def('factory_'+key,[input,volume],([rate,quantity])=>rate.mul(quantity));
          return def('factory_'+key,[input],([cost])=>cost);
        }):[];
        const legacyOther=get('other_cost');
        const operating=def(hasFactory?'factory_profit':'factory_operating_cash',
          [revenue,material,labor,legacyOther,...categoryCosts.filter(v=>v.out.metricKey!=='factory_allocation')],([r,...cost])=>r.sub(sum(cost)));
        const allocation=categoryCosts.find(cost=>cost.out.metricKey==='factory_allocation'),investment=capital(product.key,p,ordinal,volume,def);
        const depreciation=def('depreciation',[investment.dep],([amount])=>amount),incrementalDep=def('incremental_depreciation',[investment.incrementalDep],([amount])=>amount);
        const profit=def('profit',[operating,engineering,depreciation,investment.piece,...(allocation?[allocation]:[])],
          ([p,e,d,r,a=ZERO])=>p.sub(e).sub(d).add(r).sub(a));
        const incremental=def('incremental_profit',[operating,engineering,incrementalDep,investment.piece],
          ([p,e,d,r])=>p.sub(e).sub(d).add(r));
        const wc=workingCapital(product.key,p,ordinal,revenue,material,incremental,def);
        const cashAdjustment=get('cash_adjustment');
        def('cash_flow',[operating,cashAdjustment,dev.cash,investment.cash,investment.pieceCash,wc.change,wc.tax,investment.replacedCash],sum,
          {formula:'Factory operating cash + settlement timing + capital cash + working capital change + tax + other cash adjustments + replacement of previously forecast capital payments'});
        def('reported_revenue',[revenue,investment.piece],sum);def('reported_profit',[profit],([v])=>v);
        if(b.bridge){
          const operatingTerms=[
            bridgeInput('sales',revenue,{factorKind:'sales',factor:{quantity:volume.q,rate:price.q}}),
            cost('material',material),...b.bridge.laborTerms(operations,[],volume.q,[volume]),cost('factory_other',legacyOther),
            ...categoryCosts.filter(v=>v!==allocation).map(v=>cost(v.out.metricKey,v))
          ];
          b.bridge.periods.set(bridgePeriodKey(product.key,p),{
            profit:[...operatingTerms,...dev.profitTerms,cost('depreciation',depreciation),bridgeInput('piece_recovery',investment.piece),
              ...(allocation?[cost('factory_allocation',allocation)]:[])],
            cash:[...operatingTerms,...dev.cashTerms,...investment.cashTerms,bridgeInput('working_capital',wc.change),bridgeInput('tax',wc.tax),
              bridgeInput('cash_adjustment',cashAdjustment),
              ...(investment.replacedCash.q?.n===0n?[]:[bridgeInput('cash_adjustment',investment.replacedCash)])]
          });
        }
      } else for(const key of ['cash_flow','reported_revenue','reported_profit'])record[key]=b.make(prefix+':'+key,key,null,[],{status:'missing_input',periods:[p],productScope:[product.key],details:{message:'Declare the complete cash_series or manufacturing model before calculating this version.'}});
      periodic.push(record);
    }
    products[product.key]={periodic};
  }
  return {products,rate:capitalDiscount(b,rate)};
}

function budget(b:CalculationBuilder) {
  const s=b.snapshot,result:Record<string,CalculationOutput>={};
  if(hasBudgetExecution(s))return calculateBudgetExecution(b);
  const categories:Record<string,Value>={};
  for(const [key,kind] of [['approved_budget','budget'],['confirmed_actual','incurred'],['etc','etc']] as const) {
    const events=s.events.filter(e=>e.kind===kind),deps=events.map(e=>{
      const source=s.sources.find(r=>r.key===e.sourceKey),q=source&&!['to_collect','pending_inputs'].includes(source.mappingStatus)&&(kind!=='incurred'||s.policy.rules.budgetIncurredBasis==='confirmed')?Decimal.from(e.amount):null;
      return b.money({id:'event:'+e.key,sourceKey:e.sourceKey,inputKey:e.key,role:kind==='incurred'?'P04 recorded incurred event; approval workflow belongs to P12':kind,unit:e.currency,currency:e.currency,periods:[e.periodKey],value:q?.text()??null,status:q===null?'missing_input':'ok'},q,s.currency,e.periodKey);
    });
    const explicit=s.policy.rules.budgetComplete===true;
    categories[key]=events.length||explicit?b.calc('budget:'+key,key,deps,sum,{basis:'budget_events',formula:'sum of distinct '+kind+' events; payment/recovery never counted as incurred costs'}):b.make('budget:'+key,key,null,[],{status:'missing_input',basis:'budget_events',details:{message:'No complete '+kind+' event set has been supplied.'}});
    result[key]=categories[key].out;
  }
  const make=(key:string,deps:Value[],fn:(v:Decimal[])=>Decimal)=>{const v=b.calc('budget:'+key,key,deps,fn,{basis:'budget_events'});result[key]=v.out;return v;};
  const eac=make('eac',[categories.confirmed_actual,categories.etc],sum);
  make('budget_balance',[categories.approved_budget,categories.confirmed_actual],([a,c])=>a.sub(c));
  make('completion_variance',[categories.approved_budget,eac],([a,c])=>a.sub(c));
  return result;
}

/** Single engine for baseline, forecast, preview, budget and version comparison. No storage calls. */
export function calculateFinance(raw:FinanceSnapshot,bridge?:FinanceBridgeInputs,fxReference?:FinanceSnapshot):CalculationReport {
  const s=financeSnapshot(raw,50000),b=new CalculationBuilder(s,bridge,fxReference),periods=[...s.periods].sort((a,c)=>Number(a.metadata.ordinal)-Number(c.metadata.ordinal));
  if(!['not_implemented',...calculationVersions].includes(s.calculationVersion))throw Object.assign(new Error('Unsupported stored finance calculation version; an explicit version migration is required.'),{status:409});
  if(s.policy.fx||s.calculationVersion===FX_CALCULATION_VERSION||hasBudgetExecution(s)||hasCapitalModel(s)||hasDevelopmentModel(s)||hasOperationsModel(s)||hasBusinessModel(s))
    s.calculationVersion=financeCalculationVersion(s);
  if(fxReference?.policy.fx)s.calculationVersion=FX_CALCULATION_VERSION;
  if(periods.length>201||periods.some((p,i)=>p.metadata.ordinal!==i))throw Object.assign(new Error('Finance calculation requires contiguous annual periods beginning at Year 0.'),{status:400});
  const isCqa=s.policy.rules.importFormat==='cqa-import-P05.1';
  if(isCqa&&!['CNY','USD'].includes(s.currency))throw Object.assign(new Error('CQA calculation supports the approved CNY and USD reporting currencies.'),{status:400});
  const built=isCqa?cqaCalculation(b):websiteCalculation(b),scope=Object.keys(built.products).sort();
  if(bridge)bridge.rate=built.rate;
  const capital=supportsCapital(s),investmentCurrency=capitalCurrency(s);
  const products:CalculationReport['products']={};
  function totals(prefix:string,rows:Record<string,Value>[],productScope:string[]) {
    const opts={productScope,periods:periods.map(p=>p.key)},metrics:Record<string,CalculationOutput>={};
    const revenue=b.calc(prefix+':revenue','revenue',rows.map(r=>r.reported_revenue),sum,{...opts,basis:isCqa?'cqa_full':'website'});
    const profit=b.calc(prefix+':profit',isCqa?'cqa.mpbitri':'operating_profit',rows.map(r=>r.reported_profit),sum,{...opts,basis:isCqa?'cqa_full':'website'});
    const margin=b.calc(prefix+':margin',isCqa?'cqa.mpbitri_margin':'operating_margin',[profit,revenue],([p,r])=>p.div(r),{...opts,unit:'fraction',currency:null,basis:profit.out.basis,formula:'sum(profit) / sum(revenue)'});
    metrics.revenue=revenue.out;
    if(!isCqa&&s.policy.rules.model==='manufacturing'&&(s.policy.fx||fxReference))metrics.total_cost=b.calc(prefix+':total_cost','total_cost',
      [revenue,profit],([sales,operating])=>sales.sub(operating),{...opts,formula:'Reported revenue less modeled operating profit'}).out;
    if(isCqa){metrics['cqa.mpbitri']=profit.out;metrics['cqa.mpbitri_margin']=margin.out;}
    if(!isCqa&&s.policy.rules.model==='manufacturing'&&s.policy.rules.operatingMapping!=='approved'){
      metrics.full_cost_management_profit=b.calc(prefix+':full_cost_management_profit','full_cost_management_profit',
        [profit],([value])=>value,{...opts,formula:'Modeled full-cost profit before operating-profit mapping approval'}).out;
    }
    if(!isCqa&&s.policy.rules.operatingMapping==='approved'){metrics.operating_profit=profit.out;metrics.operating_margin=margin.out;}
    else for(const key of ['operating_profit','operating_margin'])metrics[key]=b.make(prefix+':'+key,key,null,[profit,revenue],{...opts,basis:'website',unit:key.endsWith('margin')?'fraction':s.currency,currency:key.endsWith('margin')?null:s.currency,status:'pending_finance',details:{message:'The website operating-profit mapping requires finance approval. CQA MPBITRI retains its original basis.'}}).out;
    const returns=calculateReturns(b,prefix,rows.map(r=>r.cash_flow),built.rate,productScope,isCqa?'cqa_incremental':'website');
    Object.assign(metrics,returns.metrics);
    if(capital)for(const key of capitalLifetime)metrics[key]=b.calc(prefix+':life:'+key,key,rows.map(row=>row[key]),sum,
      {...opts,unit:investmentCurrency,currency:investmentCurrency,basis:isCqa?'cqa_incremental':'website'}).out;
    if(capital)metrics.discount_rate=b.make(prefix+':discount_rate_display','discount_rate',built.rate.q,[built.rate],{...opts,unit:'fraction',currency:null}).out;
    return {metrics,periodic:rows.map((row,i)=>({...Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v.out])),cumulative_cash:returns.cumulative[i].out,present_value:returns.pv[i].out}))};
  }
  for(const [key,p] of Object.entries(built.products))products[key]=totals(key,p.periodic,[key]);
  const hasDevelopment=supportsDevelopment(s),costCurrency=developmentCurrency(s);
  const aggregate=periods.map((period,i)=>{
    const prefix='project:'+period.key;
    const keys=['reported_revenue','reported_profit','cash_flow',...(hasDevelopment?developmentMetrics:[]),...(isCqa?['engineering_budget']:[]),...(capital?capitalMetrics:[])];
    const row=Object.fromEntries(keys.map(key=>{
      const deps=Object.values(built.products).map(v=>v.periodic[i][key]);
      const config=(capitalMetrics as readonly string[]).includes(key)?{unit:investmentCurrency,currency:investmentCurrency}:
        key.startsWith('development_')||['engineering_budget','net_engineering'].includes(key)?{unit:costCurrency,currency:costCurrency}:{};
      const v=scope.length?b.calc(prefix+':'+key,key,deps,sum,{...config,periods:[period.key],productScope:scope,formula:'sum of enabled products in the same period and currency; each source counted once'}):b.make(prefix+':'+key,key,null,[],{...config,status:'missing_input',periods:[period.key],details:{message:'No enabled product scope has been supplied.'}});
      return [key,v];
    }));
    if(hasDevelopment)Object.assign(row,developmentBudget(b,prefix,period.key,row[isCqa?'engineering_budget':'development_gross'],scope));
    return row;
  });
  const project=totals('project',aggregate,scope);
  return {calculationVersion:s.calculationVersion==='not_implemented'?FINANCE_CALCULATION_VERSION:s.calculationVersion,dictionaryVersion:s.dictionaryVersion,asOf:s.asOf,currency:s.currency,basis:s.basis,periods:periods.map(p=>p.key),productScope:scope,
    ...project,products,budget:budget(b),outputs:b.outputs,inputs:b.inputs,issues:b.issues};
}

export function compareCalculations(before:CalculationReport,after:CalculationReport) {
  const compatibleVersion=before.calculationVersion===after.calculationVersion||
    [before.calculationVersion,after.calculationVersion].every(version=>calculationVersions.includes(version));
  const compatible=before.currency===after.currency&&before.basis===after.basis&&before.dictionaryVersion===after.dictionaryVersion&&compatibleVersion&&JSON.stringify(before.periods)===JSON.stringify(after.periods)&&JSON.stringify(before.productScope)===JSON.stringify(after.productScope);
  const compare=(a:Record<string,CalculationOutput>,c:Record<string,CalculationOutput>)=>Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(c)])].sort().map(key=>{
    const old=a[key]??null,next=c[key]??null,unit=next?.unit==='fraction'?'percentage_point':next?.unit??old?.unit??'';
    const valid=compatible&&old&&next&&old.basis===next.basis&&old.unit===next.unit&&old.exact&&next.exact;
    const q=valid?new Decimal(BigInt(next.exact!.numerator),BigInt(next.exact!.denominator)).sub(new Decimal(BigInt(old.exact!.numerator),BigInt(old.exact!.denominator))).mul(Decimal.from(unit==='percentage_point'?100:1)):null;
    return [key,{before:old,after:next,delta:{value:q?.text()??null,displayValue:q?.text(next?.displayDecimals??2)??null,exact:q?.exact()??null,unit,currency:next?.currency??old?.currency??null,basis:next?.basis??old?.basis??null,periods:next?.periods??old?.periods??after.periods,productScope:next?.productScope??old?.productScope??after.productScope,calculationVersion:after.calculationVersion,upstreamInputs:[...new Set([...(old?.upstreamInputs??[]),...(next?.upstreamInputs??[])])],status:q?'ok':compatible?'unavailable':'incompatible_scope'}}];
  }));
  return {compatible,metrics:compare(before.metrics,after.metrics),budget:compare(before.budget,after.budget),periodic:after.periodic.map((r,i)=>compare(before.periodic[i]??{},r)),products:Object.fromEntries(after.productScope.map(k=>[k,{metrics:compare(before.products[k]?.metrics??{},after.products[k].metrics),periodic:after.products[k].periodic.map((r,i)=>compare(before.products[k]?.periodic[i]??{},r))}]))};
}
