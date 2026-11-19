import type {Store} from './database.ts';
import {CqaWorkbook} from './finance-cqa.ts';
import {reviewedFinanceAttachment,reviewedTemplateSha} from './finance-cqa-attachments.ts';
import {Decimal,sum} from './finance-decimal.ts';

function readControls(bytes:Buffer) {
  const book=new CqaWorkbook(bytes);
  const irr=book.cell('Exec Sum ','D161');
  const cells=['Financials RO Ret_SPR4','Financials RC Retr_FS1','Financials Dbl BK+SW','Financials Sgl BK+SW']
    .map(sheet=>book.cell(sheet,'N343'));
  const terminal=cells.every(cell=>cell.state==='number')?
    sum(cells.map(cell=>Decimal.from(cell.value!))).mul(Decimal.from(1000)).text(8):null;
  return {irr:irr.state==='number'?Decimal.from(irr.value!).mul(Decimal.from(100)).text(6):null,
    terminal,currency:'CNY',irrSource:'Exec Sum !D161',cashSource:'Four product Financials sheets · N343'};
}

let cache:{path:string;modified:number;changed:number;sha:string;data:ReturnType<typeof readControls>}|undefined;
export function reviewedReturnControls(store:Store,project:string) {
  const attachment=reviewedFinanceAttachment(store,project,[reviewedTemplateSha],cache);
  if(!attachment)return null;
  if(attachment.bytes){
    const {path,modified,changed,sha,bytes}=attachment;
    cache={path,modified,changed,sha,data:readControls(bytes)};
  }
  return cache?.data??null;
}
