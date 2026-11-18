import type {CalculationBuilder,CalculationOutput,Value} from './finance-calculation-types.ts';
import {Decimal,ONE,sum,ZERO} from './finance-decimal.ts';
import {capitalAssets,capitalCurrency,capitalOrdinal,capitalQuoteRows,capitalRows,resolveAssetGross} from './finance-capital.ts';
import type {CapitalRow,RecoveryRecord,TermsRecord,ValuationRecord} from './finance-capital.ts';
import {bridgeInput} from './finance-bridge-inputs.ts';
import type {BridgeTerm} from './finance-bridge-inputs.ts';

type Define=(key:string,deps:Value[],fn:(data:Decimal[])=>Decimal,options?:Partial<CalculationOutput>)=>Value;
const q=Decimal.from;
const minimum=(a:Decimal,b:Decimal)=>a.cmp(b)<0?a:b;
const positive=(value:Decimal)=>value.n>=0n?value:ZERO;
export const capitalMetrics=['capital_gross','capital_allocated','capital_new','capital_payments','capital_receipts',
  'capital_agreed','capital_receivable','capital_actual_receipts','capital_net','capital_salvage','capital_piece_earned','capital_piece_cash',
  'capital_depreciation','capital_incremental_dep','depreciation','incremental_depreciation','receivables','inventory','payables','nwc','nwc_change','signed_tax','incremental_profit'] as const;
export const capitalLifetime=['capital_gross','capital_allocated','capital_new','capital_payments','capital_receipts','capital_agreed','capital_net',
  'capital_salvage','capital_piece_earned','incremental_profit'] as const;
type EventKind='payment'|'receipt'|'salvage'|'piece_receipt';
export type CapitalCashEvent={kind:EventKind;key:string;label:string;reference:string;actual:boolean};

export function capitalDiscount(b:CalculationBuilder,fallback:Value){
  const row=capitalRows(b.snapshot).find(item=>item.conversion.capital.kind==='valuation') as CapitalRow<ValuationRecord>|undefined;
  if(!row)return fallback;
  const rate=q(row.conversion.capital.discount);
  return b.input({id:'input:'+row.key,inputKey:row.key,sourceKey:row.sourceKey,unit:'fraction',currency:null,role:'Approved valuation assumption',
    periods:b.snapshot.periods.map(item=>item.key),value:rate.text(),status:'ok',cell:row.conversion.capital.reference},rate);
}

