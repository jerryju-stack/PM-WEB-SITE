// Fault injection ONLY for the generated local E-A browser fixture.
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,relative,basename,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const metadata=JSON.parse(readFileSync('.deploy/e-a-browser.json','utf8'));
const directory=resolve(metadata.directory),within=relative(resolve(tmpdir()),directory);
if(within.startsWith('..')||!basename(directory).startsWith('station-e-a-browser-'))throw Error('Not an isolated E-A directory');
const [key,value]=process.argv.slice(2);
if(key==='expire'){
 const db=new DatabaseSync(join(directory,'project-station.sqlite'));db.prepare('UPDATE timing_edit_leases SET expires_at=0').run();db.close();
}else{
 const faults=key==='clear'?{}:JSON.parse(readFileSync(metadata.faultFile,'utf8'));
 if(key!=='clear'){if(!['tasks','read','heartbeat','adopt'].includes(key))throw Error('Unknown isolated fault');if(value==='off')delete faults[key];else faults[key]=/^\d+$/.test(value)?Number(value):value;}
 writeFileSync(metadata.faultFile,JSON.stringify(faults));console.log(faults);
}
