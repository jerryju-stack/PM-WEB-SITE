import http from 'node:http';
import { readFile, mkdir, open, unlink, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, passwordHash } from './lib/database.ts';
import { template, dateValue, workdays, nextWorkday } from './lib/schedule.ts';
import type { Task } from './lib/schedule.ts';

const root=dirname(fileURLToPath(import.meta.url));
const store=openStore(resolve(process.env.DATA_DIR || join(root,'data')));
const uploads=join(store.directory,'uploads'); await mkdir(uploads,{recursive:true});
const sessions=new Map<string,{id:string;expires:number}>();
const attempts=new Map<string,{count:number;until:number}>();
const id=()=>randomBytes(16).toString('hex');
const safeUser=(user:any)=>user?{id:user.id,name:user.name,role:user.role}:null;
const fail=(message:string,status=400):never=>{throw Object.assign(Error(message),{status});};
const text=(v:any,max=5000)=>String(v??'').slice(0,max);
const verify=(u:any,p:any)=>u&&typeof p==='string'&&p.length<=1024&&timingSafeEqual(Buffer.from(u.hash,'hex'),Buffer.from(passwordHash(p,u.salt),'hex'));
const attached=(projectId:string)=>store.db.prepare('SELECT a.* FROM attachments a JOIN tasks t ON a.task_id=t.id WHERE t.project_id=? ORDER BY a.created_at DESC').all(projectId);
const eraseFiles=async(rows:any[])=>{for(const row of rows)try{await unlink(join(uploads,row.id));}catch(e:any){if(e.code!=='ENOENT')console.error('附件清理失败',row.id);}};
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

