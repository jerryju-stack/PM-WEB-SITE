/** Rehearsal on a copy of the P05 archive. Only source locations and check outcomes are recorded. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {Decimal,ONE,sum,ZERO} from '../lib/finance-decimal.ts';
import {operationsWorkspace} from '../lib/finance-operations-calculation.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';

const run=JSON.parse(readFileSync('.deploy/finance-p05/latest-run.json','utf8'));
const {snapshot}=JSON.parse(readFileSync(join(run.privateOutput,'candidate.json'),'utf8')) as {snapshot:FinanceSnapshot};
const original=calculateFinance(snapshot),year='year-2020',ordinal=2,col='F';
const records=new Map(snapshot.sources.map(source=>[source.sheet+'!'+source.cell,source.metadata.excel as {state?:string;value?:string}]));
const value=(sheet:string,cell:string,allowBlank=false)=>{
  const row=records.get(sheet+'!'+cell);
  if(allowBlank&&row?.state==='blank')return ZERO;
  assert.equal(row?.state,'number',sheet+'!'+cell);
  return Decimal.from(row!.value!);
};
const assertAmount=(key:string,result:{exact:{numerator:string;denominator:string}|null},expected:Decimal)=>{
  assert.ok(result.exact,key);
  const actual=new Decimal(BigInt(result.exact.numerator),BigInt(result.exact.denominator));
  assert.ok(actual.sub(expected).abs().cmp(Decimal.from('0.00000001'))<=0,key);
};
const scope=operationsWorkspace(snapshot,original,year,null)!;
const checks:{product:string;repeatsPerPiece:number;sharedLines:string[];financials:string;archivedControls:string[];year:string;
  archivedDesign:string;syntheticMeasuredReplacement:string;independentChecks:string[]}[]=[];
for(const [product,repeats] of [['double_buckle','2'],['single_buckle','1']]){
  const selection=scope.find(item=>item.productKey===product)!;
  const archived=selection.archive!,sheet=String(snapshot.products.find(p=>p.key===product)!.metadata.externalKey);
  assert.deepEqual(archived.operations.map(item=>item.line).sort(),['AME line 35','AME line 36']);
  assert.ok(archived.operations.every(item=>item.shared&&item.repeats===repeats));
  assert.equal(selection.records.length,0);
  const historicOther=sum([606,611,616,621,626,631,636,638].map(row=>value(sheet,'C'+row,true)));
  const originalOperations=sum(archived.operations.map((operation,i)=>{
    const first=594+i*5,row=operation.line.split(' ').at(-1);
    const efficiency=value(sheet,'D'+first),allowance=value(sheet,'D'+(first+1),true);
    return value('AME','E'+row).mul(value('AME','F'+row)).mul(Decimal.from(repeats)).mul(value(sheet,'D590'))
      .div(Decimal.from(3600)).mul(efficiency.n>0n?ONE.div(efficiency):ONE.add(allowance));
  }));
  assertAmount('SOP labor',original.products[product].periodic[ordinal].unit_labor_sop,originalOperations.add(historicOther));
  assertAmount('Annual unit labor',original.products[product].periodic[ordinal].unit_labor,value(sheet,col+'102'));
  const prior=snapshot.sources.length;
  let draft=snapshot;
  const apply=(record:Record<string,unknown>)=>{
    const edit=applyFinanceChanges(draft,[{collection:'operations',productKey:product,record:{
      ...record,reviewer:'Synthetic reviewer',reference:'Synthetic P09 replacement rehearsal'
    }}],{from:year,to:year});
    draft=edit.candidate;
    return edit.fields[0].key;
  };
  const design=apply({type:'design',revision:'REHEARSAL',lines:[{line:'SIM-LINE',shifts:'1',hours:'8',days:'260',allocation:'1',oee:'0.9'}],
    stations:[{station:'S10',operation:'Rehearsal',line:'SIM-LINE',ct:'30',people:'2',output:'1',repeats,efficiency:'1'}]});
  const actual=apply({type:'actual',designKey:design,batch:'SIMULATED',date:'2026-11-18',revision:'1',stage:'pilot',
    personHours:'2',goodPieces:'100',times:{S10:'36'},capacityFactors:{'SIM-LINE':'0.9'}});
  apply({type:'rate',rate:'60'});
  apply({type:'selection',mode:'actual',sourceKey:actual});
  const candidate=calculateFinance(draft),diff=compareCalculations(original,candidate),annual=diff.products[product].periodic[ordinal];
  const deltaUnit=value(sheet,col+'102').mul(Decimal.from('1.2').add(historicOther).sub(originalOperations.add(historicOther))).div(value(sheet,'C640'));
  const deltaLabor=deltaUnit.mul(value(sheet,col+'183')).mul(Decimal.from(1000)).mul(ONE.add(value(sheet,'K448')));
  const deltaCash=deltaLabor.neg().mul(ONE.sub(value(sheet,'C329'))).div(snapshot.currency==='USD'?value('Input','C8'):ONE);
  const deltaNpv=deltaCash.div(ONE.add(value('Exec Sum ','C182')).pow(ordinal));
  assertAmount('Unit labor variance',annual.unit_labor.delta,deltaUnit);
  assertAmount('Annual direct labor variance',annual.labor.delta,deltaLabor);
  assertAmount('Project cash flow variance',diff.periodic[ordinal].cash_flow.delta,deltaCash);
  assertAmount('Project NPV variance',diff.metrics.npv.delta,deltaNpv);
  assert.ok(diff.periodic.every((period,index)=>index===ordinal||Number(period.cash_flow.delta.value)===0));
  assert.equal(snapshot.sources.length,prior);
  checks.push({product,repeatsPerPiece:Number(repeats),sharedLines:['AME!E35:G35','AME!E36:G36'],financials:sheet,
    archivedControls:['D590','C594:D595','C599:D600','C640','F102'],year,archivedDesign:'passed',syntheticMeasuredReplacement:'passed',
    independentChecks:['SOP labor','annual unit labor','annual direct labor','consolidated period cash flow','project NPV','unchanged other periods']});
}
const report={step:'P09',input:'Authorized P05 snapshot',calculationVersion:'P09.1',historicalActuals:'to_collect',checks};
if(process.argv.includes('--record')){
  const directory='docs/validation/project-finance/P09';
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'archive-checks.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
