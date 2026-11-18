import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../lib/database.ts';
import {financeService,financeDigest} from '../lib/finance.ts';
import {financeTables} from '../lib/finance-schema.ts';
import {accountService} from '../lib/accounts.ts';
import {policy} from '../lib/policy.ts';
import {laborScenario,laborChange} from './fixtures/finance-p06.ts';

test('P06 preview is read-only; compact save is bound, atomic, repeatable, idempotent and persists the same calculation after reopen',()=>{
  process.env.ADMIN_PASSWORD='Isolated-P06-Test-2026';const directory=mkdtempSync(join(tmpdir(),'station-p06-')),store=openStore(directory),actor=store.get('users','admin'),service=financeService(store);
  store.put('projects',{id:'p',title:'Synthetic P06'});store.put('projects',{id:'other',title:'Other'});
  const ctx={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'p06'},tables=()=>Object.fromEntries([...financeTables,'audit_events'].map(t=>[t,store.db.prepare('SELECT * FROM '+t).all()]));
  let id='',digest='';
  try {
    id=service.create(actor,'p',{requestKey:'create',reason:'T2 synthetic',snapshot:laborScenario()},ctx).id;
    const account=accountService(store).create(actor,{id:'p06entry',role:'editor',password:'Synthetic-P06-2026'},ctx)!,entry=store.get('users','p06entry');
    policy(store).setMember(actor,'p',account.id,'finance-operations',ctx);
    const before=tables(),preview=service.preview(entry,'p',id,laborChange);assert.deepEqual(tables(),before);assert.equal(preview.persisted,false);assert.equal(preview.comparison.metrics.npv.delta.displayValue,'-1818.18');
    assert.throws(()=>service.preview(entry,'other',id,laborChange),(e:any)=>e.status===404);
    const save={requestKey:'save',reason: laborChange.reason,revision:0,changeSet:laborChange.changeSet,effectivePeriod:laborChange.effectivePeriod,candidateSha256:preview.candidateSha256,previewCalculationVersion:preview.calculationVersion};
    assert.throws(()=>service.save(entry,'p',id,{...save,candidateSha256:'wrong'},ctx),(e:any)=>e.status===409);assert.deepEqual(tables(),before);
    store.db.exec("CREATE TRIGGER fail_p06 BEFORE INSERT ON finance_receipts WHEN NEW.request_key='save' BEGIN SELECT RAISE(ABORT,'synthetic P06 failure'); END;");
    assert.throws(()=>service.save(entry,'p',id,save,ctx),/synthetic P06/);assert.deepEqual(tables(),before);store.db.exec('DROP TRIGGER fail_p06');
    const receipt=service.save(entry,'p',id,save,ctx);digest=preview.calculationSha256;assert.equal(receipt.calculationSha256,digest);assert.equal(receipt.snapshotSha256,financeDigest({snapshot:service.get(actor,'p',id).snapshot,status:'draft'}));
    const committed=tables();assert.deepEqual(service.save(entry,'p',id,save,ctx),receipt);assert.deepEqual(tables(),committed);
    assert.throws(()=>service.preview(entry,'p',id,laborChange),(e:any)=>e.status===409);
    assert.equal(service.calculation(actor,'p',id).calculationSha256,digest);
    service.freeze(actor,'p',id,{requestKey:'freeze',reason:'Synthetic baseline',revision:1,stateRevision:0},ctx);
    const frozen=tables(),next=service.preview(entry,'p',id,{...laborChange,revision:2});assert.equal(next.persisted,false);assert.deepEqual(tables(),frozen);
    assert.throws(()=>service.save(entry,'p',id,{...save,requestKey:'frozen',revision:2},ctx),(e:any)=>e.status===409);
    const draft=service.create(actor,'p',{requestKey:'clone',reason:'Next scenario',parentId:id,parentRevision:2,name:'Synthetic copied forecast'},ctx);
    service.activate(actor,'p',draft.id,{requestKey:'activate',reason:'Set current',revision:0,stateRevision:1},ctx);
    const pair=service.projectCalculations(actor,'p');assert.equal(pair.baseline?.versionId,id);assert.equal(pair.current?.versionId,draft.id);
    assert.equal(service.compare(actor,'p',id,{requestKey:'compare',reason:'Compare same inputs',revision:2,otherVersionId:draft.id,otherRevision:0}).metrics.npv.delta.displayValue,'0.00');
    policy(store).setMember(actor,'p',account.id,null,ctx);
    assert.throws(()=>service.save(entry,'p',id,save,ctx),(e:any)=>e.status===404);
  } finally {store.db.close();}
  const reopened=openStore(directory);try{assert.equal(financeService(reopened).calculation(reopened.get('users','admin'),'p',id).calculationSha256,digest);}finally{reopened.db.close();}
});
