import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/database.ts';
import { loadPolicy, scheduleAt, runPolicyBackup, policyStatus, retainBackups } from '../lib/backup-policy.ts';
import { backupSnapshot } from '../lib/snapshots.ts';
import { dataLock } from '../lib/data-lock.ts';
import { digest } from '../lib/attachments.ts';
const fixture=()=>{const parent=mkdtempSync(join(tmpdir(),'station-policy-')),source=join(parent,'source'),root=join(parent,'backups');process.env.ADMIN_PASSWORD='Isolated-Policy-Test-2026';const store=openStore(source);store.db.close();return {parent,source,root};};
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
// Only test fixture history is aged; production CLI has no backdating option.
function age(root:string,name:string,at:Date) {
  const path=join(root,name,'manifest.json'),manifest=json(path);manifest.createdAt=at.toISOString();const encoded=JSON.stringify(manifest,null,2)+'\n';writeFileSync(path,encoded);writeFileSync(join(root,name,'COMPLETE'),digest(Buffer.from(encoded))+'\n');
  const catalog=json(join(root,'catalog.json')),entry=catalog.entries.find((value:any)=>value.name===name);entry.createdAt=manifest.createdAt;entry.manifestSha256=digest(Buffer.from(encoded));writeFileSync(join(root,'catalog.json'),JSON.stringify(catalog));
}
test('approved policy resolves Shanghai midnight/noon boundaries and distinguishes scheduled grace from a missed slot',()=>{
  const policy=loadPolicy();assert.deepEqual([policy.rpoMinutes,policy.rtoMinutes,policy.maxDowntimeMinutes,policy.retentionDays],[1440,480,5,30]);assert.equal(policy.rtoClock,'elapsed-24x7');
  assert.deepEqual(scheduleAt(policy,new Date('2026-10-24T16:30:00Z')),{latestWindowAt:'2026-10-24T16:30:00.000Z',nextWindowAt:'2026-10-25T04:30:00.000Z',withinWindow:true});
  assert.equal(scheduleAt(policy,new Date('2026-10-25T04:34:59.999Z')).withinWindow,true);assert.equal(scheduleAt(policy,new Date('2026-10-25T04:35:00Z')).withinWindow,false);
  assert.equal(scheduleAt(policy,new Date('2026-10-25T16:31:00Z')).nextWindowAt,'2026-10-26T04:30:00.000Z');
});
test('managed backups embed approved targets; failure persists alarm without advancing recovery point; RPO and missed slot are reported',()=>{
  const f=fixture(),policy=loadPolicy(),run=runPolicyBackup(f.source,f.root,'isolated-fixture',policy);
  assert.equal(run.manifest.targets.rpoMinutes,1440);assert.equal(run.manifest.targets.rtoMinutes,480);assert.equal(run.manifest.targets.retentionDays,30);
  const original=json(join(f.root,'state.json')),lock=dataLock(f.source,'isolated-live-writer');
  try{assert.throws(()=>runPolicyBackup(f.source,f.root,'fixture',policy),/锁定/);}finally{lock.release();}
  const failed=json(join(f.root,'state.json'));assert.equal(failed.status,'failed');assert.equal(failed.lastSuccessAt,original.lastSuccessAt);assert.equal(failed.lastSnapshot,original.lastSnapshot);assert.equal(failed.failures,1);assert.ok(!JSON.stringify(failed).includes('Isolated-Policy-Test-2026'));
  assert.ok(policyStatus(f.root,policy).alerts.includes('LAST_RUN_FAILED'));assert.throws(()=>retainBackups(f.source,f.root,policy,true),/unsuccessful/);
  runPolicyBackup(f.source,f.root,'fixture',policy);const recovered=json(join(f.root,'state.json'));assert.equal(recovered.status,'ok');assert.equal(recovered.failures,0);
  const future=new Date(Date.parse(recovered.lastSuccessAt)+25*3600000),status=policyStatus(f.root,policy,future);assert.ok(status.alerts.includes('RPO_EXCEEDED'));assert.ok(status.alerts.includes('SCHEDULE_MISSED'));
  assert.throws(()=>retainBackups(f.source,f.root,policy,true,future),/fresh/);
  writeFileSync(join(f.root,recovered.lastSnapshot,'COMPLETE'),'broken');assert.ok(policyStatus(f.root,policy).alerts.includes('SNAPSHOT_INVALID'));
});
test('30-day retention previews then deletes only expired catalogued valid snapshots; boundary, fresh, unknown and live files survive replay',()=>{
  const f=fixture(),policy=loadPolicy();mkdirSync(join(f.source,'uploads'));writeFileSync(join(f.source,'uploads','unknown-source-file'),'keep');
  const old=runPolicyBackup(f.source,f.root,'fixture',policy),boundary=runPolicyBackup(f.source,f.root,'fixture',policy),fresh=runPolicyBackup(f.source,f.root,'fixture',policy);
  const now=new Date(),oldName=old.state.lastSnapshot!,boundaryName=boundary.state.lastSnapshot!;
  age(f.root,oldName,new Date(now.getTime()-31*86400000));age(f.root,boundaryName,new Date(now.getTime()-30*86400000));
  mkdirSync(join(f.root,'unmanaged'));writeFileSync(join(f.root,'unmanaged','keep'),'untouched');
  const preview=retainBackups(f.source,f.root,policy,false,now);assert.deepEqual(preview.eligible,[oldName]);assert.ok(existsSync(old.snapshot));
  const result=retainBackups(f.source,f.root,policy,true,now);assert.deepEqual(result.removed,[oldName]);assert.ok(!existsSync(old.snapshot));assert.ok(existsSync(boundary.snapshot));assert.ok(existsSync(fresh.snapshot));
  assert.deepEqual(retainBackups(f.source,f.root,policy,true,now).removed,[]);assert.equal(readFileSync(join(f.root,'unmanaged','keep'),'utf8'),'untouched');assert.equal(readFileSync(join(f.source,'uploads','unknown-source-file'),'utf8'),'keep');
  // A forged path never reaches recursive deletion; roots cannot be nested in data or share another dataset.
  assert.throws(()=>runPolicyBackup(f.source,join(f.source,'backups'),'fixture'),/separate/);
  assert.throws(()=>runPolicyBackup(f.source,join(f.source,'..backups'),'fixture'),/separate/);
  assert.throws(()=>backupSnapshot(f.source,join(f.source,'..snapshot'),'fixture'),/outside/);
  const other=fixture();assert.throws(()=>runPolicyBackup(other.source,f.root,'fixture'),/another dataset/);
  const catalog=json(join(f.root,'catalog.json'));catalog.entries.push({name:'../source',createdAt:now.toISOString(),manifestSha256:'0'.repeat(64)});writeFileSync(join(f.root,'catalog.json'),JSON.stringify(catalog));assert.throws(()=>retainBackups(f.source,f.root,policy,true,now),/Invalid catalog entry/);
});
test('expired backup budget cannot emit COMPLETE; policy CLI rejects unconfirmed deletion and exits nonzero for unhealthy status',()=>{
  const f=fixture();assert.throws(()=>backupSnapshot(f.source,join(f.parent,'timed-out'),'fixture',loadPolicy(),'fixture',{deadlineMs:Date.now()-1}),/budget/);assert.ok(!existsSync(join(f.parent,'timed-out','COMPLETE')));
  runPolicyBackup(f.source,f.root,'fixture');const cli=fileURLToPath(new URL('../scripts/backup-policy.ts',import.meta.url));
  assert.throws(()=>execFileSync(process.execPath,['--experimental-strip-types',cli,'retention','--data',f.source,'--root',f.root,'--apply','yes'],{stdio:'pipe'}));
  const state=json(join(f.root,'state.json'));writeFileSync(join(f.root,'state.json'),JSON.stringify({...state,status:'failed'}));
  try{execFileSync(process.execPath,['--experimental-strip-types',cli,'status','--root',f.root],{stdio:'pipe'});assert.fail('status should fail');}catch(error:any){assert.equal(error.status,2);assert.ok(String(error.stdout).includes('LAST_RUN_FAILED'));}
});
