import {archived} from './finance-business.ts';
import {bridgeInput} from './finance-bridge-inputs.ts';
import type {BridgeTerm} from './finance-bridge-inputs.ts';
import type {CalculationBuilder,CalculationOutput,CalculationReport,Value} from './finance-calculation-types.ts';
import type {FinanceInput,FinanceSnapshot} from './finance-contracts.ts';
import {Decimal,ONE,sum,ZERO} from './finance-decimal.ts';
import {developmentActuals,developmentCosts,developmentCurrency,isDevelopmentModule,laterPeriod,plannedCost,uncoveredQuantity} from './finance-development.ts';
import type {DevelopmentModule} from './finance-development.ts';
import {caseFinanceRate} from './finance-fx.ts';

type Define=(key:string,deps:Value[],fn:(values:Decimal[])=>Decimal,extra?:Partial<CalculationOutput>)=>Value;
const q=Decimal.from;
const residual=(total:Decimal,settled:Decimal)=>total.cmp(settled)>0?total.sub(settled):ZERO;
export const developmentMetrics=['development_gross','development_actual','development_recovery','development_cash','net_engineering'] as const;

export function createDevelopmentCalculation(b:CalculationBuilder) {
  const s=b.snapshot,currency=developmentCurrency(s),costs=developmentCosts(s);
  const actuals=new Map(developmentActuals(s).map(row=>[row.conversion.actual.costKey,row]));
  const volumes=new Map<string,Value>();
  const scopeOf=(product:string,period:string)=>product+'|'+period;
  const currencyOptions={currency,unit:currency};
  return (product:string,period:string,volume:Value,def:Define)=>{
    volumes.set(scopeOf(product,period),volume);
    const incurred:Value[]=[],actualCosts:Value[]=[],recoveries:Value[]=[],payments:Value[]=[],receipts:Value[]=[];
    const profitTerms:BridgeTerm[]=[],cashTerms:BridgeTerm[]=[];
    for(const row of costs){
      const cost=row.conversion.cost,allocation=cost.allocations.find(item=>item.productKey===product);
      if(!allocation)continue;
      const actualRow=actuals.get(row.key),actual=actualRow?.conversion.actual,share=q(allocation.share),prefix=product+':'+period+':'+row.key;
      const evidence=(field:string,amount:Decimal,reference:string,input:FinanceInput=row,fxPeriod=period,suffix='')=>b.money({
        id:prefix+':'+field,sourceKey:input.sourceKey,inputKey:input.key,role:field.replaceAll('_',' ')+' · '+cost.costRef,
        periods:[fxPeriod],unit:(input.currency??currency)+suffix,currency:input.currency,value:amount.text(),status:'ok',cell:reference
      },amount,currency,fxPeriod);
      const plan=()=>evidence('cost_basis',plannedCost(cost).mul(share),cost.reference);
      const driver=cost.module,actualIncurred=actual?.incurred;
      const hours=uncoveredQuantity(cost).mul(share),fx=caseFinanceRate(b.fxReference,row.currency??currency,currency,period);
      const factor=b.bridge&&!actualIncurred&&driver==='engineering'?{quantity:hours,rate:fx?.mul(q(cost.components.rate??'0'))??null}:undefined;
      const options={factor,factorKind:'engineering' as const};
      const spend=()=>actualIncurred?evidence('actual_incurred',q(actualIncurred.amount).mul(share),actualIncurred.reference,actualRow!,actualIncurred.period):plan();
      const incurredPeriod=actualIncurred?.period??cost.period;
      if(period===incurredPeriod){
        const amount=spend();
        incurred.push(amount);
        if(b.bridge)profitTerms.push(bridgeInput(driver,amount,{sign:-1,identity:row.key,...options}));
        if(actualIncurred)actualCosts.push(amount);
      }
      const paid=actual?.payment,settled=q(paid?.amount??'0').mul(share);
      const due=paid?laterPeriod(s,paid.period,cost.paymentPeriod):cost.paymentPeriod;
      const paidInput=()=>evidence('actual_payment',settled,paid!.reference,actualRow!,paid!.period);
      const post=(target:Value[],value:Value,kind:'payment'|'receipt',mode:'actual'|'forecast')=>{
        target.push(value);
        if(b.bridge)cashTerms.push(bridgeInput(driver,value,{...(kind==='payment'?{sign:-1 as const}:{}),
          ...(kind==='payment'&&!paid?options:{}),identity:row.key+':'+kind+':'+mode,timing:row.key+':'+kind}));
      };
      if(paid&&period===paid.period)post(payments,paidInput(),'payment','actual');
      if(period===due)post(payments,paid?b.calc(prefix+':open_payment','development_open_payment',[spend(),paidInput()],([amount,paid])=>residual(amount,paid),{
        ...currencyOptions,periods:[period],productScope:[product],formula:'Remaining payment after recorded settlement'
      }):spend(),'payment','forecast');

      const recovery=cost.recovery;
      if(recovery.method==='none'||recovery.method==='piece_price'&&recovery.productKey!==product)continue;
      const expectedRecovery=()=>{
        const rate=q(recovery.amount);
        if(recovery.method==='lump_sum')return evidence('lump_sum_recovery',rate.mul(share),cost.reference);
        const price=evidence('price_recovery',rate,cost.reference,row,period,'/piece');
        const demand=volumes.get(scopeOf(product,recovery.earnedPeriod))!;
        return b.calc(prefix+':earned_recovery','development_piece_recovery',[demand,price],([pieces,rate])=>pieces.mul(rate),
          {...currencyOptions,periods:[period],productScope:[product],formula:'Eligible sold pieces × separately stated recovery uplift',
            details:{message:'Piece-price recovery requires sales volume for '+product+' in '+recovery.earnedPeriod+'.'}});
      };
      if(period===recovery.earnedPeriod){
        const earned=expectedRecovery();recoveries.push(earned);
        if(b.bridge)profitTerms.push(bridgeInput(driver,earned,{identity:row.key+':earned'}));
      }
      const collected=actual?.receipt,received=q(collected?.amount??'0').mul(recovery.method==='piece_price'?ONE:share);
      const collectDue=collected?laterPeriod(s,collected.period,recovery.receiptPeriod):recovery.receiptPeriod;
      const receipt=()=>evidence('actual_receipt',received,collected!.reference,actualRow!,collected!.period);
      if(collected&&period===collected.period)post(receipts,receipt(),'receipt','actual');
      if(period===collectDue)post(receipts,collected?b.calc(prefix+':open_receipt','development_open_receipt',[expectedRecovery(),receipt()],
        ([due,actual])=>residual(due,actual),{...currencyOptions,periods:[period],productScope:[product],formula:'Remaining customer recovery after recorded receipt'}):expectedRecovery(),'receipt','forecast');
    }
    const total=(key:string,inputs:Value[],formula:string)=>def(key,inputs,sum,{...currencyOptions,formula});
    const gross=total('development_gross',incurred,'Sum of allocated costs after package coverage, by occurrence period');
    total('development_actual',actualCosts,'Recorded actual development occurrences; approvals are tracked separately');
    const recovery=total('development_recovery',recoveries,'Allocated lump sums and separately stated piece-price recovery');
    const cash=def('development_cash',[...receipts,...payments],items=>sum(items.slice(0,receipts.length)).sub(sum(items.slice(receipts.length))),
      {...currencyOptions,formula:'Receipts less development payments, using their own settlement periods'});
    return {gross,recovery,cash,profitTerms,cashTerms};
  };
}

