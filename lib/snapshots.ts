import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, fileId } from './attachments.ts';
import { dataLock } from './data-lock.ts';
import { capabilities } from './policy.ts';
const dbName='project-station.sqlite';
const tables=['schema_migrations','meta','settings','users','projects','articles','tasks','dependencies','attachments','audit_events','file_jobs','identities','permission_groups','project_members','project_access','timing_versions','timing_imports'];
type Entry={path:string;size:number;sha256:string};
export type RecoveryTargets={rpoMinutes:number|null;rtoMinutes:number|null;maxDowntimeMinutes:number|null;retentionDays:number|null};
export type Manifest={format:1;createdAt:string;codeVersion:string;producerCodeVersion:string;targets:RecoveryTargets;database:ReturnType<typeof inspectData>;files:Entry[]};
export const pendingTargets:RecoveryTargets={rpoMinutes:null,rtoMinutes:null,maxDowntimeMinutes:null,retentionDays:null};
function walk(directory:string,prefix=''):Entry[] {
  const result:Entry[]=[];
  for(const name of readdirSync(directory).sort()) {
    const path=join(directory,name),key=prefix?prefix+'/'+name:name,info=lstatSync(path);
    if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw Error('Snapshot rejects non-regular entries');
    if(info.isDirectory())result.push(...walk(path,key));
    else result.push({path:key,size:info.size,sha256:digest(readFileSync(path))});
  }
  return result;
}
export function inspectData(directory:string) {
  const db=new DatabaseSync(join(directory,dbName),{readOnly:true});
  try {
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw Error('Database integrity check failed');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database foreign key check failed');
    if(db.prepare("SELECT value FROM meta WHERE key='initialized'").get()?.value!=='1'||!db.prepare("SELECT 1 FROM settings WHERE id='site'").get())throw Error('Missing initialized application state');
    const migrations=db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all().map(row=>({version:Number(row.version),name:String(row.name)}));
    const versions=JSON.stringify(migrations.map(row=>row.version));
    if(!['[1]','[1,2]','[1,2,3]','[1,2,3,4]','[1,2,3,4,5]','[1,2,3,4,5,6]'].includes(versions))throw Error('Unsupported snapshot migration version');
    const latest=migrations.at(-1)!.version;
    const usableAccount=db.prepare('SELECT id,data FROM users').all().some(row=>{
      const user=JSON.parse(String(row.data));
      const identityOK=latest<3||(user.status==='active'&&Number.isSafeInteger(user.authEpoch)&&db.prepare('SELECT 1 FROM identities WHERE uid=? AND login_name=? AND retired_at IS NULL').get(user.uid??'',String(row.id)));
      return identityOK&&user.id===row.id&&typeof user.salt==='string'&&user.salt.length>0&&typeof user.hash==='string'&&/^[a-f0-9]{128}$/i.test(user.hash)&&(latest>=3?user.role==='admin':['admin','editor','viewer'].includes(user.role));
    });
    if(!usableAccount)throw Error('No usable login account in snapshot');
    if(latest>=3)for(const row of db.prepare('SELECT id,data FROM users').all()){
      const user=JSON.parse(String(row.data));if(user.id!==row.id||typeof user.uid!=='string'||!Number.isSafeInteger(user.authEpoch)||user.authEpoch<0||!['active','disabled'].includes(user.status)||!db.prepare('SELECT 1 FROM identities WHERE uid=? AND login_name=? AND retired_at IS NULL').get(user.uid,String(row.id)))throw Error('Account identity mismatch');
    }
    if(latest>=3)for(const row of db.prepare('SELECT * FROM identities').all()){
      if(row.retired_at!==null){if(row.login_name!==null)throw Error('Retired identity has login');continue;}
      const account=db.prepare('SELECT data FROM users WHERE id=?').get(row.login_name??'');
      if(!account||JSON.parse(String(account.data)).uid!==row.uid)throw Error('Identity account mismatch');
    }
    if(latest>=3&&(db.prepare('SELECT 1 FROM audit_events WHERE actor_uid IS NOT NULL AND actor_id<>actor_uid').get()||db.prepare('SELECT 1 FROM attachments WHERE uploaded_uid IS NOT NULL AND uploaded_by<>uploaded_uid').get()))throw Error('Identity evidence mismatch');
    if(latest>=4){
      if(db.prepare('SELECT 1 FROM projects p LEFT JOIN project_access a ON p.id=a.project_id WHERE a.project_id IS NULL').get())throw Error('Missing project access policy');
      for(const row of db.prepare('SELECT capabilities FROM permission_groups').all()){const caps=JSON.parse(String(row.capabilities));if(!Array.isArray(caps)||!caps.every(cap=>capabilities.includes(cap)))throw Error('Invalid permission group');}
      if(db.prepare('SELECT 1 FROM project_members m JOIN identities i ON i.uid=m.user_uid WHERE i.retired_at IS NOT NULL OR i.login_name IS NULL').get())throw Error('Retired project identity');
    }
    const state:Record<string,{count:number;sha256:string}>={};
    for(const table of tables.filter(table=>!((latest<2&&['audit_events','file_jobs'].includes(table))||(latest<3&&table==='identities')||(latest<4&&['permission_groups','project_members','project_access'].includes(table))||(latest<5&&table==='timing_versions')||(latest<6&&table==='timing_imports')))) {
      const rows=db.prepare('SELECT * FROM '+table).all();state[table]={count:rows.length,sha256:digest(Buffer.from(rows.map(row=>JSON.stringify(row)).sort().join('\n')))};
    }
    for(const table of ['projects','articles'])for(const row of db.prepare('SELECT * FROM '+table).all() as any[]) {
      if(JSON.parse(row.data).id!==row.id||!Number.isSafeInteger(row.version)||row.version<0||(table==='projects'&&(!Number.isSafeInteger(row.revision)||row.revision<0)))throw Error('Resource identity/version mismatch');
    }
    for(const row of db.prepare('SELECT * FROM tasks').all() as any[]) {
      const value=JSON.parse(row.data);
      if(value.id!==row.id||value.projectId!==row.project_id||value.parentId!==row.parent_id)throw Error('Task relationship mismatch');
      if(row.parent_id&&db.prepare('SELECT project_id FROM tasks WHERE id=?').get(row.parent_id)?.project_id!==row.project_id)throw Error('Cross-project parent');
      if(db.prepare('SELECT 1 FROM dependencies d JOIN tasks t ON d.predecessor_id=t.id WHERE d.task_id=? AND t.project_id<>?').get(row.id,row.project_id))throw Error('Cross-project dependency');
      const predecessors=db.prepare('SELECT predecessor_id FROM dependencies WHERE task_id=?').all(row.id).map(row=>row.predecessor_id).sort();
      if(JSON.stringify(predecessors)!==JSON.stringify([...value.predecessors].sort()))throw Error('Dependency representation mismatch');
    }
    for(const row of db.prepare('SELECT * FROM attachments').all() as any[]) {
      const path=join(directory,'uploads',fileId(row.id)),info=lstatSync(path);
      if(!info.isFile()||info.isSymbolicLink()||info.size!==row.size||(row.sha256&&digest(readFileSync(path))!==row.sha256))throw Error('Attachment bytes mismatch');
    }
    return {migrations,tables:state};
  }finally{db.close();}
}
function newDestination(source:string,target:string) {
  const from=realpathSync(source),to=join(realpathSync(dirname(resolve(target))),basename(target));
  const rel=relative(from,to);
  if(!rel||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)))throw Error('Destination must be outside source');
  if(existsSync(to))throw Error('Destination already exists; overwrite is forbidden');
  return to;
}
/** Caller must supply the explicit stopped-writers acknowledgement and matching source revision. */
export function backupSnapshot(directory:string,target:string,codeVersion:string,targets:RecoveryTargets=pendingTargets,producerCodeVersion=codeVersion,limits:{deadlineMs?:number}={}) {
  if(!existsSync(join(directory,dbName)))throw Error('Database missing');
  const destination=newDestination(directory,target),lock=dataLock(directory,'backup');
  const stage=join(dirname(destination),'.incomplete-'+randomUUID());
  const snapshotAt=new Date().toISOString();
  const budget=()=>{if(limits.deadlineMs!==undefined&&Date.now()>=limits.deadlineMs)throw Object.assign(Error('Backup budget exceeded'),{code:'BACKUP_BUDGET_EXCEEDED'});};
  try {
    budget();
    mkdirSync(stage);mkdirSync(join(stage,'uploads'));mkdirSync(join(stage,'quarantine'));
    // Lock excludes the server for the entire DB/files operation, not just the SQL checkpoint.
    const db=new DatabaseSync(join(directory,dbName));
    try {const result=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as any;if(result.busy!==0)throw Error('WAL checkpoint busy');}finally{db.close();}
    copyFileSync(join(directory,dbName),join(stage,dbName));
    // Canonical standalone snapshot has no dependency on source WAL/SHM.
    const copied=new DatabaseSync(join(stage,dbName));try{copied.exec('PRAGMA journal_mode=DELETE');}finally{copied.close();}
    for(const folder of ['uploads','quarantine'])if(existsSync(join(directory,folder)))for(const entry of walk(join(directory,folder),folder)) {
      budget();
      const path=join(stage,entry.path);mkdirSync(dirname(path),{recursive:true});copyFileSync(join(directory,entry.path),path);
    }
    const manifest:Manifest={format:1,createdAt:snapshotAt,codeVersion,producerCodeVersion,targets,database:inspectData(stage),files:walk(stage)};
    const encoded=JSON.stringify(manifest,null,2)+'\n';writeFileSync(join(stage,'manifest.json'),encoded,{flag:'wx'});
    budget();renameSync(stage,destination);
    // A failed/killed operation before this final marker is never accepted by verify/restore.
    writeFileSync(join(destination,'COMPLETE'),digest(Buffer.from(encoded))+'\n',{flag:'wx'});
    return verifySnapshot(destination);
  }finally{lock.release();}
}
export function verifySnapshot(directory:string):Manifest {
  if(basename(resolve(directory)).startsWith('.incomplete-'))throw Error('Incomplete snapshot');
  const encoded=readFileSync(join(directory,'manifest.json')),marker=readFileSync(join(directory,'COMPLETE'),'utf8').trim();
  if(digest(encoded)!==marker)throw Error('Manifest checksum mismatch');
  const manifest=JSON.parse(encoded.toString()) as Manifest;
  if(manifest.format!==1||typeof manifest.codeVersion!=='string'||!Array.isArray(manifest.files)||!manifest.files.some(entry=>entry.path===dbName))throw Error('Unsupported snapshot manifest');
  const seen=new Set<string>();
  for(const entry of manifest.files) {
    if(typeof entry.path!=='string'||entry.path.includes('\\')||entry.path.startsWith('/')||entry.path.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':'))||seen.has(entry.path)||!([dbName].includes(entry.path)||entry.path.startsWith('uploads/')||entry.path.startsWith('quarantine/')))throw Error('Unsafe manifest path');
    seen.add(entry.path);
  }
  const actual=walk(directory).filter(entry=>!['manifest.json','COMPLETE'].includes(entry.path));
  if(JSON.stringify(actual)!==JSON.stringify([...manifest.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)))throw Error('Snapshot file inventory/checksum mismatch');
  if(JSON.stringify(inspectData(directory))!==JSON.stringify(manifest.database))throw Error('Snapshot database evidence mismatch');
  return manifest;
}
export function restoreSnapshot(snapshot:string,target:string) {
  const manifest=verifySnapshot(snapshot),destination=newDestination(snapshot,target);
  const stage=join(dirname(destination),'.restore-incomplete-'+randomUUID());mkdirSync(stage);mkdirSync(join(stage,'uploads'));mkdirSync(join(stage,'quarantine'));
  for(const entry of manifest.files){const path=join(stage,entry.path);mkdirSync(dirname(path),{recursive:true});copyFileSync(join(snapshot,entry.path),path);}
  if(JSON.stringify(inspectData(stage))!==JSON.stringify(manifest.database))throw Error('Restored database mismatch');
  for(const entry of manifest.files){const bytes=readFileSync(join(stage,entry.path));if(bytes.length!==entry.size||digest(bytes)!==entry.sha256)throw Error('Restored bytes mismatch');}
  writeFileSync(join(stage,'restore-receipt.json'),JSON.stringify({format:1,restoredAt:new Date().toISOString(),snapshotCreatedAt:manifest.createdAt,codeVersion:manifest.codeVersion,mode:'whole-snapshot'}));
  renameSync(stage,destination);return {directory:destination,codeVersion:manifest.codeVersion};
}
