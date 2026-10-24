import { randomBytes } from 'node:crypto';
import type { Store } from './database.ts';
import { template } from './schedule.ts';
import { invalid, objectInput, resourceInput, versionInput } from './contracts.ts';
import type { Collection, Project, Article } from './contracts.ts';
/** The HTTP write boundary for project metadata and articles. Task-derived values are never accepted here. */
type ResourceMap = { projects: Project; articles: Article };
export function resourceWriter(store: Store) {
  const find = <C extends Collection>(collection: C, id: string): ResourceMap[C] => store.get(collection,id) || invalid('记录已删除或不存在',404);
  function create<C extends Collection>(collection: C, value: unknown, owner: string): ResourceMap[C] {
    const raw=objectInput(value);if (raw.id !== undefined) invalid('创建不能指定已有 ID，请刷新客户端后重试');
    const input=resourceInput(collection,raw);
    const item={id:randomBytes(16).toString('hex'),title:input.title!,description:input.description??'',category:input.category||'未分类',date:input.date??'',startDate:input.startDate??'',content:input.content??'',owner:input.owner||owner,status:'计划中',progress:0};
    dates(item);
    return store.transaction(()=>{
      store.db.prepare('INSERT INTO '+collection+'(id,data) VALUES(?,?)').run(item.id,JSON.stringify(item));
      if(collection==='projects')for(const task of template(item.id))store.db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(task.id,item.id,null,JSON.stringify(task));
      return find(collection,item.id);
    });
  }
  function update<C extends Collection>(collection: C, id: string, value: unknown): ResourceMap[C] {
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
      return find(collection,id);
    });
  }
  function remove(collection: Collection, id: string, value: unknown) {
    return store.transaction(()=>{
      const current=find(collection,id),raw=objectInput(value),expected=versionInput(raw.version);
      if(current.version!==expected)invalid('内容已更新，请查看最新数据后重新确认删除',409);
      if(collection==='projects'&&versionInput(raw.taskRevision,'任务')!==(current as Project).taskRevision)invalid('任务已更新，请查看最新数据后重新确认删除',409);
      store.db.prepare('DELETE FROM '+collection+' WHERE id=? AND version=?').run(id,expected);
    });
  }
  return {create,update,remove};
}
function dates(item: {date: string;startDate: string}) { if(item.date&&item.startDate&&item.date<item.startDate)invalid('结束日期不能早于开始日期'); }
