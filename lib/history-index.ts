import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {PlanSnapshot} from './timing-versions.ts';
// Only fields compared by comparePlans; array order is irrelevant except dependency multiplicity.
// A digest narrows candidates, and never substitutes for the final semantic comparison.
export function planDigest(plan:PlanSnapshot){
 const project=['title','description','owner','category','startDate','date','status','progress','content'].map(k=>(plan.project as any)[k]);
 const tasks=[...plan.tasks].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>[t.id,t.title,t.start,t.end,t.duration,t.owner,t.kind,t.progress,t.status,t.notes,t.parentId,t.order,[...t.predecessors].sort()]);
 return createHash('sha256').update(JSON.stringify({project,tasks})).digest('hex');
}
export function recordHistory(db:DatabaseSync,source:'version'|'archive',id:string,projectId:string,plan:PlanSnapshot){
 db.prepare('INSERT OR IGNORE INTO timing_history_index(source,id,project_id,digest) VALUES(?,?,?,?)').run(source,id,projectId,planDigest(plan));
}
export function indexMissingHistory(db:DatabaseSync,projectId?:string){
 for(const [table,source] of [['timing_versions','version'],['timing_archives','archive']] as const){
  const rows=db.prepare(`SELECT v.id,v.project_id,v.snapshot FROM ${table} v WHERE NOT EXISTS(SELECT 1 FROM timing_history_index h WHERE h.source=? AND h.id=v.id)${projectId?' AND v.project_id=?':''}`);
  for(const row of rows.iterate(...(projectId?[source,projectId]:[source])))recordHistory(db,source,String(row.id),String(row.project_id),JSON.parse(String(row.snapshot)));
 }
}
