import type {Store} from './database.ts';
import {CqaWorkbook} from './finance-cqa.ts';
import {reviewedFinanceAttachment,reviewedTemplateSha} from './finance-cqa-attachments.ts';

const groups:readonly {sheet:string;stage:string;roles:readonly (readonly [string,string])[]}[]=[
  {sheet:'DV cost',stage:'Europe DV',roles:[['N','PM'],['O','AE'],['P','Designer'],['Q','TE'],['R','Simulation'],['S','RE']]},
  {sheet:'DV cost',stage:'China DV',roles:[['Z','AE'],['AA','PD']]},
  {sheet:'PV cost',stage:'China PV',roles:[['P','AE'],['Q','PD'],['R','TE']]}
];

function readEvidence(bytes:Buffer) {
  const book=new CqaWorkbook(bytes);
  const quote=(sheet:string,address:string)=>{
    const cell=book.cell(sheet,address);
    return {source:sheet+'!'+address,amount:cell.state==='number'?cell.value:null};
  };
  return {
    pm:Object.fromEntries([2,6,8,10,11,12].map(row=>[row,book.cell('PM','B'+row).value?.trim()??''])),
    validation:[9,10,11,12,13,14].map(row=>({
      row,description:book.cell('DV cost','J'+row).value?.trim()??'',
      groups:groups.map(group=>({
        stage:group.stage,roles:group.roles.map(([column,label])=>{
          const cell=book.cell(group.sheet,column+row);
          return {label,hours:cell.state==='number'?cell.value:null,source:group.sheet+'!'+cell.address,formula:cell.formula!==null};
        })
      })),
      certifications:[
        {name:'3C',currency:'CNY',...quote('PV cost','V'+row),basis:'covered'},
        {name:'ECE',currency:'CNY',...quote('PV cost','W'+row),basis:'covered'},
        {name:'FMVSS',currency:'CNY',...quote('PV cost','X'+row),basis:'covered'},
        {name:'CE',currency:'CNY',...quote('PV cost','U'+row),basis:'pv'},
        {name:'Homologation',currency:'EUR',...quote('DV cost','W'+row),basis:'dv'}
      ] as const,
      pvTravel:quote('PV cost','T'+row)
    }))
  };
}

let cache:{path:string;modified:number;changed:number;sha:string;evidence:ReturnType<typeof readEvidence>}|undefined;
export function reviewedDevelopmentEvidence(store:Store,project:string) {
  const attachment=reviewedFinanceAttachment(store,project,[reviewedTemplateSha],cache);
  if(!attachment)return null;
  if(attachment.bytes){
    const {path,modified,changed,sha,bytes}=attachment;
    cache={path,modified,changed,sha,evidence:readEvidence(bytes)};
  }
  return cache?.evidence??null;
}
