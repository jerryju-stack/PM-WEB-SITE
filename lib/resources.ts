import { randomBytes } from 'node:crypto';
import type { Store } from './database.ts';
import { template } from './schedule.ts';
import { invalid, objectInput, resourceInput, versionInput } from './contracts.ts';
import type { Collection, Project, Article } from './contracts.ts';
import { audit } from './audit.ts';
import type { WriteContext } from './audit.ts';
/** The HTTP write boundary for project metadata and articles. Task-derived values are never accepted here. */
type ResourceMap = { projects: Project; articles: Article };
export function resourceWriter(store: Store) {
  const find = <C extends Collection>(collection: C, id: string): ResourceMap[C] => store.get(collection,id) || invalid('记录已删除或不存在',404);
  function create<C extends Collection>(collection: C, value: unknown, owner: string, context?: WriteContext): ResourceMap[C] {
    const raw=objectInput(value);if (raw.id !== undefined) invalid('创建不能指定已有 ID，请刷新客户端后重试');
    const input=resourceInput(collection,raw);
    const item={id:randomBytes(16).toString('hex'),title:input.title!,description:input.description??'',category:input.category||'未分类',date:input.date??'',startDate:input.startDate??'',content:input.content??'',owner:input.owner||owner,status:'计划中',progress:0};
    dates(item);
    return store.transaction(()=>{
      store.db.prepare('INSERT INTO '+collection+'(id,data) VALUES(?,?)').run(item.id,JSON.stringify(item));
      if(collection==='projects')for(const task of template(item.id))store.db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(task.id,item.id,null,JSON.stringify(task));
      const result=find(collection,item.id);
      audit(store.db,context,collection,item.id,null,result,{after:result.version});
      if(collection==='projects')for(const task of store.tasks(item.id))audit(store.db,context,'tasks',task.id,null,task,{projectId:item.id,revisionAfter:0});
      return result;
    });
  }
  function update<C extends Collection>(collection: C, id: string, value: unknown, context?: WriteContext): ResourceMap[C] {
    return store.transaction(()=>{
      const current=find(collection,id),raw=objectInput(value),expected=versionInput(raw.version);
      if(current.version!==expected)invalid('内容已被其他操作更新。草稿已保留，请查看最新数据后决定如何重试',409);
      const input=resourceInput(collection,raw,true);
      // Only writable fields are copied. A stale progress/status/taskRevision is deliberately ignored.
      const fields=collection==='projects'?['title','description','category','date','startDate','owner'] as const:['title','description','category','date','content'] as const;
      const item={...current};for(const key of fields)if(input[key]!==undefined)(item as Record<string,unknown>)[key]=input[key];
      dates(item);
      const {version: _version, taskRevision: _taskRevision, ...data}=item as Project;
      const result=store.db.prepare('UPDATE '+collection+' SET data=?,version=version+1 WHERE id=? AND version=?').run(JSON.stringify(data),id,expected);
      if(!result.changes)invalid('内容版本冲突，请查看最新数据',409);
      const saved=find(collection,id);audit(store.db,context,collection,id,current,saved,{before:expected,after:saved.version});return saved;
    });
  }
  function remove(collection: Collection, id: string, value: unknown, context?: WriteContext) {
    return store.transaction(()=>{
      const current=find(collection,id),raw=objectInput(value),expected=versionInput(raw.version);
      if(current.version!==expected)invalid('内容已更新，请查看最新数据后重新确认删除',409);
      if(collection==='projects'&&versionInput(raw.taskRevision,'任务')!==(current as Project).taskRevision)invalid('任务已更新，请查看最新数据后重新确认删除',409);
      const tasks=collection==='projects'?store.tasks(id):[];
      const attachments=collection==='projects'?store.db.prepare('SELECT a.* FROM attachments a JOIN tasks t ON a.task_id=t.id WHERE t.project_id=?').all(id) as any[]:[];
      store.db.prepare('DELETE FROM '+collection+' WHERE id=? AND version=?').run(id,expected);
      const versions={before:expected,taskRevision:collection==='projects'?(current as Project).taskRevision:undefined};
      audit(store.db,context,collection,id,current,null,versions);
      for(const task of tasks)audit(store.db,context,'tasks',task.id,task,null,{projectId:id,...versions});
      for(const row of attachments)audit(store.db,context,'attachments',row.id,row,null,{projectId:id,...versions});
    });
  }
  return {create,update,remove};
}
function dates(item: {date: string;startDate: string}) { if(item.date&&item.startDate&&item.date<item.startDate)invalid('结束日期不能早于开始日期'); }
