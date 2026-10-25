import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Store } from './database.ts';
import { passwordHash } from './database.ts';
import { audit } from './audit.ts';
import type { WriteContext } from './audit.ts';
import { invalid } from './contracts.ts';

export const roles=['admin','editor','viewer'];
export function accountByUid(store:Store,uid:string) {
  const identity=store.db.prepare('SELECT login_name FROM identities WHERE uid=? AND retired_at IS NULL').get(uid);
  const user=identity?.login_name?store.get('users',String(identity.login_name)):null;
  return user&&user.uid===uid&&user.status==='active'&&roles.includes(user.role)&&Number.isSafeInteger(user.authEpoch)&&user.authEpoch>=0&&verifyCredentialShape(user)?user:null;
}
export const safeAccount=(user:any)=>user?{id:user.uid,loginName:user.id,name:user.name,role:user.role,status:user.status,groupId:user.groupId}:null;
const dummySalt='00000000000000000000000000000000';
export function verifyPassword(user:any,password:unknown) {
  if(typeof password!=='string'||password.length>1024)return false;
  const computed=Buffer.from(passwordHash(password,typeof user?.salt==='string'?user.salt:dummySalt),'hex');
  const valid=typeof user?.hash==='string'&&/^[a-f0-9]{128}$/i.test(user.hash);
  return timingSafeEqual(computed,valid?Buffer.from(user.hash,'hex'):Buffer.alloc(64))&&!!valid;
}
function credentials(password:unknown) {
  if(typeof password!=='string'||password.length<10||password.length>1024)invalid('密码需为 10–1024 位');
  const salt=randomBytes(16).toString('hex');return {salt,hash:passwordHash(password as string,salt)};
}
export function accountService(store:Store) {
  const admin=(actor:any)=>{if(!actor||actor.role!=='admin')invalid('仅管理员可管理账号',403);};
  const find=(uid:string)=>{const identity=store.db.prepare('SELECT login_name FROM identities WHERE uid=? AND retired_at IS NULL').get(uid);return identity?.login_name?store.get('users',String(identity.login_name)):null;};
  const protect=(before:any,after:any)=>{
    if(before?.role==='admin'&&before.status==='active'&&(!after||after.role!=='admin'||after.status!=='active')) {
      if(store.all('users').filter(u=>u.uid!==before.uid&&u.role==='admin'&&accountByUid(store,u.uid)&&verifyCredentialShape(u)).length===0)invalid('不能停用、删除或降权最后一个可用管理员',409);
    }
  };
  const checkedGroup=(id:unknown)=>{if(typeof id!=='string'||!store.db.prepare('SELECT 1 FROM permission_groups WHERE id=?').get(id))invalid('组别无效');return id;};
  function create(actor:any,body:any,context:WriteContext) {
    admin(actor);if(typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{3,32}$/.test(body.id)||!roles.includes(body.role))invalid('账号或角色无效');
    const secret=credentials(body.password);
    return store.transaction(()=>{
      if(store.get('users',body.id))invalid('账号已存在',409);
      const user={id:body.id,name:String(body.name||body.id).slice(0,100),role:body.role,status:'active',authEpoch:0,groupId:checkedGroup(body.groupId??(body.role==='viewer'?'viewer':'editor')),...secret};
      store.put('users',user);const saved=store.get('users',body.id);audit(store.db,context,'accounts',saved.uid,null,saved);return safeAccount(saved);
    });
  }
  function update(actor:any,uid:string,body:any,context:WriteContext) {
    admin(actor);return store.transaction(()=>{
      const before=find(uid);if(!before)invalid('账号不存在',404);const next={...before};
      if(body.role!==undefined){if(!roles.includes(body.role))invalid('角色无效');next.role=body.role;}
      if(body.status!==undefined){if(!['active','disabled'].includes(body.status))invalid('账号状态无效');next.status=body.status;}
      if(body.name!==undefined){if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)invalid('显示名称无效');next.name=body.name;}
      if(body.loginName!==undefined){if(typeof body.loginName!=='string'||!/^[a-zA-Z0-9_-]{3,32}$/.test(body.loginName))invalid('登录名无效');next.id=body.loginName;}
      if(body.groupId!==undefined)next.groupId=checkedGroup(body.groupId);
      protect(before,next);
      if(next.role!==before.role||next.status!==before.status||next.groupId!==before.groupId||next.id!==before.id)next.authEpoch++;
      if(next.id!==before.id){if(store.get('users',next.id))invalid('账号已存在',409);store.db.prepare('DELETE FROM users WHERE id=?').run(before.id);store.db.prepare('UPDATE identities SET login_name=? WHERE uid=?').run(next.id,uid);}
      store.put('users',next);audit(store.db,context,'accounts',uid,before,next);return safeAccount(next);
    });
  }
  function remove(actor:any,uid:string,context:WriteContext) {
    admin(actor);store.transaction(()=>{const before=find(uid);if(!before)invalid('账号不存在',404);protect(before,null);store.db.prepare('DELETE FROM project_members WHERE user_uid=?').run(uid);store.remove('users',before.id);audit(store.db,context,'accounts',uid,before,null);});
  }
  function password(actor:any,uid:string,body:any,context:WriteContext,reset=false) {
    if(reset)admin(actor);else if(actor?.uid!==uid)invalid('无权操作',403);
    store.transaction(()=>{const user=find(uid);if(!user)invalid('账号不存在',404);if(!reset&&!verifyPassword(user,body.current))invalid('当前密码不正确');
      const next={...user,...credentials(body.password),authEpoch:user.authEpoch+1};store.put('users',next);
      audit(store.db,context,'password',uid,{id:uid,status:reset?'admin-reset':'self-change'},{id:uid,status:'changed'});
    });
  }
  return {create,update,remove,password};
}
export function verifyCredentialShape(user:any){return typeof user.salt==='string'&&!!user.salt&&typeof user.hash==='string'&&/^[a-f0-9]{128}$/i.test(user.hash);}
