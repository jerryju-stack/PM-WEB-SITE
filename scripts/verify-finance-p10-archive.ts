/** Checks the authorized P05 archive without publishing workbook amounts. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {Decimal,sum,ONE,ZERO} from '../lib/finance-decimal.ts';

const manifest=JSON.parse(readFileSync('.deploy/finance-p05/latest-run.json','utf8'));
const {snapshot}=JSON.parse(readFileSync(join(manifest.privateOutput,'candidate.json'),'utf8')) as {snapshot:FinanceSnapshot};
const matrix=JSON.parse(readFileSync('docs/validation/project-finance/P01/source-matrix.json','utf8'));
const sources=new Map(snapshot.sources.map(source=>[source.sheet+'!'+source.cell,source.metadata.excel as {state?:string;value?:string;formula?:string}]));
const K=Decimal.from(1000),tolerance=Decimal.from('0.000001');
const source=(sheet:string,cell:string)=>sources.get(sheet+'!'+cell);
function decimal(sheet:string,cell:string,allowBlank=false){
  const raw=source(sheet,cell);
  if(allowBlank&&raw?.state==='blank')return ZERO;
  assert.equal(raw?.state,'number',sheet+'!'+cell);
  return Decimal.from(raw!.value!);
}
function close(label:string,a:Decimal,b:Decimal){assert.ok(a.sub(b).abs().cmp(tolerance)<=0,label);}
function checkedAmount(label:string,value:{exact:{numerator:string;denominator:string}|null},expected:Decimal) {
  assert.ok(value.exact,label);
  close(label,new Decimal(BigInt(value.exact.numerator),BigInt(value.exact.denominator)),expected);
}
const original=calculateFinance(snapshot);
const conversion=/^'DV cost'!X9\*EUR\/(\d+(?:\.\d+)?)$/.exec(source('PM','I4')?.formula??'');
assert.ok(conversion,'PM!I4 archived conversion');
const eur=decimal('Input','C9').div(Decimal.from(conversion[1]));
for(const [pm,budget,divisor] of [[2,10,2],[4,9,1],[6,10,2],[8,12,2],[9,11,1],[10,12,2],[11,13,1],[12,14,1]]){
  for(const [column,sheet,costColumn,fx] of [['I','DV cost','X',eur],['J','DV cost','AE',ONE],['K','PV cost','Y',ONE]] as const)
    close('PM!'+column+pm,decimal(sheet,costColumn+budget).mul(fx).div(Decimal.from(divisor)),decimal('PM',column+pm));
}
for(let row=9;row<=14;row++){
  const formula=source('PV cost','Y'+row)?.formula;
  assert.ok(formula&&!/\b[VWX]\$?\d+/.test(formula),'PV total omits DV-covered columns');
}
const products=Object.entries(matrix.products as Record<string,{sheet:string;pmRows:number[]}>).map(([product,{sheet,pmRows}])=>{
  const pm=sum(pmRows.flatMap(row=>[...'GIJK'].map(col=>decimal('PM',col+row,true))));
  close(sheet+' Q426',pm.div(K),decimal(sheet,'Q426'));
  const gross=sum([...'DEFGHIJKLMN'].map(column=>decimal(sheet,column+'426'))).mul(K);
  close(sheet+' phasing',gross,pm);
  for(const [index,column] of [...'DEFGHIJKLMN'].entries()){
    const net=decimal(sheet,column+'426').sub(decimal(sheet,column+'427',true)).mul(K);
    checkedAmount(sheet+' '+column+' net engineering',original.products[product].periodic[index].net_engineering,net);
  }
  return {product,sheet,pmRows,checks:['PM G/I/J/K → Q426','D:N phasing','426 less 427, without adding DV/PV source reports']};
});
const p='outboard',sheet=matrix.products[p].sheet,sample='2000',rate=decimal(sheet,'C329'),fx=snapshot.currency==='USD'?decimal('Input','C8'):ONE;
const changed=applyFinanceChanges(snapshot,[{collection:'development',action:'new',module:'validation',costRef:'P10-SYNTHETIC-ARCHIVE-ONLY',record:{
  title:'Simulated incremental retest',group:'P10 Archive rehearsal',category:'retest',stage:'PV',quantity:'1',components:{rate:sample},
  period:'year-2020',paymentPeriod:'year-2021',reference:'Synthetic test quote',allocationBasis:'Dedicated product',
  allocations:[{productKey:p,share:'1'}],coverage:[],recovery:{method:'none'}
}}],{from:'year-2020',to:'year-2021'}).candidate;
const adjusted=calculateFinance(changed),diff=compareCalculations(original,adjusted),cost=Decimal.from(sample),discount=ONE.add(decimal('Exec Sum ','C182'));
const taxRelease=cost.mul(rate).div(fx),payment=cost.neg().div(fx);
checkedAmount('Incremental engineering expense',diff.products[p].periodic[2].net_engineering.delta,cost);
checkedAmount('Cash in occurrence period',diff.periodic[2].cash_flow.delta,taxRelease);
checkedAmount('Cash in payment period',diff.periodic[3].cash_flow.delta,payment);
checkedAmount('Project NPV',diff.metrics.npv.delta,taxRelease.div(discount.pow(2)).add(payment.div(discount.pow(3))));
assert.ok(diff.periodic.every((item,index)=>index===2||index===3||Number(item.cash_flow.delta.value)===0));
const report={step:'P10',source:'Authorized P05 snapshot',archiveWrites:0,historicalActuals:'to_collect',calculationVersion:'P10.1',
  coverage:{dv:['DV cost!X9:X14','DV cost!AE9:AE14'],pv:['PV cost!V7:X8','PV cost!Y9:Y14'],pm:['PM!I4','PM!G2:K12']},products,
  simulatedRetest:{expensePeriod:'year-2020',paymentPeriod:'year-2021',checks:['Engineering expense','Tax timing','Payment cash','Project NPV','Other periods unchanged']}};
if(process.argv.includes('--record')){
  const folder='docs/validation/project-finance/P10';
  mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'archive-checks.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
