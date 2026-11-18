import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {calculateFinance} from '../lib/finance-calculation.ts';
import {applyFinanceChanges} from '../lib/finance-preview.ts';
import {operationsWorkspace} from '../lib/finance-operations-calculation.ts';
import {financeService} from '../lib/finance.ts';
import {openStore} from '../lib/database.ts';
import {accountService} from '../lib/accounts.ts';
import {policy} from '../lib/policy.ts';
import {laborScenario} from './fixtures/finance-p06.ts';

const effectivePeriod={from:'year-1',to:'year-1'};
const evidence={reviewer:'Review owner',reference:'Synthetic work study'};
const command=(record:Record<string,unknown>,productKey='product-a')=>({collection:'operations',productKey,record:{...evidence,...record}});
const line={line:'shared-line',shifts:'1',hours:'8',days:'30',allocation:'0.6',oee:'0.8'};
const station={line:line.line,station:'S10',operation:'Join',people:'2',ct:'30',output:'2',repeats:'1',efficiency:'0.75'};
const design=(revision:string,repeats='1')=>({type:'design',revision,lines:[line],stations:[{...station,repeats}]});
const select=(sourceKey:string,mode='design')=>({type:'selection',sourceKey,mode});
const rate={type:'rate',rate:'60'};

test('P09 cycle output, repeat count, shared time, OEE and labor efficiency are independently scoped',()=>{
  let snapshot=laborScenario();
  snapshot.products.push({key:'product-b',label:'Double product',metadata:{active:true}});
  for(const row of snapshot.inputs.filter(row=>row.productKey==='product-a'))snapshot.inputs.push({...row,key:row.key+':b',productKey:'product-b'});
  const apply=(record:Record<string,unknown>,product?:string)=>{
    const change=applyFinanceChanges(snapshot,[command(record,product)],effectivePeriod);
    snapshot=change.candidate;
    return change.fields[0].key;
  };
  const single=apply(design('single')),double=apply(design('double','2'),'product-b');
  apply(rate);apply(rate,'product-b');apply(select(single));
  let report=calculateFinance(snapshot),scopes=operationsWorkspace(snapshot,report,'year-1',null)!;
  const route=scopes.find(scope=>scope.productKey==='product-a')!.records[0];
  assert.equal(route.lines[0].stations[0].normalized,'15.00');
  assert.equal(route.lines[0].takt,'51.84');
  assert.equal(route.lines[0].capacity,'27648');
  assert.equal(route.modeledLabor,'0.6667');
  assert.equal(scopes.find(scope=>scope.productKey==='product-b')!.records[0].modeledLabor,'1.3333');
  apply(select(double),'product-b');
  report=calculateFinance(snapshot);
  assert.match(report.issues.find(issue=>issue.outputId==='product-a:year-1:route_labor')!.message,/exceeds 100%/);
  assert.match(report.issues.find(issue=>issue.outputId==='product-b:year-1:route_labor')!.message,/exceeds 100%/);
});

test('P09 service gates finance calibration, persists revisions, and refuses adoption of a missing station',()=>{
  process.env.ADMIN_PASSWORD='Synthetic-P09-Verification';
  const store=openStore(mkdtempSync(join(tmpdir(),'finance-p09-'))),service=financeService(store),admin=store.get('users','admin');
  const context={actorId:admin.uid,actorUid:admin.uid,actorName:admin.name,requestId:'p09-test'};
  try {
    store.put('projects',{id:'demo',title:'P09 tests'});
    const draft=service.create(admin,'demo',{requestKey:'p09-create',reason:'Synthetic baseline',snapshot:laborScenario()},context);
    const member=accountService(store).create(admin,{id:'p09-me',name:'ME',role:'editor',password:'Synthetic-P09-ME'},context)!;
    policy(store).setMember(admin,'demo',member.id,'finance-operations',context);
    const me=store.get('users',member.loginName);
    let revision=0;
    const request=(record:Record<string,unknown>)=>({requestKey:'preview-'+revision,revision,reason:'P09 work study',effectivePeriod,changeSet:[command(record)]});
    const commit=(record:Record<string,unknown>,actor:any=me)=>{
      const body=request(record),preview=service.preview(actor,'demo',draft.id,body);
      assert.equal(preview.saveBlocked,false);
      const save={...body,requestKey:'save-'+revision,candidateSha256:preview.candidateSha256,previewCalculationVersion:preview.calculationVersion};
      const result=service.save(actor,'demo',draft.id,save,context);
      assert.equal(result.calculationSha256,preview.calculationSha256);
      assert.deepEqual(service.save(actor,'demo',draft.id,save,context),result);
      revision=result.revision;
      return {key:preview.fields[0].key,preview};
    };
    assert.throws(()=>service.preview(me,'demo',draft.id,request(rate)),(error:any)=>error.status===403);
    commit(rate,admin);
    const d=commit(design('D1'));
    assert.throws(()=>service.preview(me,'demo',draft.id,request(design('D1'))),/already exists/);
    commit(select(d.key));
    const actual={type:'actual',designKey:d.key,batch:'B1',date:'2026-11-18',revision:'1',stage:'pilot',personHours:'2',goodPieces:'100',capacityFactors:{}};
    const incomplete=commit({...actual,times:{}});
    const blocked=request(select(incomplete.key,'actual')),preview=service.preview(me,'demo',draft.id,blocked);
    assert.ok(preview.saveBlocked);
    assert.ok(preview.errors.some(issue=>issue.phase==='candidate'&&issue.message.includes('Missing cycle time at S10')));
    assert.throws(()=>service.save(me,'demo',draft.id,{...blocked,requestKey:'blocked',candidateSha256:preview.candidateSha256,
      previewCalculationVersion:preview.calculationVersion},context),/Missing cycle time at S10/);
    const corrected=commit({...actual,revision:'2',times:{S10:'36'}});
    const selected=commit(select(corrected.key,'actual'));
    assert.equal(selected.preview.candidate.products['product-a'].periodic[1].unit_labor.displayValue,'1.2000');
    const workspace=service.workspace(me,'demo',new URLSearchParams({version:draft.id,module:'operations'}));
    assert.equal(workspace.canOperate,true);
    assert.equal(workspace.canCalibrate,false);
    assert.equal(workspace.operations![0].records.length,3);
    assert.equal(workspace.operations![0].records.find(row=>row.key===corrected.key)!.lines[0].capacity,null);
    const forged=service.get(me,'demo',draft.id).snapshot;
    forged.inputs.find(input=>input.metricKey==='p09.rate')!.value.coefficient='1';
    assert.throws(()=>service.save(me,'demo',draft.id,{requestKey:'forge',reason:'Injection test',revision,snapshot:forged},context),/revision-bound/);
    assert.equal(service.get(me,'demo',draft.id).revision,revision);
  } finally {store.db.close();}
});
