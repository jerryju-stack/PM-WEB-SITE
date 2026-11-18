import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpFixture} from './http-fixture.ts';
import {laborScenario,laborChange} from './fixtures/finance-p06.ts';

test('P06 HTTP calculation, preview, compact save, clone and comparison reuse the same authorized service',async()=>{
  const f=await httpFixture();try {
    const p=(await f.call('projects',{title:'Synthetic P06 HTTP'},f.cookie)).data.id,base='projects/'+p+'/finance';
    const created=await f.call(base+'/versions',{requestKey:'create',reason:'Synthetic T2',snapshot:laborScenario()},f.cookie);assert.equal(created.status,201);
    const path=base+'/versions/'+created.data.id;
    assert.equal((await f.call(path+'/calculation')).status,401);
    assert.equal((await f.call(base+'/calculations',undefined,f.cookie)).data.baseline,null);
    const preview=await f.call(path+'/preview',laborChange,f.cookie);assert.equal(preview.status,200);assert.equal(preview.data.clientSequence,1);assert.equal(preview.data.comparison.metrics.npv.delta.displayValue,'-1818.18');
    const save={requestKey:'save',reason:'T2',revision:0,changeSet:laborChange.changeSet,effectivePeriod:laborChange.effectivePeriod,candidateSha256:preview.data.candidateSha256,previewCalculationVersion:preview.data.calculationVersion};
    const saved=await f.call(path,save,f.cookie,'PUT');assert.equal(saved.status,200);
    const after=await f.call(path+'/calculation',undefined,f.cookie);assert.equal(after.data.calculationSha256,preview.data.calculationSha256);
    assert.equal((await f.call(path+'/preview',laborChange,f.cookie)).status,409);
    const copy=await f.call(base+'/versions',{requestKey:'clone',reason:'Copy persisted version',parentId:created.data.id,parentRevision:1,name:'Copy'},f.cookie);assert.equal(copy.status,201);
    const compared=await f.call(path+'/compare',{requestKey:'compare',reason:'Same inputs',revision:1,otherVersionId:copy.data.id,otherRevision:0},f.cookie);assert.equal(compared.status,200);assert.equal(compared.data.metrics.npv.delta.displayValue,'0.00');
    const outside=(await f.call('projects',{title:'Other P06'},f.cookie)).data.id;
    assert.equal((await f.call('projects/'+outside+'/finance/versions/'+created.data.id+'/calculation',undefined,f.cookie)).status,404);
    assert.equal((await f.call(path+'/preview',{...laborChange,revision:1,effectivePeriod:{from:'unknown',to:'year-1'}},f.cookie)).status,400);
  }finally{await f.stop();}
});
