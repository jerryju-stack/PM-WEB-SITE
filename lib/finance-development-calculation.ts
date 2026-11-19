import {archived} from './finance-business.ts';
import {bridgeInput} from './finance-bridge-inputs.ts';
import type {BridgeTerm} from './finance-bridge-inputs.ts';
import type {CalculationBuilder,CalculationOutput,CalculationReport,Value} from './finance-calculation-types.ts';
import type {FinanceInput,FinanceSnapshot} from './finance-contracts.ts';
import {Decimal,ONE,sum,ZERO} from './finance-decimal.ts';
import {developmentActuals,developmentCosts,developmentCurrency,isDevelopmentModule,isPrototypeQuoteBundle,laterPeriod,plannedCost,uncoveredQuantity} from './finance-development.ts';
import type {DevelopmentModule} from './finance-development.ts';
import {caseFinanceRate} from './finance-fx.ts';
import {hasReviewedTemplate} from './finance-cqa-attachments.ts';
import type {reviewedDevelopmentEvidence} from './finance-development-evidence.ts';
import {prototypeWorkspace} from './finance-prototype-workspace.ts';
import {validationWorkspace} from './finance-validation-workspace.ts';

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

type QuoteEvidence=ReturnType<typeof reviewedDevelopmentEvidence>;
export function developmentWorkspace(s:FinanceSnapshot,report:CalculationReport,module:DevelopmentModule,period:string|null,product:string|null,source:string|null,
  quoteEvidence:QuoteEvidence=null) {
  const all=developmentCosts(s),actuals=new Map(developmentActuals(s).map(row=>[row.conversion.actual.costKey,row]));
  const targets=new Map(all.map(row=>[row.key,row.conversion.cost]));
  const currency=developmentCurrency(s);
  const matches=(cost:typeof all[number]['conversion']['cost'])=>(!period||cost.period===period)&&(!product||cost.allocations.some(item=>item.productKey===product));
  const rows=all.filter(row=>row.module===module&&(matches(row.conversion.cost)||[row.key,'actual-'+row.key,'edit-'+row.key].includes(source??''))).map(row=>{
    const {key,conversion:{cost}}=row,originalCurrency=row.currency??currency,actual=actuals.get(key);
    const rate=caseFinanceRate(s,originalCurrency,currency,cost.period);
    const planned=plannedCost(cost);
    const labor=module==='engineering'&&cost.category==='labor'?planned.sub(q(cost.components.travel??'0')):null;
    const travel=module==='engineering'?planned.sub(labor??ZERO):null;
    return {key,cost,originalCurrency,actual:actual?.conversion.actual??null,actualCurrency:actual?.currency??originalCurrency,
    coveredQuantity:q(cost.quantity).sub(uncoveredQuantity(cost)).text(8).replace(/\.?0+$/,''),
    planned:planned.text(s.policy.currencyScales[originalCurrency]),plannedRaw:planned.text(),
    reporting:rate?.mul(planned).text(s.policy.currencyScales[currency])??null,
    labor:labor?.text()??null,travel:travel?.text()??null,
    quoteBundle:module==='prototypes'&&isPrototypeQuoteBundle(cost),
    related:cost.coverage.map(link=>({...link,title:targets.get(link.provider)?.title??link.provider,
      module:targets.get(link.provider)?.module??'validation' as const})),
    includes:all.filter(row=>row.conversion.cost.coverage.some(link=>link.provider===key))
      .map(row=>({key:row.key,module:row.module,title:row.conversion.cost.title,quantity:row.conversion.cost.coverage.find(link=>link.provider===key)!.quantity}))
    };
  });
  const isPm=(row:typeof rows[number])=>/^(PM|project manager)$/i.test(row.cost.role?.trim()??'');
  const pmSource=(row:typeof rows[number])=>isPm(row)&&hasReviewedTemplate(s)?
    /^PM!D(\d+):G\1$/.exec(row.cost.reference.trim())?.[1]:undefined;
  const packageRows=new Map<string,typeof rows>();
  if(module==='engineering')for(const row of rows.filter(row=>matches(row.cost))){
    const locator=pmSource(row);
    const key=locator?'pm-'+locator:row.key;
    const group=packageRows.get(key)??[];
    group.push(row);packageRows.set(key,group);
  }
  const share=(row:typeof rows[number])=>product?q(row.cost.allocations.find(item=>item.productKey===product)?.share??'0'):ONE;
  const moneyTotal=(items:typeof rows,amount:'labor'|'travel'|'plannedRaw')=>{
    if(!items.length)return null;
    const amounts=items.map(row=>{
      const value=q(row[amount]??'0');
      if(value.n===0n)return ZERO;
      return caseFinanceRate(s,row.originalCurrency,currency,row.cost.period)?.mul(value).mul(share(row))??null;
    });
    return amounts.some(value=>value===null)?null:sum(amounts as Decimal[]).text(s.policy.currencyScales[currency]);
  };
  const hoursTotal=(items:typeof rows):string|null=>{
    const labor=items.filter(row=>row.labor!==null);
    return labor.length?sum(labor.map(row=>uncoveredQuantity(row.cost).mul(share(row)))).text(8):null;
  };
  const subtotal=(items:typeof rows)=>({hours:hoursTotal(items),labor:moneyTotal(items,'labor'),
    travel:moneyTotal(items,'travel'),total:moneyTotal(items,'plannedRaw')});
  const engineeringPackages=[...packageRows].map(([key,group])=>{
    const first=group[0],locator=pmSource(first),labor=group.filter(row=>row.labor!==null);
    const rate=labor[0]?.cost.components.rate,rateCurrency=labor[0]?.originalCurrency;
    return {key,quoteRow:locator??null,title:(locator?quoteEvidence?.pm[Number(locator)]:null)||first.cost.title,
      source:first.cost.reference,role:first.cost.role,products:[...new Set(group.flatMap(row=>row.cost.allocations.map(item=>item.productKey)))],
      items:group.map(row=>row.key),rate:rate&&labor.every(row=>row.cost.components.rate===rate&&row.originalCurrency===rateCurrency)?{value:rate,currency:rateCurrency}:null,
      multipleRates:labor.length>1&&labor.some(row=>row.cost.components.rate!==rate||row.originalCurrency!==rateCurrency),
      ...subtotal(group)};
  }).sort((a,b)=>Number(a.quoteRow??Infinity)-Number(b.quoteRow??Infinity)||a.title.localeCompare(b.title));
  const pm=[...packageRows.values()].flat().filter(isPm);
  const pmTotals=pm.length?{currency,...subtotal(pm)}:null;
  const validationHours=module==='engineering'?(quoteEvidence?.validation??[]).flatMap(spec=>{
    const costs=all.filter(row=>row.module==='validation'&&
      Number(/^(?:DV cost|PV cost)![A-Z]+(\d+)/.exec(row.conversion.cost.reference)?.[1])===spec.row&&
      (!product||row.conversion.cost.allocations.some(item=>item.productKey===product)));
    if(!costs.length)return [];
    const products=[...new Set(costs.flatMap(row=>row.conversion.cost.allocations.map(item=>item.productKey)))];
    return [{row:spec.row,description:spec.description,products,groups:spec.groups.map(group=>{
      const groupCosts=costs.filter(row=>{
        const input=row.conversion.cost;
        return group.stage==='China PV'?input.stage==='PV':input.stage==='DV'&&
          (group.stage==='Europe DV'?row.currency==='EUR':row.currency!=='EUR');
      });
      const reference=group.stage==='Europe DV'?'DV cost!T':group.stage==='China DV'?'DV cost!AB':'PV cost!Y';
      const candidates=groupCosts.some(row=>row.periodKey===period)?groupCosts.filter(row=>row.periodKey===period):groupCosts;
      const cost=candidates.find(row=>row.conversion.cost.reference.startsWith(reference))??candidates[0];
      return {...group,total:group.roles.every(role=>role.hours!==null)?sum(group.roles.map(role=>q(role.hours!))).text(8):null,
        cost:cost?{key:cost.key,period:cost.periodKey}:null};
    })}];
  }):[];
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
  const prototypes=module==='prototypes'?prototypeWorkspace(s,all.filter(row=>row.module==='prototypes'&&matches(row.conversion.cost)),
    all,product,quoteEvidence?.validation??[]):null;
  const validation=module==='validation'?validationWorkspace(s,all,period,product,quoteEvidence):null;
  return {rows,archivedRows,currency,currencies:s.policy.currencyScales,pmTotals,engineeringPackages,validationHours,validation,prototypes,series:series.map(item=>({period:item.period,metrics:Object.fromEntries(
    [...developmentMetrics,'development_budget','development_remaining'].map(key=>[key,item.row[key]?.displayValue??null]))})),
    packages:all.filter(row=>row.conversion.cost.category==='package').map(row=>({key:row.key,title:row.conversion.cost.title,ref:row.conversion.cost.costRef})),
    editable:all.filter(row=>matches(row.conversion.cost)&&!actuals.has(row.key)).map(row=>({key:row.key,cost:row.conversion.cost}))};
}
