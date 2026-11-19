import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';

const run=JSON.parse(await readFile(process.env.FINANCE_REVIEW_CASE??'.deploy/finance-workbench-review/latest-run.json','utf8'));
const base='http://127.0.0.1:'+run.port;
const finance=base+'/projects/'+run.project+'/finance';
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=createRequire(join(packages,'playwright/package.json'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless:true,args:['--no-proxy-server']});
const evidence=process.env.FINANCE_REVIEW_EVIDENCE??join(run.directory,'table-alignment');

// Match cells to logical columns, including the two-row product labels in the sales forecast.
function inspectTables(tables){
  let cells=0;
  const mismatches=[];
  for(const table of tables){
    const headers=table.tHead?.rows[0]?.cells;
    if(!headers)continue;
    const alignment=cell=>getComputedStyle(cell).textAlign;
    for(const body of table.tBodies){
      const occupiedUntil=[];
      for(const [index,row] of Array.from(body.rows).entries()){
        let column=0;
        for(const cell of row.cells){
          while(occupiedUntil[column]>index)column++;
          if(cell.colSpan===1&&headers[column]){
            cells++;
            if(alignment(cell)!==alignment(headers[column]))mismatches.push(
              (table.closest('[aria-label]')?.getAttribute('aria-label')??'Table')+' / '+headers[column].textContent.trim());
          }
          for(let n=0;n<cell.colSpan;n++)occupiedUntil[column++]=index+cell.rowSpan;
        }
      }
    }
  }
  return {tables:tables.length,cells,mismatches:[...new Set(mismatches)]};
}

// Measure the text itself, including amounts rendered inside links.
function factoryOffsets(table){
  const edge=cell=>{
    const range=document.createRange();
    range.selectNodeContents(document.createTreeWalker(cell,NodeFilter.SHOW_TEXT).nextNode());
    return range.getBoundingClientRect().right;
  };
  return [1,2].map(column=>Math.max(...Array.from(table.tBodies[0].rows,row=>
    Math.abs(edge(row.cells[column])-edge(table.tHead.rows[0].cells[column])))));
}

try{
  await mkdir(evidence,{recursive:true});
  const failures=[];
  for(const width of [1594,390]){
    const context=await browser.newContext({viewport:{width,height:width===390?844:926},hasTouch:width===390});
    const login=await context.request.post(base+'/api/login',{data:JSON.parse(await readFile(run.credentials,'utf8'))});
    assert.equal(login.status(),200);
    const page=await context.newPage();
    await page.goto(finance+'?version='+run.version);
    const navigation=page.getByRole('navigation',{name:'Finance sections'});
    await navigation.waitFor();
    const links=locator=>locator.evaluateAll(nodes=>nodes.map(node=>node.href));
    const modules=await links(navigation.locator('a'));
    assert.equal(modules.length,11);
    const seen=new Set();
    let tables=0,cells=0;
    async function visit(url){
      if(seen.has(url))return;
      seen.add(url);
      await page.goto(url);
      await navigation.waitFor();
      const result=await page.locator('#finance-workspace table').evaluateAll(inspectTables);
      tables+=result.tables;cells+=result.cells;
      if(result.mismatches.length)failures.push({width,route:new URL(url).pathname.split('/').at(-1),columns:result.mismatches});
    }
    const factory=finance+'/factory-costs?version='+run.version+'&product=center&period=year-2019';
    await visit(factory);
    const region=page.getByRole('region',{name:'Factory cost breakdown'});
    const table=region.locator('table');
    assert.deepEqual(await table.locator('thead th').allTextContents(),['Expense','Period total','Per piece']);
    const [total,perPiece]=await table.locator('tbody tr').first().locator('td').allInnerTexts();
    assert.match(total,/^-?[\d,]+\.\d{2}$/);
    assert.match(perPiece,/^-?[\d,]+\.\d{4}$/);
    await page.evaluate(()=>document.fonts.ready);
    const offsets=await table.evaluate(factoryOffsets);
    await region.screenshot({path:join(evidence,'factory-center-2019-'+width+'.png')});
    const detail=await table.locator('tbody a').first().getAttribute('href');
    await visit(new URL(detail,base).href);
    for(const module of modules){
      await visit(module);
      const tabs=await links(page.locator('.fin-sales-nav a:not([aria-current="page"])'));
      for(const tab of tabs)await visit(tab);
    }
    await visit(finance+'/compare?version='+run.version);
    console.log(width+'px: '+seen.size+' views, '+tables+' tables, '+cells+' cells. Factory right-edge offsets (px): '+offsets.join(', '));
    if(offsets.some(offset=>offset>1))failures.push({width,offsets});
    await context.close();
  }
  assert.equal(failures.length,0,'Column alignment failures (first five): '+JSON.stringify(failures.slice(0,5)));
}finally{await browser.close();}
