import { test } from 'node:test';
import assert from 'node:assert/strict';
import { address, clientAddress, trustedProxies, loginLimiter, loginLimits } from '../lib/login-security.ts';
import { createServer, request } from 'node:http';
import { httpFixture } from './http-fixture.ts';

test('only explicit proxy peers can supply a valid right-to-left forwarding chain', () => {
  const trusted = trustedProxies('127.0.0.1,::1,10.0.0.2');
  assert.equal(address('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(clientAddress('192.0.2.1', '198.51.100.1', trusted), '192.0.2.1');
  assert.equal(clientAddress('127.0.0.1', '203.0.113.9, 198.51.100.1, 10.0.0.2', trusted), '198.51.100.1');
  for (const header of ['unknown', '198.51.100.1:1234', '198.51.100.1,', Array(18).fill('10.0.0.2').join(',')]) assert.equal(clientAddress('127.0.0.1', header, trusted), '127.0.0.1');
  assert.equal(clientAddress('127.0.0.1', '198.51.100.1', new Set()), '127.0.0.1');
  assert.throws(() => trustedProxies('127.0.0.1/8'));
});
for (const trusted of [false, true]) test(`local reverse proxy ${trusted ? 'trusted' : 'untrusted'} address handling and shared-exit account separation`, async () => {
  const f = await httpFixture({ trustedProxies: trusted ? '127.0.0.1' : '' });
  // Actual loopback reverse proxy. Its explicit synthetic source is controlled only
  // by this isolated test; a deployment proxy must sanitize incoming headers.
  let forwarded = '198.51.100.10';
  const proxy = createServer((req, res) => {
    const upstream = request(f.base + req.url, { method: req.method, headers: { ...req.headers, host: new URL(f.base).host, 'x-forwarded-for': forwarded } }, response => { res.writeHead(response.statusCode!, response.headers); response.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  try {
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const port = (proxy.address() as { port: number }).port;
    const login = (id: string, password: string) => fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.250' }, body: JSON.stringify({ id, password }) });
    for (let i = 0; i < 5; i++) assert.equal((await login('missing', 'wrong')).status, 401);
    assert.equal((await login('missing', 'wrong')).status, 429);
    assert.equal((await login('admin', 'Isolated-Http-Test-2026')).status, 200);
    forwarded = '198.51.100.11';
    assert.equal((await login('missing', 'wrong')).status, trusted ? 401 : 429);
  } finally {
    await new Promise<void>(resolve => { proxy.close(() => resolve()); proxy.closeAllConnections(); }); await f.stop();
  }
});
test('pair backoff and account attacks do not lightly block another account on a shared source; expiry and memory are bounded', () => {
  let time = 0; const limiter = loginLimiter(() => time);
  for (let i = 0; i < 10; i++) limiter.failure('shared', 'attacked');
  assert.equal(limiter.check('shared', 'attacked'), false);
  assert.equal(limiter.check('shared', 'other'), true);
  for (let i = 0; i < 40; i++) limiter.failure('source-' + i, 'attacked');
  assert.equal(limiter.check('new-source', 'attacked'), false);
  time = loginLimits.windowMs; limiter.cleanup(); assert.equal(limiter.size(), 0);
  assert.equal(limiter.check('shared', 'attacked'), true);
  for (let i = 0; i < 15_000; i++) limiter.failure('source-' + i, 'account-' + i);
  assert.ok(limiter.size() <= loginLimits.maxEntries);
  assert.equal(limiter.check('fresh', 'fresh'), false);
  time += loginLimits.windowMs; assert.equal(limiter.check('fresh', 'fresh'), true);
  assert.equal(loginLimiter(() => time).size(), 0);
});
