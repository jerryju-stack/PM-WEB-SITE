import {createHash} from 'node:crypto';
import {financeKey,fixedDecimal} from './finance-contracts.ts';
import type {FinanceInput,FinanceSnapshot,FinanceSource,FixedDecimal} from './finance-contracts.ts';
import type {CalculationBuilder,Value} from './finance-calculation-types.ts';
import {Decimal,ONE,ZERO,sum} from './finance-decimal.ts';
import {invalid} from './contracts.ts';

export const BUSINESS_VERSION='P08.1';
export const businessFields={
  vehicles:['commercial','Vehicle demand','vehicles','quantity'],
  configuration:['commercial','Configuration rate','fraction','rate'],
  units_per_vehicle:['commercial','Units per vehicle','pieces/vehicle','quantity'],
  sales_price:['commercial','Selling price','unit','unit_price'],
  annual_reduction:['commercial','Annual price reduction','fraction','rate'],
  part_quantity:['bom','Quantity per product','parts/piece','quantity'],
  part_price:['bom','Supplier unit price','unit','unit_price'],
  landed_adjustment:['bom','Landed adjustment per part','unit','unit_price'],
  tooling:['bom','Supplier tooling','money','money'],
  variable:['factory','Variable manufacturing overhead','unit','unit_price'],
  fixed:['factory','Fixed manufacturing overhead','unit','unit_price'],
  scrap:['factory','Scrap rate','fraction','rate'],
  warranty:['factory','Warranty rate','fraction','rate'],
  packaging:['factory','Packaging and freight','unit','unit_price'],
  launch:['factory','Launch cost','money','money'],
  allocation:['factory','Division allocation','money','money']
} as const;
export type BusinessField=keyof typeof businessFields;
export type BusinessInput=FinanceInput&{conversion:FinanceInput['conversion']&{businessField:BusinessField;businessGroup:string;label:string;origin?:FixedDecimal;marketSlot?:number;assetKey?:string}};
export const isBusiness=(row:FinanceInput):row is BusinessInput=>row.metricKey.startsWith('p08.')&&Object.hasOwn(businessFields,row.metricKey.slice(4));
export const hasBusinessModel=(snapshot:FinanceSnapshot)=>snapshot.inputs.some(isBusiness);
export const archived=(s:FinanceSnapshot)=>s.policy.rules.importFormat==='cqa-import-P05.1';
export const businessSlug=(key:string)=>createHash('sha256').update(key).digest('hex').slice(0,24);
function fixed(q:Decimal,scale=12):FixedDecimal {
  return {coefficient:BigInt(q.text(scale).replace('.','')).toString(),scale};
}
const amount=(source:FinanceSource|undefined)=>{
  const cached=source?.metadata.excel as {state?:string;value?:string}|undefined;
  return cached?.state==='number'&&typeof cached.value==='string'?Decimal.from(cached.value):null;
};
export function makeBusinessInput(s:FinanceSnapshot,spec:{field:BusinessField;group:string;label:string;product:string;market:string|null;period:string;
  source:FinanceSource;value:Decimal;currency?:string;metadata?:Record<string,unknown>}):BusinessInput {
  const [module,,fieldUnit,fieldKind]=businessFields[spec.field];
  const absoluteFixed=spec.field==='fixed'&&!archived(s);
  const unit=absoluteFixed?'money':fieldUnit,kind=absoluteFixed?'money':fieldKind;
  const currency=unit==='unit'||unit==='money'?spec.currency??(archived(s)?'CNY':s.currency):null;
  const year=s.periods.find(p=>p.key===spec.period)?.metadata.calendarYear;
  const start=Number.isInteger(year)?year+'-01-01':spec.source.effectiveFrom;
  const end=Number.isInteger(year)?year+'-12-31':spec.source.effectiveTo;
  const value=fixed(spec.value,kind==='money'?s.policy.currencyScales[currency!]:12);
  return {key:'p08:'+businessSlug(spec.group)+':'+spec.field+':'+spec.period,module,metricKey:'p08.'+spec.field,productKey:spec.product,marketKey:spec.market,
    lineKey:null,periodKey:spec.period,sourceKey:spec.source.key,value,valueKind:kind,unit:unit==='unit'?currency+(module==='bom'?'/part':'/piece'):unit==='money'?currency!:unit,
    currency,effectiveFrom:start,effectiveTo:end,conversion:{businessField:spec.field,businessGroup:spec.group,label:spec.label,...spec.metadata}};
}

