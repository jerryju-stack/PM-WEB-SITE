import type { Store } from './database.ts';
import { accountByUid, safeAccount } from './accounts.ts';
import { invalid } from './contracts.ts';
import { audit } from './audit.ts';
import type { WriteContext } from './audit.ts';
import { randomUUID } from 'node:crypto';
export const capabilities=['projectCreate','projectEdit','projectDelete','timingRead','timingEdit','attachmentUpload','attachmentDelete','lessonCreate','lessonEdit','lessonDelete','lessonsRead','membersRead','membersManage'] as const;
export type Capability=typeof capabilities[number];
export function policy(store:Store) {
  const group=(id:string)=>{const row=store.db.prepare('SELECT * FROM permission_groups WHERE id=?').get(id);if(!row)return null;let caps:unknown;try{caps=JSON.parse(String(row.capabilities));}catch{return null;}return Array.isArray(caps)&&caps.every(c=>capabilities.includes(c))?{id:String(row.id),name:String(row.name),capabilities:caps as Capability[]}:null;};
  const valid=(user:any)=>user&&accountByUid(store,user.uid);
  const memberGroup=(user:any,projectId:string)=>{const row=user&&store.db.prepare('SELECT group_id FROM project_members WHERE project_id=? AND user_uid=?').get(projectId,user.uid);return row?group(String(row.group_id)):null;};
  function can(user:any,cap:Capability,projectId?:string) {
    if(!valid(user))return false;
    if(user.role==='admin')return true;
    if(user.role==='viewer'&&!['timingRead','lessonsRead','membersRead'].includes(cap))return false;
    if(projectId)return !!memberGroup(user,projectId)?.capabilities.includes(cap);
    if(cap==='projectCreate'&&store.db.prepare('SELECT project_id FROM project_members WHERE user_uid=?').all(user.uid).some(row=>memberGroup(user,String(row.project_id))?.capabilities.includes(cap)))return true;
    return !!group(user.groupId??(user.role==='viewer'?'viewer':'editor'))?.capabilities.includes(cap);
  }
  const access=(id:string)=>store.db.prepare('SELECT * FROM project_access WHERE project_id=?').get(id);
  const card=(user:any,id:string)=>{const config=access(id);return !!config&&(config.cards==='public'||(!!valid(user)&&(user.role==='admin'||!!memberGroup(user,id))));};
  const read=(user:any,id:string,section:'timing'|'lessons')=>{const config=access(id);if(!config||!valid(user))return false;return config[section]==='authenticated'||can(user,section==='timing'?'timingRead':'lessonsRead',id);};
  const requireRead=(user:any,id:string,section:'timing'|'lessons'='timing')=>{if(!read(user,id,section))invalid(user?'资源不存在或无权访问':'请先登录',user?404:401);};
  const requireCap=(user:any,cap:Capability,id?:string)=>{if(!can(user,cap,id))invalid(user?'无权执行此操作':'请先登录',user?403:401);};
  const articleRead=(user:any,item:any)=>!item.projectId||read(user,item.projectId,'lessons');
  const attachmentProject=(id:string)=>{const row=store.db.prepare('SELECT t.project_id FROM attachments a JOIN tasks t ON a.task_id=t.id WHERE a.id=?').get(id);if(!row)invalid('资源不存在或无权访问',404);return String(row!.project_id);};
  const taskProject=(id:string)=>{const row=store.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(id);if(!row)invalid('资源不存在或无权访问',404);return String(row!.project_id);};
  function members(user:any,id:string) {requireCap(user,'membersRead',id);return store.db.prepare('SELECT user_uid,group_id FROM project_members WHERE project_id=?').all(id).map(row=>{const account=accountByUid(store,String(row.user_uid));return {userUid:row.user_uid,groupId:row.group_id,user:account?safeAccount(account):{id:row.user_uid,name:'已停用账号',status:'disabled'}};});}
  function setMember(user:any,id:string,uid:string,groupId:string|null,context:WriteContext) {
    store.transaction(()=>{requireCap(user,'membersManage',id);if(!store.get('projects',id))invalid('项目不存在',404);
      if(groupId!==null&&!accountByUid(store,uid))invalid('请选择可用账号');if(groupId!==null&&!group(groupId))invalid('组别无效');
      const before=store.db.prepare('SELECT group_id FROM project_members WHERE project_id=? AND user_uid=?').get(id,uid);
      if(groupId===null)store.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_uid=?').run(id,uid);
      else store.db.prepare('INSERT INTO project_members VALUES(?,?,?) ON CONFLICT(project_id,user_uid) DO UPDATE SET group_id=excluded.group_id').run(id,uid,groupId);
      if((before?.group_id??null)!==groupId)audit(store.db,context,'members',id+':'+uid,before?{projectId:id,userUid:uid,groupId:before.group_id}:null,groupId?{projectId:id,userUid:uid,groupId}:null);
    });
  }
  function setAccess(user:any,id:string,body:any,context:WriteContext) {
    store.transaction(()=>{requireCap(user,'membersManage',id);const before=access(id);if(!before)invalid('项目不存在',404);
      const next={...before};for(const key of ['cards','timing','lessons'])if(body[key]!==undefined){if(!(key==='cards'?['public','members']:['authenticated','members']).includes(body[key]))invalid('可见范围无效');next[key]=body[key];}
      store.db.prepare('UPDATE project_access SET cards=?,timing=?,lessons=? WHERE project_id=?').run(next.cards!,next.timing!,next.lessons!,id);audit(store.db,context,'project-access',id,before,next);
    });
  }
  function saveGroup(user:any,id:string|undefined,body:any,context:WriteContext) {
    if(user?.role!=='admin')invalid('仅管理员可管理组别',403);
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||!Array.isArray(body.capabilities)||!body.capabilities.every((c:any)=>capabilities.includes(c)))invalid('组别名称或能力无效');
    return store.transaction(()=>{const before=id?group(id):null;if(id&&!before)invalid('组别不存在',404);const key=id??randomUUID();const next={id:key,name:body.name,capabilities:[...new Set(body.capabilities)]};
      store.db.prepare('INSERT INTO permission_groups VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,capabilities=excluded.capabilities').run(key,next.name,JSON.stringify(next.capabilities));audit(store.db,context,'groups',key,before,next);return next;
    });
  }
  return {can,card,read,requireRead,requireCap,articleRead,attachmentProject,taskProject,members,setMember,setAccess,saveGroup,access,group,groups:()=>store.db.prepare('SELECT id FROM permission_groups').all().map(row=>group(String(row.id)))};
}
