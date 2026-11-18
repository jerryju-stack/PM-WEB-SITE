/** Fixture-only data/fault control for real browser acceptance; never import in server.ts. */
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,relative,basename,join} from 'node:path';
import {openStore} from '../lib/database.ts';
import {timingVersions} from '../lib/timing-versions.ts';
const metadata=JSON.parse(readFileSync('.deploy/e-a-browser.json','utf8')),directory=resolve(metadata.directory),within=relative(resolve(tmpdir()),directory);
if(within.startsWith('..')||!basename(directory).startsWith('station-e-a-browser-')||!/^http:\/\/127\.0\.0\.1:\d+$/.test(metadata.base))throw Error('Not an isolated browser fixture');
process.kill(metadata.pid,0);
const [action]=process.argv.slice(2),password='Isolated-EA-Browser-2026';
const login=await fetch(metadata.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'admin',password})});if(!login.ok)throw Error('Fixture admin login failed');const cookie=login.headers.get('set-cookie')!.split(';')[0];
const call=async(path:string,body:unknown,method='POST')=>{const r=await fetch(metadata.base+'/api/'+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error('Fixture action failed '+r.status);return result;};
if(action==='seed'){
 const store=openStore(directory);try{
  if(!store.get('users','e-editor')){const actor=store.get('users','admin');for(let i=0;i<28;i++)store.put('users',{id:'e-reader-'+String(i).padStart(2,'0'),name:'Synthetic reader '+i,role:'viewer',salt:actor.salt,hash:actor.hash});}
  for(let i=0;i<55;i++){const id=String(i).padStart(3,'0');if(!store.get('projects','e-card-'+id))store.put('projects',{id:'e-card-'+id,title:'Pagination project '+id,description:'Synthetic card',category:'E acceptance',owner:'Synthetic',progress:0,status:'计划中'});if(!store.get('articles','e-article-'+id))store.put('articles',{id:'e-article-'+id,title:'Pagination article '+id,description:'Synthetic summary '+id,content:'## Full body '+id+'\nBrowser acceptance body canary '+id,category:i%2?'A':'B',date:'2026-11-16'});}
  const actor=store.get('users','admin'),plans=timingVersions(store),context={actorId:actor.uid,actorUid:actor.uid,actorName:'Synthetic',requestId:'e-browser-seed'};
  for(let i=0;i<123;i++)plans.save('browser-30',{kind:'baseline',name:'E-page '+String(i).padStart(3,'0'),reason:'Browser pagination acceptance',revision:store.revision('browser-30'),projectVersion:store.get('projects','browser-30').version,requestKey:'e-browser-page-'+String(i).padStart(3,'0')},context);
 }finally{store.db.close();}
 let editor:any;try{editor=await call('users',{id:'e-editor',name:'Synthetic editor',role:'editor',password});}catch{const store=openStore(directory);editor={id:store.get('users','e-editor')?.uid};store.db.close();if(!editor.id)throw Error('Fixture editor unavailable');}
 await call('projects/browser-30/members',{userUid:editor.id,groupId:'editor'});
 writeFileSync(join(directory,'acceptance-control.json'),JSON.stringify({editorUid:editor.id}));console.log('Seeded 55 project/55 article cards, 123 history pages and synthetic accounts');
}else if(action==='revoke'||action==='grant'){
 const {editorUid}=JSON.parse(readFileSync(join(directory,'acceptance-control.json'),'utf8'));await call('projects/browser-30/members',{userUid:editorUid,...(action==='grant'?{groupId:'editor'}:{})},action==='grant'?'POST':'DELETE');console.log(action+' fixture editor');
}else throw Error('Use seed/revoke/grant; faults remain in e-a-control.ts');
