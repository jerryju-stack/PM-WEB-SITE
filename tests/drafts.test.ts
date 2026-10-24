import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditDraft, ReadGuard } from '../src/drafts.ts';
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

test('late reads cannot replace a newer snapshot or review a different editor',async()=>{
 const reads=new ReadGuard();let snapshot={revision:1};
 let resolveOld!:(value:{revision:number})=>void;
 const old=new Promise<{revision:number}>(resolve=>resolveOld=resolve);
 const current=reads.begin();const pending=old.then(value=>{if(current())snapshot=value;});
 const newer=reads.begin();if(newer())snapshot={revision:3};
 resolveOld({revision:2});await pending;assert.equal(snapshot.revision,3);
 const first=new EditDraft({id:'A',notes:'mine'},1),second=new EditDraft({id:'B',notes:'other'},2);let editor=first;
 const sameEditor=reads.begin(()=>editor===first);editor=second;
 if(sameEditor())editor.review({id:'A',notes:'remote'},4);
 assert.equal(second.latest,undefined);assert.equal(second.version,2);assert.equal(second.value.notes,'other');
});
test('starting a write or unmounting invalidates pending reads without erasing drafts',()=>{
 const reads=new ReadGuard(),draft=new EditDraft({notes:'saved'},0);draft.set({notes:'unsaved'});
 const beforeWrite=reads.begin();reads.invalidate();assert.equal(beforeWrite(),false);
 let mounted=true;const beforeUnmount=reads.begin(()=>mounted);mounted=false;assert.equal(beforeUnmount(),false);
 assert.equal(draft.dirty,true);assert.equal(draft.value.notes,'unsaved');
});
