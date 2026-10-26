// Small, closed evaluator for the supplied template's formula vocabulary. No eval,
// uploaded formulas or executable content. Used to populate every formula cache.
import { col,colNum } from './timing-xml.ts';
type Node={op:string;args?:Node[];value?:any};
const number=(x:any)=>x===''?0:Number(x);
const flatten=(x:any):any[]=>Array.isArray(x)?x.flat(Infinity):[x];
export function formulaEngine(getCell:(sheet:string,ref:string)=>any,table:(column:string,row?:number)=>any[],today:number){
 const astCache=new Map<string,Node>();
 function parse(f:string):Node{
  if(astCache.has(f))return astCache.get(f)!;
  const tokens=f.replaceAll('_xlfn.','').match(/TimingTasks\[\[#This Row\],\[[^\]]+\]\]|TimingTasks\[[^\]]+\]|"(?:[^"]|"")*"|'[^']+'!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|(?:[\w\u4e00-\u9fff]+!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\d+(?:\.\d+)?|[A-Za-z_.]+|<>|<=|>=|[()+*/^&=<>%,:-]/g)??[];
  let i=0;
  const precedence:Record<string,number>={'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':5};
  function expression(min=0):Node{
   let token=tokens[i++],left:Node;
   if(token==='('){left=expression();if(tokens[i++]!==')')throw Error('公式括号错误');}
   else if(token==='-'||token==='+')left={op:'unary'+token,args:[expression(6)]};
   else if(token?.startsWith('"'))left={op:'literal',value:token.slice(1,-1).replaceAll('""','"')};
   else if(/^\d/.test(token??''))left={op:'literal',value:+token};
   else if(tokens[i]==='('){i++;const args:Node[]=[];if(tokens[i]!==')'){do{args.push(expression());if(tokens[i]!==',')break;i++;}while(true);}if(tokens[i++]!==')')throw Error('公式函数错误 '+f);left={op:token,args};}
   else left={op:'ref',value:token};
   while(i<tokens.length){const op=tokens[i],p=precedence[op];if(p===undefined||p<min)break;i++;left={op,args:[left,expression(p+1)]};}
   return left;
  }
  const node=expression();if(i!==tokens.length)throw Error('未支持的公式 '+f);astCache.set(f,node);return node;
 }
 const date=(x:number)=>new Date((x-25569)*86400000),serial=(d:Date)=>d.getTime()/86400000+25569;
 function execute(n:Node,sheet:string,row:number):any{
  const a=n.args??[],at=(i:number)=>execute(a[i],sheet,row),all=()=>a.map(x=>execute(x,sheet,row));
  if(n.op==='literal')return n.value;
  if(n.op==='ref'){
   const ref=String(n.value);
   if(ref==='TRUE')return true;if(ref==='FALSE')return false;
   if(ref.startsWith('TimingTasks[')){const current=ref.includes('#This Row'),name=current?/\],\[([^\]]+)/.exec(ref)![1]:ref.slice(12,-1);const values=table(name,current?row:undefined);return current?values[0]:values;}
   const bits=ref.split('!'),sh=bits.length>1?bits[0].replace(/^'|'$/g,''):sheet,r=bits.at(-1)!.replaceAll('$',''),range=r.split(':');
   if(range.length===1)return getCell(sh,r);
   const start=/([A-Z]+)(\d+)/.exec(range[0])!,end=/([A-Z]+)(\d+)/.exec(range[1])!,values:any[]=[];
   for(let y=+start[2];y<=+end[2];y++)for(let x=colNum(start[1]);x<=colNum(end[1]);x++)values.push(getCell(sh,col(x)+y));return values;
  }
  if(n.op==='IF')return at(0)?at(1):a[2]?at(2):false;
  if(n.op==='IFERROR'){try{return at(0);}catch{return at(1);}}
  if(n.op==='AND')return all().every(Boolean);if(n.op==='OR')return all().some(Boolean);if(n.op==='NOT')return !at(0);
  if(n.op==='unary-')return -number(at(0));if(n.op==='unary+')return number(at(0));
  if(['=','<>','<','>','<=','>='].includes(n.op)){
   const x=at(0),y=at(1),equal=typeof x===typeof y?x===y:false;
   if(n.op==='=')return equal;if(n.op==='<>')return !equal;
   return n.op==='<'?x<y:n.op==='>'?x>y:n.op==='<='?x<=y:x>=y;
  }
  if(n.op==='&')return String(at(0))+String(at(1));
  if(['+','-','*','/','^'].includes(n.op)){const x=number(at(0)),y=number(at(1));if(n.op==='/'&&!y)throw Error('#DIV/0!');return n.op==='+'?x+y:n.op==='-'?x-y:n.op==='*'?x*y:n.op==='/'?x/y:x**y;}
  const v=all(),nums=()=>v.flat(Infinity).filter(x=>typeof x==='number');
  switch(n.op){
   case 'ROW':return row;case 'ROWS':return flatten(v[0]).length;case 'TODAY':return today;
   case 'ISNUMBER':return typeof v[0]==='number';case 'LEN':return String(v[0]).length;
   case 'LEFT':return String(v[0]).slice(0,v[1]??1);case 'RIGHT':return String(v[0]).slice(-(v[1]??1));
   case 'MID':return String(v[0]).slice(v[1]-1,v[1]-1+v[2]);
   case 'FIND':{const i=String(v[1]).indexOf(String(v[0]),(v[2]??1)-1);if(i<0)throw Error('#VALUE!');return i+1;}
   case 'SUBSTITUTE':return String(v[0]).split(String(v[1])).join(String(v[2]));
   case 'VALUE':{const n=Number(v[0]);if(!Number.isFinite(n))throw Error('#VALUE!');return n;}
   case 'REPT':return String(v[0]).repeat(Math.max(0,v[1]));
   case 'ROUND':return Math.round((number(v[0])+Number.EPSILON)*10**v[1])/10**v[1];
   case 'ROUNDUP':return Math.ceil(number(v[0])*10**v[1])/10**v[1];
   case 'SUM':return nums().reduce((x,y)=>x+y,0);case 'MIN':return Math.min(...nums());case 'MAX':return Math.max(...nums());
   case 'INDEX':return flatten(v[0])[v[1]-1]??'';
   case 'MATCH':{const i=flatten(v[1]).findIndex(x=>x===v[0]);if(i<0)throw Error('#N/A');return i+1;}
   case 'COUNTIFS':case 'SUMIFS':case 'MINIFS':case 'MAXIFS':{
    const count=n.op==='COUNTIFS',offset=count?0:1,base=flatten(v[count?0:0]),matches=base.map((_,i)=>i).filter(i=>{
     for(let j=offset;j<v.length;j+=2){const cell=flatten(v[j])[i],criterion=v[j+1],m=/^(<>|<=|>=|=|<|>)(.*)$/.exec(String(criterion));
      if(!m){if(cell!==criterion)return false;continue;}let rhs:any=m[2];if(rhs!==''&&Number.isFinite(Number(rhs)))rhs=Number(rhs);
      const ok=m[1]==='='?cell===rhs:m[1]==='<>'?cell!==rhs:m[1]==='<'?cell<rhs:m[1]==='>'?cell>rhs:m[1]==='<='?cell<=rhs:cell>=rhs;if(!ok)return false;
     }return true;});
    if(count)return matches.length;const ns=matches.map(i=>number(base[i]));return n.op==='SUMIFS'?ns.reduce((x,y)=>x+y,0):ns.length?(n.op==='MINIFS'?Math.min(...ns):Math.max(...ns)):0;
   }
   case 'YEAR':return date(v[0]).getUTCFullYear();case 'MONTH':return date(v[0]).getUTCMonth()+1;
   case 'DATE':return serial(new Date(Date.UTC(v[0],v[1]-1,v[2])));
   case 'EDATE':{const d=date(v[0]),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+v[1]);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return serial(d);}
   case 'WEEKDAY':return v[1]===2?(date(v[0]).getUTCDay()+6)%7+1:date(v[0]).getUTCDay()+1;
   case 'NETWORKDAYS':{let count=0;for(let d=v[0];d<=v[1];d++)if(![0,6].includes(date(d).getUTCDay()))count++;return count;}
   case 'TEXT':{if(v[1]==='0')return String(Math.round(number(v[0])));const d=date(v[0]);return String(v[1]).replace(/yyyy|mm|dd|m|d/g,(m:string)=>m==='yyyy'?String(d.getUTCFullYear()):m==='mm'?String(d.getUTCMonth()+1).padStart(2,'0'):m==='dd'?String(d.getUTCDate()).padStart(2,'0'):m==='m'?String(d.getUTCMonth()+1):String(d.getUTCDate()));}
   default:throw Error('模板包含未支持的函数 '+n.op);
  }
 }
 return (formula:string,sheet:string,row:number)=>execute(parse(formula),sheet,row);
}
