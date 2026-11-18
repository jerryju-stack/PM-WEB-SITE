import {test} from 'node:test';
import assert from 'node:assert/strict';
import {migrations} from '../lib/migrations.ts';
import {eRecoveryDrill} from '../scripts/e-recovery-drill.ts';
test('E5 actual D9 code/data upgrades and whole restores preserve drafts/receipts/history/archived bytes; old sessions and leases cannot write',async()=>{
 const result=await eRecoveryDrill();
 assert.equal(result.historyAndDraftPreserved,true);assert.equal(result.importAndAdoptionReceiptsPreserved,true);assert.equal(result.archivedTaskAndAttachmentBytesPreserved,true);assert.equal(result.sessionsNotRestored,true);assert.equal(result.staleLeaseAndReceiptWritesRejected,true);assert.deepEqual(result.migrations,[8,...migrations.filter(m=>m.version>8).map(m=>m.version)]);
});
