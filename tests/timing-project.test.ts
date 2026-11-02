import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../lib/database.ts';
import { schedule } from '../lib/schedule.ts';
import type { Task } from '../lib/schedule.ts';
import { timingIO } from '../lib/timing-io.ts';
import { timingDrafts } from '../lib/timing-drafts.ts';
import { readProjectXml } from '../lib/timing-project.ts';

test('D9 Project XML round trip uses preview/confirm and rejects invalid input without partial writes',async()=>{
 process.env.ADMIN_PASSWORD='Isolated-D9-Test-2026';
 const store=openStore(mkdtempSync(join(tmpdir(),'station-d9-')));
 try{
  store.put('projects',{id:'p',title:'D9 测试项目',version:0,taskRevision:0});
  const leaf=(id:string,extra:Partial<Task>={}):Task=>({id,projectId:'p',parentId:'phase',order:0,title:id+' & <任务>',kind:'task',owner:'张工',start:'2026-11-02',end:null,duration:2,progress:25,status:'计划中',notes:'备注 & 数据',predecessors:[],...extra});
  const tasks=schedule([leaf('phase',{parentId:null,kind:'summary',title:'阶段'}),leaf('a'),leaf('b',{order:1,predecessors:['a']}),leaf('c',{order:2,kind:'milestone',predecessors:['b']}),leaf('empty',{parentId:null,order:1,kind:'summary',start:null,end:null})]);
  store.saveTasks('p',tasks);
  const actor=store.get('users','admin'),context={actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:randomUUID()},io=timingIO(store),drafts=timingDrafts(store);
  const lease=drafts.start('p',{},context),session=()=>({leaseToken:lease.leaseToken,draftId:drafts.state('p').draft!.id,revision:drafts.state('p').draft!.revision});
  const execution=store.tasks('p'),exported=await io.exportPlan('p','current','xml').buffer;
  assert.match(exported.toString(),/xmlns="http:\/\/schemas.microsoft.com\/project"/);
  const parsed=readProjectXml(exported);assert.deepEqual(parsed.issues,[]);assert.equal(parsed.rows[2].predecessors[0],'1.1');
  assert.equal(parsed.rows[1].title,tasks[1].title);
  const preview=(text:string)=>io.preview('p',{...session(),format:'xml',file:Buffer.from(text).toString('base64')},context);
  const good=preview(exported.toString());assert.deepEqual(good.issues,[]);assert.ok(good.previewId);assert.equal(good.comparison.summary.changed,0);assert.equal(good.matches[1].id,'a');
  io.confirm('p',{...session(),previewId:good.previewId},context);
  assert.deepEqual(drafts.view('p',session(),context).tasks,tasks);assert.deepEqual(store.tasks('p'),execution);
  store.put('projects',{id:'new',title:'新计划',version:0,taskRevision:0});
  const newLease=drafts.start('new',{},context),newSession={leaseToken:newLease.leaseToken,draftId:drafts.state('new').draft!.id,revision:drafts.state('new').draft!.revision};
  const imported=io.preview('new',{...newSession,format:'xml',mode:'new',file:exported.toString('base64')},context);
  assert.deepEqual(imported.issues,[]);assert.ok(imported.previewId);
  io.confirm('new',{...newSession,previewId:imported.previewId},context);
  const newTasks=drafts.view('new',{...newSession,revision:drafts.state('new').draft!.revision},context).tasks;
  assert.equal(newTasks.length,5);assert.equal(newTasks[2].predecessors[0],newTasks[1].id);assert.equal(newTasks[2].parentId,newTasks[0].id);assert.equal(newTasks[3].kind,'milestone');
  const before=JSON.stringify(drafts.view('p',session(),context)),count=()=>Number(store.db.prepare('SELECT count(*) AS n FROM timing_imports').get()!.n),n=count();
  for(const text of ['<Project/>','<Project>','<!DOCTYPE Project [<!ENTITY x "bad">]><Project/>'])assert.throws(()=>preview(text),/Project XML/);
  for(const text of [exported.toString().replace('<Type>1</Type><CrossProject>','<Type>3</Type><CrossProject>'),exported.toString().replace('<PredecessorUID>2</PredecessorUID>','<PredecessorUID>999</PredecessorUID>'),exported.toString().replace('<UID>3</UID>','<UID>2</UID>')]){
   const invalid=preview(text);assert.ok(invalid.issues.length);assert.equal(invalid.previewId,null);
  }
  assert.equal(count(),n);assert.equal(JSON.stringify(drafts.view('p',session(),context)),before);assert.deepEqual(store.tasks('p'),execution);
  const prefixed=exported.toString().replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s>])/g,'<$1m:$2').replace('xmlns=','xmlns:m=');
  assert.deepEqual(readProjectXml(Buffer.concat([Buffer.from([255,254]),Buffer.from(prefixed,'utf16le')])).issues,[]);
 }finally{store.db.close();}
});
