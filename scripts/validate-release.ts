// Offline migration acceptance for an explicitly copied/stopped data directory.
// Prints counts only; never prints account credentials or project contents.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { openStore } from '../lib/database.ts';
import { inspectData } from '../lib/snapshots.ts';
import { dataLock } from '../lib/data-lock.ts';

const [sourceArg,targetArg]=process.argv.slice(2);
if(!sourceArg||!targetArg)throw Error('Usage: validate-release.ts <stopped-source> <offline-copy>');
const source=resolve(sourceArg),target=resolve(targetArg);
assert.notEqual(source,target,'Migration acceptance requires a separate copy');
const before=new DatabaseSync(join(source,'project-station.sqlite'),{readOnly:true});
const lock=dataLock(target,'release-validation');
try {
  const store=openStore(target);
  try {
    const counts:Record<string,number>={};
    for(const table of ['meta','settings','users','projects','articles','tasks','dependencies','attachments']) {
      const columns=before.prepare('PRAGMA table_info('+table+')').all().map(row=>String(row.name));
      const oldRows=before.prepare('SELECT '+columns.join(',')+' FROM '+table+' ORDER BY rowid').all();
      const newRows=store.db.prepare('SELECT '+columns.join(',')+' FROM '+table+' ORDER BY rowid').all();
      assert.equal(newRows.length,oldRows.length,table+' count changed');
      for(let i=0;i<oldRows.length;i++)for(const key of columns) {
        if(table==='users'&&key==='data') {
          const oldUser=JSON.parse(String(oldRows[i].data)),newUser=JSON.parse(String(newRows[i].data));
          for(const field of Object.keys(oldUser))assert.deepEqual(newUser[field],oldUser[field],'Existing account field changed: '+field);
        } else assert.deepEqual(newRows[i][key],oldRows[i][key],table+' field changed: '+key);
      }
      counts[table]=oldRows.length;
    }
    const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
    for(const row of before.prepare('SELECT id FROM attachments').all()) {
      const id=String(row.id);assert.match(id,/^[a-f0-9]{32}$/);
      assert.equal(digest(join(source,'uploads',id)),digest(join(target,'uploads',id)),'Attachment changed');
    }
    console.log(JSON.stringify({ok:true,counts,migrations:inspectData(target).migrations,credentialsPreserved:true,attachmentsPreserved:true}));
  } finally {store.db.close();}
} finally {before.close();lock.release();}
