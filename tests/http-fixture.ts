import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function httpFixture() {
 const directory=await mkdtemp(join(tmpdir(),'station-http-test-'));
 const password='Isolated-Http-Test-2026';
 const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../server.ts',import.meta.url))],{env:{...process.env,DATA_DIR:directory,PORT:'0',ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
 const stop=async()=>{if(child.exitCode===null&&!child.killed)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});};
 let base:string;try{base=await new Promise<string>((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error('test server startup timeout')),10000);child.stdout.on('data',chunk=>{output+=String(chunk);const match=/Local: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});child.stderr.on('data',chunk=>errors+=String(chunk));child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',()=>{clearTimeout(timer);reject(Error('test server exited: '+errors));});});}catch(error){await stop();throw error;}
 const call=async(path:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST')=>{
 const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 const login=await call('login',{id:'admin',password});if(login.status!==200){await stop();throw Error('test login failed');}
 return {directory,base,call,cookie:login.cookie,stop};
}
