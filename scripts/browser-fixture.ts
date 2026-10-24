// Isolated manual browser acceptance fixture. Never opens the project's default data directory.
import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import { httpFixture } from '../tests/http-fixture.ts';
const f=await httpFixture();
let proxy:http.Server|undefined;
let requestStop!:()=>void;const stopped=new Promise<void>(resolve=>requestStop=resolve);
process.once('SIGINT',requestStop);process.once('SIGTERM',requestStop);
try {
const project=(await f.call('projects',{title:'A 批次浏览器验收',category:'隔离验证',description:'仅本机临时数据',owner:'测试成员',startDate:'2026-10-01',date:'2026-12-31'},f.cookie)).data.item;
let timing=(await f.call('projects/'+project.id+'/timing',undefined,f.cookie)).data;
const taskIds:string[]=[];
for(const title of ['验收任务 A','验收任务 B']){const task=await f.call('projects/'+project.id+'/tasks',{title,parentId:timing.tasks[0].id,owner:'测试成员',start:'2026-10-23',duration:2,revision:timing.revision},f.cookie);taskIds.push(task.data.id);timing=(await f.call('projects/'+project.id+'/timing',undefined,f.cookie)).data;}
const article=(await f.call('articles',{title:'验收手记',category:'隔离验证',date:'2026-10-24',description:'本机草稿和冲突验收',content:'## 原始正文'},f.cookie)).data.item;
let holdReads=false,failNextWrite=false;const pendingReads:(()=>void)[]=[];
let hold=false;const pending:(()=>void)[]=[];let writes=0;
proxy=http.createServer(async(req,res)=>{
 try {
 const url=new URL(req.url||'/','http://localhost');
 if(url.pathname.startsWith('/__test__/')){if(url.pathname.endsWith('/stop'))requestStop();if(url.pathname.endsWith('/hold-reads'))holdReads=true;if(url.pathname.endsWith('/resume-reads'))holdReads=false;if(url.pathname.endsWith('/release-reads')){holdReads=false;for(const send of pendingReads.splice(0))send();}if(url.pathname.endsWith('/fail-next-write'))failNextWrite=true;if(url.pathname.endsWith('/hold'))hold=true;if(url.pathname.endsWith('/release')){hold=false;for(const forward of pending.splice(0))forward();}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({hold,pending:pending.length,writes,holdReads,pendingReads:pendingReads.length}));return;}
 const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const payload=Buffer.concat(chunks);
 const forward=()=>{const upstream=http.request(f.base+req.url,{method:req.method,headers:req.headers},response=>{if(holdReads&&req.method==='GET'&&url.pathname.endsWith('/timing')){res.writeHead(response.statusCode||502,response.headers);res.flushHeaders();const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const send=()=>{if(!res.destroyed)res.end(Buffer.concat(chunks));};if(holdReads)pendingReads.push(send);else send();});}else{res.writeHead(response.statusCode||502,response.headers);response.pipe(res);}});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on('close',()=>upstream.destroy());upstream.end(payload);};
 const write=req.url?.startsWith('/api/')&&!['GET','HEAD'].includes(req.method||'GET');if(write)writes++;
 if(write&&failNextWrite){failNextWrite=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'隔离验收注入的临时失败'}));return;}
 if(hold&&write)pending.push(forward);else forward();
 } catch { if(!res.headersSent)res.writeHead(502);res.end(); }
});
const listener=proxy;
await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const address=proxy.address();if(!address||typeof address==='string')throw Error('proxy address unavailable');
const session={base:'http://127.0.0.1:'+address.port,direct:f.base,directory:f.directory,projectId:project.id,taskIds,articleId:article.id};
if(process.env.BROWSER_SESSION_FILE)await writeFile(process.env.BROWSER_SESSION_FILE,JSON.stringify(session,null,2));
console.log(JSON.stringify(session));
await stopped;
} finally {
 process.removeListener('SIGINT',requestStop);process.removeListener('SIGTERM',requestStop);
 if(proxy){proxy.closeAllConnections();await new Promise<void>(resolve=>proxy!.close(()=>resolve()));}
 await f.stop();
}