const server=http.createServer(async(req,res)=>{
  const json=(status:number,value:any)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try {
    const url=new URL(req.url||'/','http://localhost'), method=req.method||'GET';
    const token=/(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
    const session=token?sessions.get(token):null;
    const user=session&&session.expires>Date.now()?store.get('users',session.id):null;
    const requireUser=()=>{if(!user)fail('请先登录以查看项目详情和附件',401);};
    const requireEdit=()=>{requireUser();if(user.role==='viewer')fail('只读成员不能修改内容',403);};
    if(url.pathname.startsWith('/api/')) {
      if(!['GET','HEAD'].includes(method)&&req.headers.origin&&![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))fail('请求来源无效',403);
      const parts=url.pathname.split('/').filter(Boolean);
      if(parts[1]==='attachments'&&parts[2]&&method==='GET') {
        requireUser();const row=store.db.prepare('SELECT * FROM attachments WHERE id=?').get(parts[2]) as any;if(!row)fail('附件不存在',404);
        const handle=await open(join(uploads,row.id),'r');await handle.close();
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':row.size,'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.name).replaceAll("'",'%27')}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
        await pipeline(createReadStream(join(uploads,row.id)),res);return;
      }
      if(parts[1]==='projects'&&parts[3]==='tasks'&&parts[4]&&parts[5]==='attachments'&&method==='POST') {
        requireEdit();const task=store.tasks(parts[2]).find(t=>t.id===parts[4]);if(!task)fail('任务不存在',404);
        const rawName=String(req.headers['x-file-name']||'');let name:string;try{name=decodeURIComponent(rawName);}catch{fail('文件名无效');}
        name=name!.replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,200).trim();if(!name)fail('缺少文件名');
        const fileId=id(), temporary=join(uploads,fileId+'.part'), destination=join(uploads,fileId);let size=0;
        const handle=await open(temporary,'wx');
        try {
          for await(const chunk of req){size+=chunk.length;if(size>20*1024*1024)fail('单个附件不能超过 20 MB',413);await handle.write(chunk);}
          if(!size)fail('不能上传空文件');await handle.close();await rename(temporary,destination);
          store.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?)').run(fileId,task!.id,name,size,user.id,new Date().toISOString());
          return json(201,{id:fileId,name,size});
        }catch(e){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});await unlink(destination).catch(()=>{});throw e;}
      }
      let body:any={};
      if(['POST','PUT','DELETE','PATCH'].includes(method)) {
        const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)fail('请求内容不能超过 1 MB',413);chunks.push(chunk);}
        if(bytes){try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('JSON 格式无效');}if(!body||typeof body!=='object'||Array.isArray(body))fail('请求内容无效');}
      }
      if(url.pathname==='/api/login'&&method==='POST') {
        const ip=req.socket.remoteAddress||'',attempt=attempts.get(ip);
        if(attempt&&attempt.until>Date.now()&&attempt.count>=10)fail('尝试过于频繁，请 15 分钟后重试',429);
        const found=typeof body.id==='string'?store.get('users',body.id):null;
        if(!verify(found,body.password)){attempts.set(ip,{count:attempt&&attempt.until>Date.now()?attempt.count+1:1,until:Date.now()+900000});fail('账号或密码错误',401);}
        attempts.delete(ip);for(const [key,value] of sessions)if(value.expires<Date.now())sessions.delete(key);
        const key=id()+id();sessions.set(key,{id:found.id,expires:Date.now()+86400000});
        res.setHeader('Set-Cookie',`session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return json(200,safeUser(found));
      }
      if(url.pathname==='/api/logout'&&method==='POST'){if(token)sessions.delete(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{ok:true});}
      if(url.pathname==='/api/data'&&method==='GET')return json(200,{settings:store.get('settings','site'),projects:store.all('projects').map(p=>{const {content,...basic}=p;return basic;}),articles:store.all('articles'),users:user?.role==='admin'?store.all('users').map(safeUser):[],user:safeUser(user)});
      requireUser();
      if(parts[1]==='projects'&&parts[2]&&parts[3]==='timing'&&method==='GET') {
        const project=store.get('projects',parts[2]);if(!project)fail('项目不存在',404);
        return json(200,{project,tasks:store.tasks(project.id),attachments:attached(project.id),revision:store.revision(project.id),members:store.all('users').map(safeUser)});
      }
      if(url.pathname==='/api/password'&&method==='POST') {
        if(!verify(user,body.current))fail('当前密码不正确');if(typeof body.password!=='string'||body.password.length<10||body.password.length>1024)fail('新密码需为 10–1024 位');
        user.salt=randomBytes(16).toString('hex');user.hash=passwordHash(body.password,user.salt);store.put('users',user);for(const [key,s] of sessions)if(s.id===user.id&&key!==token)sessions.delete(key);return json(200,{ok:true});
      }
      if(!['POST','PUT','DELETE','PATCH'].includes(method))fail('不支持此方法',405);requireEdit();
      if(parts[1]==='attachments'&&parts[2]&&method==='DELETE') {
        const row=store.db.prepare('SELECT * FROM attachments WHERE id=?').get(parts[2]) as any;if(!row)fail('附件不存在',404);
        store.db.prepare('DELETE FROM attachments WHERE id=?').run(row.id);await eraseFiles([row]);return json(200,{ok:true});
      }
      if(parts[1]==='projects'&&parts[2]&&parts[3]==='tasks') {
        const project=store.get('projects',parts[2]);if(!project)fail('项目不存在',404);
        if(!Number.isInteger(body.revision))fail('缺少排期版本，请刷新后重试',409);
        let tasks=store.tasks(project.id);const taskId=parts[4];let target=taskId?tasks.find(t=>t.id===taskId):undefined;let removed:any[]=[];
        if(taskId&&!target)fail('任务不存在',404);
        if(method==='DELETE') {
          if(!target)fail('请选择任务');const doomed=new Set([target!.id]);let count=-1;while(count!==doomed.size){count=doomed.size;for(const t of tasks)if(t.parentId&&doomed.has(t.parentId))doomed.add(t.id);}
          removed=(attached(project.id) as any[]).filter(a=>doomed.has(a.task_id));tasks=tasks.filter(t=>!doomed.has(t.id)).map(t=>({...t,predecessors:t.predecessors.filter(p=>!doomed.has(p))}));
        }else {
          if(!target){if(method!=='POST')fail('任务不存在',404);target={id:id(),projectId:project.id,parentId:body.parentId||null,order:tasks.filter(t=>t.parentId===(body.parentId||null)).length,title:'新任务',kind:'task',owner:'',start:null,end:null,duration:1,progress:0,status:'计划中',notes:'',predecessors:[]};tasks.push(target);}
          if(body.parentId!==undefined){if(body.parentId!==null&&typeof body.parentId!=='string')fail('父任务无效');target.parentId=body.parentId;}
          if(target.parentId){const parent=tasks.find(t=>t.id===target!.parentId);if(!parent)fail('父任务不存在');if(parent!.kind==='milestone')fail('里程碑不能包含子任务');if(parent!.predecessors.length||tasks.some(t=>t.predecessors.includes(parent!.id)))fail('请先清除父任务的依赖关系，再添加子任务');}
          const isSummary=target.kind==='summary'||tasks.some(t=>t.parentId===target!.id);
          for(const key of ['title','owner','notes','status'] as const)if(body[key]!==undefined)target[key]=text(body[key],key==='notes'?20000:key==='title'?200:100);
          if(body.kind!==undefined){if(!['summary','task','milestone'].includes(body.kind))fail('任务类型无效');if(isSummary&&body.kind!=='summary')fail('汇总阶段不能直接改为普通任务');target.kind=body.kind;}
          if(body.order!==undefined){if(!Number.isInteger(body.order)||body.order<0)fail('排序值无效');target.order=body.order;}
          if(!isSummary&&target.kind!=='summary') {
            if(body.start!==undefined){if(body.start!==null&&typeof body.start!=='string')fail('开始日期无效');target.start=body.start?nextWorkday(body.start):null;}
            if(body.duration!==undefined)target.duration=Number(body.duration);
            if(body.end!==undefined&&body.end){dateValue(body.end);if(target.kind==='milestone')target.start=nextWorkday(body.end);else if(target.start)target.duration=workdays(target.start,body.end);}
            if(body.progress!==undefined)target.progress=Number(body.progress);
            if(body.predecessors!==undefined){if(!Array.isArray(body.predecessors)||!body.predecessors.every((x:any)=>typeof x==='string'))fail('前置任务格式无效');target.predecessors=[...new Set<string>(body.predecessors)];}
          }
        }
        const updated=store.saveTasks(project.id,tasks,body.revision);await eraseFiles(removed);return json(200,{tasks:updated,revision:store.revision(project.id),id:target?.id});
      }
      const collection=parts[1];
      if(collection==='settings') {
        if(user.role!=='admin')fail('仅管理员可配置网站',403);const settings=store.get('settings','site');for(const key of ['title','description','name','intro','team'])if(typeof body[key]==='string')settings[key]=text(body[key]);store.put('settings',settings);
      }else if(collection==='users') {
        if(user.role!=='admin')fail('仅管理员可管理用户',403);
        if(method==='DELETE'){if(body.id==='admin')fail('不能删除管理员');store.remove('users',String(body.id));for(const [key,s]of sessions)if(s.id===body.id)sessions.delete(key);}
        else {if(!/^[a-zA-Z0-9_-]{3,32}$/.test(body.id)||!['editor','viewer'].includes(body.role)||typeof body.password!=='string'||body.password.length<10||body.password.length>1024)fail('账号为 3–32 位英文数字，密码至少 10 位');if(store.get('users',body.id))fail('账号已存在');const salt=randomBytes(16).toString('hex');store.put('users',{id:body.id,name:text(body.name||body.id,100),role:body.role,salt,hash:passwordHash(body.password,salt)});}
      }else if(['projects','articles'].includes(collection)&&parts.length===2) {
        if(method==='DELETE'){const rows=collection==='projects'?attached(String(body.id)):[];store.remove(collection,String(body.id));await eraseFiles(rows as any[]);}
        else {
          if(typeof body.title!=='string'||!body.title.trim())fail('请填写标题');if(collection==='articles'&&typeof body.content!=='string')fail('请填写 Markdown 内容');
          const existing=body.id?store.get(collection,String(body.id)):null;
          const item={...existing,id:existing?.id||id(),title:text(body.title,200),description:text(body.description,1000),category:text(body.category||'未分类',100),date:text(body.date,10),startDate:text(body.startDate||existing?.startDate,10),content:text(body.content??existing?.content,500000),owner:text(body.owner||user.name,100),status:['进行中','已完成','计划中','已暂停'].includes(body.status)?body.status:'计划中',progress:Math.max(0,Math.min(100,Number(body.progress)||0))};
          if(item.date)dateValue(item.date);if(item.startDate)dateValue(item.startDate);if(item.date&&item.startDate&&item.date<item.startDate)fail('结束日期不能早于开始日期');
          if(existing&&collection==='projects'&&store.tasks(item.id).some(t=>t.kind!=='summary')){item.progress=existing.progress;item.status=existing.status;}
          store.transaction(()=>{store.put(collection,item);if(collection==='projects'&&!existing)for(const task of template(item.id))store.db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(task.id,item.id,null,JSON.stringify(task));});return json(200,{ok:true,id:item.id});
        }
      }else fail('接口不存在',404);
      return json(200,{ok:true});
    }
    if(method!=='GET')fail('不支持此方法',405);
    const scripts:Record<string,string>={'/app.js':'src/app.ts','/timing.js':'src/timing.ts','/schedule.js':'lib/schedule.ts'};
    if(scripts[url.pathname]){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});return res.end(stripTypeScriptTypes(await readFile(join(root,scripts[url.pathname]),'utf8')));}
    if(['/styles.css','/timing.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-cache'});return res.end(await readFile(join(root,'src',url.pathname.slice(1))));}
    if(url.pathname==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('User-agent: *\nAllow: /\nDisallow: /projects/\nDisallow: /api/\n');}
    if(url.pathname!=='/'&&!/^\/projects\/[a-zA-Z0-9_-]+\/timing$/.test(url.pathname))fail('页面不存在',404);
    const settings=store.get('settings','site');let html=await readFile(join(root,'src/index.html'),'utf8');html=html.replaceAll('__TITLE__',esc(settings.title)).replaceAll('__DESCRIPTION__',esc(settings.description));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"});res.end(html);
  }catch(e:any){if(res.headersSent){res.destroy();return;}const status=e.status||((e.code==='ENOENT')?404:400);if(status>=500)console.error(e);json(status,{error:e.message||'操作失败，请稍后重试'});}
});
const port=Number(process.env.PORT||3000);server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
