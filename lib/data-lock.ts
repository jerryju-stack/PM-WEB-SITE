import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
/** Shared by the single server and offline maintenance. Never automatically steal a stale lock. */
export function dataLock(directory: string, purpose: string) {
  mkdirSync(directory,{recursive:true});
  const path=join(directory,'.station-lock'), token=randomUUID();
  try { mkdirSync(path); } catch { throw Error('数据目录已锁定；先停止服务，崩溃遗留锁须运行 unlock 检查进程'); }
  try { writeFileSync(join(path,'owner.json'),JSON.stringify({pid:process.pid,host:hostname(),purpose,token,createdAt:new Date().toISOString()}),{flag:'wx'}); }
  catch(error) { rmSync(path,{recursive:true});throw error; }
  return { release() { if(JSON.parse(readFileSync(join(path,'owner.json'),'utf8')).token===token)rmSync(path,{recursive:true}); } };
}
export function unlockDeadProcess(directory: string) {
  const path=join(directory,'.station-lock'), owner=JSON.parse(readFileSync(join(path,'owner.json'),'utf8'));
  if(owner.host!==hostname()||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('锁所属主机或进程无效，需人工核查');
  try { process.kill(owner.pid,0); } catch(error:any) {
    if(error.code!=='ESRCH')throw error;
    rmSync(path,{recursive:true});return;
  }
  throw Error('锁所属进程仍存活，拒绝解锁');
}
