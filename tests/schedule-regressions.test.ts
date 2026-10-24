import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, template, previewTaskEdit, projectProgress } from '../lib/schedule.ts';
import type { Task } from '../lib/schedule.ts';
const leaf=(id:string,values:Partial<Task>={}):Task=>({...template('p')[0],id,parentId:'p-stage-1',kind:'task',title:id,start:null,end:null,duration:1,progress:0,...values});
test('long derived summary duration is recalculated on every save',()=>{
 const first=schedule([...template('p'),leaf('early',{start:'2000-01-03'}),leaf('late',{start:'2020-01-03'})]);
 assert.ok(first[0].duration>2600);
 assert.deepEqual(schedule(first),first);
 assert.throws(()=>schedule([...template('p'),leaf('too-long',{duration:2601})]),/工期/);
 const stale=structuredClone(first);stale[0].start='invalid';stale[0].duration=99999;
 assert.deepEqual(schedule(stale),first);
});
test('nested progress uses unrounded leaf totals, independent of grouping',()=>{
 const group=leaf('group',{kind:'summary',duration:0});
 const nested=schedule([...template('p'),group,leaf('a',{parentId:'group',progress:1}),leaf('b',{parentId:'group'}),leaf('c')]);
 const flat=schedule([...template('p'),leaf('a',{progress:1}),leaf('b'),leaf('c')]);
 assert.equal(nested[0].progress,0);assert.equal(nested[0].progress,flat[0].progress);
 assert.equal(nested.find(t=>t.id==='group')!.progress,1);
});
test('empty stages have zero weight; undated leaves and milestones keep their existing weights',()=>{
 const result=schedule([...template('p'),leaf('a',{duration:3,progress:100}),leaf('m',{kind:'milestone',duration:0}),leaf('b',{duration:1})]);
 assert.equal(result[0].progress,60);assert.equal(result[1].progress,0);
 assert.equal(result.find(t=>t.id==='a')!.start,null);
});

test('date boundaries, leap days and forward-only dependencies retain their semantics',()=>{
 assert.equal(schedule([...template('p'),leaf('last',{start:'2100-12-31'})]).at(-1)!.end,'2100-12-31');
 assert.throws(()=>schedule([...template('p'),leaf('last',{start:'2100-12-31',duration:2})]),/日期/);
 const tasks=schedule([...template('p'),leaf('leap',{start:'2024-02-29'}),leaf('weekend',{kind:'milestone',start:'2026-10-24',duration:0}),leaf('later',{start:'2026-12-01',predecessors:['leap']})]);
 assert.equal(tasks.find(t=>t.id==='weekend')!.start,'2026-10-26');assert.equal(tasks.find(t=>t.id==='later')!.start,'2026-12-01');
});

test('failed inline move preserves duration in the recoverable draft and end edits retain computed duration',()=>{
 const original=leaf('a',{start:'2026-10-23',end:'2026-10-26',duration:2});
 const moved=previewTaskEdit(original,{start:'2026-10-26'});assert.equal(moved.duration,2);assert.equal(moved.end,'2026-10-27');
 const resized=previewTaskEdit(original,{end:'2026-10-27'});assert.equal(resized.duration,3);assert.equal(resized.end,'2026-10-27');
 const saved=schedule([...template('p'),moved]).at(-1)!;assert.equal(saved.duration,2);assert.equal(saved.end,'2026-10-27');
});

test('fractional progress rounds consistently regardless of grouping or leaf order',()=>{
 const values=[0.2,0.6,0.7];
 for(const order of [[0,1,2],[2,0,1],[1,2,0]]){
  const tasks=schedule([...template('p'),{...template('p')[0],id:'group',parentId:'p-stage-1'},...order.map((index,i)=>leaf('f'+index,{progress:values[index],parentId:i?'group':'p-stage-1'}))]);
  assert.equal(tasks[0].progress,1);assert.equal(projectProgress(tasks),1);
 }
});
