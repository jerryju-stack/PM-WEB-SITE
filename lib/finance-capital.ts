import {financeKey} from './finance-contracts.ts';
import type {FinanceInput,FinanceSnapshot} from './finance-contracts.ts';
import {Decimal,ONE,sum} from './finance-decimal.ts';
import {archived,businessFx,businessInputs,businessSlug} from './finance-business.ts';
import {invalid} from './contracts.ts';

export const CAPITAL_VERSION='P11.1';
export const isCapitalInput=(row:FinanceInput)=>row.key.startsWith('p11:')||row.metricKey.startsWith('p11.');
export const isCapitalSource=(row:{key:string})=>row.key.startsWith('p11:');
export const hasCapitalModel=(s:FinanceSnapshot)=>s.inputs.some(isCapitalInput);
export const supportsCapital=(s:FinanceSnapshot)=>archived(s)||s.policy.rules.model==='manufacturing';
export const capitalCurrency=(s:FinanceSnapshot)=>archived(s)?'CNY':s.currency;
export const assetKinds=['equipment','line','in_house_tooling','supplier_tooling'] as const;
type Shares={productKey:string;share:string}[];
type Payment={id:string;period:string;share:string;reference:string};
export type AssetRecord={
  kind:'asset';assetId:string;title:string;category:typeof assetKinds[number];mode:'new'|'existing_shared';purchaseReference:string;meReference:string;lineId:string|null;
  basis:string;allocations:Shares;orderPeriod:string;servicePeriod:string;life:number;residual:string;gross:string|null;payments:Payment[];
};
type Receipt={id:string;date:string;period:string;amount:string;reference:string};
type Receivable={period:string;amount:string;reference:string};
type Piece={productKey:string;rate:string;first:string;last:string;included:boolean};
export type RecoveryRecord={kind:'recovery';agreementId:string;assetKey:string;title:string;reference:string;agreementPeriod:string;amount:string;
  receivable:Receivable|null;receiptPeriod:string;receipts:Receipt[];piece:Piece|null};
export type TermsRecord={kind:'terms';productKey:string;period:string;receivableDays:string;payableDays:string;inventoryDays:string;
  days:360|365;tax:string;release:boolean;reference:string};
export type ValuationRecord={kind:'valuation';period:string;discount:string;reference:string};
export type CapitalRecord=AssetRecord|RecoveryRecord|TermsRecord|ValuationRecord;
export type CapitalRow<T extends CapitalRecord=CapitalRecord>=FinanceInput&{conversion:{capital:T}};
export const capitalRows=(s:FinanceSnapshot)=>s.inputs.filter(isCapitalInput) as CapitalRow[];
export const capitalAssets=(s:FinanceSnapshot)=>capitalRows(s).filter(row=>row.conversion.capital.kind==='asset') as CapitalRow<AssetRecord>[];
export const capitalOrdinal=(s:FinanceSnapshot,key:string)=>Number(s.periods.find(item=>item.key===key)?.metadata.ordinal);
export const capitalQuoteRows=(s:FinanceSnapshot)=>businessInputs(s).filter(row=>row.conversion.businessField==='tooling'&&row.conversion.assetKey);
export const capitalLines=(s:FinanceSnapshot)=>[...new Set([
  ...s.lines.map(line=>line.key),...s.inputs.filter(row=>row.metricKey==='p09.design').flatMap(row=>{
    const record=row.conversion.operations as {lines?:{line:string}[]}|undefined;
    return record?.lines?.map(line=>line.line)??[];
  })
])].sort();
const fail=(message:string):never=>invalid('Investment: '+message);
const q=Decimal.from;

function obj(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('Invalid source fields.');
  return value as Record<string,unknown>;
}
function list(value:unknown,max:number):unknown[]{
  if(!Array.isArray(value)||value.length>max)fail('Invalid number of schedule lines.');
  return value as unknown[];
}
function label(value:unknown,field:string,max=220):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail('Enter '+field+'.');
  return (value as string).trim();
}
function decimal(value:unknown,name:string,max:number,scale=8,signed=false):string{
  const pattern=signed?/^-?\d{1,12}(?:\.\d{1,8})?$/:/^\d{1,12}(?:\.\d{1,8})?$/;
  if(typeof value!=='string'||!pattern.test(value)||((value as string).split('.')[1]?.length??0)>scale)fail('Enter a valid '+name+'.');
  const parsed=q(value as string);
  if(parsed.cmp(q(max))>0||signed&&parsed.cmp(q(-1))<=0)fail('Out of range: '+name+'.');
  return parsed.text((value as string).split('.')[1]?.length??0);
}
function period(s:FinanceSnapshot,value:unknown){
  const key=financeKey(value);
  if(!s.periods.some(item=>item.key===key))fail('Select a period in the finance version.');
  return key;
}
function activeProduct(s:FinanceSnapshot,value:unknown){
  const key=financeKey(value);
  if(!s.products.some(item=>item.key===key&&item.metadata.active!==false))fail('Select an enabled product.');
  return key;
}
const identity=(kind:string,id:string)=>'p11:'+businessSlug(kind+'|'+id.toLowerCase());

