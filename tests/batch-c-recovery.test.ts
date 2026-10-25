import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync,spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/database.ts';
import { dataLock } from '../lib/data-lock.ts';
import { backupSnapshot } from '../lib/snapshots.ts';
import { httpFixture } from './http-fixture.ts';
test('controlled offline admin recovery requires stopped writers, explicit acknowledgement and secret environment; restored login is audited without secrets',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'station-c-offline-'));process.env.ADMIN_PASSWORD='Isolated-Before-Recovery-2026';
  const store=openStore(directory),admin=store.get('users','admin');store.put('users',{...admin,status:'disabled'});store.db.close();
  assert.throws(()=>backupSnapshot(directory,directory+'-unusable','fixture'),/usable login/);
  const script=new URL('../scripts/recover-admin.ts',import.meta.url),secret='Isolated-Offline-Only-2026';
  const args=['--experimental-strip-types',script.pathname.replace(/^\/([A-Z]:)/,'$1'),'--data',directory,'--login','admin','--offline-confirmed','yes','--no-admin-access','yes'];
  // fileURLToPath is needed for spaces and Windows drive letters.
  const {fileURLToPath}=await import('node:url');args[1]=fileURLToPath(script);
  assert.notEqual(spawnSync(process.execPath,args,{env:{...process.env,RECOVERY_PASSWORD:''}}).status,0);
  const lock=dataLock(directory,'test-held-lock');try{assert.notEqual(spawnSync(process.execPath,args,{env:{...process.env,RECOVERY_PASSWORD:secret}}).status,0);}finally{lock.release();}
  assert.notEqual(spawnSync(process.execPath,args.slice(0,-2),{env:{...process.env,RECOVERY_PASSWORD:secret}}).status,0);
  const output=execFileSync(process.execPath,args,{env:{...process.env,RECOVERY_PASSWORD:secret},encoding:'utf8'});assert.ok(!output.includes(secret));
  const recovered=openStore(directory);try{assert.equal(recovered.get('users','admin').uid,admin.uid);assert.equal(recovered.get('users','admin').authEpoch,1);const history=recovered.db.prepare('SELECT * FROM audit_events').all();assert.equal(history.length,1);assert.equal(history[0].resource,'offline-recovery');assert.ok(!JSON.stringify(history).includes(secret));}finally{recovered.db.close();}
  const f=await httpFixture({directory,password:secret});try{assert.equal((await f.call('data',undefined,f.cookie)).data.user.role,'admin');}finally{await f.stop();}
});
