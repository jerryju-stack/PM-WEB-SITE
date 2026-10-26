// Patch individual OOXML cells, leaving unrelated package parts byte-for-byte intact.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
export const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',parseTagValue:false,trimValues:false});
export const list=(v:any):any[]=>v===undefined?[]:Array.isArray(v)?v:[v];
export const xml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export const unxml=(v:string)=>v.replace(/&#x([\da-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,h,d,k)=>h?String.fromCodePoint(parseInt(h,16)):d?String.fromCodePoint(+d):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[k]!));
export const attr=(s:string,k:string)=>unxml(new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s)?.[1]??'');
export function unpack(data:Uint8Array){
  if(data.length>8*1024*1024)throw Error('Excel 文件不能超过 8 MB');
  let total=0;
  return unzipSync(data,{filter:e=>{total+=e.originalSize;if(total>40*1024*1024)throw Error('Excel 解压内容过大');return true;}});
}
export const pack=(parts:Record<string,Uint8Array>)=>Buffer.from(zipSync(parts,{level:6}));
export const textPart=(parts:Record<string,Uint8Array>,name:string)=>strFromU8(parts[name]??strToU8(''));
export const putPart=(parts:Record<string,Uint8Array>,name:string,value:string)=>{parts[name]=strToU8(value);};
export const col=(n:number):string=>n?col(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):'';
export const colNum=(s:string)=>[...s.replaceAll('$','')].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
export type Cell={ref:string;attrs:string;formula?:string;value:string|number;raw:string};
export function strings(parts:Record<string,Uint8Array>){const doc=parser.parse(textPart(parts,'xl/sharedStrings.xml'));return list(doc?.sst?.si).map(v=>typeof v==='string'?v:v.t!==undefined?String(v.t?.['#text']??v.t):list(v.r).map(r=>r.t?.['#text']??r.t??'').join(''));}
export function cells(source:string,ss:string[]=[]){
 const out=new Map<string,Cell>(),masters=new Map<string,{ref:string;f:string}>();
 for(const m of source.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
  const ref=attr(m[1],'r'),body=m[2]??'',f=/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body),v=unxml(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1]??'');
  const type=attr(m[1],'t');let value:string|number=type==='s'?ss[+v]??'':type==='inlineStr'?[...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>unxml(x[1])).join(''):v!==''&&!['str','e'].includes(type)?Number(v):v;
  let formula=f?.[2]===undefined?undefined:unxml(f[2]);
  if(f&&attr(f[1],'t')==='shared'){
   const si=attr(f[1],'si');if(formula)masters.set(si,{ref,f:formula});else{const master=masters.get(si);if(!master)throw Error('Excel 共享公式无效');formula=translate(master.f,master.ref,ref);}
  }
  out.set(ref,{ref,attrs:m[1],formula,value,raw:m[0]});
 }return out;
}
export function translate(formula:string,from:string,to:string){
 const a=/([A-Z]+)(\d+)/.exec(from)!,b=/([A-Z]+)(\d+)/.exec(to)!,dx=colNum(b[1])-colNum(a[1]),dy=+b[2]-+a[2];
 // Quoted strings and structured table column names are deliberately skipped.
 return formula.replace(/"(?:[^"]|"")*"|\[[^\]]*\]|(\$?)([A-Z]{1,3})(\$?)(\d+)/g,(m,x,c,y,r)=>c?`${x}${col(colNum(c)+(x?0:dx))}${y}${+r+(y?0:dy)}`:m);
}
export function cellXml(cell:Cell,value:string|number=cell.value,formula=cell.formula){
 const attributes=cell.attrs.replace(/\s(?:t|cm|vm)="[^"]*"/g,'');
 if(value===''&&!formula)return `<c${attributes}/>`;
 return `<c${attributes}${typeof value==='string'?' t="'+(formula?'str':'inlineStr')+'"':''}>${formula?`<f>${xml(formula)}</f>`:''}${typeof value==='number'?`<v>${value}</v>`:formula?`<v>${xml(value)}</v>`:`<is><t xml:space="preserve">${xml(value)}</t></is>`}</c>`;
}
export function patchCells(source:string,map:Map<string,Cell>){
 const attrsByRow=new Map<number,string>();
 for(const m of source.matchAll(/<row\b([^>]*?)(?:\/>|>[\s\S]*?<\/row>)/g))attrsByRow.set(+attr(m[1],'r'),m[1]);
 const grouped=new Map<number,Cell[]>();for(const cell of map.values()){const r=+cell.ref.replace(/\D/g,'');if(!grouped.has(r))grouped.set(r,[]);grouped.get(r)!.push(cell);}
 const prototype=attrsByRow.get(10)??' r="10"';
 const rows=[...grouped].sort(([a],[b])=>a-b).map(([r,values])=>{
  const attributes=attrsByRow.get(r)??prototype.replace(/\br="10"/,`r="${r}"`);
  return `<row${attributes}>${values.sort((a,b)=>colNum(a.ref.replace(/\d/g,''))-colNum(b.ref.replace(/\d/g,''))).map(c=>cellXml(c)).join('')}</row>`;
 });
 return source.replace(/<sheetData>[\s\S]*?<\/sheetData>/,`<sheetData>${rows.join('')}</sheetData>`);
}
