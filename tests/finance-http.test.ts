import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpFixture} from './http-fixture.ts';
import {sampleFinance} from './fixtures/finance-p04.ts';
import {openStore} from '../lib/database.ts';
import {accountService} from '../lib/accounts.ts';
import {policy} from '../lib/policy.ts';
import {request as httpRequest} from 'node:http';

const command=(requestKey:string,snapshot=sampleFinance(),revision?:number)=>({requestKey,reason:'Synthetic HTTP P04',snapshot,...(revision===undefined?{}:{revision})});
test('P04 HTTP authorizes reads, candidate previews and writes; public cards omit money; concurrent revisions and receipt replay are atomic',async()=>{
  const f=await httpFixture();
  try {
    const p=(await f.call('projects',{title:'Synthetic P04 project'},f.cookie)).data.id;
    const other=(await f.call('projects',{title:'Synthetic other project'},f.cookie)).data.id;
    const base='projects/'+p+'/finance',store=openStore(f.directory);
    let uid='';
    try {
      const actor=store.get('users','admin'),context={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'http-setup'};
      for(const [id,role,group] of [['viewerfinance','viewer','finance-controller'],['entryfinance','editor','finance-operations']]) {
        const user=accountService(store).create(actor,{id,role,password:'Synthetic-P04-Http-2026'},context)!;
        policy(store).setMember(actor,p,user.id,group,context);if(id==='entryfinance')uid=user.id;
      }
    }finally{store.db.close();}
    const viewer=(await f.call('login',{id:'viewerfinance',password:'Synthetic-P04-Http-2026'})).cookie;
    const entry=(await f.call('login',{id:'entryfinance',password:'Synthetic-P04-Http-2026'})).cookie;
    assert.equal((await f.call(base)).status,401);
    assert.equal((await f.call('finance/projects')).status,401);
    assert.equal((await f.call(base,undefined,f.cookie)).data.state,'empty');
    const created=await f.call(base+'/versions',command('create'),f.cookie);
    assert.equal(created.status,201);const id=created.data.id,version=base+'/versions/'+id;
    assert.equal((await f.call(version)).status,401);
    assert.equal((await f.call(version+'/preview',command('anonymous-preview',sampleFinance(),0))).status,401);
    assert.equal((await f.call(version,command('anonymous-write',sampleFinance(),0),'','PUT')).status,401);
    assert.equal((await f.call(version,undefined,viewer)).status,200);
    assert.equal((await f.call(version+'/changes',undefined,viewer)).status,200);
    assert.equal((await f.call(version,command('viewer-write',sampleFinance(),0),viewer,'PUT')).status,403);
    const candidate=sampleFinance();candidate.inputs[0].value.coefficient='36';
    assert.equal((await f.call(version+'/preview',command('viewer-preview',candidate,0),viewer)).status,403);
    assert.equal((await f.call(version+'/preview',command('entry-preview',candidate,0),entry)).data.persisted,false);
    const foreign='projects/'+other+'/finance/versions/'+id;
    for(const [path,body,method] of [[foreign,undefined,'GET'],[foreign+'/changes',undefined,'GET'],[foreign+'/preview',command('cross-preview',candidate,0),'POST'],[foreign,command('cross-save',candidate,0),'PUT']] as const)
      assert.equal((await f.call(path,body,entry,method)).status,404);
    const [a,b]=await Promise.all([
      f.call(version,command('parallel-a',candidate,0),entry,'PUT'),
      f.call(version,command('parallel-b',candidate,0),entry,'PUT')
    ]);
    assert.deepEqual([a.status,b.status].sort(),[200,409]);
    const winner=a.status===200?'parallel-a':'parallel-b',saved=a.status===200?a.data:b.data;
    assert.deepEqual((await f.call(version,command(winner,candidate,0),entry,'PUT')).data,saved);
    assert.equal((await f.call(version,command(winner,sampleFinance(),0),entry,'PUT')).status,409);
    assert.equal((await f.call(version+'/freeze',{requestKey:'forbidden-freeze',reason:'test',revision:1,stateRevision:0},entry)).status,403);
    const freeze=await f.call(version+'/freeze',{requestKey:'freeze',reason:'Approve synthetic',revision:1,stateRevision:0},f.cookie);
    assert.equal(freeze.status,200);assert.equal(freeze.data.status,'frozen');
    const publicData=await f.call('data'),memberData=await f.call('data',undefined,entry);
    assert.equal(publicData.status,200);assert.equal(memberData.status,200);
    for(const data of [publicData.data,memberData.data]) {
      const json=JSON.stringify(data);
      for(const field of ['coefficient','finance_versions','snapshotSha256','approvedBaselineId','budget-1','synthetic-ame','currencyScale','100000','40000'])assert.ok(!json.includes(field),'public card contains '+field);
    }
    const listed=await f.call('finance/projects',undefined,entry);
    assert.deepEqual(listed.data.projects.map((r:any)=>r.id),[p]);
    // Current membership is checked even when the request key has a successful committed receipt.
    const revoke=await f.call('projects/'+p+'/members',{userUid:uid},f.cookie,'DELETE');assert.equal(revoke.status,200);
    assert.equal((await f.call(version,command(winner,candidate,0),entry,'PUT')).status,404);
    assert.equal((await f.call(version+'/preview',command('revoked-preview',candidate,2),entry)).status,404);
    assert.equal((await f.call(version,undefined,entry)).status,404);
  }finally{await f.stop();}
});
test('P04 HTTP rechecks authority after a slow financial request body finishes',async()=>{
  const f=await httpFixture();try {
    const p=(await f.call('projects',{title:'Synthetic P04 in-flight'},f.cookie)).data.id;
    const store=openStore(f.directory);let uid='';
    try {
      const actor=store.get('users','admin'),c={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'setup'};
      const u=accountService(store).create(actor,{id:'slowentry',role:'editor',password:'Synthetic-Slow-P04-2026'},c)!;uid=u.id;
      policy(store).setMember(actor,p,uid,'finance-operations',c);
    }finally{store.db.close();}
    const entry=(await f.call('login',{id:'slowentry',password:'Synthetic-Slow-P04-2026'})).cookie;
    const path='projects/'+p+'/finance/versions',r=await f.call(path,command('create'),f.cookie);
    const candidate=sampleFinance();candidate.inputs[0].value.coefficient='36';
    const body=JSON.stringify(command('inflight',candidate,0));
    let request:any;
    const pending=new Promise<number>((resolve,reject)=>{
      request=httpRequest(f.base+'/api/'+path+'/'+r.data.id,{method:'PUT',headers:{Cookie:entry,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{
        response.resume();response.once('end',()=>resolve(response.statusCode!));
      });request.on('error',reject);request.flushHeaders();request.write(body.slice(0,30));
    });
    // A sequential admin write commits before the remaining body bytes are sent.
    assert.equal((await f.call('projects/'+p+'/members',{userUid:uid},f.cookie,'DELETE')).status,200);
    request.end(body.slice(30));assert.equal(await pending,404);
    assert.equal((await f.call(path+'/'+r.data.id,undefined,f.cookie)).data.revision,0);
    assert.equal((await f.call(path+'/'+r.data.id+'/changes',undefined,f.cookie)).data.changes.length,1);
  }finally{await f.stop();}
});
