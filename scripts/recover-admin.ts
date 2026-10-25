// Local filesystem operator recovery. There is deliberately no HTTP recovery route.
import { resolve,join } from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { dataLock } from '../lib/data-lock.ts';
import { openStore,passwordHash } from '../lib/database.ts';
import { migrations } from '../lib/migrations.ts';
import { audit } from '../lib/audit.ts';
const args=process.argv.slice(2),options=new Map<string,string>();
for(let i=0;i<args.length;i+=2)options.set(args[i],args[i+1]);
try {
  if(options.get('--offline-confirmed')!=='yes'||options.get('--no-admin-access')!=='yes')throw Error('Require stopped writers and explicit --no-admin-access yes');
  const source=options.get('--data'),login=options.get('--login'),password=process.env.RECOVERY_PASSWORD;
  if(!source||!login||!/^[a-zA-Z0-9_-]{3,32}$/.test(login)||!password||password.length<10||password.length>1024)throw Error('Require --data, valid --login and RECOVERY_PASSWORD (10–1024 characters)');
  const directory=resolve(source);if(!existsSync(join(directory,'project-station.sqlite')))throw Error('Recovery never initializes a data directory');
  const lock=dataLock(directory,'offline-admin-recovery');
  try {
    const check=new DatabaseSync(join(directory,'project-station.sqlite'),{readOnly:true});
    try{if(check.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v!==migrations.at(-1)!.version||check.prepare("SELECT value FROM meta WHERE key='initialized'").get()?.value!=='1')throw Error('Use matching initialized code/data before recovery');}finally{check.close();}
    const store=openStore(directory);
    try{store.transaction(()=>{
      const before=store.get('users',login),salt=randomBytes(16).toString('hex');
      if(before&&before.role!=='admin')throw Error('Choose an existing administrator or a new distinct recovery login');
      store.put('users',{...before,id:login,name:before?.name??'恢复管理员',role:'admin',status:'active',authEpoch:(before?.authEpoch??0)+1,salt,hash:passwordHash(password,salt)});
      const after=store.get('users',login);audit(store.db,{actorId:'system:offline-recovery',actorName:'本机受控恢复',requestId:'offline-'+Date.now()},'offline-recovery',after.uid,before,after);
    });console.log(JSON.stringify({ok:true,event:'offline-admin-recovery',restartAndLoginRequired:true}));}finally{store.db.close();}
  }finally{lock.release();}
}catch{console.error(JSON.stringify({ok:false,error:'离线恢复未完成；请检查参数、停写锁、配套迁移、账号类型及安全环境变量'}));process.exitCode=1;}
