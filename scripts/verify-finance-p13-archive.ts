/** Compare the single authorized CQA original with a labeled synthetic shared-line revision. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {FinanceBridgeInputs} from '../lib/finance-bridge-inputs.ts';
import {calculateFinance} from '../lib/finance-calculation.ts';
import {financeBridges} from '../lib/finance-bridges.ts';
import {comparisonSources} from '../lib/finance-comparison-sources.ts';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {Decimal,ONE,sum,ZERO} from '../lib/finance-decimal.ts';

const run=JSON.parse(readFileSync('.deploy/finance-p05/latest-run.json','utf8'));
const {snapshot}=JSON.parse(readFileSync(join(run.privateOutput,'candidate.json'),'utf8')) as {snapshot:FinanceSnapshot};
const source=snapshot.sources.find(row=>row.sheet==='AME'&&row.cell==='F35')!;
const input=snapshot.inputs.find(row=>row.sourceKey===source.key&&row.metricKey==='cqa.operations.cycle_time')!;
const value=Decimal.from(input.value).mul(Decimal.from('1.1')),fixed={coefficient:BigInt(value.text(8).replace('.','')).toString(),scale:8};
const target='year-2020',year={from:target,to:target};
const {candidate}=applyFinanceChanges(snapshot,[{collection:'inputs',key:input.key,value:fixed}],year);
candidate.name='SIMULATED · CQA later-stage rehearsal';
const captured=(snapshot:FinanceSnapshot)=>{
  const inputs=new FinanceBridgeInputs();return {snapshot,inputs,report:calculateFinance(snapshot,inputs)};
};
const cells=new Map(snapshot.sources.map(row=>[row.sheet+'!'+row.cell,row.metadata.excel as {state:string;value:string}]));
const amount=(sheet:string,cell:string)=>{const raw=cells.get(sheet+'!'+cell)!;return raw.state==='blank'?ZERO:Decimal.from(raw.value);};
const exact=(value:{exact:{numerator:string;denominator:string}|null})=>{
  assert.ok(value.exact);return new Decimal(BigInt(value.exact.numerator),BigInt(value.exact.denominator));
};
const currencies:Record<string,unknown>[]=[];
for(const currency of ['CNY','USD']){
  const left=captured({...snapshot,currency,currencyScale:snapshot.policy.currencyScales[currency]});
  const right=captured({...candidate,currency,currencyScale:snapshot.policy.currencyScales[currency]});
  const result=financeBridges(left,right,null,null),data=result.data!;
  assert.ok(data.profit?.reconciled&&!data.profit.unexplained);
  assert.ok(data.npv?.reconciled&&!data.npv.unexplained);
  const terms=comparisonSources(left.snapshot,right.snapshot,left.report,right.report);
  const ordinal=left.report.periods.indexOf(target),col=String.fromCharCode(68+ordinal);
  const cost:Decimal[]=[],npv:Decimal[]=[];
  for(const product of snapshot.products.filter(row=>left.report.productScope.includes(row.key))){
    const sheet=String(product.metadata.externalKey);
    const row=[594,599].find(row=>String((cells.get(sheet+'!C'+(row+1)) as {formula?:string})?.formula).includes('F35'));
    const hoursDelta=row?Decimal.from(fixed).sub(amount('AME','F35')).mul(amount('AME','E35'))
      .mul(Decimal.from(Number(product.metadata.cyclesPerUnit))).div(Decimal.from(3600))
      .mul(amount(sheet,'D'+row).n>0n?ONE.div(amount(sheet,'D'+row)):ONE.add(amount(sheet,'D'+(row+1)))):ZERO;
    const unit=hoursDelta.mul(amount(sheet,'D590')).mul(amount(sheet,col+'102')).div(amount(sheet,'C640'));
    const fx=currency==='USD'?ONE.div(amount('Input','C8')):ONE;
    const profit=unit.mul(amount(sheet,col+'183')).mul(Decimal.from(1000)).mul(ONE.add(amount(sheet,'K448'))).mul(fx).neg();
    const projectNpv=profit.mul(ONE.sub(amount(sheet,'C329'))).div(ONE.add(amount('Exec Sum ','C182')).pow(ordinal));
    cost.push(profit);npv.push(projectNpv);
    const productProfit=data.profit.products.find(row=>row.key===product.key);
    const productNpv=data.npv.products.find(row=>row.key===product.key);
    if(row){
      assert.ok(productProfit&&productNpv);
      assert.ok(exact(productProfit.value).sub(profit).abs().cmp(Decimal.from('0.00000001'))<=0,product.key+' profit');
      assert.ok(exact(productNpv.value).sub(projectNpv).abs().cmp(Decimal.from('0.00000001'))<=0,product.key+' NPV');
    }else{assert.equal(productProfit,undefined);assert.equal(productNpv,undefined);}
  }
  assert.ok(exact(data.profit.metric.delta).sub(sum(cost)).abs().cmp(Decimal.from('0.00000001'))<=0,'project profit');
  assert.ok(exact(data.npv.metric.delta).sub(sum(npv)).abs().cmp(Decimal.from('0.00000001'))<=0,'project NPV');
  assert.ok(data.periodic.every(item=>item.period===target||item.metrics.cash_flow.delta.exact?.numerator==='0'));
  const labor=data.profit.byDriver.find(row=>row.key==='labor_volume')!;
  assert.equal(labor.products.length,2);
  for(const row of labor.details)for(const side of ['before','after'] as const){
    assert.ok(terms.links(side,row.evidence[side],row.period).some(link=>link.reference==='AME!F35'));
  }
  currencies.push({currency,productsCompared:left.report.productScope.length,periodsCompared:left.report.periods.length,
    productsAffected:labor.products.map(row=>row.key),sameSourceBothSides:true,independentProductAndProjectTieOut:'passed',
    unexplainedResidual:false});
}
const evidence={step:'P13',original:'Authorized P05 CQA archive',after:'SIMULATED · CQA later-stage rehearsal',
  period:target,source:'AME!F35',sharedEdit:'cycle time × 1.10',actualCrossStageReconciliation:'pending second authorized original',currencies};
if(process.argv.includes('--record'))writeFileSync('docs/validation/project-finance/P13/archive-checks.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
