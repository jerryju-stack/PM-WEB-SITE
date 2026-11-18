import {invalid} from './contracts.ts';
export type PageOptions={limit?:unknown;cursor?:unknown};
export function pageSize(value:unknown,fallback=50){if(value===undefined||value===null||value==='')return fallback;const n=Number(value);if(!Number.isInteger(n)||n<1||n>100)invalid('分页大小须为 1–100');return n;}
export const encodeCursor=(scope:string,position:unknown)=>Buffer.from(JSON.stringify({scope,position})).toString('base64url');
export function decodeCursor<T>(value:unknown,scope:string,valid:(position:any)=>boolean):T|undefined{
 if(value===undefined||value===null||value==='')return;
 try{if(typeof value!=='string'||value.length>4096||!/^[\w-]+$/.test(value))throw Error();const body=JSON.parse(Buffer.from(value,'base64url').toString());if(body.scope!==scope||!valid(body.position))throw Error();return body.position;}catch{invalid('分页游标无效，请刷新列表');}
}