function budgetEvents(s:FinanceSnapshot,period:string,product?:string) {
  const sources=new Map(s.sources.map(source=>[source.key,source]));
  return s.events.filter(event=>event.kind==='budget'&&isDevelopmentModule(event.module)&&event.periodKey===period&&(!product||event.productKey===product))
    .map(event=>{
      const source=sources.get(event.sourceKey);
      const amount=source&&!['to_collect','pending_inputs'].includes(source.mappingStatus)?q(event.amount):null;
      return {event,source,amount};
    });
}

export function developmentBudget(b:CalculationBuilder,prefix:string,period:string,gross:Value,scope:string[],product?:string) {
  const currency=developmentCurrency(b.snapshot),options={currency,unit:currency,periods:[period],productScope:scope,basis:'development_budget'};
  const events=budgetEvents(b.snapshot,period,product).map(({event,source,amount})=>b.money({
    id:'development-budget:'+event.key,sourceKey:event.sourceKey,inputKey:event.key,role:'Development budget event',
    periods:[period],unit:event.currency,currency:event.currency,value:amount?.text()??null,status:amount===null?'missing_input':'ok',cell:source?.externalKey
  },amount,currency,period));
  const budget=events.length?b.calc(prefix+':development_budget','development_budget',events,sum,options):
    b.make(prefix+':development_budget','development_budget',null,[],{...options,status:'missing_input',details:{message:'No development budget is recorded for this scope and period.'}});
  const remaining=b.calc(prefix+':development_remaining','development_remaining',[budget,gross],([limit,forecast])=>limit.sub(forecast),{
    ...options,formula:'Scoped development budget less gross forecast after package coverage'
  });
  return {development_budget:budget,development_remaining:remaining};
}

