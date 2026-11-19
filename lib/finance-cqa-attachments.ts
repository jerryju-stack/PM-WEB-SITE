import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Store} from './database.ts';
import {fileId} from './attachments.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';

export const reviewedTemplateSha='15209409788e23a98f506d4997f3450f94da4d176fa14a16a8e281de3bd14591';
export const hasReviewedTemplate=(snapshot:FinanceSnapshot)=>snapshot.sources.some(row=>row.fingerprint===reviewedTemplateSha);

export function reviewedFinanceAttachment(store:Store,project:string,hashes:readonly string[],cached?:{path:string;modified:number;changed:number;sha:string}) {
  const attachments=store.db.prepare('SELECT a.id,a.size,a.sha256 FROM attachments a JOIN tasks t ON t.id=a.task_id '+
    'WHERE t.project_id=? AND t.archived=0 AND a.sha256 IN ('+hashes.map(()=>'?').join(',')+') ORDER BY a.size,a.id').all(project,...hashes);
  for(const item of attachments){
    const path=join(store.directory,'uploads',fileId(String(item.id)));
    const stat=lstatSync(path,{throwIfNoEntry:false});
    if(!stat?.isFile()||stat.size!==item.size||stat.size>20*1024*1024)continue;
    const identity={path,modified:stat.mtimeMs,changed:stat.ctimeMs,sha:String(item.sha256)};
    if(cached?.path===path&&cached.modified===stat.mtimeMs&&cached.changed===stat.ctimeMs&&cached.sha===identity.sha)return {...identity,bytes:null};
    let bytes:Buffer;
    try{bytes=readFileSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
    if(createHash('sha256').update(bytes).digest('hex')===item.sha256)return {...identity,bytes};
  }
  return null;
}
