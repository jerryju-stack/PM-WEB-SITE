// Disposable local UI fixture. No production DATA_DIR accepted, no credentials printed.
import { createServer } from 'node:http';
import { httpFixture } from '../tests/http-fixture.ts';
const f=await httpFixture();
try{
  const engineer=(await f.call('users',{id:'engineer',name:'Engineering 验证',role:'editor',groupId:'engineering',password:'Isolated-C-Browser-2026'},f.cookie)).data;
  const project=(await f.call('projects',{title:'C 浏览器验收项目',category:'隔离验证',owner:'历史负责人文本',description:'仅本机临时数据'},f.cookie)).data.id;
  await f.call(`projects/${project}/tasks`,{revision:0,title:'Engineering 附件任务',start:'2026-10-26',duration:1},f.cookie);
  await f.call(`projects/${project}/members`,{userUid:engineer.id,groupId:'engineering'},f.cookie);
  await f.call(`projects/${project}/access`,{timing:'members',lessons:'members'},f.cookie,'PATCH');
  await f.call('articles',{title:'公开知识验收',content:'公开知识仍可阅读'},f.cookie);
  const control=createServer((req,res)=>{if(req.url!=='/stop'){res.writeHead(404);res.end();return;}res.end('stopping');control.close(async()=>{await f.stop();console.log(JSON.stringify({allFixturePortsClosed:true}));});control.closeAllConnections();});
  await new Promise<void>(resolve=>control.listen(0,'127.0.0.1',resolve));
  console.log(JSON.stringify({base:f.base,projectId:project,engineerUid:engineer.id,control:`http://127.0.0.1:${(control.address() as {port:number}).port}/stop`}));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{control.close();control.closeAllConnections();void f.stop();});
}catch(error){await f.stop();throw error;}
