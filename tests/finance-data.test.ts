import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore,passwordHash} from '../lib/database.ts';
import {applyMigrations,migrations} from '../lib/migrations.ts';
import {accountService} from '../lib/accounts.ts';
import {policy} from '../lib/policy.ts';
import {financeTables} from '../lib/finance-schema.ts';
import {financeService,financeDigest} from '../lib/finance.ts';
import {financeSnapshot} from '../lib/finance-contracts.ts';
import {resourceWriter} from '../lib/resources.ts';
import {sampleFinance} from "./fixtures/finance-p04.ts";
import {backupSnapshot,verifySnapshot,restoreSnapshot,inspectData} from '../lib/snapshots.ts';

function fixture() {
  process.env.ADMIN_PASSWORD='Isolated-Finance-P04-2026';
  const directory=mkdtempSync(join(tmpdir(),'station-finance-p04-')),store=openStore(directory),actor=store.get('users','admin');
  for(const id of ['p','other'])store.put('projects',{id,title:'Synthetic '+id,description:'No real financial data'});
  const context={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'p04-test'},service=financeService(store);
  return {directory,store,actor,context,service};
}
const command=(requestKey:string,snapshot=sampleFinance(),revision?:number)=>({requestKey,reason:'Synthetic P04 evidence',snapshot,...(revision===undefined?{}:{revision})});
const tables=(store:ReturnType<typeof openStore>)=>Object.fromEntries([...financeTables,'audit_events'].map(t=>[t,store.db.prepare('SELECT * FROM '+t).all()]));
const status=(code:number)=>(e:any)=>e.status===code;
test('P04 exact decimals, original units, effective periods and separate budget/incurred/payment events survive restart',()=>{
  const f=fixture();let id='';
  try {
    const s=sampleFinance();
    s.inputs.push({...s.inputs[0],key:'huge-amount',metricKey:'synthetic_amount',valueKind:'money',value:{coefficient:'90071992547409931234567',scale:2},currency:'CNY',unit:'CNY'});
    s.inputs.push({...s.inputs[0],key:'precise-rate',metricKey:'hourly_rate',valueKind:'unit_price',value:{coefficient:'123456789012',scale:10},currency:'CNY',unit:'CNY/person-hour'});
    s.inputs[1].conversion={sourceUnit:'CNY thousand',sourceValue:{coefficient:'90071992547409931234567',scale:5},multiplier:{coefficient:'1000',scale:0},rounding:'half_away_from_zero'};
    const r=f.service.create(f.actor,'p',command('create',s),f.context);id=r.id;
    assert.equal(f.service.get(f.actor,'p',id).snapshot.inputs.find(r=>r.key==='huge-amount')!.value.coefficient,'90071992547409931234567');
    assert.equal(f.store.db.prepare("SELECT typeof(coefficient) AS t FROM finance_inputs WHERE stable_key='huge-amount'").get()!.t,'text');
    const got=f.service.get(f.actor,'p',id).snapshot;assert.equal(got.events.length,3);
    assert.equal(got.events.find(e=>e.kind==='payment')!.relatedKey,'incurred-1');
    assert.equal(got.sources[0].observation,'design');assert.equal(got.inputs.find(r=>r.key==='precise-rate')!.value.scale,10);
    assert.throws(()=>resourceWriter(f.store).remove('projects','p',{version:0,taskRevision:0},f.context),status(409));
    assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {f.store.db.close();}
  const reopened=openStore(f.directory);try{assert.equal(financeService(reopened).get(reopened.get('users','admin'),'p',id).snapshot.inputs.length,3);}finally{reopened.db.close();}
});
test('P04 canonical contract rejects float money, wrong currency precision, foreign/missing references, duplicate keys and invalid effective dates',()=>{
  const variants=[
    (s:any)=>{s.events[0].amount.coefficient=1.1;},
    (s:any)=>{s.events[0].amount={coefficient:'0100',scale:2};},
    (s:any)=>{s.events[0].amount.scale=3;},
    (s:any)=>{s.inputs[0].lineKey='other-line';},
    (s:any)=>{s.sources.push(s.sources[0]);},
    (s:any)=>{s.sources[0].effectiveFrom='2027-02-30';},
    (s:any)=>{s.inputs[0].effectiveTo='2026-01-01';},
    (s:any)=>{s.policy.cashFlowOriginPeriod='year-1';},
    (s:any)=>{s.periods[1].metadata.ordinal=0;},
    (s:any)=>{s.inputs[0].projectId='other';},
    (s:any)=>{s.events[2].relatedKey='unavailable';}
  ];
  for(const mutate of variants){const s=sampleFinance();mutate(s);assert.throws(()=>financeSnapshot(s),status(400));}
  const s=sampleFinance();s.events[0].currency='JPY';s.events[0].amount.scale=0;assert.equal(financeSnapshot(s).events.find(e=>e.key==='budget-1')!.amount.scale,0);
});
test('P04 project-scoped duties, Viewer ceiling, approval, revoked identities and receipt retries enforce live authorization',()=>{
  const f=fixture();try {
    const accounts=accountService(f.store),access=policy(f.store);
    const users=Object.fromEntries([['reader','viewer','finance-controller'],['entry','editor','finance-operations'],['approve','editor','finance-reader']].map(([id,role,groupId])=>{
      const u=accounts.create(f.actor,{id,role,password:'Synthetic-P04-Account-2026'},f.context)!;access.setMember(f.actor,'p',u.id,groupId,f.context);return [id,f.store.get('users',id)];
    }));
    assert.equal(f.service.project(f.actor,'p').state,'empty');assert.equal(f.service.project(users.reader,'p').state,'empty');
    const r=f.service.create(f.actor,'p',command('create'),f.context),candidate=sampleFinance();candidate.inputs[0].value.coefficient='36';
    assert.equal(f.service.get(users.reader,'p',r.id).snapshot.name,'Synthetic forecast');
    assert.equal(f.service.preview(users.reader,'p',r.id,command('read-preview',sampleFinance(),0)).persisted,false);
    for(const user of [users.reader,users.entry]) {
      assert.throws(()=>f.service.get(user,'other',r.id),status(404));
      assert.throws(()=>f.service.create(user,'p',command('forbidden-create'),f.context),status(403));
      assert.throws(()=>f.service.freeze(user,'p',r.id,{requestKey:'freeze',reason:'test',revision:0,stateRevision:0},f.context),status(403));
    }
    assert.throws(()=>f.service.preview(users.reader,'p',r.id,command('preview',candidate,0)),status(403));
    assert.throws(()=>f.service.save(users.reader,'p',r.id,command('noop',sampleFinance(),0),f.context),status(403));
    const before=tables(f.store),preview=f.service.preview(users.entry,'p',r.id,command('preview',candidate,0));
    assert.equal(preview.calculationStatus,'calculated');assert.equal(preview.changes.length,1);assert.deepEqual(tables(f.store),before);
    const otherModule=structuredClone(candidate);otherModule.inputs[0].module='validation';
    assert.throws(()=>f.service.save(users.entry,'p',r.id,command('other-duty',otherModule,0),f.context),status(403));
    const saved=f.service.save(users.entry,'p',r.id,command('save',candidate,0),f.context);assert.equal(saved.revision,1);
    assert.deepEqual(f.service.save(users.entry,'p',r.id,command('save',candidate,0),f.context),saved);
    access.setMember(f.actor,'p',users.entry.uid,'finance-reader',f.context);
    assert.throws(()=>f.service.save(users.entry,'p',r.id,command('save',candidate,0),f.context),status(403));
    access.setMember(f.actor,'p',users.entry.uid,null,f.context);
    assert.throws(()=>f.service.get(users.entry,'p',r.id),status(404));
    accounts.update(f.actor,users.reader.uid,{status:'disabled'},f.context);
    assert.throws(()=>f.service.get(users.reader,'p',r.id),status(401));
    // Supplied stale admin role cannot bypass a live demotion.
    accounts.create(f.actor,{id:'backupadmin',role:'admin',password:'Synthetic-Backup-Admin-2026'},f.context);
    accounts.update(f.actor,f.actor.uid,{role:'viewer'},f.context);
    assert.throws(()=>f.service.create(f.actor,'p',command('stale-admin'),f.context),status(404));
  } finally {f.store.db.close();}
});
test('P04 concurrent stores reject stale revision, receipt hash collision and stale project-state changes; frozen history and identities are immutable',()=>{
  const f=fixture(),other=openStore(f.directory);try {
    const second=financeService(other),r=f.service.create(f.actor,'p',command('create'),f.context);
    assert.deepEqual(f.service.create(f.actor,'p',command('create'),f.context),r);
    assert.throws(()=>f.service.create(f.actor,'p',command('create',{...sampleFinance(),name:'Changed'}),f.context),status(409));
    const candidate=sampleFinance();candidate.inputs[0].value.coefficient='36';
    const saved=f.service.save(f.actor,'p',r.id,command('save',candidate,0),f.context);assert.equal(saved.revision,1);
    assert.throws(()=>second.save(f.actor,'p',r.id,command('losing-concurrent-save',sampleFinance(),0),f.context),status(409));
    const baseline=f.service.freeze(f.actor,'p',r.id,{requestKey:'freeze',reason:'Approve synthetic snapshot',revision:1,stateRevision:0},f.context);
    assert.equal(baseline.status,'frozen');assert.equal(baseline.approvedBaselineId,r.id);assert.equal(baseline.currentVersionId,null);
    assert.deepEqual(f.service.freeze(f.actor,'p',r.id,{requestKey:'freeze',reason:'Approve synthetic snapshot',revision:1,stateRevision:0},f.context),baseline);
    assert.throws(()=>f.service.save(f.actor,'p',r.id,command('frozen-edit',candidate,2),f.context),status(409));
    assert.throws(()=>f.store.db.prepare('UPDATE finance_inputs SET coefficient=? WHERE version_id=?').run('99',r.id),/Frozen/);
    assert.throws(()=>f.store.db.prepare('DELETE FROM finance_sources WHERE version_id=?').run(r.id),/Frozen/);
    assert.throws(()=>f.store.db.prepare('UPDATE finance_versions SET name=? WHERE id=?').run('tampered',r.id),/Frozen/);
    assert.throws(()=>f.store.db.exec("UPDATE finance_changes SET reason='tampered'"),/append only/);
    assert.throws(()=>f.store.db.exec("DELETE FROM finance_receipts"),/append only/);
    const draft=f.service.create(f.actor,'p',{...command('clone',candidate),parentId:r.id,parentRevision:2},f.context);
    assert.throws(()=>f.service.activate(f.actor,'p',draft.id,{requestKey:'stale-state',reason:'test',revision:0,stateRevision:0},f.context),status(409));
    const active=f.service.activate(f.actor,'p',draft.id,{requestKey:'activate',reason:'Select current forecast',revision:0,stateRevision:1},f.context);
    assert.equal(active.approvedBaselineId,r.id);assert.equal(active.currentVersionId,draft.id);
    assert.equal(f.service.get(f.actor,'p',draft.id).parentId,r.id);
    assert.throws(()=>f.store.db.prepare('UPDATE finance_inputs SET project_id=? WHERE version_id=?').run('other',draft.id),/scope is immutable/);
    assert.throws(()=>f.store.db.prepare('UPDATE finance_versions SET project_id=? WHERE id=?').run('other',draft.id),/identity is immutable/);
    const evidence=f.service.changes(f.actor,'p',draft.id).changes;
    assert.equal(evidence.length,2);for(const change of evidence)assert.equal(change.afterSha256,financeDigest(change.payload.after));
    assert.equal(f.store.db.prepare("SELECT actor_uid FROM audit_events WHERE resource='finance' LIMIT 1").get()!.actor_uid,f.actor.uid);
  } finally {other.db.close();f.store.db.close();}
});
test('P04 downstream audit/receipt failure rolls back data, revision, pointers and complete evidence; the same request can retry',()=>{
  const f=fixture();try {
    const r=f.service.create(f.actor,'p',command('create'),f.context),candidate=sampleFinance();candidate.inputs[0].value.coefficient='36';
    for(const target of ['audit_events','finance_receipts']) {
      const before=tables(f.store);
      f.store.db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON "+target+" BEGIN SELECT RAISE(ABORT,'P04 injected failure'); END;");
      assert.throws(()=>f.service.save(f.actor,'p',r.id,command('rollback-save',candidate,0),f.context),/P04 injected failure/);
      assert.throws(()=>f.service.freeze(f.actor,'p',r.id,{requestKey:'rollback-freeze',reason:'test',revision:0,stateRevision:0},f.context),/P04 injected failure/);
      assert.throws(()=>f.service.create(f.actor,'p',command('rollback-create'),f.context),/P04 injected failure/);
      assert.deepEqual(tables(f.store),before);
      f.store.db.exec('DROP TRIGGER injected_failure');
    }
    assert.equal(f.service.save(f.actor,'p',r.id,command('rollback-save',candidate,0),f.context).revision,1);
  } finally {f.store.db.close();}
});
test('P04 explicit approver can freeze without business editing; raw cross-project inserts and tampered backup evidence are rejected',()=>{
  const f=fixture();try {
    const access=policy(f.store),g=access.saveGroup(f.actor,undefined,{name:'Synthetic Approver',capabilities:['financeRead','financeApprove']},f.context);
    const a=accountService(f.store).create(f.actor,{id:'approvalonly',role:'editor',password:'Synthetic-Approval-2026'},f.context)!;
    access.setMember(f.actor,'p',a.id,g.id,f.context);const approver=f.store.get('users','approvalonly');
    const r=f.service.create(f.actor,'p',command('create'),f.context);
    const cols=f.store.db.prepare('PRAGMA table_info(finance_inputs)').all().map(r=>String(r.name));
    assert.throws(()=>f.store.db.exec('INSERT INTO finance_inputs ('+cols.join(',')+') SELECT '+cols.map(c=>c==='project_id'?"'other'":c).join(',')+' FROM finance_inputs'),/FOREIGN KEY/);
    assert.throws(()=>f.service.save(approver,'p',r.id,command('no-edit',sampleFinance(),0),f.context),status(403));
    const frozen=f.service.freeze(approver,'p',r.id,{requestKey:'approve',reason:'Synthetic approval',revision:0,stateRevision:0},f.context);
    assert.equal(frozen.status,'frozen');assert.equal(f.service.get(f.actor,'p',r.id).approvedUid,approver.uid);
    assert.doesNotThrow(()=>inspectData(f.directory));
    f.store.db.exec("DROP TRIGGER finance_changes_update_immutable; UPDATE finance_changes SET after_sha256='tampered' WHERE operation='freeze'");
    assert.throws(()=>inspectData(f.directory),/Finance change hash mismatch/);
  }finally{f.store.db.close();}
});
test('P04 migration 10 -> 11 is atomic, preserves legacy data and empty finance, reruns stably, and backup/restore includes all finance tables',()=>{
  const parent=mkdtempSync(join(tmpdir(),'station-finance-migration-')),directory=join(parent,'data');mkdirSync(directory);
  const db=new DatabaseSync(join(directory,'project-station.sqlite'));
  db.exec(readFileSync(new URL('./fixtures/b-schema.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO users VALUES(?,?)').run('admin',JSON.stringify({id:'admin',name:'Synthetic Administrator',role:'admin',salt:'isolated-salt',hash:passwordHash('Synthetic-P04-Legacy-2026','isolated-salt')}));
  db.prepare('INSERT INTO settings VALUES(?,?)').run('site',JSON.stringify({id:'site',title:'Synthetic legacy'}));
  db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('p',JSON.stringify({id:'p',title:'Synthetic legacy project',owner:'Keep owner'}),7,3);
  db.prepare('INSERT INTO articles VALUES(?,?,?)').run('a',JSON.stringify({id:'a',title:'Keep article',content:'Keep body'}),2);
  applyMigrations(db,migrations.filter(m=>m.version<=10));
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,10);
  const before={projects:db.prepare('SELECT * FROM projects').all(),articles:db.prepare('SELECT * FROM articles').all(),users:db.prepare('SELECT * FROM users').all(),groups:db.prepare('SELECT * FROM permission_groups').all()};
  const step=migrations.find(m=>m.version===11)!;
  assert.ok(step);assert.equal(migrations.at(-1)!.version,11);
  assert.throws(()=>applyMigrations(db,[...migrations.filter(m=>m.version<11),{...step,up(db){step.up(db);db.exec('INSERT INTO p04_injected_missing_table VALUES(1)');}}]),/p04_injected/);
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()!.v,10);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_versions'").get(),undefined);
  assert.deepEqual(db.prepare('SELECT * FROM permission_groups').all(),before.groups);db.close();
  let store=openStore(directory);
  try {
    for(const t of ['projects','articles','users'] as const)assert.deepEqual(store.db.prepare('SELECT * FROM '+t).all(),before[t]);
    const actor=store.get('users','admin'),service=financeService(store);
    assert.deepEqual(service.project(actor,'p'),{projectId:'p',state:'empty',versions:[],approvedBaselineId:null,currentVersionId:null,stateRevision:0});
    const context={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'migration-evidence'};
    const r=service.create(actor,'p',command('seed-synthetic'),context);
    service.freeze(actor,'p',r.id,{requestKey:'freeze',reason:'synthetic',revision:0,stateRevision:0},context);
    service.activate(actor,'p',r.id,{requestKey:'activate',reason:'synthetic',revision:1,stateRevision:1},context);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {store.db.close();}
  store=openStore(directory);store.db.close();
  const beforeBackup=inspectData(directory),snapshot=join(parent,'backup'),restored=join(parent,'restored');
  backupSnapshot(directory,snapshot,'p04-synthetic');verifySnapshot(snapshot);restoreSnapshot(snapshot,restored);
  assert.deepEqual(inspectData(restored),beforeBackup);
  for(const table of financeTables)assert.ok(beforeBackup.tables[table]);
  assert.equal(beforeBackup.tables.finance_events.count,3);assert.equal(beforeBackup.tables.finance_receipts.count,3);
  // Evidence is a public synthetic summary; no private CQA cells, amounts or credentials are exported.
  if(process.env.P04_EVIDENCE_PATH)writeFileSync(process.env.P04_EVIDENCE_PATH,JSON.stringify({schemaBefore:10,schemaAfter:11,migrationFailureRolledBack:true,legacyPreserved:true,emptyLegacyFinance:true,secondStartupStable:true,backupVerified:true,restoreEqual:true,financeTables:financeTables.map(t=>({table:t,count:beforeBackup.tables[t].count,sha256:beforeBackup.tables[t].sha256})),foreignKeyCheck:'ok'},null,2)+'\n');
});
