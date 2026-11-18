import {openStore} from '../lib/database.ts';
import {template} from '../lib/schedule.ts';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {dataLock} from '../lib/data-lock.ts';

// All fixtures stay in the repository's ignored data directory.
const directory=resolve('data/finance-prototype-p03');
process.env.ADMIN_PASSWORD=randomBytes(24).toString('hex');
const fixtureLock=dataLock(directory,'finance-prototype-fixture');
const store=openStore(directory);
try {
  for(const [id,title] of [['p03-assembly','Sample Assembly Program'],['p03-platform','Sample Platform Program']]) {
    if(store.get('projects',id)) continue;
    store.put('projects',{id,title,category:'P03 sample',description:'Fictional project for the integrated finance navigation review.',
      owner:'Sample PM',startDate:'2026-10-01',date:'2027-12-31',status:'进行中',progress:35});
    store.saveTasks(id,template(id));
  }
} finally {
  store.db.close();
  fixtureLock.release();
}
process.env.DATA_DIR=directory;
process.env.FINANCE_PROTOTYPE='1';
process.env.PORT=process.env.PORT||'18743';
await import('../server.ts');
