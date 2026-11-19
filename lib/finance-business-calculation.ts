import type {CalculationBuilder,CalculationOutput,Value} from './finance-calculation-types.ts';
import {archived,businessGroups,businessInputs,businessPart,businessSlug,businessValue,isBusiness} from './finance-business.ts';
import type {BusinessField} from './finance-business.ts';
import {Decimal,ONE,ZERO,sum} from './finance-decimal.ts';

type Rows=ReturnType<typeof businessInputs>;
type Read=(cell:string,unit?:string,blank?:boolean,override?:boolean)=>Value;
type Define=(name:string,dependencies:Value[],calculate:(values:Decimal[])=>Decimal,options?:Partial<CalculationOutput>)=>Value;
const field=(rows:Rows,key:BusinessField)=>rows.find(row=>row.conversion.businessField===key);
const decimal=(value:string|number)=>Decimal.from(value);
const weight=(values:Decimal[])=>{
  let total=ZERO,weighted=ZERO;
  for(let i=0;i<values.length;i+=2){total=total.add(values[i]);weighted=weighted.add(values[i].mul(values[i+1]));}
  return total.n===0n?ZERO:weighted.div(total);
};

export function createBusinessCalculation(builder:CalculationBuilder) {
  const snapshot=builder.snapshot,isArchive=archived(snapshot),stored=snapshot.inputs.filter(isBusiness);
  if(!stored.length&&!isArchive)return null;
  const persisted=new Set(stored.map(row=>row.key));
  const touchedProducts=new Set(stored.map(row=>row.productKey));
  const byProductPeriod=new Map<string,Rows>();
  for(const row of businessInputs(snapshot).filter(row=>isArchive||touchedProducts.has(row.productKey))){
    const key=row.productKey+':'+row.periodKey;
    const existing=byProductPeriod.get(key);
    if(existing)existing.push(row);else byProductPeriod.set(key,[row]);
  }
  const lastQuote=new Map<string,{candidate:Value;original:Decimal;edited:boolean}>();
  const base=isArchive?'CNY':snapshot.currency;
  function defaultAmount(name:string,period:string):Value {
    const id='business:missing:'+name+':'+period;
    if(builder.values.has(id))return builder.values.get(id)!;
    return builder.make(id,name,null,[],{periods:[period],details:{message:'A required business input is missing: '+name+'.'}});
  }
  return function periodModel(product:string,period:string,ordinal:number,define:Define,raw?:Read) {
    const available=byProductPeriod.get(product+':'+period)??[];
    const groups=businessGroups(available);
    const changed=available.filter(row=>persisted.has(row.key));
    if(!available.length)return null;
    const get=(rows:Rows,key:BusinessField)=>{const row=field(rows,key);return row?businessValue(builder,row):defaultAmount(product+':'+key,period);};
    const moneyUnit={unit:base+'/piece',currency:base,...(isArchive?{basis:'cqa_full'}:{})};
    const countUnit={unit:'pieces',currency:null,...(isArchive?{basis:'cqa_full'}:{})};
    const sales=[...groups.entries()].filter(([,rows])=>rows[0].module==='commercial');
    const quotes:Array<{market:string|null;slot:number;volume:Value;quote:Value}>=[];
    const volumeChanged=changed.some(row=>['vehicles','configuration','units_per_vehicle'].includes(row.conversion.businessField));
    let priceChanged=false;
    for(const [group,rows] of sales) {
      const tag=String(rows[0].marketKey),priceRow=field(rows,'sales_price'),reduction=field(rows,'annual_reduction');
      const previous=lastQuote.get(group),editedPrice=!!priceRow&&persisted.has(priceRow.key),editedReduction=!!reduction&&persisted.has(reduction.key);
      const edited=editedPrice||editedReduction||!!previous?.edited;
      priceChanged||=edited;
      let quote:Value;
      if(editedPrice||!previous||isArchive&&!edited)quote=get(rows,'sales_price');
      else {
        const reductionValue=editedReduction||!isArchive?get(rows,'annual_reduction'):null;
        const original=priceRow?.conversion.origin?Decimal.from(priceRow.conversion.origin):ZERO;
        const originalFactor=previous.original.n?original.div(previous.original):ONE;
        const dependencies=[previous.candidate,...(reductionValue?[reductionValue]:[])];
        if(isArchive&&priceRow)dependencies.push(get(rows,'sales_price'));
        quote=define('market_quote_'+tag,dependencies,([prior,rate])=>reductionValue?prior.mul(ONE.sub(rate)):prior.mul(originalFactor),
          {...moneyUnit,formula:'Previous effective quote × (1 − annual reduction), preserving documented archive curve where no new rate is entered'});
      }
      if(!isArchive&&!editedPrice&&previous&&priceRow){
        // A stored native quote is a fixed price for that period. A reduction applies only when a period has no price.
        quote=get(rows,'sales_price');
      }
      lastQuote.set(group,{candidate:quote,original:priceRow?.conversion.origin?Decimal.from(priceRow.conversion.origin):ZERO,edited});
      const volume=define('market_volume_'+tag,[get(rows,'vehicles'),get(rows,'configuration'),get(rows,'units_per_vehicle')],
          ([demand,configuration,units])=>demand.mul(configuration).mul(units),
          {...countUnit,formula:'Vehicle demand × configuration rate × units per vehicle'});
      define('market_price_'+tag,[quote],([price])=>price,moneyUnit);
      const effectiveQuote=volume.q?.n===0n?define('inactive_market_quote_'+tag,[volume],()=>ZERO,moneyUnit):quote;
      define('market_revenue_'+tag,[volume,effectiveQuote],([pieces,price])=>pieces.mul(price),
        {unit:base,currency:base,formula:'Forecast market pieces × effective selling price'});
      quotes.push({market:rows[0].marketKey,slot:Number(rows[0].conversion.marketSlot??0),volume,quote:effectiveQuote});
    }
    const vehicleVolume=quotes.map(row=>row.volume);
    const volume=!isArchive&&sales.length
      ?define('volume',vehicleVolume,values=>decimal(sum(values).text(0)),countUnit)
      :isArchive&&volumeChanged&&raw?define('volume',[...vehicleVolume,raw('K449','fraction')],values=>
        decimal(sum(values.slice(0,-1)).mul(ONE.add(values.at(-1)!)).text(0)),{...countUnit,formula:'Market volumes × archive volume adjustment; nearest whole piece'}):null;
    const price=(!isArchive&&sales.length||isArchive&&(priceChanged||volumeChanged))
      ?define('unit_sales',quotes.flatMap(row=>[row.volume,row.quote]),weight,{...moneyUnit,formula:'Market selling prices weighted by effective volume'}):null;
    const col=String.fromCharCode(68+ordinal);
    const materialChanges=changed.some(row=>row.module==='bom');
    const parts=new Map<string|null,Value[]>();
    for(const [group,rows] of groups) {
      if(rows[0].module!=='bom'||isArchive&&!rows.some(row=>persisted.has(row.key)))continue;
      const part=businessPart(builder,period,group,rows,base);
      if(!part)continue;
      const market=rows[0].marketKey;
      let contribution=part;
      if(isArchive) {
        const origin=field(rows,'part_quantity')?.conversion.archiveContribution;
        if(typeof origin!=='string')continue;
        // The archived market material curve already contains all original parts. Add only the revised line delta.
        const reduction=raw&&ordinal>1?Array.from({length:ordinal-1},(_,i)=>raw(String.fromCharCode(70+i)+'414','fraction',true)):[];
        contribution=define('part_delta_'+businessSlug(group),[part,...reduction],([updated,...rates])=>
          updated.sub(decimal(origin)).mul(rates.reduce((factor,rate)=>factor.mul(ONE.add(rate)),ONE)),
          {...moneyUnit,formula:'Change from archived landed contribution, carried at the original material reduction factors'});
      }
      const list=parts.get(market)??[];list.push(contribution);parts.set(market,list);
    }
    let material:Value|null=null;
    if(isArchive&&raw&&(materialChanges||volumeChanged)){
      const marketRates:Value[]=[];
      for(const {volume,market,slot} of quotes) {
        const effects=parts.get(market)??[];
        const frozen=raw(col+(385+slot),'CNY/piece',true);
        marketRates.push(volume,define('market_material_'+market,[frozen,...effects],sum,moneyUnit));
      }
      const weighted=define('weighted_material',marketRates,weight,moneyUnit);
      material=define('unit_material',[weighted,raw(col+'415','CNY/piece',true),raw(col+'416','fraction',true),raw(col+'417','fraction',true)],
        ([unit,extra,scrap,overage])=>unit.mul(ONE.add(scrap).add(overage)).add(extra),
        {...moneyUnit,formula:'Volume-weighted landed material with archive add-on and percentage factors'});
    } else if(!isArchive&&parts.size) {
      const marketRates=quotes.flatMap(({market,volume})=>{
        const materialParts=[...(parts.get(null)??[]),...(parts.get(market)??[])];
        return [volume,define('market_material_'+market,
          materialParts.length||volume.q?.n===0n?materialParts:[defaultAmount(product+':BOM:'+market,period)],sum,moneyUnit)];
      });
      material=define('unit_material',marketRates.length?marketRates:[...parts.values()].flat(),marketRates.length?weight:sum,moneyUnit);
    }
    const factory=available.filter(row=>row.module==='factory');
    const factoryCost=(key:BusinessField)=> {
      const row=field(factory,key);
      return row&&(!isArchive||persisted.has(row.key))?businessValue(builder,row):null;
    };
    return {volume,price,material,factoryCost,partCosts:[...parts.values()].flat(),repriceFactory:priceChanged||volumeChanged};
  };
}
