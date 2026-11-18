/** Read-only rehearsal against the authorized P05 import. Public output contains no project amounts. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {FinanceSnapshot} from '../lib/finance-contracts.ts';
import {businessFx,businessInputs} from '../lib/finance-business.ts';
import {calculateFinance,compareCalculations} from '../lib/finance-calculation.ts';
import {applyFinanceChanges,previewImpact} from '../lib/finance-preview.ts';
import {Decimal,ONE,ZERO,sum} from '../lib/finance-decimal.ts';

const run=JSON.parse(readFileSync('.deploy/finance-p05/latest-run.json','utf8'));
const {snapshot}=JSON.parse(readFileSync(join(run.privateOutput,'candidate.json'),'utf8')) as {snapshot:FinanceSnapshot};
const original=calculateFinance(snapshot),inputs=businessInputs(snapshot),period='year-2020';
const all=inputs.filter(row=>row.productKey==='outboard'&&row.periodKey===period);
const fields=['part_price','sales_price','annual_reduction','vehicles','variable','allocation'] as const;
const result=fields.map(field=>{
  const row=all.find(input=>input.conversion.businessField===field&&!input.conversion.referenceOnly&&(field!=='part_price'||input.currency==='CNY'))!;
  assert.ok(row,field);
  const source=snapshot.sources.find(item=>item.key===row.sourceKey)!;
  const next=field==='annual_reduction'?{coefficient:'10',scale:2}:
    {...row.value,coefficient:String(BigInt(row.value.coefficient)+10n**BigInt(row.value.scale))};
  const changed=applyFinanceChanges(snapshot,[{collection:'inputs',key:row.key,value:next}],{from:period,to:period});
  const candidate=calculateFinance(changed.candidate),diff=compareCalculations(original,candidate),impact=previewImpact(original,candidate,changed.fields);
  assert.equal(candidate.calculationVersion,'P08.1');assert.ok(diff.compatible);
  assert.ok(diff.metrics.npv.delta.value!==null);
  assert.equal(candidate.issues.filter(issue=>issue.code==='missing_input'&&original.outputs[issue.outputId]?.value!=null).length,0);
  assert.deepEqual(impact.affectedProducts,['outboard']);
  assert.ok(impact.paths[0].nodes.some(n=>n.metricKey==='cqa.mpbitri'));
  assert.equal(diff.products.outboard.periodic[1].cash_flow.delta.displayValue,'0.00');
  if(field==='part_price'){
    const sheet=String(snapshot.products.find(p=>p.key==='outboard')!.metadata.externalKey);
    const sourceValue=(cell:string,otherSheet=sheet)=>{
      const source=snapshot.sources.find(s=>s.sheet===otherSheet&&s.cell===cell);
      const excel=source?.metadata.excel as any;
      return excel?.state==='number'?Decimal.from(excel.value):ZERO;
    };
    // Independent source calculation: quote delta × original qty × annual material factor × market share × add-on factors.
    const qty=all.find(item=>item.conversion.businessGroup===row.conversion.businessGroup&&item.conversion.businessField==='part_quantity')!;
    const slot=['EU','ROW','US'].indexOf(String(snapshot.markets.find(item=>item.key===row.marketKey)!.metadata.volumeMarket));
    const volume=sourceValue('F'+(370+slot)),total=sum([370,371,372].map(n=>sourceValue('F'+n)));
    const expected=Decimal.from(qty.value).mul(businessFx(snapshot,row.currency!,period)!.rate).mul(ONE.add(sourceValue('F414')))
      .mul(volume.div(total)).mul(ONE.add(sourceValue('F416')).add(sourceValue('F417')));
    const actual=diff.products.outboard.periodic[2].unit_material.delta.exact!;
    const calculated=new Decimal(BigInt(actual.numerator),BigInt(actual.denominator));
    assert.ok(calculated.sub(expected).abs().cmp(Decimal.from('0.000001'))<=0);
    assert.ok(Number(diff.metrics['cqa.mpbitri'].delta.value)<0);
  }
  if(field==='allocation')assert.equal(diff.metrics.npv.delta.displayValue,'0.00');
  if(field==='annual_reduction')assert.notEqual(diff.products.outboard.periodic[3].unit_sales.delta.displayValue,'0.0000');
  return {field,source:{sheet:source.sheet,cell:source.cell},status:'passed',market:row.marketKey,period,
    beforePeriodUnchanged:true,affectedProductCount:impact.affectedProducts.length,standardOperatingMapping:candidate.metrics.operating_profit.status};
});
assert.ok(inputs.some(r=>r.conversion.assetKey&&r.conversion.archiveCapitalized&&r.conversion.referenceOnly));
const summary={step:'P08',source:'Authorized P05 frozen snapshot',calculationVersion:'P08.1',count:result.length,
  noProductionWrites:true,copiedInputsOnly:true,toolingReferenceOnly:true,results:result};
if(process.argv.includes('--record')){
  const dir='docs/validation/project-finance/P08';mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'archive-checks.json'),JSON.stringify(summary,null,2)+'\n');
}
console.log(JSON.stringify(summary));