export function businessFx(s:FinanceSnapshot,currency:string,period:string) {
  const base=archived(s)?'CNY':s.currency;
  if(currency===base)return {rate:ONE,source:null,input:null};
  if(archived(s)) {
    const cell=currency==='USD'?'C8':currency==='EUR'?'C9':null;
    const source=cell?s.sources.find(row=>row.sheet==='Input'&&row.cell===cell):undefined;
    const rate=amount(source);
    return rate&&rate.n>0n?{rate,source,input:null}:null;
  }
  // A native forecast carries one explicit, period-specific FX input per currency pair.
  const matches=s.inputs.filter(row=>row.metricKey==='fx_to_base'&&row.periodKey===period&&row.unit===base+'/'+currency&&!row.productKey&&!row.marketKey&&!row.lineKey);
  const input=matches[0],rate=input&&Decimal.from(input.value);
  const source=input&&s.sources.find(row=>row.key===input.sourceKey);
  return matches.length===1&&rate.n>0n&&source&&!['to_collect','pending_inputs'].includes(source.mappingStatus)?{rate,source,input}:null;
}

/** Project the editable rows already mapped by P05. Only changed rows are persisted in a draft. */
export function businessInputs(s:FinanceSnapshot):BusinessInput[] {
  const stored=s.inputs.filter(isBusiness);
  if(!archived(s))return stored.filter(row=>!row.conversion.origin);
  const existing=new Map(stored.map(row=>[row.key,row])),sources=new Map(s.sources.map(row=>[row.sheet+'|'+row.cell,row]));
  const markets=s.markets.filter(m=>typeof m.metadata.productKey==='string');
  const rows:BusinessInput[]=[];
  function add(field:BusinessField,group:string,label:string,product:string,market:string|null,period:string,source:FinanceSource|undefined,
    value:Decimal|null,currency?:string,metadata?:Record<string,unknown>) {
    if(!source||value===null)return;
    const row=makeBusinessInput(s,{field,group,label,product,market,period,source,value,currency,metadata});
    row.conversion.origin=row.value;
    rows.push(existing.get(row.key)??row);
  }
  const at=(sheet:string,cell:string)=>sources.get(sheet+'|'+cell);
  for(const p of s.products.filter(product=>product.metadata.active!==false)) {
    const sheet=String(p.metadata.externalKey),productMarkets=markets.filter(m=>m.metadata.productKey===p.key);
    for(const period of s.periods) {
      const ordinal=Number(period.metadata.ordinal);
      if(ordinal>10)continue;
      const col=String.fromCharCode(68+ordinal),get=(cell:string)=>at(sheet,col+cell);
      if(ordinal)for(const market of productMarkets) {
        const slot=['EU','ROW','US','EU/ROW/US'].indexOf(String(market.metadata.volumeMarket));
        if(slot<0)continue;
        const columnSlot=slot===3?0:slot,marketGroup='sales:'+p.key+':'+market.key;
        const unit=get(String(370+columnSlot)),quote=get(String(377+columnSlot)),yearReduction=get('413');
        const inputCell=/^Input!\$?([A-Z]+\$?\d+)$/.exec(String((unit?.metadata.excel as any)?.formula??''))?.[1].replace('$','');
        const ref=inputCell?at('Input',inputCell):undefined;
        const volumeCell=/Vol_SBS_Updated!\$?([A-Z]+\$?\d+)/.exec(String((ref?.metadata.excel as any)?.formula??''))?.[1].replace('$','');
        const volumeSource=volumeCell?at('Vol_SBS_Updated',volumeCell):undefined;
        const demand=/^([A-Z]+\d+)\*\$C\$(\d+)$/.exec(String((volumeSource?.metadata.excel as any)?.formula??''));
        const vehicles=demand?at('Vol_SBS_Updated',demand[1]):undefined,configuration=demand?at('Vol_SBS_Updated','C'+demand[2]):undefined;
        const v=amount(vehicles),units=amount(configuration);
        const baseQuantity=amount(unit)?.mul(Decimal.from(1000));
        if(!baseQuantity||!quote)continue;
        const exactSource=v&&units&&v.mul(units).sub(baseQuantity).abs().cmp(Decimal.from('0.000001'))<=0;
        const metadata={marketSlot:columnSlot,adjustedFrom:unit?.key};
        const demandMetadata={...metadata,normalizedDemand:!exactSource};
        add('vehicles',marketGroup,market.label,p.key,market.key,period.key,exactSource?vehicles:unit,exactSource?v:baseQuantity,undefined,demandMetadata);
        add('units_per_vehicle',marketGroup,market.label,p.key,market.key,period.key,exactSource?configuration:unit,exactSource?units:ONE,undefined,demandMetadata);
        add('configuration',marketGroup,market.label,p.key,market.key,period.key,unit,ONE,undefined,{...metadata,normalized:true});
        add('sales_price',marketGroup,market.label,p.key,market.key,period.key,quote,amount(quote),undefined,metadata);
        if(ordinal>1)add('annual_reduction',marketGroup,market.label,p.key,market.key,period.key,yearReduction,amount(yearReduction)?.neg()??null,undefined,metadata);
      }
      const factoryGroup='factory:'+p.key;
      const group=(field:BusinessField,cell:number,shift=1)=>{const source=get(String(cell));add(field,factoryGroup,p.label,p.key,null,period.key,source,amount(source)?.mul(Decimal.from(shift))??null);};
      group('variable',107);group('fixed',108);group('scrap',418);group('warranty',424);group('launch',428,1000);group('allocation',209,1000);
      const pack=get('421'),freight=get('422'),a=amount(pack),b=amount(freight);
      if(a&&b)add('packaging',factoryGroup,p.label,p.key,null,period.key,pack,a.add(b),undefined,{pairedSource:freight?.key});
    }
  }
  const byKey=new Map(s.inputs.map(row=>[row.key,row]));
  for(const base of s.inputs.filter(row=>row.metricKey==='cqa.bom.landed_contribution'&&row.productKey&&row.marketKey)) {
    const market=s.markets.find(m=>m.key===base.marketKey),sheet=String(market?.metadata.externalKey);
    const row=/^bom:.+:(\d+):landed_contribution$/.exec(base.key)?.[1];
    if(!row||!market)continue;
    const group='part:'+market.key+':'+row,qty=byKey.get('bom:'+market.key+':'+row+':quantity'),price=byKey.get('bom:'+market.key+':'+row+':piece_price');
    const code=String((at(sheet,'J'+row)?.metadata.excel as any)?.value??'').trim(),part=code||'BOM line '+row;
    const sourceQty=at(sheet,'M'+row),sourcePrice=at(sheet,'AA'+row),sourceLanded=at(sheet,'AC'+row),sourceTooling=at(sheet,'AD'+row);
    const landed=amount(sourceLanded),q=amount(sourceQty),unitPrice=amount(sourcePrice),tooling=amount(sourceTooling);
    if(!qty||!q||!landed)continue;
    const assetKey='supplier-tooling:'+businessSlug(market.key+':'+row);
    const metadata={partNumber:part,archiveContribution:landed.text(),archiveQuantity:q.text(),referenceOnly:!price||!unitPrice||q.n<=0n};
    const fx=price?.currency?businessFx(s,price.currency,base.periodKey):null;
    const canQuote=!!(fx&&unitPrice&&q.n>0n);
    for(const period of s.periods.filter(p=>Number(p.metadata.ordinal)>0)) {
      add('part_quantity',group,part,base.productKey!,base.marketKey!,period.key,sourceQty,q,undefined,{...metadata,referenceOnly:!canQuote});
      if(canQuote) {
        add('part_price',group,part,base.productKey!,base.marketKey!,period.key,sourcePrice,unitPrice,price!.currency!,metadata);
        // AC already includes M. Keep the archival per-part landing residual as the documented starting adjustment.
        add('landed_adjustment',group,part,base.productKey!,base.marketKey!,period.key,sourceLanded,landed.div(q).sub(unitPrice!.mul(fx!.rate)),undefined,metadata);
      }
    }
    if(tooling?.n)add('tooling',group,part,base.productKey!,base.marketKey!,base.periodKey,sourceTooling,tooling,undefined,{assetKey,archiveCapitalized:true,referenceOnly:true});
  }
  return [...rows,...stored.filter(row=>!row.conversion.origin)];
}

