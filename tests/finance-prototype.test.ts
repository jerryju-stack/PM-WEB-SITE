import test from 'node:test';
import assert from 'node:assert/strict';
import {httpFixture} from './http-fixture.ts';

test('P03 sample pages and assets require the explicit preview flag', async()=>{
  for(const enabled of [false,true]) {
    const fixture=await httpFixture({env:{FINANCE_PROTOTYPE:enabled?'1':'0'}});
    try {
      for(const path of ['/finance-prototype.js','/finance-prototype.css']) {
        const response=await fetch(fixture.base+path);
        assert.equal(response.status,enabled?200:404,path);
      }
      for(const path of ['/finance','/projects/sample/finance/operations/assembly-01','/finance.js','/finance.css']) {
        assert.equal((await fetch(fixture.base+path)).status,200,path);
      }
      const home=await (await fetch(fixture.base)).text();
      assert.equal(home.includes('name="finance-prototype"'),enabled);
      const catalog=await fixture.call('data');
      assert.equal(catalog.status,200);
      assert.equal(Object.hasOwn(catalog.data,'finance'),false);
      assert.equal((await fixture.call('finance-prototype',undefined,fixture.cookie)).status,405);
    } finally {
      await fixture.stop();
    }
  }
});
