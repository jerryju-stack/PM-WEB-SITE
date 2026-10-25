import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, dirname, sep } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { backupSnapshot, verifySnapshot } from './snapshots.ts';
import { digest } from './attachments.ts';
import { dataLock } from './data-lock.ts';
export type BackupPolicy={format:1;rpoMinutes:number;rtoMinutes:number;maxDowntimeMinutes:number;retentionDays:number;timezone:'Asia/Shanghai';windows:string[];rtoClock:'elapsed-24x7'};
export const defaultPolicyPath=fileURLToPath(new URL('../config/backup-policy.json',import.meta.url));
export function loadPolicy(path=defaultPolicyPath):BackupPolicy {
  const raw=JSON.parse(readFileSync(path,'utf8'));
  for(const key of ['rpoMinutes','rtoMinutes','maxDowntimeMinutes','retentionDays'])if(!Number.isSafeInteger(raw[key])||raw[key]<=0)throw Error('Policy targets must be positive integers');
  if(raw.format!==1||raw.timezone!=='Asia/Shanghai'||raw.rtoClock!=='elapsed-24x7'||!Array.isArray(raw.windows)||raw.windows.length!==2||new Set(raw.windows).size!==2||!raw.windows.every((value:unknown)=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)))throw Error('Invalid policy schedule');
  return {format:1,rpoMinutes:raw.rpoMinutes,rtoMinutes:raw.rtoMinutes,maxDowntimeMinutes:raw.maxDowntimeMinutes,retentionDays:raw.retentionDays,timezone:raw.timezone,windows:[...raw.windows].sort(),rtoClock:raw.rtoClock};
}
export function scheduleAt(policy:BackupPolicy,now=new Date()) {
  if(!Number.isFinite(now.getTime()))throw Error('Invalid time');
  // Fixed UTC+08:00 is appropriate to the explicitly supported Asia/Shanghai policy.
  const local=new Date(now.getTime()+8*3600000),day=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-8*3600000;
  const slots=[-1,0,1].flatMap(offset=>policy.windows.map(value=>{const [hours,minutes]=value.split(':').map(Number);return day+offset*86400000+hours*3600000+minutes*60000;})).sort((a,b)=>a-b);
  const latest=slots.filter(value=>value<=now.getTime()).at(-1)!,next=slots.find(value=>value>now.getTime())!;
  return {latestWindowAt:new Date(latest).toISOString(),nextWindowAt:new Date(next).toISOString(),withinWindow:now.getTime()-latest<policy.maxDowntimeMinutes!*60000};
}
type Entry={name:string;createdAt:string;manifestSha256:string};
type Catalog={format:1;dataset:string;entries:Entry[]};
type State={format:1;status:'running'|'ok'|'failed';pid:number;host:string;lastAttemptAt:string;lastSuccessAt?:string;lastSnapshot?:string;lastErrorCode?:string;elapsedMs?:number;backupBudgetMs:number;failures:number};
const catalogName='catalog.json',stateName='state.json';
const atomicJSON=(path:string,value:unknown)=>{const temporary=path+'.tmp-'+randomUUID();writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(temporary,path);};
const readCatalog=(root:string):Catalog=>{
  const value=JSON.parse(readFileSync(join(root,catalogName),'utf8'));
  if(value.format!==1||!Array.isArray(value.entries)||typeof value.dataset!=='string'||new Set(value.entries.map((entry:any)=>entry.name)).size!==value.entries.length)throw Error('Invalid backup catalog');
  for(const entry of value.entries)if(!/^snapshot-\d{8}T\d{6}Z-[a-f0-9-]{36}$/.test(entry.name)||!Number.isFinite(Date.parse(entry.createdAt))||!/^[a-f0-9]{64}$/.test(entry.manifestSha256))throw Error('Invalid catalog entry');
  return value;
};
function guardedRoot(source:string,root:string) {
  const data=realpathSync(source),parent=realpathSync(dirname(resolve(root))),destination=join(parent,resolve(root).split(/[\\/]/).at(-1)!);
  const nested=(from:string,to:string)=>{const path=relative(from,to);return !path||(path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path));};
  if(nested(data,destination)||nested(destination,data))throw Error('Backup root and data must be separate directories');
  if(existsSync(destination)&&lstatSync(destination).isSymbolicLink())throw Error('Backup root cannot be a symbolic link');
  return {root:destination,dataset:digest(Buffer.from(process.platform==='win32'?data.toLowerCase():data))};
}
function openCatalog(source:string,root:string) {
  const checked=guardedRoot(source,root);mkdirSync(checked.root,{recursive:true});
  if(!existsSync(join(checked.root,catalogName))) {
    if(readdirSync(checked.root).some(name=>name!=='.station-lock'))throw Error('Refuse to adopt a nonempty backup root');
    atomicJSON(join(checked.root,catalogName),{format:1,dataset:checked.dataset,entries:[]});
  }
  const catalog=readCatalog(checked.root);if(catalog.dataset!==checked.dataset)throw Error('Backup root belongs to another dataset');
  return {...checked,catalog};
}
function verifiedEntry(root:string,entry:Entry) {
  const path=join(root,entry.name),info=lstatSync(path);
  if(info.isSymbolicLink()||!info.isDirectory()||realpathSync(path)!==resolve(path))throw Error('Unsafe managed snapshot');
  const manifest=verifySnapshot(path);
  if(manifest.createdAt!==entry.createdAt||digest(readFileSync(join(path,'manifest.json')))!==entry.manifestSha256)throw Error('Managed snapshot identity mismatch');
  return manifest;
}
function readState(root:string):State|undefined {
  if(!existsSync(join(root,stateName)))return undefined;
  const state=JSON.parse(readFileSync(join(root,stateName),'utf8'));
  if(state.format!==1||!['running','ok','failed'].includes(state.status)||!Number.isSafeInteger(state.pid)||state.pid<=0||typeof state.host!=='string'||!Number.isFinite(Date.parse(state.lastAttemptAt))||!Number.isSafeInteger(state.failures)||state.failures<0||(state.lastSuccessAt&&!Number.isFinite(Date.parse(state.lastSuccessAt))))throw Error('Invalid backup state');
  return state;
}
export function policyStatus(root:string,policy=loadPolicy(),now=new Date()) {
  const catalog=readCatalog(root),state=readState(root),alerts:string[]=[],valid:Entry[]=[],invalid:string[]=[];
  for(const entry of catalog.entries)try{verifiedEntry(root,entry);valid.push(entry);}catch{invalid.push(entry.name);}
  valid.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const latest=valid[0],schedule=scheduleAt(policy,now),ageMinutes=latest?(now.getTime()-Date.parse(latest.createdAt))/60000:null;
  if(!latest)alerts.push('NO_VERIFIED_BACKUP');
  if(ageMinutes!==null&&ageMinutes<0)alerts.push('BACKUP_FROM_FUTURE');
  if(ageMinutes!==null&&ageMinutes>policy.rpoMinutes!)alerts.push('RPO_EXCEEDED');
  if(invalid.length)alerts.push('SNAPSHOT_INVALID');
  if(state?.status==='failed')alerts.push('LAST_RUN_FAILED');
  if(state?.status==='running') {
    let alive=state.host===hostname();try{if(alive)process.kill(state.pid,0);}catch(error:any){if(error.code==='ESRCH')alive=false;}
    if(!alive)alerts.push('INTERRUPTED_RUN');
    else if(now.getTime()-Date.parse(state.lastAttemptAt)>policy.maxDowntimeMinutes!*60000)alerts.push('RUN_BUDGET_EXCEEDED');
  }
  // Give the scheduled slot its five-minute execution window before flagging it as missed.
  if(!schedule.withinWindow&&(!state?.lastSuccessAt||Date.parse(state.lastSuccessAt)<Date.parse(schedule.latestWindowAt)))alerts.push('SCHEDULE_MISSED');
  return {policy,schedule,latestVerifiedAt:latest?.createdAt??null,ageMinutes,validSnapshots:valid.length,invalidSnapshots:invalid,state:state??null,alerts,healthy:alerts.length===0};
}
/** Explicit offline command. Does not stop/start services or send external notifications. */
export function runPolicyBackup(source:string,root:string,codeVersion:string,policy=loadPolicy()) {
  if(!existsSync(join(source,'project-station.sqlite')))throw Error('Database missing');
  const checked=guardedRoot(source,root);mkdirSync(checked.root,{recursive:true});const lock=dataLock(checked.root,'backup-policy');
  try {
    const {catalog}=openCatalog(source,checked.root),previous=readState(checked.root),start=Date.now();
    const backupBudgetMs=Math.floor(policy.maxDowntimeMinutes*60000*0.8); // Reserve 20% for the external stop/start/health adapter.
    const state:State={format:1,status:'running',pid:process.pid,host:hostname(),lastAttemptAt:new Date(start).toISOString(),lastSuccessAt:previous?.lastSuccessAt,lastSnapshot:previous?.lastSnapshot,backupBudgetMs,failures:previous?.failures??0};atomicJSON(join(checked.root,stateName),state);
    try {
      const name='snapshot-'+new Date(start).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')+'-'+randomUUID();
      const manifest=backupSnapshot(source,join(checked.root,name),codeVersion,policy,codeVersion,{deadlineMs:start+backupBudgetMs});
      const elapsedMs=Date.now()-start;
      if(elapsedMs>backupBudgetMs)throw Object.assign(Error('Backup budget exceeded'),{code:'BACKUP_BUDGET_EXCEEDED'});
      catalog.entries.push({name,createdAt:manifest.createdAt,manifestSha256:digest(readFileSync(join(checked.root,name,'manifest.json')))});atomicJSON(join(checked.root,catalogName),catalog);
      const result:State={...state,status:'ok',lastSuccessAt:new Date().toISOString(),lastSnapshot:name,elapsedMs,failures:0};atomicJSON(join(checked.root,stateName),result);
      return {snapshot:join(checked.root,name),manifest,state:result};
    }catch(error:any){atomicJSON(join(checked.root,stateName),{...state,status:'failed',failures:state.failures+1,lastErrorCode:/^[A-Z0-9_]{1,48}$/.test(error.code??'')?error.code:'BACKUP_FAILED',elapsedMs:Date.now()-start});throw error;}
  }finally{lock.release();}
}
/** Only catalogued, fully verified snapshots older than the policy window qualify. Unknown bytes stay untouched. */
export function retainBackups(source:string,root:string,policy=loadPolicy(),apply=false,now=new Date()) {
  const checked=guardedRoot(source,root),lock=dataLock(checked.root,'backup-retention');
  try {
    const catalog=readCatalog(checked.root);if(catalog.dataset!==checked.dataset)throw Error('Backup root belongs to another dataset');
    const valid:Entry[]=[],protectedSnapshots:string[]=[];
    for(const entry of catalog.entries)try{verifiedEntry(checked.root,entry);valid.push(entry);}catch{protectedSnapshots.push(entry.name);}
    valid.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    const newest=valid[0],fresh=newest&&Date.parse(newest.createdAt)<=now.getTime()&&now.getTime()-Date.parse(newest.createdAt)<=policy.rpoMinutes!*60000;
    const eligible=fresh?valid.filter(entry=>entry!==newest&&now.getTime()-Date.parse(entry.createdAt)>policy.retentionDays!*86400000):[];
    const removed:string[]=[];
    if(apply&&!fresh)throw Error('Retention requires a fresh verified recovery point');
    if(apply&&readState(checked.root)?.status!=='ok')throw Error('Resolve the unsuccessful backup run before retention');
    if(apply&&protectedSnapshots.length)throw Error('Invalid managed snapshots require investigation before retention');
    for(const entry of apply?eligible:[]) {
      // Repeat identity, complete inventory and real-path checks immediately before recursive removal.
      verifiedEntry(checked.root,entry);const target=realpathSync(join(checked.root,entry.name));
      if(dirname(target)!==realpathSync(checked.root))throw Error('Retention target escaped backup root');
      rmSync(target,{recursive:true});removed.push(entry.name);
      catalog.entries=catalog.entries.filter(value=>value.name!==entry.name);atomicJSON(join(checked.root,catalogName),catalog);
    }
    const known=new Set([catalogName,stateName,'.station-lock',...catalog.entries.map(entry=>entry.name)]);
    return {applied:apply,eligible:eligible.map(entry=>entry.name),removed,protectedSnapshots,unknown:readdirSync(checked.root).filter(name=>!known.has(name)),hasFreshRecoveryPoint:Boolean(fresh)};
  }finally{lock.release();}
}