export function validateBusinessChange(s:FinanceSnapshot,row:BusinessInput,value:FixedDecimal,currency?:string) {
  const field=row.conversion.businessField,q=Decimal.from(value);
  if(row.conversion.referenceOnly)invalid('This archival row is reference only. A confirmed quantity, quote, currency and FX basis are required.');
  if(field!=='landed_adjustment'&&q.n<0n)invalid('Enter a nonnegative business value.');
  if(field==='vehicles'&&q.d!==1n)invalid('Vehicle demand must be a whole count.');
  if(['configuration','annual_reduction','scrap','warranty'].includes(field)&&q.cmp(ONE)>0)invalid('Enter a fraction from 0 to 1.');
  if(field==='annual_reduction'&&q.cmp(ONE)===0)invalid('Annual price reduction must be below 100%.');
  if(currency!==undefined&&(!['part_price','sales_price'].includes(field)||!Object.hasOwn(s.policy.currencyScales,currency)))invalid('Quote currency must be configured for this version.');
  const quoteCurrency=currency??row.currency;
  if(quoteCurrency&&!businessFx(s,quoteCurrency,row.periodKey))invalid('Missing approved FX for '+quoteCurrency+' in '+row.periodKey+'.');
}

export const isBusinessSource=(source:FinanceSource)=>source.system==='p08_business_entry'&&/^p08-entry:[a-f0-9]{24}$/.test(source.key);
export function addBusinessRecord(s:FinanceSnapshot,raw:Record<string,unknown>,periods:string[]):BusinessInput[] {
  const type=raw.recordType;
  if(!['commercial','bom','factory'].includes(String(type)))invalid('Unknown business record type.');
  if(!archived(s)&&s.policy.rules.model!=='manufacturing')invalid('Business inputs require a manufacturing forecast.');
  if(Object.keys(raw).some(key=>!['collection','recordType','productKey','marketKey','reference','partNumber','assetKey','currency','values'].includes(key)))invalid('Unknown business record field.');
  if(archived(s)&&type!=='bom')invalid('Use the mapped source rows to edit archived commercial and factory schedules.');
  const product=financeKey(raw.productKey);
  const market=raw.marketKey===null?null:financeKey(raw.marketKey);
  if(!s.products.some(p=>p.key===product&&p.metadata.active!==false))invalid('Select an active product.');
  if(type==='commercial'&&!market||type==='factory'&&market||type==='bom'&&archived(s)&&!market)invalid('Select the required market scope.');
  if(market&&!s.markets.some(m=>m.key===market&&(!m.metadata.productKey||m.metadata.productKey===product)))invalid('The market is outside this product.');
  const part=typeof raw.partNumber==='string'?raw.partNumber.trim():'';
  if(type==='bom'&&(!part||part.length>100))invalid('Enter a stable part number of 1–100 characters.');
  if(typeof raw.reference!=='string'||!raw.reference.trim()||raw.reference.length>200)invalid('Enter the quote or planning reference.');
  const reference=String(raw.reference).trim();
  const values=raw.values;
  if(!values||typeof values!=='object'||Array.isArray(values))invalid('Enter the business record values.');
  const entries=Object.entries(values as Record<string,unknown>);
  if(!entries.length||entries.some(([key])=>!Object.hasOwn(businessFields,key)||businessFields[key as BusinessField][0]!==type))invalid('A business record has fields outside its module.');
  const fields=new Set(entries.map(([field])=>field));
  const required=type==='commercial'?['vehicles','configuration','units_per_vehicle']:type==='bom'?['part_quantity','part_price','landed_adjustment']:[];
  if(required.some(key=>!fields.has(key))||type==='commercial'&&fields.has('sales_price')===fields.has('annual_reduction'))invalid('Complete the required fields and use one selling price or annual reduction.');
  if(periods.includes(s.policy.cashFlowOriginPeriod)&&type!=='factory')invalid('Commercial and BOM entries require an operating period.');
  const currency=String(raw.currency??(archived(s)?'CNY':s.currency));
  if(!Object.hasOwn(s.policy.currencyScales,currency))invalid('Select a configured currency.');
  const assetKey=fields.has('tooling')?financeKey(raw.assetKey):undefined;
  if(assetKey&&(periods.length!==1||businessInputs(s).some(row=>row.conversion.assetKey===assetKey)))invalid('Supplier tooling requires one period and a unique asset reference.');
  const group=type==='commercial'?'sales:'+product+':'+market:type==='factory'?'factory:'+product:'part:new:'+product+':'+market+':'+businessSlug(part.toLowerCase());
  const known=businessInputs(s);
  const candidate:BusinessInput[]=[];
  for(const period of periods) {
    const existing=known.filter(row=>row.productKey===product&&row.periodKey===period&&
      (row.marketKey===market||type==='bom'&&(!row.marketKey||!market)));
    if(existing.some(row=>row.conversion.businessGroup===group||type==='bom'&&String(row.conversion.partNumber).toLowerCase()===part.toLowerCase()))
      invalid('A record with this business key and period already exists in this or an overlapping shared market.');
    if(type==='commercial'&&fields.has('annual_reduction')) {
      const ordinal=Number(s.periods.find(p=>p.key===period)?.metadata.ordinal);
      const previous=s.periods.find(p=>p.metadata.ordinal===ordinal-1)?.key;
      if(!known.some(row=>row.conversion.businessGroup===group&&row.periodKey===previous)&&!candidate.some(row=>row.periodKey===previous))invalid('A price reduction requires a quote or reduction in the previous period.');
    }
    const key='p08-entry:'+businessSlug(group+':'+period);
    const source:FinanceSource={key,system:'p08_business_entry',externalKey:reference,fingerprint:null,sheet:null,cell:null,owner:'Finance business entry',
      observation:'budget',mappingStatus:'mapped',originalCurrency:null,originalUnit:'business assumptions',originalPeriod:period,
      effectiveFrom:s.asOf,effectiveTo:null,metadata:{businessGroup:group}};
    const label=type==='bom'?part:type==='commercial'?s.markets.find(m=>m.key===market)!.label:s.products.find(p=>p.key===product)!.label;
    for(const [name,value] of entries) {
      const field=name as BusinessField,normalized=fixedDecimal(value);
      const qty=Decimal.from(normalized);
      const row=makeBusinessInput(s,{field,group,label,product,market,period,source,value:qty,
        currency:field==='part_price'||field==='sales_price'||field==='tooling'?currency:undefined,
        metadata:{...(type==='bom'?{partNumber:part,archiveContribution:'0'}:{}),...(field==='tooling'?{assetKey}:{})}});
      if(row.valueKind==='money'&&qty.cmp(Decimal.from(row.value))!==0)invalid('Currency amount exceeds the configured money precision.');
      validateBusinessChange(s,row,normalized);
      candidate.push(row);
    }
    if(s.sources.some(row=>row.key===source.key))invalid('The business source already exists.');
    s.sources.push(source);
  }
  s.inputs.push(...candidate);
  return candidate;
}

