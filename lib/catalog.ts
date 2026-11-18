import type {Store} from './database.ts';
import {capabilities,policy} from './policy.ts';
import {safeAccount} from './accounts.ts';
import {decodeCursor,encodeCursor,pageSize} from './pagination.ts';

/** All reads are synchronous under one live request identity. Body tables are joined for small scalar columns only. */
export function catalog(store:Store,user:any,params:URLSearchParams){
 const access=policy(store).snapshot(user),limit=pageSize(params.get('limit'),24);
 const search=(params.get('q')??'').slice(0,200),status=(params.get('status')??''),category=(params.get('category')??'');
 const list=(kind:'projects'|'articles')=>{
  const filter=kind==='projects'?status:category,scope=JSON.stringify([kind,search,filter,user?.uid??'anonymous']);
  const cursor=decodeCursor<string>(params.get(kind+'Cursor'),scope,p=>typeof p==='string'&&p.length<=200);
  const allowed=JSON.stringify(kind==='projects'?access.cardIds:access.lessonIds);
  const visible=kind==='projects'?'c.id IN (SELECT value FROM json_each(?))':"(r.project_id IS NULL OR r.project_id IN (SELECT value FROM json_each(?)))";
  const where=`${visible}${filter?` AND c.${kind==='projects'?'status':'category'}=?`:''}${search?' AND card_matches(c.search_text,?)':''}`;
  const args=[allowed,...(filter?[filter]:[]),...(search?[search]:[])];
  const rows=store.db.prepare(`SELECT c.summary,r.version,${kind==='projects'?'r.revision':'r.project_id,r.created_uid'} FROM ${kind}_cards c JOIN ${kind} r ON r.id=c.id WHERE ${where}${cursor?' AND c.id>?':''} ORDER BY c.id LIMIT ?`).all(...args,...(cursor?[cursor]:[]),limit+1);
  const items=rows.slice(0,limit).map(row=>{const item=JSON.parse(String(row.summary));return {...item,version:row.version,...(kind==='projects'?{taskRevision:row.revision,capabilities:capabilities.filter(cap=>access.can(cap,item.id))}:{projectId:row.project_id,createdUid:row.created_uid,canEdit:access.can('lessonEdit',row.project_id?String(row.project_id):undefined),canDelete:access.can('lessonDelete',row.project_id?String(row.project_id):undefined)})};});
  const last=items.at(-1);
  return {items,nextCursor:rows.length>limit?encodeCursor(scope,last.id):null};
 };
 const projects=list('projects'),articles=list('articles');
 const states=store.db.prepare('SELECT c.status,COUNT(*) AS n FROM projects_cards c WHERE c.id IN (SELECT value FROM json_each(?)) GROUP BY c.status').all(JSON.stringify(access.cardIds));
 const articleStats=store.db.prepare('SELECT c.category,COUNT(*) AS n FROM articles_cards c JOIN articles a ON a.id=c.id WHERE a.project_id IS NULL OR a.project_id IN (SELECT value FROM json_each(?)) GROUP BY c.category').all(JSON.stringify(access.lessonIds));
 return {settings:store.get('settings','site'),projects:projects.items,articles:articles.items,projectsPage:{nextCursor:projects.nextCursor},articlesPage:{nextCursor:articles.nextCursor},stats:{projects:states.reduce((s,r)=>s+Number(r.n),0),statuses:Object.fromEntries(states.map(r=>[r.status,r.n])),articles:articleStats.reduce((s,r)=>s+Number(r.n),0),categories:articleStats.map(r=>String(r.category))},users:[],user:user?{...safeAccount(user),capabilities:capabilities.filter(cap=>access.can(cap))}:null};
}