export function resolveAssetGross(s:FinanceSnapshot,record:AssetRecord,quotes?:ReturnType<typeof capitalQuoteRows>){
  if(record.gross!==null)return {amount:q(record.gross),quote:null,fx:null};
  const matches=(quotes??capitalQuoteRows(s)).filter(row=>row.conversion.assetKey===record.assetId);
  const quote=matches.length===1?matches[0]:null;
  const fx=quote?.currency?businessFx(s,quote.currency,quote.periodKey):null;
  return {amount:quote&&!quote.conversion.archiveCapitalized&&fx?q(quote.value).mul(fx.rate):null,quote,fx};
}

function parseAsset(s:FinanceSnapshot,raw:Record<string,unknown>):AssetRecord{
  const assetId=financeKey(raw.assetId),category=raw.category as AssetRecord['category'],mode=raw.mode;
  if(!assetKinds.includes(category)||mode!=='new'&&mode!=='existing_shared')return fail('Choose an asset category and ownership type.');
  const money=(value:unknown,name:string)=>decimal(value,name,999999999999,s.policy.currencyScales[capitalCurrency(s)]);
  const orderPeriod=period(s,raw.orderPeriod),servicePeriod=period(s,raw.servicePeriod);
  if(capitalOrdinal(s,servicePeriod)<capitalOrdinal(s,orderPeriod))fail('Service cannot precede the order period.');
  const gross=raw.gross===null?null:money(raw.gross,'gross capital'),residual=money(raw.residual,'residual value');
  const life=Number(decimal(raw.life,'depreciation life',40,0));
  if(life<1)fail('Enter a depreciation life of at least one year.');
  const lineId=raw.lineId===null?null:financeKey(raw.lineId);
  if(lineId&&!capitalLines(s).includes(lineId))fail('The ME line is outside this financial version.');
  const allocations=list(raw.allocations,16).map(item=>{
    const value=obj(item,['productKey','share']);
    return {productKey:activeProduct(s,value.productKey),share:decimal(value.share,'product allocation share',1)};
  }).sort((a,b)=>a.productKey.localeCompare(b.productKey));
  const total=sum(allocations.map(item=>q(item.share)));
  if(!allocations.length||new Set(allocations.map(item=>item.productKey)).size!==allocations.length||
    allocations.some(item=>q(item.share).n<=0n)||total.cmp(ONE)>0)fail('Use unique positive product allocations totaling at most 1.');
  const payments=list(raw.payments,24).map(item=>{
    const value=obj(item,['id','period','share','reference']);
    const payPeriod=period(s,value.period);
    if(capitalOrdinal(s,payPeriod)<capitalOrdinal(s,orderPeriod))fail('A payment cannot precede the order period.');
    return {id:financeKey(value.id),period:payPeriod,share:decimal(value.share,'payment share',1),reference:label(value.reference,'payment evidence')};
  });
  if(new Set(payments.map(item=>item.id.toLowerCase())).size!==payments.length||payments.some(item=>q(item.share).n<=0n)||
    (mode==='new'?sum(payments.map(item=>q(item.share))).cmp(ONE)!==0:payments.length!==0))
    fail('New asset payment shares must total 1. Existing shared assets have no new payments.');
  const result:AssetRecord={kind:'asset',assetId,title:label(raw.title,'asset title'),category,mode,gross,residual,life,orderPeriod,servicePeriod,allocations,payments,lineId,
    meReference:label(raw.meReference,'ME reference'),purchaseReference:label(raw.purchaseReference,'procurement reference'),basis:label(raw.basis,'allocation basis')};
  const quotes=capitalQuoteRows(s).filter(row=>row.conversion.assetKey?.toLowerCase()===assetId.toLowerCase());
  if(quotes.some(row=>row.conversion.archiveCapitalized))fail('This archived supplier tool is already included in the Financials capital schedule.');
  if(quotes.length&&(category!=='supplier_tooling'||gross!==null||quotes.some(row=>!allocations.some(allocation=>allocation.productKey===row.productKey))))
    fail('Use the linked BOM quote and its product scope for this supplier tool.');
  if(gross===null&&category!=='supplier_tooling')fail('Enter a gross cost.');
  const amount=resolveAssetGross(s,result,quotes).amount;
  if(!amount||q(residual).cmp(amount)>0)fail('A linked quote with an exchange rate is required, and residual value cannot exceed gross cost.');
  return result;
}