export function businessValue(b:CalculationBuilder,row:BusinessInput):Value {
  const id='input:'+row.key;
  if(b.values.has(id))return b.values.get(id)!;
  const src=b.snapshot.sources.find(source=>source.key===row.sourceKey),q=Decimal.from(row.value);
  const fx=row.currency?businessFx(b.snapshot,row.currency,row.periodKey):null;
  const input=b.input({id,sourceKey:row.sourceKey,inputKey:row.key,role:row.conversion.label,unit:row.unit,currency:row.currency,
    periods:[row.periodKey],value:q.text(),status:'ok',sheet:src?.sheet,cell:src?.cell},q);
  if(!row.currency||fx?.rate.cmp(ONE)===0&&!fx.source)return input;
  const fxInput=b.input({id:'fx:'+row.currency+':'+row.periodKey,sourceKey:fx?.source?.key??null,inputKey:fx?.input?.key??null,
    role:'Documented FX to calculation currency',unit:(archived(b.snapshot)?'CNY':b.snapshot.currency)+'/'+row.currency,currency:null,
    periods:[row.periodKey],value:fx?.rate.text()??null,status:fx?'ok':'missing_input',sheet:fx?.source?.sheet,cell:fx?.source?.cell},fx?.rate??null);
  return b.calc(id+':converted',row.metricKey,[input,fxInput],([value,rate])=>value.mul(rate),{periods:[row.periodKey],formula:'Quote × source FX'});
}

export function businessPart(b:CalculationBuilder,period:string,group:string,rows:BusinessInput[],base:string):Value|null {
  const find=(field:BusinessField)=>rows.find(row=>row.conversion.businessField===field);
  const qty=find('part_quantity'),price=find('part_price'),landed=find('landed_adjustment');
  if(!qty||!price||!landed)return null;
  return b.calc('landed:'+period+':'+group,'landed_contribution',[qty,price,landed].map(row=>businessValue(b,row)),
    ([count,quote,clearing])=>{if(quote.add(clearing).n<0n)throw Error('Landed unit cost cannot be negative.');return count.mul(quote.add(clearing));},
    {unit:base+'/piece',currency:base,periods:[period],productScope:[qty.productKey!],formula:'Quantity × (converted quote + landed adjustment per part)'});
}

export function businessGroups(rows:BusinessInput[]) {
  const groups=new Map<string,BusinessInput[]>();
  for(const row of rows) {
    const group=row.conversion.businessGroup,items=groups.get(group);
    if(items)items.push(row);else groups.set(group,[row]);
  }
  return groups;
}
