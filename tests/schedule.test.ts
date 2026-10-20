import { test } from 'node:test';
import assert from 'node:assert/strict';
import { template, schedule, finish, workdays, nextWorkday } from '../lib/schedule.ts';
import type { Task } from '../lib/schedule.ts';
const task=(id:string,values:Partial<Task>={}):Task=>({id,projectId:'p',parentId:'p-stage-1',order:0,title:id,kind:'task',owner:'测试',start:'2026-10-23',end:null,duration:2,progress:0,status:'计划中',notes:'',predecessors:[],...values});
test('工作日计算跳过周末，里程碑保持零工期',()=>{
 assert.equal(finish('2026-10-23',2),'2026-10-26');assert.equal(nextWorkday('2026-10-24'),'2026-10-26');assert.equal(workdays('2026-10-23','2026-10-26'),2);
 const result=schedule([...template('p'),task('milestone',{kind:'milestone',duration:3})]);assert.equal(result.at(-1)!.duration,0);assert.equal(result.at(-1)!.end,'2026-10-23');
});
test('FS 依赖按工作日连锁顺延，阶段按叶子任务加权汇总',()=>{
 const result=schedule([...template('p'),task('a',{progress:100}),task('b',{predecessors:['a'],duration:3}),task('c',{parentId:'p-stage-2',predecessors:['b'],kind:'milestone'})]);
 assert.equal(result.find(t=>t.id==='b')!.start,'2026-10-27');assert.equal(result.find(t=>t.id==='b')!.end,'2026-10-29');assert.equal(result.find(t=>t.id==='c')!.start,'2026-10-30');assert.equal(result[0].progress,40);assert.equal(result[0].start,'2026-10-23');assert.equal(result[0].end,'2026-10-29');
});
test('拒绝循环、跨项目依赖、无效日期和超长工期',()=>{
 assert.throws(()=>schedule([...template('p'),task('a',{predecessors:['b']}),task('b',{predecessors:['a']})]),/循环/);
 assert.throws(()=>schedule([...template('p'),task('a',{parentId:'a'})]),/循环/);
 assert.throws(()=>schedule([...template('p'),task('a',{predecessors:['b']}),task('b',{projectId:'other',parentId:null})]),/不属于/);
 assert.throws(()=>schedule([...template('p'),task('a',{start:'2026-02-30'})]),/日期/);
 assert.throws(()=>schedule([...template('p'),task('a',{duration:3000})]),/工期/);
});
