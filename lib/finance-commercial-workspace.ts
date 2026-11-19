import type {CalculationOutput,CalculationReport} from './finance-calculation-types.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {archived,businessFx,businessGroups} from './finance-business.ts';
import type {BusinessField,BusinessInput} from './finance-business.ts';
import {Decimal} from './finance-decimal.ts';

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
  const quotedScopes=new Set(inputs.filter(input=>input.module==='bom'&&
    ['part_quantity','part_price'].includes(input.conversion.businessField)).map(input=>input.productKey+':'+input.periodKey));
  return Object.entries(report.products).flatMap(([product,data])=>data.periodic.flatMap((row,index)=>{
    const volume=exact(row.volume),material=exact(row.material);
    if(!volume||volume.n<=0n||!material)return [];
    const period=report.periods[index];
    return [{product,period,unitCost:material.div(volume).text(4),currency:row.material.currency??report.currency,
      hasItemQuotes:quotedScopes.has(product+':'+period)}];
  }));
}

const plantCosts=[
  ['fixed','Fixed manufacturing overhead','Period total','foh'],
  ['variable','Variable manufacturing overhead','Per piece','voh'],
  ['scrap','Scrap','Percentage of sales','scrap'],
  ['warranty','Warranty','Percentage of sales',null],
  ['packaging','Packaging and freight','Per piece',null],
  ['launch','Launch','One-time period total',null],
  ['allocation','Corporate allocation','Period total','allocations']
] as const;

export function factoryCostWorkspace(snapshot:FinanceSnapshot,report:CalculationReport,inputs:BusinessInput[],period:string) {
  const index=report.periods.indexOf(period);
  if(index<0)return [];
  const currency=archived(snapshot)?'CNY':snapshot.currency;
  const scale=snapshot.policy.currencyScales[currency];
  return Object.entries(report.products).flatMap(([product,value])=>{
    const row=value.periodic[index],volume=exact(row?.volume);
    return plantCosts.flatMap(([field,label,basis,fallback])=>{
      const output=row?.['factory_'+field]??(fallback?row?.[fallback]:undefined);
      if(!output)return [];
      const amount=exact(output),source=inputs.find(item=>item.productKey===product&&item.periodKey===period&&item.conversion.businessField===field);
      return [{product,field,label,basis,total:amount?.text(scale)??null,unit:amount&&volume&&volume.n>0n?amount.div(volume).text(4):null,
        volume:volume?.text(0)??null,currency,inputKey:source?.key??null,
        original:source?Decimal.from(source.value).text(Math.min(source.value.scale,8)):null,originalUnit:source?.unit??null}];
    });
  });
}