function parseRecovery(s:FinanceSnapshot,raw:Record<string,unknown>):RecoveryRecord{
  const agreementId=financeKey(raw.agreementId),assetKey=financeKey(raw.assetKey);
  const asset=capitalAssets(s).find(item=>item.key===assetKey)?.conversion.capital;
  if(!asset)return fail('Choose an existing investment source.');
  const money=(value:unknown,name:string)=>decimal(value,name,999999999999,s.policy.currencyScales[capitalCurrency(s)]);
  const agreementPeriod=period(s,raw.agreementPeriod),receiptPeriod=period(s,raw.receiptPeriod),amount=money(raw.amount,'contract amount');
  const afterAgreement=(key:string)=>capitalOrdinal(s,key)>=capitalOrdinal(s,agreementPeriod);
  if(!afterAgreement(receiptPeriod))fail('Receipt forecast cannot precede the agreement.');
  let receivable:Receivable|null=null;
  if(raw.receivable!==null){
    const data=obj(raw.receivable,['period','amount','reference']);
    receivable={period:period(s,data.period),amount:money(data.amount,'receivable amount'),reference:label(data.reference,'receivable evidence')};
    if(!afterAgreement(receivable.period)||capitalOrdinal(s,receiptPeriod)<capitalOrdinal(s,receivable.period)||q(receivable.amount).cmp(q(amount))>0)
      fail('Receivable must be within the contract amount and between agreement and forecast receipt.');
  }
  let piece:Piece|null=null;
  if(raw.piece!==null){
    const data=obj(raw.piece,['productKey','rate','first','last','included']),productKey=activeProduct(s,data.productKey);
    const first=period(s,data.first),last=period(s,data.last);
    if(!asset.allocations.some(item=>item.productKey===productKey)||!afterAgreement(first)||capitalOrdinal(s,last)<capitalOrdinal(s,first)||
      capitalOrdinal(s,receiptPeriod)<capitalOrdinal(s,last)||typeof data.included!=='boolean')return fail('Select an allocated product and a valid piece-price earning range before settlement.');
    piece={productKey,rate:decimal(data.rate,'price per piece',999999999999),first,last,included:data.included};
  }
  const receipts=list(raw.receipts,24).map(item=>{
    const data=obj(item,['id','period','amount','date','reference']),key=period(s,data.period),date=label(data.date,'receipt date',10);
    const calendarYear=s.periods.find(item=>item.key===key)?.metadata.calendarYear;
    if(!afterAgreement(key)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||
      Number.isInteger(calendarYear)&&Number(date.slice(0,4))!==calendarYear)fail('Use an actual receipt date matching its period and following the agreement.');
    const receiptAmount=money(data.amount,'actual receipt');
    if(q(receiptAmount).n<=0n)fail('Actual receipt amounts must be positive.');
    return {id:financeKey(data.id),period:key,date,amount:receiptAmount,reference:label(data.reference,'receipt evidence')};
  });
  if(new Set(receipts.map(item=>item.id.toLowerCase())).size!==receipts.length||sum(receipts.map(item=>q(item.amount))).cmp(q(receivable?.amount??amount))>0)
    fail('Receipt references must be unique, and settled amounts must fit the receivable or contract amount.');
  return {kind:'recovery',agreementId,assetKey,title:label(raw.title,'agreement title'),reference:label(raw.reference,'agreement evidence'),
    agreementPeriod,amount,receivable,receiptPeriod,piece,receipts};
}

