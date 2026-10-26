import http from 'node:http';
import { readFile, mkdir, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/database.ts';
import { accountByUid, accountService, safeAccount, verifyPassword } from './lib/accounts.ts';
import { policy, capabilities } from './lib/policy.ts';
import { audit } from './lib/audit.ts';
import type { WriteContext } from './lib/audit.ts';
import { resourceWriter } from './lib/resources.ts';
import { writeTasks } from './lib/task-writes.ts';
import { timingVersions } from './lib/timing-versions.ts';
import { attachmentService, fileId } from './lib/attachments.ts';
import { dataLock } from './lib/data-lock.ts';
import { requestId, errorResponse, diagnostic } from './lib/http-errors.ts';
import { clientAddress, trustedProxies, loginLimiter } from './lib/login-security.ts';

const root=dirname(fileURLToPath(import.meta.url));
const directory=resolve(process.env.DATA_DIR || join(root,'data'));
const lock=dataLock(directory,'server');
process.on('exit',()=>lock.release());
const store=openStore(directory);
const uploads=join(store.directory,'uploads'); await mkdir(uploads,{recursive:true});
const resources=resourceWriter(store);
const plans=timingVersions(store);
const accounts=accountService(store),permissions=policy(store);
const files=attachmentService(store);
const recovery=await files.retry();
if(recovery.some(row=>!row.ok))console.error(JSON.stringify({event:'attachment-recovery-pending',count:recovery.filter(row=>!row.ok).length}));
const sessions=new Map<string,{uid:string;epoch:number;expires:number}>();
const attempts=loginLimiter();
const proxies=trustedProxies(process.env.TRUSTED_PROXIES);
const id=()=>randomBytes(16).toString('hex');
const safeUser=(user:any)=>user?{...safeAccount(user),capabilities:capabilities.filter(cap=>permissions.can(user,cap))}:null;
const fail=(message:string,status=400):never=>{throw Object.assign(Error(message),{status});};
const text=(v:any,max=5000)=>String(v??'').slice(0,max);
const attached=(projectId:string)=>store.db.prepare('SELECT a.* FROM attachments a JOIN tasks t ON a.task_id=t.id WHERE t.project_id=? ORDER BY a.created_at DESC').all(projectId);
const eraseFiles=async(rows:any[])=>{const results=await files.retry(rows.map(row=>row.id));if(results.some(row=>!row.ok))console.error(JSON.stringify({event:'attachment-cleanup-pending',count:results.filter(row=>!row.ok).length}));};
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

const server=http.createServer(async(req,res)=>{
  const trace=requestId();res.setHeader('X-Request-Id',trace);
  const json=(status:number,value:any)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try {
    const url=new URL(req.url||'/','http://localhost'), method=req.method||'GET';
    const token=/(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
    const currentUser=()=>{const session=token?sessions.get(token):null;const found=session&&session.expires>Date.now()?accountByUid(store,session.uid):null;return found&&found.authEpoch===session!.epoch?found:null;};
    let user=currentUser();
    const context:WriteContext={actorId:user?.uid??'anonymous',actorName:user?.name??'',requestId:trace,actorUid:user?.uid};
    const recheck=()=>{user=currentUser();context.actorId=user?.uid??'anonymous';context.actorName=user?.name??'';context.actorUid=user?.uid;};
    const requireUser=()=>{if(!user)fail('请先登录以查看项目详情和附件',401);};
    if(url.pathname.startsWith('/api/')) {
      if(!['GET','HEAD'].includes(method)&&req.headers.origin&&![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))fail('请求来源无效',403);
      const parts=url.pathname.split('/').filter(Boolean);
      if(parts[1]==='attachments'&&parts[2]&&method==='GET') {
        requireUser();permissions.requireRead(user,permissions.attachmentProject(parts[2]));const row=store.db.prepare('SELECT * FROM attachments WHERE id=?').get(parts[2]) as any;if(!row)fail('附件不存在',404);
        const handle=await open(join(uploads,fileId(row.id)),'r');await handle.close();
        recheck();requireUser();permissions.requireRead(user,permissions.attachmentProject(parts[2]));
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':row.size,'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.name).replaceAll("'",'%27')}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
        await pipeline(createReadStream(join(uploads,row.id)),res);return;
      }
      if(parts[1]==='projects'&&parts[3]==='tasks'&&parts[4]&&parts[5]==='attachments'&&method==='POST') {
        requireUser();const projectId=permissions.taskProject(parts[4]);if(projectId!==parts[2])fail('资源不存在或无权访问',404);permissions.requireRead(user,projectId);permissions.requireCap(user,'attachmentUpload',projectId);const task=store.tasks(projectId).find(t=>t.id===parts[4]);if(!task)fail('任务不存在',404);
        const rawName=String(req.headers['x-file-name']||'');let name:string;try{name=decodeURIComponent(rawName);}catch{fail('文件名无效');}
        name=name!.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,200).trim();if(!name)fail('缺少文件名');
        return json(201,await files.upload(task!.id,name!,req,context,()=>{recheck();requireUser();const currentProject=permissions.taskProject(task!.id);if(currentProject!==projectId)fail('资源不存在或无权访问',404);permissions.requireRead(user,currentProject);permissions.requireCap(user,'attachmentUpload',currentProject);return context;}));
      }
      let body:any={};
      if(['POST','PUT','DELETE','PATCH'].includes(method)) {
        const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)fail('请求内容不能超过 1 MB',413);chunks.push(chunk);}
        if(bytes){try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('JSON 格式无效');}if(!body||typeof body!=='object'||Array.isArray(body))fail('请求内容无效');}
      }
      // The body can take arbitrarily long. Resolve the live session and account only
      // after it is consumed; all following authorization/business SQL is synchronous.
      recheck();
      if(url.pathname==='/api/login'&&method==='POST') {
        const ip=clientAddress(req.socket.remoteAddress||'',req.headers['x-forwarded-for'],proxies);
        if(!attempts.check(ip,body.id))fail('尝试过于频繁，请稍后重试',429);
        const found=typeof body.id==='string'?store.get('users',body.id):null;
        const passwordOK=verifyPassword(found,body.password);
        if(!passwordOK||!found||!accountByUid(store,found.uid)){attempts.failure(ip,body.id);fail('账号或密码错误',401);}
        for(const [key,value] of sessions)if(value.expires<Date.now())sessions.delete(key);
        if(sessions.size>=10000)fail('尝试过于频繁，请稍后重试',429);
        const key=id()+id();sessions.set(key,{uid:found.uid,epoch:found.authEpoch,expires:Date.now()+86400000});
        res.setHeader('Set-Cookie',`session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return json(200,safeUser(found));
      }
      if(url.pathname==='/api/logout'&&method==='POST'){if(token)sessions.delete(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
      if(url.pathname==='/api/data'&&method==='GET')return json(200,{settings:store.get('settings','site'),projects:store.all('projects').filter(p=>permissions.card(user,p.id)).map(p=>Object.fromEntries(['id','title','description','category','date','startDate','owner','status','progress','version','taskRevision'].map(key=>[key,p[key]]).concat([['capabilities',capabilities.filter(cap=>permissions.can(user,cap,p.id))]]))),articles:store.all('articles').filter(item=>permissions.articleRead(user,item)).map(item=>({...item,canEdit:permissions.can(user,'lessonEdit',item.projectId??undefined),canDelete:permissions.can(user,'lessonDelete',item.projectId??undefined)})),users:user?.role==='admin'?store.all('users').map(safeUser):[],user:safeUser(user)});
      if(parts[1]==='projects'&&parts[2]&&parts[3]==='timing'&&parts[4]) {
        const projectId=parts[2];permissions.requireRead(user,projectId);
        if(parts[4]==='versions') {
          if(method==='GET'&&parts.length===5)return json(200,{versions:plans.list(projectId)});
          if(method==='GET'&&parts.length===6)return json(200,plans.get(projectId,parts[5]));
          if(method==='POST'&&parts.length===5){permissions.requireCap(user,'timingEdit',projectId);const result=plans.save(projectId,body,context);return json(result.replayed?200:201,result);}
          fail('已保存版本只读，不支持此方法',405);
        }
        if(parts[4]==='compare'&&parts.length===5&&method==='GET') {
          const from=url.searchParams.get('from'),to=url.searchParams.get('to');if(!from||!to)fail('请选择来源和目标计划');
          return json(200,plans.compare(projectId,from!,to!));
        }
        fail('接口不存在',404);
      }
      if(parts[1]==='projects'&&parts[2]&&parts[3]==='timing'&&parts.length===4&&method==='GET') {
        permissions.requireRead(user,parts[2]);
        const project=store.get('projects',parts[2]);if(!project)fail('项目不存在',404);
        return json(200,{project,tasks:store.tasks(project.id),attachments:attached(project.id),revision:store.revision(project.id),members:permissions.can(user,'membersRead',project.id)?permissions.members(user,project.id):[],capabilities:capabilities.filter(cap=>permissions.can(user,cap,project.id))});
      }
      if((parts[1]==='projects'||parts[1]==='articles')&&parts.length===3&&method==='GET') {
        const item=store.get(parts[1],parts[2]);if(!item)fail('记录已删除或不存在',404);if(parts[1]==='projects')permissions.requireRead(user,item.id);else if(!permissions.articleRead(user,item))fail('资源不存在或无权访问',user?404:401);return json(200,item);
      }
      requireUser();
      if(parts[1]==='groups') {
        if(method==='GET')return json(200,{groups:permissions.groups(),capabilities});
        if(!['POST','PATCH'].includes(method))fail('不支持此方法',405);return json(200,permissions.saveGroup(user,parts[2],body,context));
      }
      if(parts[1]==='projects'&&parts[2]&&['members','access','candidates'].includes(parts[3])) {
        const projectId=parts[2];
        if(parts[3]==='candidates'){permissions.requireCap(user,'membersManage',projectId);return json(200,store.all('users').filter(u=>accountByUid(store,u.uid)).map(safeAccount));}
        if(parts[3]==='members') {
          if(method==='GET')return json(200,permissions.members(user,projectId));
          if(!['POST','PATCH','DELETE'].includes(method))fail('不支持此方法',405);
          if(typeof body.userUid!=='string'||(method!=='DELETE'&&typeof body.groupId!=='string'))fail('成员或组别无效');permissions.setMember(user,projectId,body.userUid,method==='DELETE'?null:body.groupId,context);return json(200,{ok:true});
        }
        permissions.requireCap(user,'membersManage',projectId);if(method==='GET')return json(200,permissions.access(projectId));if(method!=='PATCH')fail('不支持此方法',405);permissions.setAccess(user,projectId,body,context);return json(200,{ok:true});
      }
      if(parts[1]==='users') {
        if(user.role!=='admin')fail('仅管理员可管理账号',403);
        if(method==='GET')return json(200,store.all('users').map(safeUser));
        const uid=parts[2]??body.id;
        if(parts[3]==='password'&&method==='POST'){accounts.password(user,uid,body,context,true);return json(200,{ok:true});}
        if(method==='DELETE'){accounts.remove(user,uid,context);return json(200,{ok:true});}
        if(method==='PATCH'){return json(200,accounts.update(user,uid,body,context));}
        if(method==='POST'&&!parts[2])return json(200,accounts.create(user,body,context));
        fail('不支持此方法',405);
      }
      if(url.pathname==='/api/password'&&method==='POST') {
        accounts.password(user,user.uid,body,context);return json(200,{ok:true,relogin:true});
      }
      if(!['POST','PUT','DELETE','PATCH'].includes(method))fail('不支持此方法',405);
      if(parts[1]==='attachments'&&parts[2]&&method==='DELETE') {
        const row=store.db.prepare('SELECT * FROM attachments WHERE id=?').get(parts[2]) as any;if(!row)fail('附件不存在',404);
        const projectId=permissions.attachmentProject(row.id);permissions.requireRead(user,projectId);permissions.requireCap(user,'attachmentDelete',projectId);
        files.remove(row.id,context);await eraseFiles([row]);return json(200,{ok:true});
      }
      if(parts[1]==='projects'&&parts[2]&&parts[3]==='tasks') {
        permissions.requireRead(user,parts[2]);permissions.requireCap(user,'timingEdit',parts[2]);if(parts[4]&&permissions.taskProject(parts[4])!==parts[2])fail('资源不存在或无权访问',404);
        const result=writeTasks(store,parts[2],parts[4],method,body,context);
        await eraseFiles(result.removed);const {removed,...response}=result;return json(200,response);
      }
      const collection=parts[1];
      if(collection==='settings') {
        if(user.role!=='admin')fail('仅管理员可配置网站',403);const settings=store.get('settings','site');for(const key of ['title','description','name','intro','team'])if(typeof body[key]==='string')settings[key]=text(body[key]);store.put('settings',settings);
      }else if((collection==='projects'||collection==='articles')&&parts.length<=3) {
        const resourceId=parts[2]??body.id;
        if(resourceId!==undefined&&typeof resourceId!=='string')fail('资源 ID 无效');
        const existing=resourceId?store.get(collection,resourceId):null;
        if(resourceId&&!existing)fail('资源不存在或无权访问',404);
        if(collection==='projects') {
          if(resourceId){permissions.requireRead(user,resourceId);permissions.requireCap(user,method==='DELETE'?'projectDelete':'projectEdit',resourceId);}
          else permissions.requireCap(user,'projectCreate');
          if(method==='DELETE'&&store.db.prepare('SELECT 1 FROM articles WHERE project_id=?').get(resourceId))fail('请先处理关联项目的 Lesson Learn，再删除项目',409);
        } else {
          if(existing&&!permissions.articleRead(user,existing))fail('资源不存在或无权访问',404);
          const projectId=existing?.projectId??(body.projectId||undefined);
          if(existing&&body.projectId!==undefined&&body.projectId!==existing.projectId)fail('不能更改文章项目归属');
          if(projectId){if(typeof projectId!=='string'||!store.get('projects',projectId))fail('资源不存在或无权访问',404);permissions.requireRead(user,projectId,'lessons');}
          permissions.requireCap(user,method==='DELETE'?'lessonDelete':resourceId?'lessonEdit':'lessonCreate',projectId);
        }
        if(method==='DELETE') {
          if(!resourceId)fail('请选择记录');
          const rows=collection==='projects'?attached(resourceId):[];
          resources.remove(collection,resourceId,body,context);await eraseFiles(rows as any[]);
        } else if((method==='PATCH'||method==='PUT'||method==='POST')&&resourceId!==undefined) {
          const item=resources.update(collection,resourceId,body,context);return json(200,{ok:true,id:item.id,version:item.version,item});
        } else if(method==='POST'&&!resourceId) {
          const item=resources.create(collection,body,user.name,context,key=>{
            if(collection==='projects'){store.db.prepare('INSERT INTO project_members VALUES(?,?,?)').run(key,user.uid,'manager');audit(store.db,context,'members',key+':'+user.uid,null,{projectId:key,userUid:user.uid,groupId:'manager'});}
            else store.db.prepare('UPDATE articles SET project_id=?,created_uid=? WHERE id=?').run(body.projectId||null,user.uid,key);
          });return json(200,{ok:true,id:item.id,version:item.version,item});
        } else fail('请使用 POST 创建或 PATCH 更新指定记录',405);
      }else fail('接口不存在',404);
      return json(200,{ok:true});
    }
    if(method!=='GET')fail('不支持此方法',405);
    const scripts:Record<string,string>={'/app.js':'src/app.ts','/timing.js':'src/timing.ts','/timing-history.js':'src/timing-history.ts','/schedule.js':'lib/schedule.ts','/drafts.js':'src/drafts.ts','/access-ui.js':'src/access-ui.ts'};
    if(scripts[url.pathname]){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});return res.end(stripTypeScriptTypes(await readFile(join(root,scripts[url.pathname]),'utf8')));}
    if(['/styles.css','/timing.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-cache'});return res.end(await readFile(join(root,'src',url.pathname.slice(1))));}
    if(url.pathname==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('User-agent: *\nAllow: /\nDisallow: /projects/\nDisallow: /api/\n');}
    if(url.pathname!=='/'&&!/^\/projects\/[a-zA-Z0-9_-]+\/timing$/.test(url.pathname))fail('页面不存在',404);
    const settings=store.get('settings','site');let html=await readFile(join(root,'src/index.html'),'utf8');html=html.replaceAll('__TITLE__',esc(settings.title)).replaceAll('__DESCRIPTION__',esc(settings.description));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"});res.end(html);
  }catch(e:any){const failure=errorResponse(e,trace);if(failure.status>=500)console.error(diagnostic(e,trace,req.method));if(res.headersSent){res.destroy();return;}json(failure.status,failure.body);}
});
const port=Number(process.env.PORT||3000);server.listen(port,'127.0.0.1',()=>{const address=server.address();console.log(`Local: http://127.0.0.1:${typeof address==='object'&&address?address.port:port}`);});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{server.close(()=>process.exit(0));server.closeAllConnections();});
