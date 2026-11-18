import {zipSync,strToU8} from 'fflate';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {annualSpecs,column} from '../../lib/finance-cqa.ts';
const xml=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function syntheticCqa(change='1',missing=false) {
  const matrix=JSON.parse(readFileSync(new URL('../../docs/validation/project-finance/P01/source-matrix.json',import.meta.url),'utf8'));
  for(const spec of Object.values<any>(matrix.sources))spec.refs={};
  const names=[...Object.values<any>(matrix.products).map(p=>p.sheet),'Financials Template','AME','Input','PM','DV cost','PV cost',...Object.values<any>(matrix.marketBoms).map(b=>b.sheet)];
  const bytes:Record<string,Uint8Array>={},records=new Map<string,Map<string,string>>();
  for(const name of names)records.set(name,new Map());
  function cell(sheet:string,address:string,value:string,formula?:string,attrs='') {
    records.get(sheet)!.set(address,'<c r="'+address+'"><f'+attrs+'>'+xml(formula??'')+'</f><v>'+value+'</v></c>');
  }
  for(const [product,p] of Object.entries<any>(matrix.products)) {
    for(let i=0;i<11;i++) {
      for(const spec of annualSpecs)cell(p.sheet,column(4+i)+spec.row,spec.row===183?'0.001':spec.row===245?'0.15':change);
      if(i)cell(p.sheet,column(4+i)+'262','1');
    }
    cell(p.sheet,'C640','1.12345678901234');cell(p.sheet,'D590','60');cell(p.sheet,'C330','0.10');
    if(missing)records.get(p.sheet)!.set('E188','<c r="E188"><f>MissingBudget</f></c>');
  }
  for(let i=0;i<11;i++) {
    if(i)cell('Financials Template',column(4+i)+'262','0');
    cell('Financials Template',column(4+i)+'349','0');
  }
  cell('Input','C8','6.7');cell('Input','C9','7.4');
  for(let row=31;row<=36;row++)for(const col of ['E','F','G','H','I','L','O'])cell('AME',col+row,col==='G'?'0.85':'1');
  for(let row=2;row<=12;row++)for(const col of ['D','E','F','G','I','J','K'])cell('PM',col+row,'1');
  for(let row=9;row<=14;row++) {
    for(let c=13;c<=33;c++)cell('DV cost',column(c)+row,'1');
    for(let c=14;c<=26;c++)cell('PV cost',column(c)+row,'1');
  }
  cell('PV cost','Y10','1','N10+$O$10+S$10+$T10',' t="shared" si="0" ref="Y10:Y14"');
  records.get('PV cost')!.set('Y11','<c r="Y11"><f t="shared" si="0"/><v>1</v></c>');
  for(const bom of Object.values<any>(matrix.marketBoms)) {
    cell(bom.sheet,'M8','2');cell(bom.sheet,'AC8','4');cell(bom.sheet,'AD8','100');
  }
  for(let i=0;i<names.length;i++) {
    const rows=new Map<string,string[]>();
    for(const [address,value] of records.get(names[i])!){const row=address.match(/\d+/)![0];if(!rows.has(row))rows.set(row,[]);rows.get(row)!.push(value);}
    bytes['xl/worksheets/sheet'+(i+1)+'.xml']=strToU8('<worksheet><sheetData>'+[...rows].map(([r,c])=>'<row r="'+r+'">'+c.join('')+'</row>').join('')+'</sheetData></worksheet>');
  }
  bytes['xl/workbook.xml']=strToU8('<workbook><sheets>'+names.map((name,i)=>'<sheet name="'+xml(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'" state="'+(name==='Financials Template'?'hidden':'visible')+'"/>').join('')+'</sheets><definedNames><definedName name="EUR">Input!$C$9</definedName><definedName name="TARIFF_PM">[1]Rates!$A$1</definedName></definedNames><externalReferences><externalReference r:id="external-first"/><externalReference r:id="external-second"/></externalReferences></workbook>');
  bytes['xl/_rels/workbook.xml.rels']=strToU8('<Relationships>'+names.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="external-first" Target="externalLinks/externalLink2.xml"/><Relationship Id="external-second" Target="externalLinks/externalLink1.xml"/></Relationships>');
  for(const i of [1,2]) {
    bytes['xl/externalLinks/externalLink'+i+'.xml']=strToU8('<externalLink><externalBook/></externalLink>');
    bytes['xl/externalLinks/_rels/externalLink'+i+'.xml.rels']=strToU8('<Relationships><Relationship Id="rId1" Target="file:///missing-synthetic-'+i+'.xlsx" TargetMode="External"/></Relationships>');
  }
  const archive=zipSync(bytes);matrix.sample.sha256=createHash('sha256').update(archive).digest('hex');return {archive,matrix};
}
