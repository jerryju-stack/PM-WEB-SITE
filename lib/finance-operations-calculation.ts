import type {CalculationBuilder,CalculationReport,Value} from './finance-calculation-types.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {Decimal} from './finance-decimal.ts';
import {archived} from './finance-business.ts';
import {operationsIndex,supportsOperations} from './finance-operations.ts';
import type {OperationsRecord} from './finance-operations.ts';
import {caseFinanceRate} from './finance-fx.ts';

export function createOperationsCalculation(b:CalculationBuilder) {
  const s=b.snapshot,index=operationsIndex(s);
  const currency=archived(s)?'CNY':s.currency;
  const sources=new Map(s.sources.map(source=>[source.key,source]));
  return (product:string,period:string,demand:Value):Value|null=>{
    const scope=index.scope(product,period);
    if(!scope.design||!scope.selected||!scope.selection||!scope.record)return null;
    const {design,record,selected,selection,rate}=scope;
    const model=index.evaluate(design,record.type==='actual'?record:undefined,demand.q);
    const makeInput=(row:typeof design,value:Decimal|null,role:string,unit:string,inputCurrency:string|null=null)=>{
      const source=sources.get(row.sourceKey);
      const observation=row.conversion.operations;
      const evidence={id:'input:'+row.key,sourceKey:row.sourceKey,inputKey:row.key,periods:[period],role:role+' · '+observation.reviewer,
        unit,currency:inputCurrency,value:value?.text()??null,status:value===null?'missing_input' as const:'ok' as const,sheet:null,cell:source?.externalKey??null};
      return inputCurrency?b.money(evidence,value,currency,period):b.input(evidence,value);
    };
    const basis=makeInput(selection,Decimal.from(1),record.type==='actual'?'Measured basis':'Design basis','record');
    const quantity=makeInput(selected,model.personHours,record.type==='actual'?'Actual person-hours ÷ batch good pieces':'Station standard person-hours','person-hour/piece');
    const designEvidence=record.type==='actual'?[makeInput(design,Decimal.from(1),'Referenced design revision','record')]:[];
    const rateInput=rate?[makeInput(rate,Decimal.from(rate.value),'Finance-calibrated hourly rate',rate.unit,rate.currency)]:[];
    const id=product+':'+period+':route_labor';
    const details={message:[...model.issues,...(rate?[]:['A finance-calibrated hourly rate is required.'])].join(' ')};
    const unit=currency+'/piece',deps=[quantity,basis,...designEvidence,...rateInput];
    const options={unit,currency,periods:[period],productScope:[product],basis:archived(s)?'cqa_full':'website',
      formula:(record.type==='actual'?'Actual batch person-hours ÷ good pieces':'Σ (CT × operators × repeats ÷ (3600 × units per cycle × independent labor efficiency))')+' × calibrated hourly rate',
      details};
    if(details.message)return b.make(id,'route_labor',null,deps,{...options,status:'missing_input'});
    const labor=b.calc(id,'route_labor',deps,amounts=>amounts[0].mul(amounts.at(-1)!),options);
    b.bridge?.labor.set(labor,{quantity:quantity.q,rate:rateInput[0]?.q??null});
    return labor;
  };
}

