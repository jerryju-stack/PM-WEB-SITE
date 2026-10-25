import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
export type WriteContext = { actorId: string; actorName: string; requestId: string; actorUid?: string };
export const internalContext: WriteContext = { actorId: 'system:internal', actorName: '内部工具', requestId: 'internal' };
// Only domain fields enter history. Free-form long text is represented by digest/length.
export function auditValue(value: any) {
  if (!value) return null;
  const result: Record<string, unknown> = {};
  for (const key of ['id','uid','role','status','groupId','userUid','capabilities','cards','timing','lessons','projectId','parentId','task_id','title','name','owner','kind','order','start','end','duration','progress','predecessors','date','startDate','category','size','sha256']) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  for (const key of ['content','notes','description']) if (typeof value[key] === 'string') result[key] = { length: value[key].length, sha256: createHash('sha256').update(value[key]).digest('hex') };
  return result;
}
export function audit(db: DatabaseSync, context: WriteContext | undefined, resource: string, id: string, before: any, after: any, versions: unknown = {}) {
  const actor = context ?? internalContext;
  const columns=db.prepare('PRAGMA table_info(audit_events)').all();
  const stable=columns.some(row=>row.name==='actor_uid');
  db.prepare('INSERT INTO audit_events(actor_id,actor_name,request_id,operation,resource,resource_id,occurred_at,versions,changes'+(stable?',actor_uid':'')+') VALUES(?,?,?,?,?,?,?,?,?'+(stable?',?':'')+')')
    .run(actor.actorId,actor.actorName,actor.requestId,!before?'create':!after?'delete':'update',resource,id,new Date().toISOString(),JSON.stringify(versions),JSON.stringify({before:auditValue(before),after:auditValue(after)}),...(stable?[actor.actorUid??null]:[]));
}
