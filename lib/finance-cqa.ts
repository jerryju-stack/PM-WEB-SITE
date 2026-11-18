import {XMLParser} from 'fast-xml-parser';
import {unzipSync,strFromU8} from 'fflate';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {invalid} from './contracts.ts';
import type {FixedDecimal,FinanceSnapshot,FinanceModule,FinanceSource} from './finance-contracts.ts';
import {financeSnapshot} from './finance-contracts.ts';
export const CQA_IMPORT_LIMIT=50000;
export const CQA_MAPPING_VERSION='P05.1';
const array=(x:any):any[]=>x===undefined?[]:Array.isArray(x)?x:[x];
const text=(x:any):string=>String(x&&typeof x==='object'?x['#text']??'':x??'');
const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
export function decimalText(value:string,shift=0,targetScale?:number):FixedDecimal {
  const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[Ee]([+-]?\d+))?$/.exec(value);
  if(!m||value.length>120||Math.abs(Number(m[4]??0))>100)invalid('Invalid CQA decimal');
  let n=BigInt((m![1]==='-'?'-':'')+m![2]+(m![3]??'')),scale=(m![3]?.length??0)-Number(m![4]??0)-shift;
  if(scale<0){n*=10n**BigInt(-scale);scale=0;}
  const precision=targetScale??Math.min(scale,12);
  if(scale>precision) {const divisor=10n**BigInt(scale-precision),sign=n<0n?-1n:1n,absolute=n*sign;n=(absolute/divisor+(absolute%divisor*2n>=divisor?1n:0n))*sign;}
  else n*=10n**BigInt(precision-scale);
  if(n.toString().replace('-','').length>60)invalid('CQA decimal exceeds precision');
  return {coefficient:n.toString(),scale:precision};
}
export function sharedFormula(formula:string,anchor:string,target:string):string {
  const a=/^([A-Z]+)(\d+)$/.exec(anchor)!,b=/^([A-Z]+)(\d+)$/.exec(target)!;
  const dx=columnNumber(b[1])-columnNumber(a[1]),dy=Number(b[2])-Number(a[2]);
  return formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'|(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]*)(?![A-Za-z0-9_(])/g,(match,cAbs,col,rAbs,row)=>{
    if(col===undefined)return match;
    const x=columnNumber(col)+(cAbs?0:dx),y=Number(row)+(rAbs?0:dy);
    return x<1||y<1?'#REF!':cAbs+column(x)+rAbs+y;
  });
}
export type CqaCell={address:string;type:string;raw:string|null;value:string|null;rawFormula:string|null;formula:string|null;formulaAttributes:Record<string,string>;sharedAnchor:string|null;state:'number'|'text'|'blank'|'error'|'missing_cache'};
export class CqaWorkbook {
  fingerprint:string;parts:Record<string,Uint8Array>;sheets:{name:string;path:string;state:string}[];
  names:Record<string,string>;definedNames:{name:string;localSheetId:string|null;definition:string}[]=[];
  external:{index:number;id:string;target:string;part:string;cacheSha256:string|null}[]=[];
  private parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false});
  private strings:string[];private cache=new Map<string,Map<string,CqaCell>>();
  xml(path:string):any {
    const bytes=this.parts[path];if(!bytes)invalid('Missing OOXML part: '+path);
    const s=strFromU8(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(s))invalid('Unsupported XML declaration');
    return this.parser.parse(s);
  }
  constructor(bytes:Uint8Array) {
    if(bytes.length>20*1024*1024)invalid('CQA archive exceeds 20 MiB');
    let expanded=0;
    this.parts=unzipSync(bytes,{filter(entry){expanded+=entry.originalSize;if(expanded>128*1024*1024||entry.originalSize>40*1024*1024)invalid('CQA archive expansion limit');return true;}});
    this.fingerprint=sha(bytes);
    const wb=this.xml('xl/workbook.xml').workbook;
    const rels=Object.fromEntries(array(this.xml('xl/_rels/workbook.xml.rels').Relationships.Relationship).map(r=>[r['@_Id'],r['@_Target']]));
    this.sheets=array(wb.sheets.sheet).map(s=>({name:s['@_name'],state:s['@_state']??'visible',path:posix.normalize(rels[s['@_r:id']].startsWith('/')?rels[s['@_r:id']].slice(1):'xl/'+rels[s['@_r:id']])}));
    this.strings=this.parts['xl/sharedStrings.xml']?array(this.xml('xl/sharedStrings.xml').sst.si).map(si=>si.t!==undefined?text(si.t):array(si.r).map(r=>text(r.t)).join('')):[];
    this.definedNames=array(wb.definedNames?.definedName).map(n=>({name:n['@_name'],localSheetId:n['@_localSheetId']??null,definition:text(n)}));
    this.names=Object.fromEntries(this.definedNames.filter(n=>n.localSheetId===null).map(n=>[n.name,n.definition]));
    for(const [i,ref] of array(wb.externalReferences?.externalReference).entries()) {
      const target=rels[ref['@_r:id']],cachePart=posix.normalize(target.startsWith('/')?target.slice(1):'xl/'+target);
      const path=posix.join(posix.dirname(cachePart),'_rels',posix.basename(cachePart)+'.rels');
      for(const r of array(this.xml(path).Relationships.Relationship))this.external.push({index:i+1,id:r['@_Id'],target:r['@_Target'],part:cachePart,cacheSha256:this.parts[cachePart]?sha(this.parts[cachePart]):null});
    }
  }
  cells(name:string):Map<string,CqaCell> {
    if(this.cache.has(name))return this.cache.get(name)!;
    const sheet=this.sheets.find(s=>s.name===name);if(!sheet)invalid('Missing CQA sheet: '+name);
    const all=array(this.xml(sheet!.path).worksheet.sheetData?.row).flatMap(r=>array(r.c)),anchors=new Map<string,any>();
    for(const c of all)if(c.f&&typeof c.f==='object'&&text(c.f))anchors.set(c.f['@_si'],c);
    const cells=new Map<string,CqaCell>();
    for(const c of all) {
      const type=c['@_t']??'n',raw=c.v===undefined?null:text(c.v),f=c.f,anchor=f&&typeof f==='object'&&f['@_t']==='shared'&&!text(f)?anchors.get(f['@_si']):null;
      const formula=f===undefined?null:anchor?sharedFormula(text(anchor.f),anchor['@_r'],c['@_r']):text(f),value=type==='s'?(raw===null?null:this.strings[Number(raw)]):type==='inlineStr'?text(c.is?.t):raw;
      cells.set(c['@_r'],{address:c['@_r'],type,raw,value: value??null,rawFormula:f===undefined?null:text(f),formula,formulaAttributes:f&&typeof f==='object'?Object.fromEntries(Object.entries(f).filter(([k])=>k.startsWith('@_')).map(([k,v])=>[k.slice(2),String(v)])):{},
        sharedAnchor:anchor?.['@_r']??null,state:type==='e'?'error':formula!==null&&(raw===null||raw==='')?'missing_cache':value===null||value.trim()===''?'blank':type==='n'?'number':'text'});
    }
    this.cache.set(name,cells);return cells;
  }
  cell(sheet:string,address:string):CqaCell {return this.cells(sheet).get(address)??{address,type:'n',raw:null,value:null,rawFormula:null,formula:null,formulaAttributes:{},sharedAnchor:null,state:'blank'};}
}
export function column(n:number):string {let result='';while(n){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26);}return result;}
export function columnNumber(name:string):number {return [...name].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);}
export function addresses(range:string):string[] {
  const [a,b=a]=range.split(':'),start=/^([A-Z]+)(\d+)$/.exec(a),end=/^([A-Z]+)(\d+)$/.exec(b);if(!start||!end)invalid('Invalid CQA range');
  const out:string[]=[];
  if((Number(end![2])-Number(start![2])+1)*(columnNumber(end![1])-columnNumber(start![1])+1)>20000)invalid('CQA range too large');
  for(let r=Number(start![2]);r<=Number(end![2]);r++)for(let c=columnNumber(start![1]);c<=columnNumber(end![1]);c++)out.push(column(c)+r);
  return out;
}
type AnnualSpec={row:number;field:string;module:FinanceModule;kind:'money'|'unit_price'|'quantity'|'rate';currency:string|null;unit:string;shift:number;basis:string};
export const annualSpecs:AnnualSpec[]=[
  ...[[183,'volume','quantity',null,'pieces',3],[94,'unit_sales','unit_price','CNY','CNY/piece',0],[99,'unit_material','unit_price','CNY','CNY/piece',0],[102,'unit_labor','unit_price','CNY','CNY/piece',0],
    [107,'unit_voh','unit_price','CNY','CNY/piece',0],[108,'unit_foh','unit_price','CNY','CNY/piece',0]].map(([row,field,kind,currency,unit,shift])=>({row:Number(row),field:String(field),module:(row===183||row===94?'commercial':row===99?'bom':row===102?'operations':'factory') as FinanceModule,kind:kind as any,currency:currency as string|null,unit:String(unit),shift:Number(shift),basis:'cqa_full'})),
  ...[[186,'revenue'],[187,'material'],[188,'labor'],[193,'voh'],[194,'foh'],[195,'depreciation'],[204,'factory_profit'],[209,'allocations'],[210,'net_engineering'],[212,'mpbitri']].map(([row,field])=>({row:Number(row),field:String(field),module:'budget' as const,kind:'money' as const,currency:'CNY',unit:'CNY',shift:3,basis:'cqa_full'})),
  ...[[265,'revenue'],[266,'material'],[267,'labor'],[272,'overhead'],[273,'depreciation'],[284,'net_engineering'],[285,'total_cost'],[286,'cbt'],
    [320,'inventory'],[321,'receivables'],[322,'payables'],[323,'nwc'],[338,'cbt_cash'],[339,'depreciation_addback'],[340,'signed_tax'],[341,'nwc_change'],[342,'investment_cash'],[343,'cash_flow'],[344,'cumulative_cash']].map(([row,field])=>({row:Number(row),field:String(field),module:'returns' as const,kind:'money' as const,currency:'CNY',unit:'CNY',shift:3,basis:'cqa_incremental'})),
  ...[[426,'engineering_budget','engineering'],[427,'engineering_recovery','engineering'],[430,'investment_recovery','investment'],[294,'building','investment'],[295,'machining_forming','investment'],[296,'assembly','investment'],[297,'dunnage_packaging','investment'],[298,'in_house_tooling','investment'],[299,'supplier_tooling','investment'],[300,'capex_300','investment'],[301,'signed_reimbursement','investment'],[302,'net_investment','investment']].map(([row,field,module])=>({row:Number(row),field:String(field),module:module as FinanceModule,kind:'money' as const,currency:'CNY',unit:'CNY',shift:3,basis:'cqa_incremental'})),
  {row:349,field:'cash_flow_usd',module:'returns',kind:'money',currency:'USD',unit:'USD',shift:3,basis:'cqa_incremental'},
  {row:245,field:'usd_per_cny',module:'returns',kind:'rate',currency:null,unit:'USD/CNY',shift:0,basis:'shared'}
];
export type CqaCandidate={format:'cqa-import-P05.1';sourceSha256:string;mappingVersion:string;snapshot:FinanceSnapshot;report:any};
export function buildCqaCandidate(book:CqaWorkbook,matrix:any,base:FinanceSnapshot):CqaCandidate {
  if(book.fingerprint!==matrix.sample.sha256)invalid('CQA fingerprint differs from the approved P01 source',409);
  const s:FinanceSnapshot=structuredClone(base);s.products=[];s.markets=[];s.lines=[];s.sources=[];s.inputs=[];s.events=[];
  s.basis='cqa_incremental';s.dictionaryVersion=matrix.version;s.calculationVersion='not_implemented';s.currency='USD';s.currencyScale=2;
  s.policy={currencyScales:{CNY:2,USD:2,EUR:2},cashFlowOriginPeriod:'year-0',rounding:'half_away_from_zero',rules:{importFormat:'cqa-import-P05.1',mappingVersion:CQA_MAPPING_VERSION,sourceSha256:book.fingerprint,
    cashTiming:'Year 0 immediate; annual periods at year end',asOfBasis:base.policy.rules.asOfBasis??'caller-provided as-of; not an actuals cutoff',basisNote:'CQA cash and full-cost controls retain separate basis tags; website mapping pending_finance',externalRefresh:false}};
  s.periods=matrix.sample.calendarLabels.map((label:any,ordinal:number)=>({key:ordinal===0?'year-0':'year-'+label,label:String(label),metadata:{ordinal,originalLabel:label,calendarYear:ordinal===0?null:label,dateAssumption:ordinal===0?'symbolic Year 0; no invented calendar year':null}}));
  const sources=new Map<string,FinanceSource>(),annual:any[]=[],inventory:any[]=[],issues:any[]=[],checks:any[]=[];
  const logicalSheet=(sheet:string)=>Object.entries<any>(matrix.products).find(([,p])=>p.sheet===sheet)?.[0]??Object.entries<any>(matrix.marketBoms).find(([,b])=>b.sheet===sheet)?.[0]??sha(sheet).slice(0,12);
  function source(sheet:string,address:string,group:string,unit='source_unit',currency:string|null=null,period='original source period') {
    const key='cqa:'+logicalSheet(sheet)+':'+address,cell=book.cell(sheet,address),spec=matrix.sources[group];
    const old=sources.get(key);
    if(old){const mappings=old.metadata.mappings as any[];if(!mappings.some(m=>m.group===group))mappings.push({group,status:spec.status});return old;}
    const r:FinanceSource={key,system:'cqa_archive',externalKey:sheet+'!'+address,fingerprint:book.fingerprint,sheet,cell:address,owner:spec.owners.join(' / '),
      observation:group==='line_design'?'design':cell.formula!==null?'cached':'budget',mappingStatus:spec.status,originalCurrency:currency,originalUnit:unit,originalPeriod:period,
      effectiveFrom:s.asOf,effectiveTo:null,metadata:{importFormat:'cqa-import-P05.1',mappings:[{group,status:spec.status}],raw:{type:cell.type,value:cell.raw,formula:cell.rawFormula,formulaAttributes:cell.formulaAttributes,sharedAnchor:cell.sharedAnchor},
        excel:{value:cell.value,formula:cell.formula,state:cell.state,kind:cell.formula===null?'literal':'cached_formula'},website:{value:null,status:'not_calculated'}}};
    sources.set(key,r);return r;
  }
  function input(rowKey:string,src:FinanceSource,metricKey:string,module:FinanceModule,periodKey:string,kind:AnnualSpec['kind'],unit:string,currency:string|null,shift=0,productKey:string|null=null,marketKey:string|null=null,lineKey:string|null=null) {
    const cell=book.cell(src.sheet!,src.cell!);
    src.originalCurrency=currency;
    src.originalUnit=shift===3?(kind==='quantity'?'thousand pieces':'thousand '+currency):unit;
    if(cell.state!=='number')return null;
    const value=decimalText(cell.value!,shift,kind==='money'?2:kind==='quantity'&&shift===3?0:undefined),period=s.periods.find(p=>p.key===periodKey)!;
    const item={key:rowKey,module,metricKey,productKey,marketKey,lineKey,periodKey,sourceKey:src.key,value,valueKind:kind,unit,currency,
      effectiveFrom:period.metadata.calendarYear?String(period.metadata.calendarYear)+'-01-01':s.asOf,effectiveTo:period.metadata.calendarYear?String(period.metadata.calendarYear)+'-12-31':null,
      conversion:{role:cell.formula===null?'source_literal':'excel_cached_control',sourceValue:cell.value,sourceUnit:src.originalUnit,multiplier:'1e'+shift,
        rounding:'half_away_from_zero',sourcePrecisionPreserved:true,websiteValue:null,websiteStatus:'not_calculated'}};
    s.inputs.push(item);return item;
  }
  for(const [product,p] of Object.entries<any>(matrix.products)) {
    s.products.push({key:product,label:p.label,metadata:{externalKey:p.sheet,active:true,cyclesPerUnit:p.cyclesPerUnit}});
    for(const row of p.lineRows)if(!s.lines.some(l=>l.key==='ame-line-'+row))s.lines.push({key:'ame-line-'+row,label:'AME line '+row,metadata:{externalKey:'AME!'+row,measured:false}});
    for(let i=0;i<11;i++)for(const spec of annualSpecs) {
      const address=column(4+i)+spec.row,cell=book.cell(p.sheet,address),period=s.periods[i],group=spec.module==='engineering'?'engineering':spec.module==='investment'?'investment':spec.module==='returns'?'local_cash':spec.module==='commercial'?'volume':spec.module==='operations'?'labor':spec.module==='bom'?'bom':'full_pl';
      const src=source(p.sheet,address,group,spec.shift===3?(spec.kind==='quantity'?'thousand pieces':'thousand '+spec.currency):spec.unit,spec.currency,String(period.label));
      const normalized=input('annual:'+product+':'+period.key+':'+spec.row,src,'cqa.'+spec.basis+'.'+spec.field,spec.module,period.key,spec.kind,spec.unit,spec.currency,spec.shift,product);
      annual.push({productKey:product,periodKey:period.key,originalPeriod:period.label,basis:spec.basis,metricKey:spec.field,sourceKey:src.key,sheet:p.sheet,cell:address,sourceUnit:src.originalUnit,currency:spec.currency,
        excelValue:cell.value,excelState:cell.state,normalizedValue:normalized?.value??null,websiteValue:null,websiteStatus:'not_calculated'});
    }
  }
  for(const sheet of book.sheets.filter(p=>/^Financials /.test(p.name))) {
    const active=Object.values<any>(matrix.products).some(p=>p.sheet===sheet.name);
    const volume=[...addresses('E262:N262')].map(c=>book.cell(sheet.name,c));
    const hasVolume=volume.some(c=>c.state==='number'&&BigInt(decimalText(c.value!,0,6).coefficient)!==0n);
    const cash=addresses('D349:N349').map(c=>book.cell(sheet.name,c));
    const zeroCash=cash.every(c=>c.state==='number'&&BigInt(decimalText(c.value!,0,6).coefficient)===0n);
    inventory.push({sheet:sheet.name,state:sheet.state,active,classification:active?'enabled_product':'excluded_template',hasVolume,cashContributionZero:zeroCash});
    checks.push({check:'product_scope',sheet:sheet.name,status:active===hasVolume&&(active||zeroCash)?'passed':'failed'});
    if(active!==hasVolume||(!active&&!zeroCash))issues.push({status:'blocking',code:'unexpected_product_scope',sheet:sheet.name,cell:'E262:N262 / D349:N349'});
  }
  // Every P01 locator is preserved, including labels, blank cells and unresolved Excel errors.
  for(const [group,spec] of Object.entries<any>(matrix.sources))for(const ref of Object.values<string>(spec.refs)) {
    const [template,range]=ref.split('!');
    const sheets=template==='@fin'?Object.values<any>(matrix.products).map(p=>p.sheet):template==='@bom'?Object.values<any>(matrix.marketBoms).map(b=>b.sheet):[template];
    for(const sheet of sheets)for(const address of addresses(range))source(sheet,address,group,spec.unit,null,spec.period);
  }
  for(const [market,bom] of Object.entries<any>(matrix.marketBoms)) {
    s.markets.push({key:market,label:bom.variant,metadata:{externalKey:bom.sheet,productKey:bom.product,volumeMarket:bom.volumeMarket}});
    const rows=new Set(addresses(bom.landedLines).map(a=>Number(a.match(/\d+/)![0])));
    for(const row of rows)for(const col of ['H','I','J','K','L','M','AA','AB','AC','AD','AF'])source(bom.sheet,col+row,'bom',col==='M'?'pieces':col==='AD'?'CNY tooling':col==='AC'?'CNY/piece':'source field',col==='AD'||col==='AC'?'CNY':null,'SOP BOM snapshot');
    for(const row of rows) {
      const currencyCell=book.cell(bom.sheet,'AB'+row).value?.trim(),code=currencyCell==='RMB'?'CNY':currencyCell;
      for(const [col,field,kind,unit,ccy] of [['M','quantity','quantity','pieces',null],['AA','piece_price','unit_price',(code??'unknown')+'/piece',code],['AC','landed_contribution','unit_price','CNY/piece','CNY'],['AD','tooling','money','CNY','CNY']] as const) {
        if(kind==='unit_price'&&(!ccy||!['CNY','EUR','USD'].includes(ccy)))continue;
        const src=source(bom.sheet,col+row,'bom',unit,ccy??null,'SOP BOM snapshot');
        input('bom:'+market+':'+row+':'+field,src,'cqa.bom.'+field,'bom','year-2019',kind,unit,ccy??null,0,bom.product,market);
      }
    }
  }
  for(const line of s.lines) {
    const row=Number(line.key.split('-').at(-1));
    for(const [col,field,kind,unit,currency,shift] of [['E','people','quantity','persons',null,0],['F','cycle_time','quantity','seconds/cycle',null,0],['G','oee','rate','fraction',null,0],['H','utilization','rate','fraction',null,0],['I','existing_line','money','CNY','CNY',3],['L','new_line','money','CNY','CNY',3],['O','tooling','money','CNY','CNY',3]] as const) {
      const src=source('AME',col+row,'line_design',shift===3?'thousand CNY':unit,currency,'SOP line design');
      input('ame:'+row+':'+field,src,'cqa.operations.'+field,'operations','year-2019',kind,unit,currency,shift,null,null,line.key);
    }
  }
  for(const [product,p] of Object.entries<any>(matrix.products)) {
    for(const [address,field,kind,unit] of [['C640','unit_labor','unit_price','CNY/piece'],['D590','hourly_rate','unit_price','CNY/person-hour']] as const) {
      const src=source(p.sheet,address,'labor',unit,'CNY','SOP design');input('labor:'+product+':'+field,src,'cqa.operations.'+field,'operations','year-2019',kind,unit,'CNY',0,product);
    }
    for(const row of p.pmRows)for(const col of ['D','E','F','G','I','J','K']) {
      const unit=col==='D'?'person-hour':'CNY',src=source('PM',col+row,'pm',unit,col==='D'?null:'CNY','development budget');
      input('pm:'+product+':'+col+row,src,'cqa.engineering.pm_'+col,'engineering','year-0',col==='D'?'quantity':'money',unit,col==='D'?null:'CNY',0,product);
    }
  }
  for(const [sheet,group] of [['DV cost','development_dv'],['PV cost','development_pv']] as const) {
    const last=sheet==='DV cost'?33:26,first=sheet==='DV cost'?13:14;
    for(let row=9;row<=14;row++)for(let c=first;c<=last;c++) {
      const col=column(c),hours=sheet==='DV cost'?['N','O','P','Q','R','S','Z','AA'].includes(col):['P','Q','R'].includes(col);
      const currency=hours?null:sheet==='DV cost'&&(c<=24||c>=32)?'EUR':sheet==='PV cost'&&col==='Z'?'EUR':'CNY';
      const src=source(sheet,col+row,group,hours?'person-hour':currency!,currency,'development budget');
      const product=row<=10?'outboard':row<=12?'center':row===13?'double_buckle':'single_buckle';
      input('development:'+group+':'+col+row,src,'cqa.'+group+'.'+col,sheet==='DV cost'&&col==='Y'?'prototypes':'validation','year-0',hours?'quantity':'money',hours?'person-hour':currency!,currency,0,product);
    }
  }
  for(const [cell,field,unit] of [['C8','cny_per_usd','CNY/USD'],['C9','cny_per_eur','CNY/EUR']] as const) {
    const src=source('Input',cell,'fx',unit,null,'archive exchange-rate assumption');
    input('fx:'+field,src,'cqa.fx.'+field,'returns','year-0','rate',unit,null);
  }
  for(const [product,p] of Object.entries<any>(matrix.products)) {
    const src=source(p.sheet,'C330','local_cash','annual effective fraction',null,'project valuation');
    input('discount:'+product,src,'cqa.returns.discount_rate','returns','year-0','rate','annual effective fraction',null,0,product);
  }
  // Snapshot all external links without dereferencing targets. Named external references are retained too.
  const dependencies=book.external.map(link=>({key:'external-'+link.index,...link,snapshotSourceSha256:book.fingerprint,status:'cached_external',refreshed:false}));
  const externalNames=Object.entries(book.names).filter(([,value])=>/\[\d+\]/.test(value));
  for(const src of sources.values()) {
    const effective=(src.metadata.excel as any).formula;
    src.metadata.externalDependencies=[...new Set([...(String(effective??'').match(/\[\d+\]/g)??[]),...externalNames.filter(([name])=>new RegExp('(^|[^A-Za-z0-9_])'+name.replace(/[.*+?^$()|[\]\\]/g,'\\$&')+'([^A-Za-z0-9_]|$)').test(String(effective??''))).map(([name])=>'name:'+name)])];
  }
  const coverage={dv:{sheet:'DV cost',range:'M8:AG15',scope:'package includes samples and fixtures; individual quantities to_collect'},
    pv:{sheet:'PV cost',range:'V7:X8',coveredBy:'DV',excludedFromTotal:'PV cost!Y9:Y14',formulaEvidence:addresses('Y9:Y14').map(a=>({cell:a,formula:book.cell('PV cost',a).formula}))},
    pm:{sheet:'PM',rows:Object.fromEntries(Object.entries<any>(matrix.products).map(([k,p])=>[k,p.pmRows])),split:'EU/NA shared package halves; preserve formulas and original divisor; do not add DV/PV and PM totals together'}};
  const manifest:FinanceSource={key:'cqa:manifest',system:'cqa_archive',externalKey:'workbook-manifest',fingerprint:book.fingerprint,sheet:null,cell:null,owner:'Finance',observation:'cached',mappingStatus:'mapped',
    originalCurrency:null,originalUnit:'workbook metadata',originalPeriod:'Year 0, 2019-2028',effectiveFrom:s.asOf,effectiveTo:null,metadata:{mappingVersion:CQA_MAPPING_VERSION,inventory,coverage,
      pending:['station_actual','prototype_actual','budget_actual','operating_bridge'],websiteResults:{value:null,status:'not_calculated'}}};
  sources.set(manifest.key,manifest);
  for(let i=0;i<dependencies.length;i++)sources.set('cqa:external:'+(i+1),{...manifest,key:'cqa:external:'+(i+1),externalKey:dependencies[i].key,originalUnit:'external dependency',mappingStatus:'cached_external',metadata:dependencies[i]});
  for(const definition of book.definedNames) {
    const key='cqa:name:'+sha(definition.name+':'+definition.localSheetId).slice(0,24),externalIndices=[...definition.definition.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1]));
    sources.set(key,{...manifest,key,externalKey:definition.name+(definition.localSheetId===null?'':':sheet-'+definition.localSheetId),originalUnit:'defined name',
      mappingStatus:externalIndices.length?'cached_external':'mapped',metadata:{...definition,externalIndices,snapshotSourceSha256:book.fingerprint,refreshed:false}});
  }
  s.sources=[...sources.values()];
  const counts={products:s.products.length,periods:s.periods.length,markets:s.markets.length,lines:s.lines.length,sources:s.sources.length,inputs:s.inputs.length,annualRows:annual.length,externalLinks:dependencies.length,excludedTemplates:inventory.filter(i=>!i.active).length};
  const report={counts,inventory,annual,dependencies,externalNames,definedNames:book.names,coverage,issues,checks,pending:[{code:'station_actual',status:'to_collect'},{code:'prototype_actual',status:'to_collect'},{code:'budget_actual',status:'to_collect'},{code:'operating_bridge',status:'pending_finance'}],
    websiteCalculation:{value:null,status:'not_implemented'},sourceSha256:book.fingerprint};
  return {format:'cqa-import-P05.1',sourceSha256:book.fingerprint,mappingVersion:CQA_MAPPING_VERSION,snapshot:financeSnapshot(s,CQA_IMPORT_LIMIT),report};
}
