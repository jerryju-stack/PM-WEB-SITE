import type {FinanceSnapshot} from "../../lib/finance-contracts.ts";
export function sampleFinance():FinanceSnapshot {
  const scope={module:'operations' as const,productKey:'product-a',marketKey:'market-a',lineKey:'line-a',periodKey:'year-1',sourceKey:'synthetic-ame'};
  return {
    name:'Synthetic forecast',currency:'CNY',currencyScale:2,basis:'website',asOf:'2026-11-17',dictionaryVersion:'P01.1',calculationVersion:'not_implemented',
    policy:{currencyScales:{CNY:2,USD:2,JPY:0,KWD:3},cashFlowOriginPeriod:'year-0',rounding:'half_away_from_zero',
      rules:{discountRate:{coefficient:'10',scale:2},discountSource:'synthetic assumption',cashTiming:'period_end',conversionRules:[]}},
    products:[{key:'product-a',label:'Product A',metadata:{externalKey:'SYN-P-A'}}],
    markets:[{key:'market-a',label:'Market A',metadata:{}}],lines:[{key:'line-a',label:'Line A',metadata:{}}],
    periods:[{key:'year-0',label:'Year 0',metadata:{ordinal:0}},{key:'year-1',label:'2027',metadata:{ordinal:1}}],
    sources:[{key:'synthetic-ame',system:'synthetic',externalKey:'SYN-AME-1',fingerprint:'synthetic-only',sheet:'AME',cell:'C30',
      owner:'Manufacturing Engineering',observation:'design',mappingStatus:'design_only',originalCurrency:'CNY',originalUnit:'seconds',
      originalPeriod:'2027',effectiveFrom:'2027-01-01',effectiveTo:'2027-12-31',metadata:{sample:true}}],
    inputs:[{...scope,key:'ct-assembly',metricKey:'cycle_time',valueKind:'quantity',value:{coefficient:'30',scale:0},unit:'seconds',currency:null,
      effectiveFrom:'2027-01-01',effectiveTo:'2027-12-31',conversion:{rule:'identity',sourceValue:{coefficient:'30',scale:0},sourceUnit:'seconds'}}],
    events:[
      {...scope,key:'budget-1',kind:'budget',amount:{coefficient:'100000',scale:2},currency:'CNY',eventDate:null,relatedKey:null,evidenceKey:'SYN-BUDGET-1'},
      {...scope,key:'incurred-1',kind:'incurred',amount:{coefficient:'40000',scale:2},currency:'CNY',eventDate:'2027-02-01',relatedKey:'budget-1',evidenceKey:'SYN-ACCEPT-1'},
      {...scope,key:'payment-1',kind:'payment',amount:{coefficient:'40000',scale:2},currency:'CNY',eventDate:'2027-03-01',relatedKey:'incurred-1',evidenceKey:'SYN-BANK-1'}
    ]
  };
}
