import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditDraft } from '../src/drafts.ts';
test('reload/conflict review preserves draft and does not silently advance expected version',()=>{
 const draft=new EditDraft({title:'old',notes:'old'},2);draft.set({...draft.value,notes:'mine'});draft.fail('conflict');
 draft.review({title:'theirs',notes:'old'},3);
 assert.equal(draft.version,2);assert.equal(draft.value.notes,'mine');assert.equal(draft.dirty,true);
 draft.useReviewedVersion();assert.equal(draft.version,3);assert.equal(draft.value.notes,'mine');assert.equal(draft.dirty,true);
 draft.review({title:'changed again',notes:'new'},4);assert.equal(draft.version,3);
});
test('draft values and latest data are detached from mutable server snapshots',()=>{
 const source={notes:'before',ids:['a']};const draft=new EditDraft(source,0);source.ids.push('b');assert.deepEqual(draft.value.ids,['a']);
 draft.set({...draft.value,notes:'after'});const latest={notes:'remote',ids:['x']};draft.review(latest,1);latest.ids.push('y');assert.deepEqual(draft.latest!.value.ids,['x']);
 draft.set({notes:'before',ids:['a']});assert.equal(draft.dirty,false);
});
