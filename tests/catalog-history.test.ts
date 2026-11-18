import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../lib/database.ts';
import {timingVersions} from '../lib/timing-versions.ts';
import {timingDrafts} from '../lib/timing-drafts.ts';
import {planDigest} from '../lib/history-index.ts';
import {catalog} from '../lib/catalog.ts';
import {httpFixture} from './http-fixture.ts';

function fixture(){process.env.ADMIN_PASSWORD='Isolated-EC-Regression-2026';const directory=mkdtempSync(join(tmpdir(),'station-ec-test-')),store=openStore(directory),actor=store.get('users','admin'),context={actorId:actor.uid,actorUid:actor.uid,actorName:'Synthetic',requestId:'ec-test'};store.put('projects',{id:'p',title:'Synthetic',progress:0,status:'计划中'});return {store,directory,actor,context};}

test('E3 stable history pages include ties and archives, exclude deletions in SQL and never select snapshots',()=>{
 const {store,context}=fixture();try{
  const plans=timingVersions(store);
  for(let i=0;i<123;i++)plans.save('p',{kind:'version',name:'version '+i,reason:'synthetic',revision:0,projectVersion:0,requestKey:'request-number-'+String(i).padStart(4,'0')},context);
  const ids=plans.list('p').map(v=>v.id);plans.remove('p',ids[12],context);
  const statements:string[]=[];let queries=0;
  const traced={...store,db:{prepare(sql:string){queries++;statements.push(sql);return store.db.prepare(sql);}}};
  const service=timingVersions(traced as any),seen:string[]=[];let cursor:string|null=null;
  do{const page=service.page('p',{limit:17,cursor});seen.push(...page.versions.map(v=>v.id));cursor=page.nextCursor;}while(cursor);
  assert.equal(seen.length,122);assert.equal(new Set(seen).size,122);assert.deepEqual(seen,plans.list('p').map(v=>v.id));assert.equal(queries,8);
  assert.ok(statements.every(sql=>!sql.includes('snapshot')&&!sql.includes('v.*')));
  const page=plans.page('p',{limit:17});assert.throws(()=>plans.page('other',{cursor:page.nextCursor}),{status:400});assert.throws(()=>plans.page('p',{limit:101}),{status:400});
  plans.restore('p',ids[12],context);assert.equal(plans.list('p').length,123);
  const next=plans.save('p',{kind:'version',name:'after restore',reason:'synthetic',revision:0,projectVersion:0,requestKey:'after-restore-request'},context);assert.equal(next.version.sequence,124);
 }finally{store.db.close();}
});

test('E3 history digest is only a candidate index: metadata changes, hash collisions, deletion and missing legacy entries retain archive semantics',()=>{
 const {store,context}=fixture();try{
  const plans=timingVersions(store),version=plans.save('p',{kind:'baseline',name:'Baseline',reason:'fixture',revision:0,projectVersion:0,requestKey:'initial-baseline-request'},context).version;
  const current=plans.current('p');assert.equal(plans.hasEquivalent('p',current),true);
  const different={...current,project:{...current.project,title:'New metadata'}};
  assert.equal(plans.hasEquivalent('p',different),false);
  // Force a digest collision. The final compare must reject it.
  store.db.prepare('UPDATE timing_history_index SET digest=? WHERE id=?').run(planDigest(different),version.id);
  assert.equal(plans.hasEquivalent('p',different),false);
  store.db.prepare('DELETE FROM timing_history_index').run();assert.equal(plans.hasEquivalent('p',current),true);
  plans.remove('p',version.id,context);assert.equal(plans.hasEquivalent('p',current),false);plans.restore('p',version.id,context);assert.equal(plans.hasEquivalent('p',current),true);
  const drafts=timingDrafts(store),start=drafts.start('p',{},context),session={leaseToken:start.leaseToken,draftId:start.draft!.id,revision:0};
  drafts.save('p',[{id:'a',projectId:'p',parentId:null,order:0,title:'New task',kind:'task',owner:'PM',start:'2026-11-02',end:null,duration:1,progress:0,status:'计划中',notes:'',predecessors:[]}],session,context);
  drafts.adopt('p',{...session,revision:1},context);
  assert.equal(plans.list('p').filter(v=>v.kind==='previous').length,0,'equal baseline prevents duplicate previous archive');
 }finally{store.db.close();}
});