export function createCapitalCalculation(b:CalculationBuilder){
  const s=b.snapshot,currency=capitalCurrency(s),assets=capitalAssets(s),quotes=assets.some(row=>row.conversion.capital.gross===null)?capitalQuoteRows(s):[];
  const recoveries=capitalRows(s).filter(row=>row.conversion.capital.kind==='recovery') as CapitalRow<RecoveryRecord>[];
  const pieces=new Map<string,Value[]>();
  const grossOptions=new Map(assets.map(row=>[row.key,resolveAssetGross(s,row.conversion.capital,quotes)]));
  const zeroes=()=>({gross:[] as Value[],allocated:[] as Value[],added:[] as Value[],payment:[] as Value[],receipt:[] as Value[],agreed:[] as Value[],
    due:[] as Value[],actual:[] as Value[],salvage:[] as Value[],dep:[] as Value[],incDep:[] as Value[],piece:[] as Value[],pieceReceipt:[] as Value[]});
  return (product:string,period:string,ordinal:number,volume:Value,def:Define,archive?:{gross:Value;receipt:Value})=>{
    const items=zeroes();
    const opts={unit:currency,currency,periods:[period],productScope:[product]};
    const evidence=(row:CapitalRow,name:string,value:Decimal|null,reference:string,unit=currency)=>{
      const id=product+':'+period+':'+row.key+':'+name;
      return b.values.get(id)??b.input({id,inputKey:row.key,sourceKey:row.sourceKey,unit,currency:unit===currency?currency:null,
        periods:[period],value:value?.text()??null,status:value===null?'missing_input':'ok',role:name,cell:reference},value);
    };
    const event=(id:string,source:CapitalCashEvent,deps:Value[],formula:(amount:Decimal[])=>Decimal)=>
      b.calc(product+':'+period+':capital-event:'+id,'capital_cash_event',deps,formula,{...opts,details:{capitalEvent:source}});
    for(const row of assets){
      const asset=row.conversion.capital,allocation=asset.allocations.find(item=>item.productKey===product);
      if(!allocation)continue;
      const share=q(allocation.share),total=sum(asset.allocations.map(item=>q(item.share))),service=capitalOrdinal(s,asset.servicePeriod);
      const depreciation=ordinal>=service&&ordinal<service+asset.life,payments=asset.payments.filter(item=>item.period===period);
      const salvage=asset.mode==='new'&&ordinal===service+asset.life-1&&q(asset.residual).n>0n;
      if(period!==asset.orderPeriod&&!depreciation&&!payments.length&&!salvage)continue;
      const valuation=grossOptions.get(row.key)!,quote=valuation.quote,fx=valuation.fx;
      const doc=evidence(row,'Asset gross capital',valuation.amount,asset.purchaseReference);
      const quoteInput=quote?b.input({id:product+':'+period+':'+quote.key+':capital-quote',inputKey:quote.key,sourceKey:quote.sourceKey,
        value:q(quote.value).text(),periods:[period],role:'Supplier tooling quote',status:'ok',unit:quote.unit,currency:quote.currency},q(quote.value)):null;
      const fxEvidence=fx?.source?b.input({id:product+':'+period+':'+row.key+':capital-fx',inputKey:fx.input?.key??null,sourceKey:fx.source.key,
        value:fx.rate.text(),periods:[period],role:'Supplier tooling FX',status:'ok',unit:currency+'/'+quote?.currency,currency:null,
        sheet:fx.source.sheet,cell:fx.source.cell??fx.source.externalKey},fx.rate):null;
      const gross=b.calc(product+':'+period+':'+row.key+':capital_basis','capital_basis',[doc,...(quoteInput?[quoteInput]:[]),...(fxEvidence?[fxEvidence]:[])],([amount])=>{
        if(amount.cmp(q(asset.residual))<0)throw Error('Asset residual exceeds the gross cost of its linked quote.');
        return amount;
      },{...opts,details:{message:'Asset '+asset.assetId+' requires a valid gross amount and residual value.'}});
      const alloc=evidence(row,'Allocation share',share,asset.basis,'fraction');
      const allocated=b.calc(product+':'+period+':'+row.key+':allocated','asset_allocated_amount',[gross,alloc],([amount,pct])=>amount.mul(pct),opts);
      if(period===asset.orderPeriod){
        items.gross.push(b.calc(product+':'+period+':'+row.key+':gross','asset_gross_amount',[gross,alloc],([amount,pct])=>amount.mul(pct).div(total),opts));
        items.allocated.push(allocated);
        if(asset.mode==='new')items.added.push(allocated);
      }
      for(const payment of payments)items.payment.push(event(row.key+':payment:'+payment.id,{kind:'payment',key:row.key,label:asset.title+' · '+payment.id,
        reference:payment.reference,actual:false},[allocated],([amount])=>amount.mul(q(payment.share))));
      const residual=evidence(row,'Asset residual',q(asset.residual).mul(share),asset.meReference);
      if(depreciation){
        const charge=b.calc(product+':'+period+':'+row.key+':asset-dep','asset_depreciation',[allocated,residual],([amount,remainder])=>amount.sub(remainder).div(q(asset.life)),opts);
        items.dep.push(charge);
        if(asset.mode==='new')items.incDep.push(charge);
      }
      if(salvage)items.salvage.push(event(row.key+':salvage',{kind:'salvage',key:row.key,label:asset.title,reference:asset.meReference,actual:false},[residual],([v])=>v));
    }
    for(const row of recoveries){
      const agreement=row.conversion.capital,asset=assets.find(item=>item.key===agreement.assetKey)?.conversion.capital;
      const allocation=asset?.allocations.find(item=>item.productKey===product),piece=agreement.piece;
      if(!asset||!allocation||piece&&piece.productKey!==product)continue;
      const share=piece?ONE:q(allocation.share).div(sum(asset.allocations.map(item=>q(item.share))));
      const amount=q(agreement.amount).mul(share),due=q(agreement.receivable?.amount??agreement.amount).mul(share);
      if(period===agreement.agreementPeriod)items.agreed.push(evidence(row,'Customer agreement',amount,agreement.reference));
      if(period===agreement.receivable?.period)items.due.push(evidence(row,'Customer receivable',due,agreement.receivable.reference));
      const cashEvents=piece?items.pieceReceipt:items.receipt;
      for(const receipt of agreement.receipts.filter(item=>item.period===period)){
        const actual=evidence(row,'Customer receipt '+receipt.id,q(receipt.amount).mul(share),receipt.reference);
        items.actual.push(actual);
        if(!piece?.included)cashEvents.push(event(row.key+':receipt:'+receipt.id,{kind:piece?'piece_receipt':'receipt',key:row.key,label:agreement.title+' · '+receipt.id,
          reference:receipt.reference,actual:true},[actual],([v])=>v));
      }
      const prior=pieces.get(row.key)??[];
      if(piece&&ordinal>=capitalOrdinal(s,piece.first)&&ordinal<=capitalOrdinal(s,piece.last)){
        const rate=evidence(row,'Recovery uplift',q(piece.rate),agreement.reference,currency+'/piece');
        const agreementCap=evidence(row,'Customer agreement cap',amount,agreement.reference);
        const earned=b.calc(product+':'+period+':'+row.key+':piece-earned','piece_recovery_accrual',[volume,rate,agreementCap,...prior],
          ([qty,price,cap,...earned])=>minimum(qty.mul(price),positive(cap.sub(sum(earned)))),{...opts,
            details:{message:'Piece-price recovery requires a valid volume for '+agreement.agreementId+'.'}});
        prior.push(earned);pieces.set(row.key,prior);
        if(!piece.included)items.piece.push(earned);
      }
      const settled=sum(agreement.receipts.map(item=>q(item.amount))).mul(share);
      const forecastOrdinal=Math.max(capitalOrdinal(s,agreement.receiptPeriod),...agreement.receipts.map(item=>capitalOrdinal(s,item.period)));
      if(ordinal===forecastOrdinal&&!piece?.included){
        const planned=evidence(row,'Collectible recovery',due,agreement.receivable?.reference??agreement.reference);
        cashEvents.push(event(row.key+':forecast',{kind:piece?'piece_receipt':'receipt',key:row.key,
          label:agreement.title+' · Forecast balance',reference:agreement.receivable?.reference??agreement.reference,actual:false},
          [planned,...prior],([limit,...earned])=>positive((piece?minimum(sum(earned),limit):limit).sub(settled))));
      }
    }
    const total=(key:string,deps:Value[])=>def(key,deps,sum,opts);
    total('capital_gross',[...items.gross,...(archive?[archive.gross]:[])]);
    total('capital_allocated',items.allocated);
    total('capital_new',items.added);
    const payment=total('capital_payments',[...items.payment,...(archive?[archive.gross]:[])]);
    const receipt=total('capital_receipts',[...items.receipt,...(archive?[archive.receipt]:[])]);
    total('capital_agreed',items.agreed);total('capital_receivable',items.due);total('capital_actual_receipts',items.actual);
    const net=def('capital_net',[payment,receipt],([p,r])=>p.sub(r),opts);
    const residual=total('capital_salvage',items.salvage);
    const cash=def('capital_cash',[net,residual],([net,salvage])=>salvage.sub(net),opts);
    const cashTerms:BridgeTerm[]=[];
    if(b.bridge){
      const add=(driver:string,list:Value[],sign?:-1)=>list.forEach(value=>{
        const event=value.out.details.capitalEvent as CapitalCashEvent|undefined;
        cashTerms.push(bridgeInput(driver,value,{sign,timing:event?driver+':'+event.key:undefined,identity:value.out.id}));
      });
      add('capital_payments',items.payment,-1);add('capital_receipts',items.receipt);
      add('salvage',items.salvage);add('piece_receipts',items.pieceReceipt);
      if(archive){add('capital_payments',[archive.gross],-1);add('capital_receipts',[archive.receipt]);}
    }
    return {cash,cashTerms,dep:total('capital_depreciation',items.dep),incrementalDep:total('capital_incremental_dep',items.incDep),
      piece:total('capital_piece_earned',items.piece),pieceCash:total('capital_piece_cash',items.pieceReceipt)};
  };
}

