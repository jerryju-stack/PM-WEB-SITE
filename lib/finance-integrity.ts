import type {DatabaseSync} from 'node:sqlite';
import {financeDigest,readFinanceSnapshot} from './finance.ts';

/** Read-only backup/restore verification. Never repairs evidence or changes historical rows. */
export function verifyFinanceEvidence(db:DatabaseSync) {
  for(const v of db.prepare('SELECT * FROM finance_versions').all()) {
    const current=readFinanceSnapshot(db,String(v.project_id),String(v.id));
    const changes=db.prepare('SELECT * FROM finance_changes WHERE project_id=? AND version_id=? ORDER BY rowid').all(v.project_id,v.id);
    if(!changes.length)throw Error('Finance version missing change evidence');
    let previous:any=null,revision:number|null=null;
    for(const c of changes) {
      const payload=JSON.parse(String(c.payload_json));
      if(c.after_sha256!==financeDigest(payload.after)||(payload.before?c.before_sha256!==financeDigest(payload.before):c.before_sha256!==null))throw Error('Finance change hash mismatch');
      if(c.revision_before!==revision||(!previous&&c.operation!=='create')||(previous&&financeDigest(payload.before.snapshot)!==financeDigest(previous.snapshot)))throw Error('Finance change history mismatch');
      previous=payload.after;revision=Number(c.revision_after);
    }
    if(revision!==v.revision||previous.status!==v.status||financeDigest(previous.snapshot)!==financeDigest(current))throw Error('Finance current snapshot mismatch');
  }
  if(db.prepare("SELECT 1 FROM finance_project_state s JOIN finance_versions v ON s.project_id=v.project_id AND s.approved_baseline_id=v.id WHERE v.status<>'frozen'").get())throw Error('Finance baseline is not frozen');
  for(const r of db.prepare('SELECT * FROM finance_receipts').all()) {
    const result=JSON.parse(String(r.result_json)),c=db.prepare('SELECT * FROM finance_changes WHERE id=? AND project_id=? AND actor_uid=?').get(result.changeSetId,r.project_id,r.actor_uid);
    if(!c||c.version_id!==result.id||c.after_sha256!==result.snapshotSha256||c.revision_after!==result.revision)throw Error('Finance receipt evidence mismatch');
  }
}
