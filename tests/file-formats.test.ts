import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FilePool} from '../lib/file-pool.ts';
import {syntheticTasks} from '../scripts/e-a-fixtures.ts';
import {schedulePolicy} from '../lib/timing-versions.ts';
import {readProjectXml} from '../lib/timing-project.ts';
import type {FileTask} from '../lib/file-job-types.ts';

test('E2 actual workers preserve XML20/1000 round trip and reject XML1001, Excel101 and Excel depth4 without truncation',async()=>{
 const pool=new FilePool(),plan={format:1 as const,project:{id:'p',title:'Synthetic formats',taskRevision:1,version:0} as any,tasks:syntheticTasks(1000,'chain'),schedulePolicy};
 try{
  const output=await pool.run<Uint8Array>({kind:'export',format:'xml',plan,version:null}),parsed=readProjectXml(output.value);assert.equal(parsed.rows.length,1000);assert.deepEqual(parsed.issues,[]);
  const body={file:Buffer.from(output.value).toString('base64'),format:'xml' as const,draftId:'d',revision:1,leaseToken:'synthetic'};
  const preview=await pool.run<any>({kind:'preview',projectId:'p',body,before:plan});assert.equal(preview.value.tasks.length,1000);assert.deepEqual(preview.value.result.issues,[]);assert.equal(preview.value.result.previewId,null,'pure worker cannot create database previews');
  const exportJob=(format:'xml'|'xlsx',tasks:typeof plan.tasks):FileTask=>({kind:'export',format,plan:{...plan,tasks},version:null,...(format==='xlsx'?{signingKey:'SyntheticTestKey'}:{})});
  await assert.rejects(pool.run(exportJob('xml',syntheticTasks(1001,'fanout'))),{status:400});
  await assert.rejects(pool.run(exportJob('xlsx',syntheticTasks(101,'fanout').map(t=>({...t,parentId:null,predecessors:[]})))),{status:400});
  await assert.rejects(pool.run(exportJob('xlsx',syntheticTasks(100,'fanout'))),{status:400});
  assert.ok(pool.stats().peakWorkers<=2);
 }finally{await pool.close();}
});