export function applyCapitalChange(s:FinanceSnapshot,value:unknown,selected:string[],seen:Set<string>){
  if(!supportsCapital(s))fail('Use a manufacturing or CQA forecast.');
  const change=obj(value,['collection','key','record']),raw=change.record as Record<string,unknown>,kind=raw?.kind;
  let record:CapitalRecord,key:string,scope:string,productKey:string|null=null;
  if(kind==='asset'){
    record=parseAsset(s,obj(raw,['kind','assetId','title','category','mode','purchaseReference','meReference','lineId','basis','allocations',
      'orderPeriod','servicePeriod','life','residual','gross','payments']));
    key=identity(kind,record.assetId);scope=record.orderPeriod;
  }else if(kind==='recovery'){
    record=parseRecovery(s,obj(raw,['kind','agreementId','assetKey','title','reference','agreementPeriod','amount','receivable','receiptPeriod','receipts','piece']));
    key=identity(kind,record.agreementId);scope=record.agreementPeriod;
  }else if(kind==='terms'){
    const terms=obj(raw,['kind','productKey','period','receivableDays','payableDays','inventoryDays','days','tax','release','reference']);
    productKey=activeProduct(s,terms.productKey);scope=period(s,terms.period);
    if(terms.days!==360&&terms.days!==365||typeof terms.release!=='boolean')return fail('Choose a day basis and working-capital release treatment.');
    record={kind,productKey,period:scope,receivableDays:decimal(terms.receivableDays,'receivable days',730),payableDays:decimal(terms.payableDays,'payable days',730),
      inventoryDays:decimal(terms.inventoryDays,'inventory days',730),days:terms.days,tax:decimal(terms.tax,'tax rate',1),release:terms.release,reference:label(terms.reference,'terms evidence')};
    key=identity(kind,productKey+'|'+scope);
  }else if(kind==='valuation'){
    const data=obj(raw,['kind','discount','reference']);
    scope=s.policy.cashFlowOriginPeriod;
    record={kind,period:scope,discount:decimal(data.discount,'annual discount rate',10,8,true),reference:label(data.reference,'valuation evidence')};
    key=identity(kind,'project');
  }else return fail('Unknown investment source.');
  const previous=capitalRows(s).find(row=>row.key===key);
  if(change.key!==undefined&&change.key!==key||previous&&change.key===undefined)fail('Open the existing source row to update this identity.');
  if(!selected.includes(scope)||seen.has(key))fail('Use a unique source row within the preview period range.');
  seen.add(key);
  const module=kind==='terms'||kind==='valuation'?'returns':'investment',sourceKey=key+':source',currency=capitalCurrency(s);
  const amount=record.kind==='asset'?resolveAssetGross(s,record).amount!:q(record.kind==='recovery'?record.amount:record.kind==='terms'?record.tax:record.discount);
  const isMoney=module==='investment',scale=isMoney?s.policy.currencyScales[currency]:8;
  const nextValue={coefficient:BigInt(amount.text(scale).replace('.','')).toString(),scale};
  const reference=record.kind==='asset'?record.purchaseReference:record.reference;
  const rowCurrency=isMoney?currency:null,unit=rowCurrency??'fraction';
  const row:CapitalRow={key,module,metricKey:'p11.'+kind,productKey,marketKey:null,lineKey:null,periodKey:scope,sourceKey,
    value:nextValue,valueKind:isMoney?'money':'rate',unit,currency:rowCurrency,effectiveFrom:s.asOf,effectiveTo:null,conversion:{capital:record}};
  s.sources=s.sources.filter(item=>item.key!==sourceKey).concat({key:sourceKey,system:'Capital and returns',externalKey:reference,fingerprint:null,
    sheet:null,cell:null,owner:module,observation:'budget',mappingStatus:'mapped',originalCurrency:rowCurrency,originalUnit:unit,
    originalPeriod:scope,effectiveFrom:s.asOf,effectiveTo:null,metadata:{}});
  s.inputs=s.inputs.filter(item=>item.key!==key).concat(row);
  const summary=(item:CapitalRecord)=>{
    const periodLabel=(key:string)=>s.periods.find(item=>item.key===key)!.label;
    if(item.kind==='recovery')return item.amount+' · receipt '+periodLabel(item.receiptPeriod);
    if(item.kind==='terms')return [item.receivableDays,item.payableDays,item.inventoryDays].join(' / ')+' days · tax '+item.tax;
    if(item.kind==='asset')return resolveAssetGross(s,item).amount?.text(scale)+' · service '+periodLabel(item.servicePeriod);
    return item.discount;
  };
  return {collection:'capital',key,metricKey:row.metricKey,period:scope,productKey,sourceKey,unit,currency:rowCurrency,before:previous?.value??null,after:nextValue,
    beforeLabel:previous?summary(previous.conversion.capital):null,afterLabel:summary(record)};
}

export function validateCapitalLinks(s:FinanceSnapshot){
  const rows=capitalRows(s),assets=new Map(capitalAssets(s).map(row=>[row.key,row.conversion.capital]));
  const receiptIds=new Set<string>();
  for(const row of rows){
    const record=row.conversion.capital;
    if(record.kind!=='recovery')continue;
    const asset=assets.get(record.assetKey);
    if(!asset||record.piece&&!asset.allocations.some(item=>item.productKey===record.piece!.productKey))fail('A linked agreement requires its original product allocation.');
    for(const receipt of record.receipts){
      const key=receipt.id.toLowerCase();
      if(receiptIds.has(key))fail('A receipt identity may only be used once in the project.');
      receiptIds.add(key);
    }
  }
}
