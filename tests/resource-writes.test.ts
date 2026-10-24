import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/database.ts';
import { template } from '../lib/schedule.ts';
import { resourceWriter } from '../lib/resources.ts';
const setup=()=>{process.env.ADMIN_PASSWORD='Isolated-Test-Only-2026';return openStore(mkdtempSync(join(tmpdir(),'station-write-test-')));};
for (const collection of ['projects','articles'] as const) test(collection+' updates and deletes require exact versions and never upsert',()=>{
 const store=setup();try{const writer=resourceWriter(store),body=collection==='projects'?{title:'original'}:{title:'original',content:'body'};
 const item=writer.create(collection,body,'tester');assert.equal(item.version,0);
 const updated=writer.update(collection,item.id,{...body,title:'A',version:0});assert.equal(updated.version,1);
 assert.throws(()=>writer.update(collection,item.id,{...body,description:'B',version:0}),{status:409});
 assert.equal(store.get(collection,item.id).title,'A');
 assert.throws(()=>writer.update(collection,item.id,{...body}),{status:409});
 assert.throws(()=>writer.remove(collection,item.id,{version:0,taskRevision:0}),{status:409});
 writer.remove(collection,item.id,{version:1,taskRevision:0});
 assert.throws(()=>writer.update(collection,item.id,{...body,version:1}),{status:404});
 assert.throws(()=>writer.remove(collection,item.id,{version:1,taskRevision:0}),{status:404});
 assert.equal(store.all(collection).length,0);
 }finally{store.db.close();}
});
test('metadata and task revisions are independent; project writes preserve derived values; delete checks both',()=>{
 const store=setup();try{const writer=resourceWriter(store),p=writer.create('projects',{title:'project'},'tester');
 const tasks=[...template(p.id),{...template(p.id)[0],id:'leaf',parentId:p.id+'-stage-1',kind:'task' as const,duration:1,progress:100}];
 store.saveTasks(p.id,tasks,0);
 const edited=writer.update('projects',p.id,{title:'renamed',version:0,progress:0,status:'计划中'});
 assert.equal(edited.progress,100);assert.equal(edited.status,'已完成');assert.equal(edited.taskRevision,1);assert.equal(edited.version,1);
 const latest=store.tasks(p.id);latest.find(t=>t.id==='leaf')!.progress=0;store.saveTasks(p.id,latest,1);
 assert.equal(store.get('projects',p.id).title,'renamed');assert.equal(store.get('projects',p.id).version,1);
 assert.throws(()=>writer.remove('projects',p.id,{version:1,taskRevision:1}),{status:409});
 writer.remove('projects',p.id,{version:1,taskRevision:2});
 }finally{store.db.close();}
});
test('long schedules persist repeatedly, survive metadata rename, reparent and delete; project and root progress agree',()=>{
 const store=setup();try{const writer=resourceWriter(store),p=writer.create('projects',{title:'long'},'tester');
 let tasks=store.tasks(p.id);for(const [id,start,progress] of [['early','2000-01-03',1],['late','2020-01-03',0]] as const)tasks.push({...template(p.id)[0],id,parentId:p.id+'-stage-1',kind:'task',duration:1,start,progress});
 store.saveTasks(p.id,tasks,0);store.saveTasks(p.id,store.tasks(p.id),1);writer.update('projects',p.id,{title:'renamed',version:0});
 tasks=store.tasks(p.id);tasks.find(t=>t.id==='late')!.parentId=p.id+'-stage-2';store.saveTasks(p.id,tasks,2);
 store.saveTasks(p.id,store.tasks(p.id).filter(t=>t.id!=='late'),3);assert.equal(store.get('projects',p.id).title,'renamed');
 assert.equal(store.get('projects',p.id).progress,store.tasks(p.id).find(t=>t.id===p.id+'-stage-1')!.progress);
 }finally{store.db.close();}
});
