import { randomUUID } from 'node:crypto';
export const requestId=()=>randomUUID(); // Never accept caller-provided log identifiers.
export function errorResponse(error:any,id:string) {
  const status=[400,401,403,404,405,409,413,429].includes(error?.status)?error.status:500;
  const category=({400:'input',401:'authentication',403:'permission',404:'not_found',405:'method',409:'conflict',413:'input',429:'rate_limit'} as Record<number,string>)[status]??'internal';
  return {status,body:{error:status===500?'内部错误，请稍后重试':String(error.message),category,requestId:id}};
}
export function diagnostic(error:any,id:string,method:string|undefined) {
  // No URL, headers, bodies, SQL or error.message. Keep bounded call frames for diagnosis.
  const header=String(error?.name)+': '+String(error?.message);
  const frames=typeof error?.stack==='string'&&error.stack.startsWith(header)?error.stack.slice(header.length):'';
  return JSON.stringify({level:'error',requestId:id,method:['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method??'')?method:'OTHER',
    code:/^[A-Z0-9_]{1,48}$/.test(error?.code??'')?error.code:'INTERNAL',
    stack:frames.split('\n').filter((line:string)=>/^\s+at /.test(line)).slice(0,15).map((line:string)=>line.slice(0,400))});
}
