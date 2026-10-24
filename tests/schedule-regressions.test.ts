import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, template } from '../lib/schedule.ts';
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