export function operationsWorkspace(s:FinanceSnapshot,report:CalculationReport,period:string,productFilter:string|null) {
  if(!supportsOperations(s))return null;
  const index=operationsIndex(s),periodIndex=report.periods.indexOf(period);
  const byCell=new Map(s.sources.filter(row=>row.sheet&&row.cell).map(row=>[row.sheet+'!'+row.cell,row]));
  const excel=(sheet:string,cell:string)=>byCell.get(sheet+'!'+cell)?.metadata.excel as {state:string;value:string;formula?:string}|undefined;
  const archivedValue=(sheet:string,cell:string)=>{
    const cached=excel(sheet,cell);
    return {reference:sheet+'!'+cell,value:cached?.state==='number'?cached.value:null};
  };
  const format=(value:Decimal|null,places=2)=>value?.text(places)??null;
  const percent=(value:Decimal|null)=>format(value?.mul(Decimal.from(100))??null);
  const exact=(output:CalculationReport['periodic'][number][string]|undefined)=>output?.exact?
    new Decimal(BigInt(output.exact.numerator),BigInt(output.exact.denominator)):null;
  return s.products.filter(p=>p.metadata.active!==false&&(!productFilter||p.key===productFilter)).map(product=>{
    const scope=index.scope(product.key,period),output=report.products[product.key]?.periodic[periodIndex]??{};
    const demand=exact(output.volume);
    const currency=archived(s)?'CNY':s.currency;
    const rateCurrency=scope.rate?.currency??currency;
    const fx=scope.rate?caseFinanceRate(s,rateCurrency,currency,period):null;
    const rate=scope.rate&&fx?Decimal.from(scope.rate.value).mul(fx):null;
    const sheet=String(product.metadata.externalKey);
    const archive=archived(s)?{
      labor:archivedValue(sheet,'C640'),rate:archivedValue(sheet,'D590'),
      operations:[594,599].map(first=>{
        const link=/AME!\$?F\$?(\d+)/.exec(excel(sheet,'C'+(first+1))?.formula??'');
        const row=link?.[1];
        return {line:row?'AME line '+row:'Financials operation '+first,lineKey:row?'ame-'+row:null,financials:sheet+'!C'+first+':D'+(first+1),
          shared:row==='35'||row==='36',repeats:row?String(product.metadata.cyclesPerUnit):'1',
          people:row?archivedValue('AME','E'+row):archivedValue(sheet,'C'+first),ct:row?archivedValue('AME','F'+row):archivedValue(sheet,'C'+(first+1)),
          oee:row?archivedValue('AME','G'+row):null,efficiency:archivedValue(sheet,'D'+first),allowance:archivedValue(sheet,'D'+(first+1))};
      })
    }:null;
    return {productKey:product.key,label:product.label,period,demand:format(demand,0),currency,rateCurrency,currencies:s.policy.currencyScales,
      archive,currentUnitLabor:output.unit_labor?.displayValue??null,selectedKey:scope.selected?.key??null,
      hourlyRate:format(rate,4),laborTotal:format(exact(output.labor),10),
      laborByPeriod:report.products[product.key]?.periodic.map((row,idx)=>({
        period:report.periods[idx],volume:format(exact(row.volume),0),value:format(exact(row.unit_labor),4)
      }))??[],
      selection:scope.selection?.conversion.operations as Extract<OperationsRecord,{type:'selection'}>|undefined,
      rate:scope.rate?.conversion.operations as Extract<OperationsRecord,{type:'rate'}>|undefined,
      records:scope.items.flatMap(row=>{
        const record=row.conversion.operations;
        if(record.type!=='design'&&record.type!=='actual')return [];
        const design=record.type==='design'?row:scope.items.find(item=>item.key===record.designKey)!;
        const model=index.evaluate(design,record.type==='actual'?record:undefined,demand);
        return [{key:row.key,record,designKey:design.key,issues:model.issues,personHours:format(model.personHours,8),
          modeledLabor:format(model.personHours&&rate?model.personHours.mul(rate):null,4),
          lines:model.lines.map(({line,stations,takt,longest,capacity,balance,bottlenecks,shared,factor})=>({
            ...line,shared,factor,takt:format(takt),constraint:format(longest),capacity:capacity?(capacity.n/capacity.d).toString():null,balance:percent(balance),
            stations:stations.map(({row,ct,work})=>({...row,observedCt:ct,normalized:format(work),bottleneck:bottlenecks.some(s=>s.row.station===row.station),
              overTakt:work&&takt?work.cmp(takt)>0:null}))
          }))}];
      })};
  });
}
