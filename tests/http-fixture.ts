import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
export async function httpFixture(options:{directory?:string;password?:string;trustedProxies?:string}={}) {
 const directory=options.directory??await mkdtemp(join(tmpdir(),'station-http-test-'));
 const password=options.password??'Isolated-Http-Test-2026';
 const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../server.ts',import.meta.url))],{env:{...process.env,DATA_DIR:directory,PORT:'0',ADMIN_PASSWORD:password,TRUSTED_PROXIES:options.trustedProxies??''},stdio:['ignore','pipe','pipe']});
 let base='';
 const stop=async()=>{
   if(child.pid&&child.exitCode===null&&child.signalCode===null&&!child.killed)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});
   if(base)await new Promise<void>((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:Number(new URL(base).port)});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();reject(Error('fixture port still listening'));});socket.once('timeout',()=>{socket.destroy();reject(Error('fixture port check timeout'));});socket.once('error',(error:any)=>{socket.destroy();if(error.code==='ECONNREFUSED')resolve();else reject(error);});});
 };
 let output='',errors='';
 try{base=await new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('test server startup timeout')),10000);child.stdout.on('data',chunk=>{output+=String(chunk);const match=/Local: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});child.stderr.on('data',chunk=>errors+=String(chunk));child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',()=>{clearTimeout(timer);reject(Error('test server exited: '+errors));});});}catch(error){await stop();throw error;}
 const call=async(path:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST')=>{
 const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 try {
 const login=await call('login',{id:'admin',password});if(login.status!==200)throw Error('test login failed');
 return {directory,base,call,cookie:login.cookie,stop,logs:()=>({output,errors})};
 } catch(error) { await stop();throw error; }
}
