import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { httpFixture } from './http-fixture.ts';
import { diagnostic, errorResponse } from '../lib/http-errors.ts';
import { openStore } from '../lib/database.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { backupSnapshot } from '../lib/snapshots.ts';
test('new initialization refuses missing password instead of leaking a generated credential; later explicit initialization is retryable',()=>{
  const directory=mkdtempSync(join(tmpdir(),'station-init-b-')),previous=process.env.ADMIN_PASSWORD;delete process.env.ADMIN_PASSWORD;
  try {assert.throws(()=>openStore(directory),/ADMIN_PASSWORD/);assert.throws(()=>backupSnapshot(directory,directory+'-invalid-snapshot','fixture'),/initialized/);process.env.ADMIN_PASSWORD='Isolated-Retry-Init-2026';const store=openStore(directory);try{assert.equal(store.all('users').length,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n,5);}finally{store.db.close();}}
  finally{if(previous===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=previous;}
});
test('error classes retain A HTTP status contract; unknown faults are generic and diagnostics omit multiline secrets',()=>{
  for(const status of [400,401,403,404,405,409,413,429])assert.equal(errorResponse(Object.assign(Error('safe'),{status}),'id').status,status);
  const error=Object.assign(Error('password=SECRET Cookie=session=TOKEN\n    at SECRET_STACK_FORGERY'),{code:'SQLITE_ERROR'});
  assert.equal(errorResponse(error,'id').status,500);assert.ok(!JSON.stringify(errorResponse(error,'id')).includes('SECRET'));
  const log=diagnostic(error,'id','POST');assert.ok(log.includes('batch-b-errors.test.ts'));assert.ok(!log.includes('SECRET'));assert.ok(!log.includes('TOKEN'));
});
test('actual SQL and disk errors return 500 with bounded generated requestId; audit correlates and no credentials enter responses/logs',async()=>{
  const f=await httpFixture();const secret='Sensitive-Canary-Do-Not-Log';
  const db=new DatabaseSync(join(f.directory,'project-station.sqlite'));
  try {
    const response=await fetch(f.base+'/api/projects',{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json','X-Request-Id':'attacker-controlled-'+secret},body:JSON.stringify({title:'safe'})});
    const good=await response.json(),trace=response.headers.get('x-request-id')!;
    assert.match(trace,/^[0-9a-f-]{36}$/);assert.ok(!trace.includes(secret));
    assert.equal(db.prepare("SELECT request_id FROM audit_events WHERE resource='projects' AND resource_id=?").get(good.id)!.request_id,trace);
    db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'Sensitive-Canary-Do-Not-Log password hash Cookie session private_key SQL /secret/path\n    at FORGED_SECRET'); END");
    const failed=await fetch(f.base+'/api/projects/'+good.id,{method:'PATCH',headers:{Cookie:f.cookie,'Content-Type':'application/json'},body:JSON.stringify({version:0,title:'fail',password:secret})});
    const failure=await failed.json();assert.equal(failed.status,500);assert.equal(failure.category,'internal');assert.equal(failure.requestId,failed.headers.get('x-request-id'));assert.ok(!JSON.stringify(failure).includes(secret));
    assert.equal(db.prepare('SELECT version FROM projects WHERE id=?').get(good.id)!.version,0);db.exec('DROP TRIGGER injected_failure');
    const tasks=await f.call('projects/'+good.id+'/timing',undefined,f.cookie),taskId=tasks.data.tasks[0].id;
    renameSync(join(f.directory,'uploads'),join(f.directory,'uploads-held'));writeFileSync(join(f.directory,'uploads'),'block directory');
    let diskTrace:string;
    try {const disk=await fetch(f.base+'/api/projects/'+good.id+'/tasks/'+taskId+'/attachments',{method:'POST',headers:{Cookie:f.cookie,'X-File-Name':'fault.txt'},body:secret});const value=await disk.json();assert.equal(disk.status,500);diskTrace=value.requestId;assert.ok(!JSON.stringify(value).includes(secret));}
    finally{unlinkSync(join(f.directory,'uploads'));renameSync(join(f.directory,'uploads-held'),join(f.directory,'uploads'));}
    assert.equal(db.prepare('SELECT count(*) AS n FROM attachments').get()!.n,0);
    // Before any bytes exist, some filesystems report ENOENT rather than ENOTDIR.
    for(const job of db.prepare('SELECT attempts FROM file_jobs').all())assert.ok(Number(job.attempts)>0);
    await f.stop();
    const logs=f.logs();assert.ok(logs.errors.includes(failure.requestId));assert.ok(logs.errors.includes(diskTrace!));assert.ok(logs.errors.includes('server.ts'));
    for(const forbidden of [secret,'FORGED_SECRET',f.cookie.split('=')[1],'Isolated-Http-Test-2026','/secret/path'])assert.ok(!JSON.stringify(logs).includes(forbidden));
  }finally{db.close();await f.stop();}
});
