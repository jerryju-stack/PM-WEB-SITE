import {readFileSync} from 'node:fs';
import type {Store} from './database.ts';
import type {FinanceSnapshot} from './finance-contracts.ts';
import {CqaWorkbook} from './finance-cqa.ts';
import {hasReviewedTemplate,reviewedFinanceAttachment,reviewedTemplateSha} from './finance-cqa-attachments.ts';

type Component={product:string;market:string;part:string;name:string;quantity:string;sheet:string;row:number;supplier:string};
type BomMapping={product:string;sheet:string;landedLines:string;landedTotal:string;toolingTotal:string;volumeMarket:string};
// The reviewed template uses the P01 market mapping. Match bytes before interpreting its columns.
const extractSha='183a66e76ba65405ad936af0130376213c316a7eefdae5d7e8ba1009708fc7cb';
let cached:{path:string;modified:number;changed:number;sha:string;rows:Component[]}|undefined;
let mapping:Record<string,BomMapping>|undefined;
const marketMapping=():Record<string,BomMapping>=>mapping??=JSON.parse(readFileSync(new URL('../docs/validation/project-finance/P01/source-matrix.json',import.meta.url),'utf8')).marketBoms;
const reviewedBom=(snapshot:FinanceSnapshot,period:string|undefined)=>
  snapshot.policy.rules.model!=='cash_series'&&snapshot.periods.some(row=>row.key===period&&row.metadata.calendarYear===2019)&&
  hasReviewedTemplate(snapshot);

export function bomReferences(snapshot:FinanceSnapshot,period:string|undefined) {
  if(!reviewedBom(snapshot,period))return {};
  return Object.fromEntries(Object.entries(marketMapping()).map(([market,bom])=>[market,{
    landed:bom.sheet+'!'+bom.landedTotal,tooling:bom.sheet+'!'+bom.toolingTotal,region:bom.volumeMarket
  }]));
}

function extractComponents(bytes:Buffer):Component[] {
  // Quoted fields in the RFQ extract can span physical lines.
  const text=bytes.toString('utf8').replace(/^\uFEFF/,''),records:string[][]=[];
  let record:string[]=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    }else if(!quoted&&char===','){record.push(field);field='';}
    else if(!quoted&&(char==='\r'||char==='\n')){
      if(char==='\r'&&text[i+1]==='\n')i++;
      record.push(field);records.push(record);record=[];field='';
    }else field+=char;
  }
  if(record.length||field){record.push(field);records.push(record);}
  return records.slice(1).flatMap(([product,market,sheet,number,part,en,zh,supplier,quantity])=>
    part?.trim()&&quantity?.trim()&&Number(quantity)>=0?[{product,market,sheet,row:Number(number),part:part.trim(),name:zh||en,supplier,quantity}]:[]);
}

function workbookComponents(bytes:Buffer){
  const book=new CqaWorkbook(bytes),rows:Component[]=[];
  for(const [market,mapping] of Object.entries(marketMapping())){
    const limits=/^AC(\d+):AC(\d+)$/.exec(mapping.landedLines)!;
    for(let row=Number(limits[1]);row<=Number(limits[2]);row++){
      const cell=(column:string)=>book.cell(mapping.sheet,column+row);
      const part=cell('J').value?.trim(),qty=cell('M');
      if(!part||qty.state!=='number'||!(Number(qty.value)>=0))continue;
      const supplier=[...new Set([cell('V').value,cell('AE').value].join(' ').match(/\b(?:SUP|ORG|OEM|SITE)_\d+\b/gi)??[])].join(' / ');
      rows.push({product:mapping.product,market,part,name:cell('L').value||cell('K').value||'',quantity:qty.value!,sheet:mapping.sheet,row,supplier});
    }
  }
  return rows;
}

export function sourceBomComponents(store:Store,project:string,snapshot:FinanceSnapshot,period:string|undefined):Component[] {
  if(!reviewedBom(snapshot,period))return [];
  const attachment=reviewedFinanceAttachment(store,project,[extractSha,reviewedTemplateSha],cached);
  if(!attachment)return [];
  if(attachment.bytes){
    const {path,modified,changed,bytes,sha}=attachment;
    cached={path,modified,changed,sha,rows:sha===extractSha?extractComponents(bytes):workbookComponents(bytes)};
  }
  const markets=new Map(snapshot.markets.map(row=>[row.key,row.metadata.productKey]));
  const active=new Set(snapshot.products.filter(row=>row.metadata.active!==false).map(row=>row.key));
  return (cached?.rows??[]).filter(row=>active.has(row.product)&&markets.get(row.market)===row.product);
}
