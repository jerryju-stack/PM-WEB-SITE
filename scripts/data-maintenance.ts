import { existsSync, readFileSync, mkdirSync, lstatSync, writeFileSync, renameSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { backupSnapshot, verifySnapshot, restoreSnapshot, pendingTargets } from '../lib/snapshots.ts';
import { openStore } from '../lib/database.ts';
import { dataLock, unlockDeadProcess } from '../lib/data-lock.ts';
import { attachmentService, reconcile } from '../lib/attachments.ts';
import { defaultPolicyPath } from '../lib/backup-policy.ts';
import { committedRuntimeVersion } from '../lib/runtime-version.ts';
import { migrations } from '../lib/migrations.ts';
const [command,...args]=process.argv.slice(2),options=new Map<string,string>();
for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw Error('Options require explicit values');options.set(args[i].slice(2),args[i+1]);}
const required=(key:string)=>{const value=options.get(key);if(!value)throw Error('Missing --'+key);return value;};
const directory=()=>resolve(required('data'));
const root=fileURLToPath(new URL('../',import.meta.url));
const started=performance.now();
async function main() {
  if(command==='unlock'){unlockDeadProcess(directory());return {unlocked:true};}
  if(command==='verify')return verifySnapshot(resolve(required('snapshot')));
  if(command==='restore')return restoreSnapshot(resolve(required('snapshot')),resolve(required('target')));
  if(required('offline-confirmed')!=='yes')throw Error('Stop all writers and supply --offline-confirmed yes');
  if(command==='backup') {
    // A reproducible backup must identify committed runtime code, not an unrecorded worktree.
    const gitArgs=['-c','safe.directory='+root];
    const code=committedRuntimeVersion();
    const pair=options.has('paired-code')?execFileSync('git',[...gitArgs,'rev-parse','--verify',required('paired-code')+'^{commit}'],{cwd:root,encoding:'utf8'}).trim():code;
    const check=new DatabaseSync(join(directory(),'project-station.sqlite'),{readOnly:true});
    try{if(check.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v===1&&!options.has('paired-code'))throw Error('A snapshot requires --paired-code pointing to the stopped A code revision');}finally{check.close();}
    const raw=JSON.parse(readFileSync(options.has('policy')?resolve(required('policy')):defaultPolicyPath,'utf8'));
    const policy={...pendingTargets};
    for(const key of Object.keys(pendingTargets) as (keyof typeof pendingTargets)[]){if(!(key in raw)||(raw[key]!==null&&(!Number.isSafeInteger(raw[key])||raw[key]<0)))throw Error('Invalid recovery policy');policy[key]=raw[key];}
    return backupSnapshot(directory(),resolve(required('target')),pair,policy,code);
  }
  const data=directory();if(!existsSync(join(data,'project-station.sqlite')))throw Error('Database missing; maintenance never initializes a directory');
  const lock=dataLock(data,command);
  try {
    const db=new DatabaseSync(join(data,'project-station.sqlite'),{readOnly:true});
    try {if(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v!==migrations.at(-1)!.version||!db.prepare("SELECT 1 FROM meta WHERE key='initialized'").get())throw Error('Use matching application migration before maintenance');}finally{db.close();}
    const store=openStore(data);
    try {
      if(command==='identity-report')return {
        unconfirmedAudit:store.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE actor_uid IS NULL AND actor_id NOT LIKE 'system:%'").get()!.n,
        unconfirmedUploads:store.db.prepare('SELECT id,uploaded_by,created_at FROM attachments WHERE uploaded_uid IS NULL').all(),
        unassignedProjects:store.db.prepare('SELECT p.id FROM projects p WHERE NOT EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id)').all(),
        invalidAccounts:store.all('users').filter(u=>!['admin','editor','viewer'].includes(u.role)||!['active','disabled'].includes(u.status)).map(u=>({uid:u.uid,loginName:u.id,role:u.role,status:u.status})),
        note:'历史登录名/姓名不是已确认身份关联；仅经独立证据核对后人工处理，不推定成员关系',
      };
      if(command==='reconcile')return reconcile(store);
      if(command==='retry'){const results=await attachmentService(store).retry();if(results.some(row=>!row.ok))process.exitCode=2;return {results,report:reconcile(store)};}
      if(command==='audit') {
        const id=required('resource-id'),resource=required('resource');
        if(!['projects','tasks','articles','attachments','accounts','password','groups','members','project-access','offline-recovery'].includes(resource))throw Error('Unknown audit resource');
        const limit=Number(options.get('limit')??100);if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('limit must be 1..1000');
        return store.db.prepare('SELECT * FROM audit_events WHERE resource=? AND resource_id=? ORDER BY sequence DESC LIMIT ?').all(resource,id,limit);
      }
      if(command==='quarantine') {
        const name=required('file');if(basename(name)!==name||name.includes('\\')||name==='.'||name==='..')throw Error('Invalid file name');
        if(!reconcile(store).orphan.includes(name))throw Error('Only offline confirmed orphan files can be quarantined');
        const source=join(data,'uploads',name),info=lstatSync(source);if(!info.isFile()||info.isSymbolicLink())throw Error('Only regular orphan files can be quarantined');
        const target=join(data,'quarantine','orphans',randomUUID());mkdirSync(target,{recursive:true});
        writeFileSync(join(target,'receipt.json'),JSON.stringify({originalName:name,at:new Date().toISOString(),action:'orphan-quarantine'}),{flag:'wx'});
        renameSync(source,join(target,'file'));return {quarantined:name,entry:target};
      }
      if(command==='export-quarantine') {
        const entry=required('entry');if(!/^(jobs\/[a-zA-Z0-9_-]{1,128}|orphans\/[a-f0-9-]{36})$/.test(entry))throw Error('Invalid quarantine entry');
        const source=join(data,'quarantine',entry),target=resolve(required('target'));
        // Export only to a new sibling/outside directory, never back into live uploads.
        const {relative}=await import('node:path');const rel=relative(resolve(data),target);if(!rel||(!rel.startsWith('..')&&!rel.includes(':')))throw Error('Export target must be outside DATA_DIR');
        if(existsSync(target))throw Error('Export target exists');mkdirSync(target);
        for(const name of readdirSync(source)){const path=join(source,name);const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe quarantine entry');copyFileSync(path,join(target,name));}
        return {exported:target};
      }
      throw Error('Commands: backup verify restore unlock reconcile retry audit identity-report quarantine export-quarantine');
    }finally{store.db.close();}
  }finally{lock.release();}
}
try { const result=await main();console.log(JSON.stringify({ok:!process.exitCode,elapsedMs:Math.round(performance.now()-started),result},null,2)); }
catch(error:any){console.error(JSON.stringify({ok:false,error:error.message,elapsedMs:Math.round(performance.now()-started)}));process.exitCode=1;}