test('E3 card projections track every writer and keep body reads out of paginated catalog SQL',()=>{
 const {store,actor}=fixture();try{
  for(let i=0;i<150;i++)store.put('articles',{id:'a'+String(i).padStart(3,'0'),title:'ÉXAMPLE '+i,description:'Summary',category:'A',date:'2026-11-02',content:'private-body-canary'.repeat(1000)});
  const queries:string[]=[];let returnedBytes=0;
  const traced={...store,db:{prepare(sql:string){queries.push(sql);const s=store.db.prepare(sql);return {get:(...a:any[])=>s.get(...a),all:(...a:any[])=>{const rows=s.all(...a);returnedBytes+=Buffer.byteLength(JSON.stringify(rows));return rows;}};}}};
  const first=catalog(traced as any,actor,new URLSearchParams({limit:'7',q:'éxample'}));
  assert.equal(first.articles.length,7);assert.equal(first.stats.articles,150);assert.ok(first.articlesPage.nextCursor);assert.deepEqual(first.users,[]);
  assert.ok(!JSON.stringify(first).includes('private-body-canary'));assert.ok(returnedBytes<30000);
  assert.ok(!queries.some(q=>/SELECT\s+(?:\*|data)|r\.data/.test(q)));
  const next=catalog(store,actor,new URLSearchParams({limit:'7',q:'éxample',articlesCursor:first.articlesPage.nextCursor!}));assert.equal(next.articles[0].id,'a007');
  store.put('articles',{id:'a000',title:'Changed',content:'still private',category:'B'});assert.equal(JSON.parse(String(store.db.prepare('SELECT summary FROM articles_cards WHERE id=?').get('a000')!.summary)).title,'Changed');
  store.remove('articles','a000');assert.equal(store.db.prepare('SELECT id FROM articles_cards WHERE id=?').get('a000'),undefined);
  assert.equal(store.get('articles','a001').content.length,19000);
 }finally{store.db.close();}
});

test('E3 HTTP permission filtering happens before pagination and totals, and revocation applies on the next page',async()=>{
 const f=await httpFixture();try{
  const account=(await f.call('users',{id:'reader',name:'Reader',role:'viewer',password:'Isolated-EC-Reader-2026'},f.cookie)).data;
  const cookie=(await f.call('login',{id:'reader',password:'Isolated-EC-Reader-2026'})).cookie;
  const publicIds:string[]=[],privateIds:string[]=[];
  for(let i=0;i<9;i++){
   const p=(await f.call('projects',{title:'Card '+i},f.cookie)).data.id;
   await f.call(`projects/${p}/access`,{cards:i%2?'members':'public',lessons:'members'},f.cookie,'PATCH');
   (i%2?privateIds:publicIds).push(p);
   await f.call('articles',{title:'Private '+i,content:'private-content-canary',projectId:p},f.cookie);
  }
  await f.call(`projects/${privateIds[0]}/members`,{userUid:account.id,groupId:'viewer'},f.cookie);
  const seen:string[]=[];let cursor:string|null=null;
  do{const page=(await f.call('data?limit=2'+(cursor?'&projectsCursor='+encodeURIComponent(cursor):''),undefined,cookie)).data;assert.equal(page.stats.projects,6);assert.equal(page.stats.articles,1);assert.ok(!JSON.stringify(page).includes('private-content-canary'));seen.push(...page.projects.map((p:any)=>p.id));cursor=page.projectsPage.nextCursor;}while(cursor);
  assert.equal(new Set(seen).size,6);assert.equal(seen.length,6);
  const first=(await f.call('data?limit=1',undefined,cookie)).data;
  await f.call(`projects/${privateIds[0]}/members`,{userUid:account.id},f.cookie,'DELETE');
  const after=(await f.call('data?limit=1&projectsCursor='+encodeURIComponent(first.projectsPage.nextCursor),undefined,cookie)).data;assert.equal(after.stats.projects,5);assert.equal(after.stats.articles,0);assert.ok(!after.projects.some((p:any)=>privateIds.includes(p.id)));
  assert.equal((await f.call('articles/'+(await f.call('data',undefined,f.cookie)).data.articles[0].id,undefined,cookie)).status,404);
  const users=await f.call('users?limit=1',undefined,f.cookie);assert.equal(users.data.users.length,1);assert.ok(users.data.nextCursor);assert.ok(!JSON.stringify(users.data).includes('hash'));
  assert.equal((await f.call('users?limit=1',undefined,cookie)).status,403);
 }finally{await f.stop();}
});
