import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { httpFixture } from './http-fixture.ts';
const password='Isolated-C-Account-2026';
async function setup(){
  const f=await httpFixture();
  const users:Record<string,any>={};
  for(const [id,role,groupId] of [['manager','editor','manager'],['editor','editor','editor'],['engineer','editor','engineering'],['viewer','viewer','manager'],['outsider','editor','editor'],['other','editor','editor']]){
    const result=await f.call('users',{id,name:'同名显示',role,groupId,password},f.cookie);assert.equal(result.status,200);users[id]={...result.data,cookie:(await f.call('login',{id,password})).cookie};
  }
  const p=(await f.call('projects',{title:'private-one'},f.cookie)).data.id,q=(await f.call('projects',{title:'private-two'},f.cookie)).data.id;
  for(const project of [p,q])assert.equal((await f.call(`projects/${project}/access`,{cards:'members',timing:'members',lessons:'members'},f.cookie,'PATCH')).status,200);
  for(const key of ['manager','editor','engineer','viewer'])assert.equal((await f.call(`projects/${p}/members`,{userUid:users[key].id,groupId:key==='engineer'?'engineering':key==='viewer'?'manager':key},f.cookie)).status,200);
  await f.call(`projects/${q}/members`,{userUid:users.other.id,groupId:'editor'},f.cookie);
  return {...f,users,p,q};
}
test('two-project matrix, Engineering capabilities, aggregation and direct-ID bypasses are enforced on server',async()=>{
  const f=await setup(),db=new DatabaseSync(join(f.directory,'project-station.sqlite'));
  try{
    const task=(await f.call(`projects/${f.p}/tasks`,{revision:0,title:'matrix leaf'},f.cookie)).data.id;
    const taskQ=(await f.call(`projects/${f.q}/timing`,undefined,f.cookie)).data.tasks[0].id;
    for(const key of ['manager','editor','engineer','viewer']){
      assert.equal((await f.call(`projects/${f.p}/timing`,undefined,f.users[key].cookie)).status,200);
      assert.equal((await f.call(`projects/${f.q}/timing`,undefined,f.users[key].cookie)).status,404);
    }
    for(const cookie of ['',f.users.outsider.cookie,f.users.other.cookie]){
      assert.equal((await f.call(`projects/${f.p}/timing`,undefined,cookie)).status,cookie?404:401);
      const aggregate=(await f.call('data',undefined,cookie)).data;
      assert.ok(!aggregate.projects.some((p:any)=>p.id===f.p));assert.equal(aggregate.users.length,0);
      assert.equal((await f.call(`projects/${f.p}/members`,undefined,cookie)).status,cookie?403:401);
      assert.equal((await f.call('users',undefined,cookie)).status,cookie?403:401);
    }
    for(const key of ['viewer','engineer','outsider'])assert.equal((await f.call(`projects/${f.p}/tasks/${task}`,{revision:0,title:'forbidden',role:'admin',userUid:f.users.manager.id},f.users[key].cookie,'PATCH')).status,key==='outsider'?404:403);
    assert.equal((await f.call(`projects/${f.p}/tasks/${taskQ}`,{revision:0,title:'cross'},f.users.editor.cookie,'PATCH')).status,404);
    assert.equal((await f.call(`projects/${f.p}/tasks/${task}`,{revision:1,predecessors:[taskQ]},f.users.editor.cookie,'PATCH')).status,400);
    const upload=(path:string,cookie:string)=>fetch(f.base+'/api/'+path,{method:'POST',headers:{Cookie:cookie,'X-File-Name':'engineering.txt'},body:'Engineering bytes'});
    const uploaded=await upload(`projects/${f.p}/tasks/${task}/attachments`,f.users.engineer.cookie);assert.equal(uploaded.status,201);const file=(await uploaded.json()).id;
    assert.equal((await upload(`projects/${f.p}/tasks/${taskQ}/attachments`,f.users.engineer.cookie)).status,404);
    for(const cookie of ['',f.users.outsider.cookie,f.users.other.cookie])assert.equal((await fetch(f.base+'/api/attachments/'+file,{headers:{Cookie:cookie}})).status,cookie?404:401);
    assert.equal((await f.call('attachments/'+file,{projectId:f.q,role:'admin'},f.users.engineer.cookie,'DELETE')).status,403);
    assert.equal((await f.call('articles',{title:'project knowledge',content:'private canary',projectId:f.p},f.users.engineer.cookie)).status,200);
    const article=(await f.call('data',undefined,f.cookie)).data.articles[0];
    assert.equal((await f.call('articles/'+article.id,{version:0,content:'engineering update'},f.users.engineer.cookie,'PATCH')).status,200);
    assert.equal((await f.call('articles/'+article.id,{version:1},f.users.engineer.cookie,'DELETE')).status,403);
    assert.equal((await f.call('articles/'+article.id,{version:1,projectId:f.q,title:'move'},f.users.engineer.cookie,'PATCH')).status,400);
    assert.equal((await f.call('articles/'+article.id,undefined,f.users.other.cookie)).status,404);
    assert.ok(!(await f.call('data',undefined,f.users.outsider.cookie)).data.articles.some((a:any)=>a.id===article.id));
    assert.equal((await f.call('projects',{title:'manager-created'},f.users.manager.cookie)).status,200);
    assert.equal((await f.call('projects',{title:'forbidden'},f.users.editor.cookie)).status,403);
    assert.equal((await f.call('projects',{title:'viewer ceiling'},f.users.viewer.cookie)).status,403);
    const custom=(await f.call('groups',{name:'Only evidence',capabilities:['timingRead','attachmentUpload']},f.cookie)).data;
    assert.equal((await f.call(`projects/${f.p}/members`,{userUid:f.users.editor.id,groupId:custom.id},f.cookie)).status,200);
    assert.equal((await f.call(`projects/${f.p}/tasks/${task}`,{revision:0,title:'denied'},f.users.editor.cookie,'PATCH')).status,403);
    assert.equal(db.prepare('SELECT version FROM projects WHERE id=?').get(f.p)!.version,0);
    assert.equal(db.prepare('SELECT revision FROM projects WHERE id=?').get(f.p)!.revision,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attachments').get()!.n,1);
    assert.equal((db.prepare('SELECT uploaded_uid FROM attachments WHERE id=?').get(file)!).uploaded_uid,f.users.engineer.id);
    db.prepare('INSERT INTO permission_groups VALUES(?,?,?)').run('unknown-group','Fault injected unknown group','["unknown-capability"]');
    db.prepare('UPDATE project_members SET group_id=? WHERE project_id=? AND user_uid=?').run('unknown-group',f.p,f.users.viewer.id);
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,f.users.viewer.cookie)).status,404);
    db.prepare('UPDATE project_members SET group_id=? WHERE project_id=? AND user_uid=?').run('manager',f.p,f.users.viewer.id);db.prepare('DELETE FROM permission_groups WHERE id=?').run('unknown-group');
    assert.ok(!JSON.stringify(f.logs()).includes(password));
  }finally{db.close();await f.stop();}
});
test('confirmed default public cards/knowledge differ from authenticated Timing; admin succession and login rename revoke old sessions',async()=>{
  const f=await httpFixture();
  try{
    const project=(await f.call('projects',{title:'default-visible',content:'private project body'},f.cookie)).data.id;
    const user=(await f.call('users',{id:'reader',name:'reader',role:'viewer',password},f.cookie)).data;
    const reader=(await f.call('login',{id:'reader',password})).cookie;
    const article=(await f.call('articles',{title:'public knowledge',content:'public body'},f.cookie)).data.id;
    const anonymous=(await f.call('data')).data;
    assert.ok(anonymous.projects.some((p:any)=>p.id===project));assert.ok(!JSON.stringify(anonymous.projects).includes('private project body'));assert.ok(anonymous.articles.some((a:any)=>a.id===article));
    assert.equal((await f.call(`projects/${project}/timing`)).status,401);
    assert.equal((await f.call(`projects/${project}/timing`,undefined,reader)).status,200);
    assert.equal((await f.call(`projects/${project}/members`,undefined,reader)).status,403);
    const second=(await f.call('users',{id:'second-admin',name:'second',role:'admin',password},f.cookie)).data;
    const secondCookie=(await f.call('login',{id:'second-admin',password})).cookie;
    assert.equal((await f.call('users/'+user.id,{loginName:'renamed-reader'},secondCookie,'PATCH')).status,200);
    assert.equal((await f.call(`projects/${project}/timing`,undefined,reader)).status,401);
    const renamed=await f.call('login',{id:'renamed-reader',password});assert.equal(renamed.status,200);assert.equal(renamed.data.id,user.id);
    const admin=(await f.call('data',undefined,f.cookie)).data.user;
    assert.equal((await f.call('users/'+admin.id,{role:'viewer'},secondCookie,'PATCH')).status,200);
    assert.equal((await f.call(`projects/${project}/timing`,undefined,f.cookie)).status,401);
    assert.equal((await f.call('users/'+second.id,{status:'disabled'},secondCookie,'PATCH')).status,409);
  }finally{await f.stop();}
});
test('account rebuild/name changes do not inherit identity, permissions or sessions; password/admin recovery and last-admin guard',async()=>{
  const f=await setup(),db=new DatabaseSync(join(f.directory,'project-station.sqlite'));
  try{
    const before=f.users.editor,otherSession=(await f.call('login',{id:'editor',password})).cookie;
    assert.equal((await f.call('users/'+before.id,{name:'改名显示'},f.cookie,'PATCH')).data.id,before.id);
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,before.cookie)).status,200);
    assert.equal((await f.call('password',{current:'wrong',password:'New-Isolated-Password-2026'},before.cookie)).status,400);
    assert.equal((await f.call('password',{current:password,password:'New-Isolated-Password-2026'},before.cookie)).status,200);
    for(const cookie of [before.cookie,otherSession])assert.equal((await f.call(`projects/${f.p}/timing`,undefined,cookie)).status,401);
    let current=(await f.call('login',{id:'editor',password:'New-Isolated-Password-2026'})).cookie;
    assert.equal((await f.call('users/'+f.users.manager.id+'/password',{password},current)).status,403);
    assert.equal((await f.call('users/'+before.id+'/password',{password},f.cookie)).status,200);
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,current)).status,401);
    current=(await f.call('login',{id:'editor',password})).cookie;
    assert.equal((await f.call('users/'+before.id,{status:'disabled'},f.cookie,'PATCH')).status,200);
    assert.equal((await f.call('login',{id:'editor',password})).status,401);
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,current)).status,401);
    await f.call('users/'+before.id,{status:'active'},f.cookie,'PATCH');
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,current)).status,401);
    current=(await f.call('login',{id:'editor',password})).cookie;
    await f.call(`projects/${f.p}/members`,{userUid:before.id},f.cookie,'DELETE');
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,current)).status,404);
    await f.call(`projects/${f.p}/members`,{userUid:before.id,groupId:'viewer'},f.cookie);
    assert.equal((await f.call(`projects/${f.p}/tasks`,{revision:0,title:'not old editor'},current)).status,403);
    await f.call('users/'+before.id,{},f.cookie,'DELETE');
    const rebuilt=(await f.call('users',{id:'editor',name:'同名显示',role:'editor',password},f.cookie)).data;
    assert.notEqual(rebuilt.id,before.id);assert.equal(db.prepare('SELECT 1 FROM project_members WHERE user_uid=?').get(rebuilt.id),undefined);
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,current)).status,401);
    const fresh=(await f.call('login',{id:'editor',password})).cookie;assert.equal((await f.call(`projects/${f.p}/timing`,undefined,fresh)).status,404);
    assert.ok(db.prepare('SELECT retired_at FROM identities WHERE uid=?').get(before.id)!.retired_at);
    const admin=(await f.call('data',undefined,f.cookie)).data.user;
    for(const body of [{status:'disabled'},{role:'viewer'}])assert.equal((await f.call('users/'+admin.id,body,f.cookie,'PATCH')).status,409);
    assert.equal((await f.call('users/'+admin.id,{},f.cookie,'DELETE')).status,409);
    db.exec("UPDATE users SET data=json_set(data,'$.role','unknown') WHERE id='outsider'");
    assert.equal((await f.call('login',{id:'outsider',password})).status,401);
    assert.equal((await f.call(`projects/${f.p}/timing`,undefined,f.users.outsider.cookie)).status,401);
    const history=db.prepare("SELECT * FROM audit_events WHERE resource='password'").all();
    assert.equal(history.length,2);assert.ok(history.every(row=>row.actor_uid));
    for(const secret of [password,'New-Isolated-Password-2026','salt','hash','session='])assert.ok(!JSON.stringify(history).includes(secret));
  }finally{db.close();await f.stop();}
});