export function developmentWorkspace(s:FinanceSnapshot,report:CalculationReport,module:DevelopmentModule,period:string|null,product:string|null,source:string|null) {
  const all=developmentCosts(s),actuals=new Map(developmentActuals(s).map(row=>[row.conversion.actual.costKey,row]));
  const targets=new Map(all.map(row=>[row.key,row.conversion.cost]));
  const currency=developmentCurrency(s);
  const matches=(cost:typeof all[number]['conversion']['cost'])=>(!period||cost.period===period)&&(!product||cost.allocations.some(item=>item.productKey===product));
  const rows=all.filter(row=>row.module===module&&(matches(row.conversion.cost)||[row.key,'actual-'+row.key,'edit-'+row.key].includes(source??''))).map(row=>{
    const {key,conversion:{cost}}=row,originalCurrency=row.currency??currency,actual=actuals.get(key);
    const rate=caseFinanceRate(s,originalCurrency,currency,cost.period);
    const labor=module==='engineering'&&cost.category==='labor'?q(cost.quantity).mul(q(cost.components.rate??'0')):null;
    const travel=module==='engineering'?q(cost.components.travel??'0'):null;
    const planned=plannedCost(cost);
    const workbookRow=/^(DV cost|PV cost)!([A-Z]+)([0-9]+)/.exec(cost.reference);
    const region=cost.title.startsWith('欧区')?'Europe':cost.title.startsWith('中国')?'China':null;
    return {key,cost,originalCurrency,actual:actual?.conversion.actual??null,actualCurrency:actual?.currency??originalCurrency,
    coveredQuantity:q(cost.quantity).sub(uncoveredQuantity(cost)).text(8).replace(/\.?0+$/,''),
    planned:planned.text(s.policy.currencyScales[originalCurrency]),plannedRaw:planned.text(),
    reporting:rate?.mul(planned).text(s.policy.currencyScales[currency])??null,reportingRaw:rate?.mul(planned).text()??null,
    labor:labor?.text()??null,travel:travel?.text()??null,
    modelScope:workbookRow?.[3]??null,region,
    quoteBundle:module==='prototypes'&&(/费用包|cost package/i.test(cost.title)||cost.category!=='sample'),
    related:cost.coverage.map(link=>({...link,title:targets.get(link.provider)?.title??link.provider,
      module:targets.get(link.provider)?.module??'validation' as const})),
    includes:all.filter(row=>row.conversion.cost.coverage.some(link=>link.provider===key))
      .map(row=>({key:row.key,module:row.module,title:row.conversion.cost.title,quantity:row.conversion.cost.coverage.find(link=>link.provider===key)!.quantity}))
    };
  });
  const pm=rows.filter(row=>row.cost.role?.toUpperCase()==='PM'&&row.labor!==null);
  const pmTotals=pm.length&&pm.every(row=>row.originalCurrency===pm[0].originalCurrency)?{
    currency:pm[0].originalCurrency,hours:sum(pm.map(row=>q(row.cost.quantity))).text(2),
    labor:sum(pm.map(row=>q(row.labor!))).text(s.policy.currencyScales[pm[0].originalCurrency]),
    travel:sum(pm.map(row=>q(row.travel!))).text(s.policy.currencyScales[pm[0].originalCurrency]),
    total:sum(pm.map(row=>q(row.plannedRaw))).text(s.policy.currencyScales[pm[0].originalCurrency])
  }:null;
  const tests=new Map<string,typeof rows>();
  if(module==='validation')for(const row of rows){
    const key=[row.modelScope??row.key,row.region??'',row.cost.stage,row.originalCurrency,
      ...row.cost.allocations.map(allocation=>allocation.productKey)].join('|');
    const group=tests.get(key)??[];
    group.push(row);
    tests.set(key,group);
  }
  const validationGroups=[...tests.values()].map(group=>{
    const first=group[0],code=first.originalCurrency;
    return {scope:first.modelScope,stage:first.cost.stage,region:first.region,products:first.cost.allocations.map(item=>item.productKey),
      original:sum(group.map(item=>q(item.plannedRaw))).text(s.policy.currencyScales[code]),currency:code,
      reporting:group.every(item=>item.reportingRaw!==null)?sum(group.map(item=>q(item.reportingRaw!))).text(s.policy.currencyScales[currency]):null,
      items:group.map(item=>item.key)};
  }).sort((a,b)=>Number(a.scope??999)-Number(b.scope??999)||String(a.stage).localeCompare(String(b.stage)));
  const forecast=product?report.products[product]?.periodic:report.periodic;
  const series=(forecast??[]).map((row,i)=>({period:report.periods[i],row})).filter(row=>!period||row.period===period);
  const archivedRows=archived(s)?s.inputs.filter(row=>(!product||row.productKey===product)&&(
    module==='engineering'? row.module==='engineering'&&(/\.pm_[GIJK]$/.test(row.metricKey)||
      /\.engineering_(budget|recovery)$/.test(row.metricKey)&&(!period||row.periodKey===period)) :
    module==='prototypes'?row.metricKey==='cqa.development_dv.Y':
    /^(cqa\.development_dv\.(X|AE)|cqa\.development_pv\.[VWXYZ])$/.test(row.metricKey))).map(row=>{
      const source=s.sources.find(source=>source.key===row.sourceKey);
      return {key:row.key,productKey:row.productKey,source:[source?.sheet,source?.cell].filter(Boolean).join('!'),
        amount:q(row.value).text(row.value.scale),unit:row.unit,covered:/cqa\.development_pv\.[VWX]$/.test(row.metricKey)};
    }):[];
  return {rows,archivedRows,currency,currencies:s.policy.currencyScales,pmTotals,validationGroups,series:series.map(item=>({period:item.period,metrics:Object.fromEntries(
    [...developmentMetrics,'development_budget','development_remaining'].map(key=>[key,item.row[key]?.displayValue??null]))})),
    packages:all.filter(row=>row.conversion.cost.category==='package').map(row=>({key:row.key,title:row.conversion.cost.title,ref:row.conversion.cost.costRef})),
    editable:all.filter(row=>matches(row.conversion.cost)&&!actuals.has(row.key)).map(row=>({key:row.key,cost:row.conversion.cost}))};
}
