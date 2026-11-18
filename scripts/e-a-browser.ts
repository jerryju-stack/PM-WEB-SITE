/** Isolated real-server browser fixture + fault proxy. Not imported by the product server. */
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,basename } from 'node:path';
import { createServer,request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { openStore } from '../lib/database.ts';
import { syntheticTasks } from './e-a-fixtures.ts';
import { timingVersions } from '../lib/timing-versions.ts';
import { httpFixture } from '../tests/http-fixture.ts';

const previous=process.argv.includes('--reuse')?JSON.parse(readFileSync('.deploy/e-a-browser.json','utf8')):undefined;
const directory=previous?.directory??mkdtempSync(join(tmpdir(),'station-e-a-browser-')),faultFile=join(directory,'faults.json');
if(!basename(directory).startsWith('station-e-a-browser-'))throw Error('Not an E-A fixture');
process.env.ADMIN_PASSWORD='Isolated-EA-Browser-2026';
const store=openStore(directory),actor=store.get('users','admin');
if(!previous)for(const n of [30,1000]){const id='browser-'+n;store.put('projects',{id,title:'E-A isolated '+n,category:'Test',owner:'Synthetic PM',description:'Disposable local browser validation',progress:0,status:'计划中'});store.saveTasks(id,syntheticTasks(n,'fanout',id));timingVersions(store).save(id,{kind:'baseline',name:'Synthetic baseline',reason:'E-A',revision:store.revision(id),projectVersion:0,requestKey:'synthetic-browser-'+n},{actorId:actor.uid,actorUid:actor.uid,actorName:actor.name,requestId:'browser-fixture'});}
store.db.close();writeFileSync(faultFile,'{}');
const fixture=await httpFixture({directory,password:process.env.ADMIN_PASSWORD});
const baselineModule=process.argv.includes('--baseline')?stripTypeScriptTypes(execFileSync('git',['-c','safe.directory='+process.cwd(),'show','e37b032:src/timing.ts']).toString()):undefined;
const proxy=createServer((req,res)=>{
 if(baselineModule&&req.url==='/timing.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(baselineModule);return;}
 let faults:any={};try{faults=JSON.parse(readFileSync(faultFile,'utf8'));}catch{}
 const task=req.method!=='GET'&&req.url?.includes('/tasks'),read=req.method==='GET'&&/\/timing$/.test(req.url||''),heartbeat=req.url?.endsWith('/heartbeat'),adopt=req.url?.endsWith('/adopt');
 const fault=task?faults.tasks:read?faults.read:heartbeat?faults.heartbeat:adopt?faults.adopt:undefined;
 appendFileSync(join(directory,'requests.jsonl'),JSON.stringify({at:new Date().toISOString(),method:req.method,path:req.url,fault:fault??null})+'\n');
 if(typeof fault==='number'){req.resume();res.writeHead(fault,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Isolated injected '+fault}));return;}
 if(fault==='drop'){req.resume();req.socket.destroy();return;}
 const upstream=request(fixture.base+req.url,{method:req.method,headers:req.headers},response=>{
  if(fault==='commit-drop'){response.resume();response.on('end',()=>req.socket.destroy());return;}
  const forward=()=>{
   if(response.headers['content-type']?.includes('text/html')){
    const chunks:Buffer[]=[];response.on('data',b=>chunks.push(b));response.on('end',()=>{const html=Buffer.concat(chunks).toString().replace('</body>',`<script>
     (()=>{let started=0;const samples=[],inputSamples=[],handlerSamples=[],longTasks=[],sameInputSamples=[],viewportSamples=[];const root=()=>document.querySelector('#app');const viewport=()=>({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,dpr:devicePixelRatio});try{new PerformanceObserver(list=>{for(const entry of list.getEntries()){longTasks.push({startMs:entry.startTime,durationMs:entry.duration});if(longTasks.length>256)longTasks.shift();}}).observe({entryTypes:['longtask']});}catch{}const publish=()=>{root()?.setAttribute('data-ea-timings',JSON.stringify({samples,inputSamples,handlerSamples,longTasks,sameInputSamples,viewportSamples,viewport:viewport(),heapBytes:performance.memory?.usedJSHeapSize,visibility:document.visibilityState}));};
     document.addEventListener('input',e=>{if(!e.target.matches('[data-inline]'))return;started=performance.now();const at=started;requestAnimationFrame(()=>requestAnimationFrame(()=>{inputSamples.push(performance.now()-at);publish();}));},true);
     new MutationObserver(()=>{if(started&&document.querySelector('.save-state')?.textContent.includes('草稿已保存')){const at=started;started=0;requestAnimationFrame(()=>requestAnimationFrame(()=>{samples.push(performance.now()-at);publish();}));}}).observe(document.documentElement,{childList:true,subtree:true});
     const button=document.createElement('button');button.id='ea-run-benchmark';button.textContent='运行30次隔离浏览器基准';button.style='position:fixed;right:10px;bottom:10px;z-index:9999';document.body.append(button);
     button.addEventListener('click',async()=>{button.disabled=true;samples.length=0;inputSamples.length=0;handlerSamples.length=0;longTasks.length=0;sameInputSamples.length=0;viewportSamples.length=0;try{for(let i=0;i<31;i++){const before=samples.length,input=document.querySelector('input[data-inline="owner"]:not(:disabled)');if(!input)throw Error('Enter editing first');viewportSamples.push(viewport());input.focus();input.value='Browser benchmark '+i;const handlerStart=performance.now();input.dispatchEvent(new Event('input',{bubbles:true}));handlerSamples.push(performance.now()-handlerStart);const deadline=Date.now()+30000;while(samples.length===before){if(Date.now()>deadline)throw Error('save timeout');await new Promise(r=>setTimeout(r,25));}sameInputSamples.push(input===document.querySelector('input[data-inline="owner"]:not(:disabled)'));}button.textContent='基准完成：首次 + 30 次';}catch(e){button.textContent='基准失败：'+e.message;}finally{button.disabled=false;publish();}});
     const idle=document.createElement('button');idle.id='ea-idle-control';idle.textContent='测量空闲帧控制';idle.style='position:fixed;right:10px;bottom:45px;z-index:9999';document.body.append(idle);idle.addEventListener('click',async()=>{idle.disabled=true;const frames=[];try{for(let i=0;i<31;i++){await new Promise(r=>setTimeout(r,800));const at=performance.now();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));frames.push(performance.now()-at);}root()?.setAttribute('data-ea-idle',JSON.stringify({frames,intervalMs:800,viewport:viewport(),visibility:document.visibilityState}));idle.textContent='空闲帧控制完成';}finally{idle.disabled=false;}});})();
    </script></body>`);res.writeHead(response.statusCode||200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
   }else{res.writeHead(response.statusCode||502,response.headers);response.pipe(res);}
  };
  if(fault==='delay')setTimeout(forward,3000);else forward();
 });upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
proxy.listen(previous?Number(new URL(previous.base).port):0,'127.0.0.1',()=>{const address=proxy.address() as any;const metadata={base:`http://127.0.0.1:${address.port}`,directory,faultFile,pid:process.pid};mkdirSync('.deploy',{recursive:true});writeFileSync('.deploy/e-a-browser.json',JSON.stringify(metadata));console.log(JSON.stringify(metadata));});
async function stop(){proxy.close();await fixture.stop();process.exit();}process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
