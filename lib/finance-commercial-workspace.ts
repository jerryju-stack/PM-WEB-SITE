import type {CalculationOutput,CalculationReport} from './finance-calculation-types.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {archived,businessFx,businessGroups} from './finance-business.ts';
import type {BusinessField,BusinessInput} from './finance-business.ts';
import {Decimal} from './finance-decimal.ts';
import {screenMetric} from './finance-workspace.ts';

const exact=(output:CalculationOutput|undefined)=>output?.exact?
  new Decimal(BigInt(output.exact.numerator),BigInt(output.exact.denominator)):null;

export function commercialWorkspace(snapshot:FinanceSnapshot,report:CalculationReport,inputs:BusinessInput[]){
  const currency=archived(snapshot)?'CNY':snapshot.currency;
  const scale=snapshot.policy.currencyScales[currency];
  const reportPeriods=new Map(report.periods.map((key,index)=>[key,index]));
  const yearly=new Map<string,BusinessInput[]>();
  for(const row of inputs.filter(row=>row.module==='commercial')){
    const key=row.periodKey;
    const group=yearly.get(key)??[];
    group.push(row);
    yearly.set(key,group);
  }
  const products=snapshot.products.filter(item=>item.metadata.active!==false);
  const hasVolume=(key:string)=>products.some(product=>{
      const row=report.products[product.key]?.periodic[reportPeriods.get(key)??-1];
      return (exact(row?.volume)?.n??0n)>0n;
  });
  const forecasts=snapshot.periods.filter(period=>period.metadata.ordinal!==0&&(yearly.has(period.key)||hasVolume(period.key)))
    .sort((a,b)=>Number(a.metadata.ordinal)-Number(b.metadata.ordinal));
  const lastProduction=forecasts.findLastIndex(period=>hasVolume(period.key));
  const production=lastProduction<0?forecasts:forecasts.slice(0,lastProduction+1);
  const periodRows=production.map(period=>({key:period.key,label:period.label}));

  const markets=forecasts.flatMap(period=>[...businessGroups(yearly.get(period.key)??[]).values()].map(rows=>{
    const first=rows[0];
    const product=first.productKey,market=first.marketKey,tag=String(market);
    const field=(key:BusinessField)=>rows.find(row=>row.conversion.businessField===key);
    const input=(key:BusinessField)=>{const row=field(key);return row?Decimal.from(row.value):null;};
    const row=product?report.products[product]?.periodic[reportPeriods.get(period.key)??-1]:undefined;
    const demand=input('vehicles'),configuration=input('configuration'),units=input('units_per_vehicle');
    const quoted=field('sales_price'),rawPrice=input('sales_price');
    const volume=exact(row?.['market_volume_'+tag])??(demand&&configuration&&units?demand.mul(configuration).mul(units):null);
    const computed=row?.['market_price_'+tag];
    const rate=quoted?.currency?businessFx(snapshot,quoted.currency,period.key):null;
    const price=computed?exact(computed):rawPrice&&rate?rawPrice.mul(rate.rate):null;
    return {period:period.key,periodLabel:period.label,product,market,volume:volume?.text(0)??null,
      demand:demand?.text(0)??null,configuration:configuration?.mul(Decimal.from(100)).text(4)??null,
      units:units?.text(4)??null,unitPrice:price?.text(scale)??null,
      originalPrice:rawPrice?.text(6)??null,originalCurrency:quoted?.currency??null,quoteKey:quoted?.key??null,
      revenue:volume?.n===0n?'0':volume&&price?volume.mul(price).text(scale):null};
  }));
  const matrix=products.map(product=>({key:product.key,label:product.label,years:production.map(period=>{
    const row=report.products[product.key]?.periodic[reportPeriods.get(period.key)??-1];
    const volume=exact(row?.volume),revenue=exact(row?.revenue??row?.reported_revenue);
    return {period:period.key,volume:volume?.text(0)??null,
      unitPrice:volume?.n&&revenue?revenue.div(volume).text(scale):null,revenue:revenue?.text(scale)??null};
  })}));
  return {currency,periods:periodRows,products:matrix,markets};
}

export function materialCostSchedule(report:CalculationReport,inputs:BusinessInput[]){
  const quotedScopes=new Set(inputs.filter(input=>input.module==='bom'&&input.conversion.businessField==='part_price'&&
    (!input.conversion.origin||input.periodKey===report.periods[1])).map(input=>input.productKey+':'+input.periodKey));
  return Object.entries(report.products).flatMap(([product,data])=>data.periodic.flatMap((row,index)=>{
    const volume=exact(row.volume),material=exact(row.material);
    if(!volume||volume.n<=0n)return [];
    const period=report.periods[index];
    return [{product,period,unitCost:material?.div(volume).text(4)??null,material:material?.text(8)??null,currency:row.material?.currency??report.currency,
      hasItemQuotes:quotedScopes.has(product+':'+period)}];
  }));
}

const plantCosts=[
  ['variable','Variable manufacturing overhead','Per piece','voh'],
  ['fixed','Fixed manufacturing overhead','Period total','foh'],
  ['scrap','Scrap','Percentage of sales','scrap'],
  ['warranty','Warranty','Percentage of sales',null],
  ['packaging','Packaging and freight','Per piece',null],
  ['launch','Launch','One-time period total',null],
  ['allocation','Corporate allocation','Period total','allocations']
] as const;

export function factoryCostWorkspace(snapshot:FinanceSnapshot,report:CalculationReport,inputs:BusinessInput[],period:string,productFilter:string|null,includeHorizon=false) {
  if(snapshot.policy.rules.model==='cash_series')return [];
  const selected=productFilter&&Object.hasOwn(report.products,productFilter)?productFilter:null;
  const currency=archived(snapshot)?'CNY':snapshot.currency;
  const moneyScale=snapshot.policy.currencyScales[currency];
  const inputByScope=new Map(inputs.filter(input=>input.module==='factory').map(input=>
    [JSON.stringify([input.productKey,input.periodKey,input.conversion.businessField]),input]));
  const sources=new Map(snapshot.sources.map(source=>[source.key,source]));
  return Object.entries(report.products).filter(([product])=>!selected||product===selected).flatMap(([product,value])=>
    value.periodic.flatMap((row,index)=>{
      const rowPeriod=report.periods[index],volume=exact(row.volume);
      if(!selected&&!includeHorizon&&rowPeriod!==period)return [];
      return plantCosts.map(([field,label,basis,fallback])=>{
        const output=row['factory_'+field]??(fallback?row[fallback]:undefined);
        const unrecorded=output?.formula==='No separate amount recorded for this category';
        const amount=unrecorded?null:exact(output),input=inputByScope.get(JSON.stringify([product,rowPeriod,field]));
        const source=input?sources.get(input.sourceKey):undefined;
        return {product,period:rowPeriod,field,label,basis:field==='fixed'&&archived(snapshot)?'Per piece':basis,
          total:amount?.text(moneyScale)??null,exactTotal:amount?.text(10)??null,unit:amount&&volume&&volume.n>0n?amount.div(volume).text(4):null,
          volume:volume?.text(0)??null,currency,moneyScale,inputKey:input?.key??null,metric:output?screenMetric(output):null,
          original:input?Decimal.from(input.value).text(input.value.scale):null,originalUnit:input?.unit??null,
          reference:source?.sheet&&source.cell?source.sheet+'!'+source.cell:source?.externalKey??null};
      });
    }));
}
