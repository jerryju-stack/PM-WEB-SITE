import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/database.ts';
import { template } from '../lib/schedule.ts';
import type { Task } from '../lib/schedule.ts';
test('保存失败事务回滚，删除最后一个任务清空汇总，保留空模板',()=>{
 const directory=mkdtempSync(join(tmpdir(),'station-db-test-'));
 process.env.ADMIN_PASSWORD='Isolated-Database-Test-2026';
 const store=openStore(directory);
 try {
  store.put('projects',{id:'p',title:'测试',progress:0,status:'计划中'});
  store.saveTasks('p',template('p'));
  const leaf:Task={...template('p')[0],id:'leaf',parentId:'p-stage-1',kind:'task',title:'完成任务',start:'2026-10-20',duration:2,progress:100};
  store.saveTasks('p',[...template('p'),leaf]);assert.equal(store.get('projects','p').progress,100);
  const revision=store.revision('p');
  assert.throws(()=>store.saveTasks('p',[...template('p'),{...leaf,predecessors:['leaf']}],revision),/循环/);
  assert.equal(store.revision('p'),revision);assert.equal(store.tasks('p').find(t=>t.id==='leaf')!.progress,100);
  store.saveTasks('p',template('p'),revision);assert.equal(store.get('projects','p').progress,0);assert.equal(store.tasks('p').length,8);
 } finally {store.db.close();}
});