export function createWorkingCapital(b:CalculationBuilder){
  const s=b.snapshot,currency=capitalCurrency(s),closing=new Map<string,Value>();
  const rows=capitalRows(s).filter(row=>row.conversion.capital.kind==='terms') as CapitalRow<TermsRecord>[];
  return (product:string,period:string,ordinal:number,revenue:Value,material:Value,pretax:Value,def:Define,
    archive?:{inventory:Value;receivable:Value;payable:Value;tax:Value})=>{
    const active=rows.filter(row=>row.productKey===product&&capitalOrdinal(s,row.periodKey)<=ordinal)
      .sort((a,c)=>capitalOrdinal(s,c.periodKey)-capitalOrdinal(s,a.periodKey))[0];
    const terms=active?.conversion.capital,opts={unit:currency,currency,periods:[period],productScope:[product]};
    const explicit=(field:'inventoryDays'|'receivableDays'|'payableDays'|'tax',unit:string)=>{
      const value=q(terms![field]);
      return b.input({id:product+':'+period+':'+active!.key+':'+field,inputKey:active!.key,sourceKey:active!.sourceKey,
        value:value.text(),periods:[period],role:field,unit,currency:null,status:'ok',cell:terms!.reference},value);
    };
    const days=q(terms?.days??360);
    const released=terms?.release&&terms.period===period;
    const releaseEvidence=released?b.input({id:product+':'+period+':'+active!.key+':release',inputKey:active!.key,sourceKey:active!.sourceKey,
      value:'1',periods:[period],role:'Release working capital in this period',unit:'flag',currency:null,status:'ok',cell:terms.reference},ONE):null;
    function balance(metric:string,base:Value,term:'inventoryDays'|'receivableDays'|'payableDays',fallback:Value|undefined,sign=1){
      if(releaseEvidence)return def(metric,[releaseEvidence],()=>ZERO,{...opts,formula:'Closing balance after explicit release'});
      const driver=terms?explicit(term,'days'):fallback;
      return driver?def(metric,[base,driver],([amount,count])=>amount.mul(count).mul(q(sign)).div(days),opts):def(metric,[],()=>ZERO,opts);
    }
    const inventory=balance('inventory',material,'inventoryDays',archive?.inventory),ar=balance('receivables',revenue,'receivableDays',archive?.receivable),
      ap=balance('payables',material,'payableDays',archive?.payable,-1);
    const nwc=def('nwc',[inventory,ar,ap],sum,opts);
    const previous=closing.get(product);closing.set(product,nwc);
    const change=def('nwc_change',previous?[previous,nwc]:[nwc],values=>values.length===2?values[0].sub(values[1]):values[0].neg(),opts);
    const rate=terms?explicit('tax','fraction'):archive?.tax;
    const tax=rate?def('signed_tax',[pretax,rate],([income,rate])=>(archive?income:positive(income)).mul(rate).neg(),opts):def('signed_tax',[],()=>ZERO,opts);
    return {change,tax};
  };
}
