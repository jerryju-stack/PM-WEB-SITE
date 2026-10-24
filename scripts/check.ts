import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
function check(command:string,args:string[]) {
 const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
check(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'--noEmit']);
check(process.execPath,['--experimental-strip-types','--test',...readdirSync(resolve(root,'tests')).filter(name=>name.endsWith('.test.ts')).map(name=>'tests/'+name)]);
for(const args of [['diff','--check'],['diff','--cached','--check'],['show','--format=','--check','HEAD']])check('git',['-c','safe.directory='+root,...args]);
