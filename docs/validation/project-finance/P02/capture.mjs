import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
const packages=process.env.PLAYWRIGHT_MODULES??join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const require=createRequire(join(packages,'playwright/package.json'));
const {chromium}=require('playwright');
const here=dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try{
  for(const design of ['A','B','C']){
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(join(here,design+'.html')).href);
    await page.waitForSelector('[data-metric="npv"] .value');
    await page.screenshot({path:join(here,design+'-desktop.png')});
    const metrics=await page.locator('.metrics').innerText();
    if(!metrics.includes('2,314.05')||!metrics.includes('22,000.00'))throw Error('Metric values differ');
    if(await page.locator('.metric').count()!==6)throw Error('Six metric groups required');
    await page.locator('[data-action="preview"]').first().click();
    await page.locator('#preview').waitFor({state:'visible'});
    if(!(await page.locator('#preview-result').innerText()).includes('-1,818.18'))throw Error('CT preview mismatch');
    await page.screenshot({path:join(here,design+'-preview.png')});
    await page.locator('#ct').fill('24');
    if(!(await page.locator('#preview-result').innerText()).includes('Favorable'))throw Error('Favorable label required');
    await page.keyboard.press('Escape');
    await page.locator('[data-info="npv"]').click();
    if(!(await page.locator('#detail-content').innerText()).includes('discount'))throw Error('English definition required');
    await page.keyboard.press('Escape');
    for(const report of ['budget','returns','compare']){
      await page.locator('.tabs [data-report="'+report+'"]').click();
      if(!await page.locator('#detail').evaluate(e=>e.open))throw Error('Report did not open');
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});
    await page.screenshot({path:join(here,design+'-mobile.png'),fullPage:true});
    await page.screenshot({path:join(here,design+'-mobile-first.png')});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflow)throw Error(design+' mobile horizontal overflow');
    await page.locator('[data-action="preview"]').first().click();
    await page.locator('#ct').fill('36');
    await page.screenshot({path:join(here,design+'-mobile-preview.png')});
    if(errors.length)throw Error(errors.join('\n'));
    const visibleText=await page.locator('body').innerText();
    if(/[\u3400-\u9fff]/u.test(visibleText))throw Error('English interface contains Chinese text');
    results.push({design,language:'en',version:'P02-v1.1',desktop:[1440,1000],mobile:[390,844],metricGroups:6,consoleErrors:errors,mobileOverflow:overflow,preview:{ct:[30,36],costDelta:2000,npvDelta:-1818.18,favorableCt:24},reports:['budget','returns','compare'],definitions:'English definitions aligned with P01',status:'passed'});
    await page.close();
  }
  await writeFile(join(here,'visual-checks.json'),JSON.stringify(results,null,2)+'\n');
  const sharp=require('sharp');
  for(const [suffix,width,height] of [['desktop',720,500],['mobile-first',390,844],['preview',720,500]]){
    const parts=[];
    for(const [i,design] of ['A','B','C'].entries()){
      const input=await sharp(join(here,design+'-'+suffix+'.png')).resize(width,height).png().toBuffer();
      parts.push({input,left:i*(width+16),top:0});
    }
    const output=suffix==='mobile-first'?'mobile':suffix;
    await sharp({create:{width:width*3+32,height,channels:4,background:'#141518'}})
      .composite(parts).png().toFile(join(here,'comparison-'+output+'.png'));
  }
}finally{await browser.close();}
