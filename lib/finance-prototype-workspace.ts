import type {FinanceSnapshot} from './finance-contracts.ts';
import {Decimal,ONE,sum,ZERO} from './finance-decimal.ts';
import type {developmentCosts} from './finance-development.ts';
import {developmentCurrency,plannedCost,uncoveredQuantity} from './finance-development.ts';
import {hasReviewedTemplate} from './finance-cqa-attachments.ts';
import {caseFinanceRate} from './finance-fx.ts';

type CostRow=ReturnType<typeof developmentCosts>[number];
const q=Decimal.from;

export function prototypeWorkspace(s:FinanceSnapshot,scoped:CostRow[],all:CostRow[],product:string|null,
  specifications:readonly {row:number;description:string}[]) {
  const reviewed=hasReviewedTemplate(s),currency=developmentCurrency(s);
  const grouped=new Map<string,CostRow[]>();
  const references=new Map<string,{row:string;factor:string|null}>();
  for(const row of scoped){
    const {cost}=row.conversion;
    const rush=reviewed&&row.currency==='EUR'?/^DV cost!U(9|1[0-4])(?:；报价系数 \/(0\.89))?$/.exec(cost.reference):null;
    const china=reviewed&&row.currency==='CNY'?/^DV cost!Y(9|1[0-4]) \+ AD\1$/.exec(cost.reference):null;
    const reference=rush?{row:rush[1],factor:rush[2]??'1'}:china?{row:china[1],factor:null}:null;
    const key=reference?'dv-'+reference.row:row.key;
    const items=grouped.get(key)??[];
    items.push(row);grouped.set(key,items);
    if(reference)references.set(row.key,reference);
  }
  const amounts=new Map(scoped.map(row=>{
    const {cost}=row.conversion,reference=references.get(row.key),code=row.currency??currency;
    const share=product?q(cost.allocations.find(item=>item.productKey===product)?.share??'0'):ONE;
    const quantity=uncoveredQuantity(cost).mul(share);
    const planned=plannedCost(cost).mul(share);
    const rate=caseFinanceRate(s,code,currency,cost.period);
    const component=(key:string)=>cost.components[key]==null?null:quantity.mul(q(cost.components[key]));
    const rush=reference?.factor?component('expedite'):null;
    return [row.key,{
      total:planned.n===0n?ZERO:rate?.mul(planned)??null,
      factor:reference?.factor??null,rush:rush?.mul(q(reference!.factor!))??null,
      inspection:reference&&reference.factor===null?component('processing'):null,
      freight:reference&&reference.factor===null?component('freight'):null
    }] as const;
  }));
  const totals=(items:CostRow[])=>{
    const values=items.map(row=>amounts.get(row.key)!);
    const column=(name:'rush'|'inspection'|'freight',code:string)=>{
      const recorded=values.flatMap(value=>value[name]===null?[]:[value[name]!]);
      return recorded.length?sum(recorded).text(s.policy.currencyScales[code]):null;
    };
    return {
      total:values.length&&values.every(row=>row.total!==null)?sum(values.map(row=>row.total!)).text(s.policy.currencyScales[currency]):null,
      rush:column('rush','EUR'),inspection:column('inspection','CNY'),freight:column('freight','CNY')
    };
  };
  const groups=[...grouped].map(([key,items])=>{
    const first=items[0],reference=references.get(first.key),cost=first.conversion.cost;
    const products=[...new Set(items.flatMap(row=>row.conversion.cost.allocations.map(item=>item.productKey)))];
    const coverage=reference?all.filter(row=>row.module==='validation'&&
      row.conversion.cost.reference.split('；')[0]==='DV cost!M'+reference.row&&
      items.some(item=>item.periodKey===row.periodKey)&&
      row.conversion.cost.allocations.some(item=>(product?[product]:products).includes(item.productKey)))
      .map(row=>({key:row.key,period:row.periodKey,reference:row.conversion.cost.reference.split('；')[0]})):[];
    return {
      key,products,row:reference?.row??null,title:reference?
        specifications.find(item=>String(item.row)===reference.row)?.description||'Quote specification '+reference.row:cost.title,
      items:items.map(row=>({key:row.key,factor:amounts.get(row.key)!.factor,classified:references.has(row.key)})),
      coverage,...totals(items)
    };
  }).sort((a,b)=>Number(a.row??Infinity)-Number(b.row??Infinity)||a.title.localeCompare(b.title));
  return {groups,classified:references.size>0,summary:totals(scoped)};
}
