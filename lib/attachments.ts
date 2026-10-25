import { mkdir, open, rename, stat, lstat } from 'node:fs/promises';
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { Store } from './database.ts';
import { audit } from './audit.ts';
import type { WriteContext } from './audit.ts';
import { invalid } from './contracts.ts';
export const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function fileId(id:string) { if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('Unsafe attachment identifier');return id; }
export type FileBoundary=(point:string)=>Promise<void>;
const noBoundary:FileBoundary=async()=>{};
export function attachmentService(store:Store, boundary:FileBoundary=noBoundary) {
  const uploads=join(store.directory,'uploads');
  async function upload(taskId:string,name:string,chunks:AsyncIterable<Uint8Array>,context:WriteContext,authorize?:()=>WriteContext) {
    const id=randomBytes(16).toString('hex'), part=join(uploads,id+'.part'), final=join(uploads,id);
    store.db.prepare('INSERT INTO file_jobs(id,kind,created_at) VALUES(?,?,?)').run(id,'upload',new Date().toISOString());
    await boundary('upload-intent');
    let handle:Awaited<ReturnType<typeof open>>|undefined;
    try {
      await mkdir(uploads,{recursive:true});handle=await open(part,'wx');let size=0;const hash=createHash('sha256');
      for await(const chunk of chunks){size+=chunk.length;if(size>20*1024*1024)invalid('单个附件不能超过 20 MB',413);await handle.writeFile(chunk);hash.update(chunk);}
      if(!size)invalid('不能上传空文件');
      await handle.sync();await handle.close();handle=undefined;await boundary('upload-part');
      await rename(part,final);await boundary('upload-rename');const sha256=hash.digest('hex');
      store.transaction(()=>{
        // Synchronous final authorization shares the registration transaction. No await may
        // separate this check from attachment registration and its success audit.
        if(authorize)context=authorize();
        const task=store.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(taskId);if(!task)invalid('任务不存在',404);
        store.db.prepare('INSERT INTO attachments(id,task_id,name,size,uploaded_by,created_at,sha256) VALUES(?,?,?,?,?,?,?)').run(id,taskId,name,size,context.actorId,new Date().toISOString(),sha256);
        const project=store.get('projects',String(task!.project_id));
        audit(store.db,context,'attachments',id,null,{id,task_id:taskId,name,size,sha256},{projectId:project.id,projectVersion:project.version,taskRevision:project.taskRevision});
        store.db.prepare('DELETE FROM file_jobs WHERE id=?').run(id);
      });
      await boundary('upload-commit');return {id,name,size};
    } catch(error) {
      await handle?.close().catch(()=>{});
      // Intents survive process death; uncommitted bytes are quarantined, never silently discarded.
      await retry([id]);throw error;
    }
  }
  function remove(id:string,context:WriteContext) {
    store.transaction(()=>{
      const row=store.db.prepare('SELECT * FROM attachments WHERE id=?').get(id);if(!row)invalid('附件不存在',404);
      const task=store.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(row!.task_id);const project=store.get('projects',String(task!.project_id));
      store.db.prepare('DELETE FROM attachments WHERE id=?').run(id);
      audit(store.db,context,'attachments',id,row,null,{projectId:project.id,projectVersion:project.version,taskRevision:project.taskRevision});
    });
  }
  /** Only call for known completed requests, or under the exclusive offline/startup lock. */
  async function retry(ids?:string[]) {
    const jobs=store.db.prepare('SELECT * FROM file_jobs ORDER BY created_at').all() as {id:string;kind:string}[];
    const results: {id:string;ok:boolean;code?:string}[]=[];
    for(const job of jobs) {
      if(ids&&!ids.includes(job.id))continue;
      try {
        fileId(job.id);
        if(store.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(job.id))throw Object.assign(Error('Referenced file cannot be cleaned'),{code:'REFERENCED'});
        const quarantine=join(store.directory,'quarantine','jobs',job.id);await mkdir(quarantine,{recursive:true});
        // Deterministic destination makes replay safe even if killed between rename and job completion.
        const receipt=await open(join(quarantine,'receipt.json'),'a');try{await receipt.writeFile(JSON.stringify({id:job.id,kind:job.kind,at:new Date().toISOString()})+'\n');await receipt.sync();}finally{await receipt.close();}
        for(const suffix of ['.part','']) {
          const source=join(uploads,job.id+suffix),destination=join(quarantine,suffix?'partial':'file');
          try {
            const info=await lstat(source);if(!info.isFile()||info.isSymbolicLink())throw Object.assign(Error('Not a regular file'),{code:'UNSAFE_FILE'});
            try { await stat(destination);throw Object.assign(Error('Destination already exists'),{code:'QUARANTINE_EXISTS'}); } catch(error:any) {if(error.code!=='ENOENT')throw error;}
            await rename(source,destination);await boundary('cleanup-rename');
          } catch(error:any){if(error.code!=='ENOENT')throw error;}
        }
        store.db.prepare('DELETE FROM file_jobs WHERE id=?').run(job.id);results.push({id:job.id,ok:true});
      }catch(error:any){const code=/^[A-Z0-9_]{1,48}$/.test(error.code??'')?error.code:'FILE_ERROR';store.db.prepare('UPDATE file_jobs SET attempts=attempts+1,last_error=? WHERE id=?').run(code,job.id);results.push({id:job.id,ok:false,code});}
    }
    return results;
  }
  return {upload,remove,retry};
}
/** Offline report: never modifies files; a pending intent always outranks orphan classification. */
export function reconcile(store:Store) {
  const rows=store.db.prepare('SELECT * FROM attachments').all() as any[],jobs=store.db.prepare('SELECT * FROM file_jobs').all() as any[];
  const referenced=new Set(rows.map(row=>row.id)), pending=new Set(jobs.map(row=>row.id));
  const report:{normal:string[];legacy:string[];missing:string[];corrupt:string[];orphan:string[];pending:any[]}={normal:[],legacy:[],missing:[],corrupt:[],orphan:[],pending:jobs};
  for(const row of rows) {
    try { const path=join(store.directory,'uploads',fileId(row.id));const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()){report.corrupt.push(row.id);continue;}
      if(info.size!==row.size||(row.sha256&&digest(readFileSync(path))!==row.sha256))report.corrupt.push(row.id);
      else (row.sha256?report.normal:report.legacy).push(row.id);
    }catch(error:any){if(error.code==='ENOENT')report.missing.push(row.id);else throw error;}
  }
  try { for(const name of readdirSync(join(store.directory,'uploads'))) {const id=name.endsWith('.part')?name.slice(0,-5):name;if(!pending.has(id)&&(!referenced.has(name)||name.endsWith('.part')))report.orphan.push(name);} }catch(error:any){if(error.code!=='ENOENT')throw error;}
  return report;
}
