import type {FinanceSnapshot} from './finance-contracts.ts';
import type {reviewedDevelopmentEvidence} from './finance-development-evidence.ts';
import {Decimal,sum,ZERO} from './finance-decimal.ts';
import {developmentCurrency,plannedCost} from './finance-development.ts';
import type {developmentCosts} from './finance-development.ts';
import {hasReviewedTemplate} from './finance-cqa-attachments.ts';
import {caseFinanceRate} from './finance-fx.ts';

export type ValidationPhase='europe-dv'|'china-dv'|'china-pv'|'other';
type CostRow=ReturnType<typeof developmentCosts>[number];
type Evidence=NonNullable<ReturnType<typeof reviewedDevelopmentEvidence>>['validation'][number];
const q=Decimal.from;

function quoteReference(row:CostRow) {
  const cost=row.conversion.cost;
  const euro=/^DV cost!([MTVW])(9|1[0-4])(?:；报价系数 \/(0\.89))?$/.exec(cost.reference);
  if(euro&&row.currency==='EUR'&&cost.stage==='DV')
    return {row:euro[2],phase:'europe-dv' as const,part:euro[1],factor:euro[3]??'1'};
  const dv=/^DV cost!AB(9|1[0-4]):AC\1$/.exec(cost.reference);
  if(dv&&row.currency==='CNY'&&cost.stage==='DV')
    return {row:dv[1],phase:'china-dv' as const,part:'AB',factor:'1'};
  const pv=/^PV cost!(?:O(9|1[0-4])|Y(9|1[0-4]) - O\2)$/.exec(cost.reference);
  if(pv&&row.currency==='CNY'&&cost.stage==='PV')
    return {row:pv[1]??pv[2],phase:'china-pv' as const,part:pv[1]?'O':'Y',factor:'1'};
  return null;
}

export function validationWorkspace(s:FinanceSnapshot,all:CostRow[],period:string|null,product:string|null,
  evidence:ReturnType<typeof reviewedDevelopmentEvidence>) {
  const reviewed=hasReviewedTemplate(s),currency=developmentCurrency(s);
  const quotes=new Map(evidence?.validation.map(spec=>[String(spec.row),spec]));
  const groups=new Map<string,{row:string|null;title:string;products:Set<string>;records:RecordItem[];evidence?:Evidence}>();
  const selected=all.filter(row=>row.module==='validation'&&(!product||row.conversion.cost.allocations.some(item=>item.productKey===product)));
  type RecordItem={key:string;period:string;phase:ValidationPhase;part:string|null;original:Decimal;converted:Decimal|null};
  for(const row of selected){
    const {cost}=row.conversion,reference=reviewed?quoteReference(row):null,code=row.currency??currency;
    const key=reference?'dv-'+reference.row:row.key;
    const spec=reference?quotes.get(reference.row):undefined;
    const group=groups.get(key)??{row:reference?.row??null,title:reference?
      spec?.description||'Quote specification '+reference.row:cost.title,products:new Set<string>(),records:[],evidence:spec};
    cost.allocations.forEach(item=>group.products.add(item.productKey));
    const share=product?q(cost.allocations.find(item=>item.productKey===product)!.share):q('1');
    const planned=plannedCost(cost).mul(share);
    const rate=caseFinanceRate(s,code,currency,cost.period);
    const record:RecordItem={key:row.key,period:cost.period,phase:reference?.phase??'other',part:reference?.part??null,
      original:planned.mul(q(reference?.factor??'1')),converted:planned.n===0n?ZERO:rate?.mul(planned)??null};
    group.records.push(record);groups.set(key,group);
  }
  const phases=[['europe-dv','EUR'],['china-dv','CNY'],['china-pv','CNY'],['other',currency]] as const;
  const report=(items:RecordItem[])=>items.length&&items.every(row=>row.converted!==null)?
    sum(items.map(row=>row.converted!)).text(s.policy.currencyScales[currency]):null;
  const totals=(items:RecordItem[])=>({
    phases:phases.map(([phase,code])=>{
      const rows=items.filter(row=>row.phase===phase);
      const amount=phase==='other'?report(rows):rows.length?sum(rows.map(row=>row.original)).text(s.policy.currencyScales[code]):null;
      return {phase,currency:code,amount,present:rows.length>0};
    }),
    total:report(items)
  });
  const inScope=(row:RecordItem)=>!period||row.period===period;
  const records=[...groups].map(([key,group])=>{
    const scoped=group.records.filter(inScope);
    return {key,row:group.row,title:group.title,products:[...group.products],...totals(scoped),
      items:scoped.map(({key,period,phase,part})=>({key,period,phase,part})),
      coverage:group.evidence?{
        certifications:group.evidence.certifications,pvTravel:group.evidence.pvTravel
      }:null};
  }).sort((a,b)=>Number(a.row??Infinity)-Number(b.row??Infinity)||a.title.localeCompare(b.title));
  const hasQuoteBasis=records.some(group=>group.row!==null);
  return {
    groups:records.filter(row=>row.items.length>0),
    coverage:records.filter(row=>row.coverage!==null),
    summary:totals([...groups.values()].flatMap(group=>group.records.filter(inScope))),
    hasQuoteBasis
  };
}
