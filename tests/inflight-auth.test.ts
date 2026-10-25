import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { httpFixture } from './http-fixture.ts';

for (const revoke of ['delete', 'downgrade', 'logout'] as const) test(`slow JSON and upload recheck ${revoke} before business commit`, async () => {
  const f = await httpFixture(); const db = new DatabaseSync(join(f.directory, 'project-station.sqlite'));
  const pending: ReturnType<typeof request>[] = [];
  try {
    const password = 'Isolated-Inflight-2026';
    await f.call('users', { id: 'editor', name: 'test', role: 'editor', password }, f.cookie);
    const cookie = (await f.call('login', { id: 'editor', password })).cookie;
    const project = (await f.call('projects', { title: 'original' }, f.cookie)).data.id;
    const task = (await f.call(`projects/${project}/timing`, undefined, f.cookie)).data.tasks[0].id;
    const start = (path: string, upload: boolean) => {
      let req!: ReturnType<typeof request>;
      let ready!: () => void;
      const started = new Promise<void>(resolve => ready = resolve);
      const result = new Promise<{ status: number; body: any }>((resolve, reject) => {
        req = request(f.base + '/api/' + path, { method: upload ? 'POST' : 'PATCH', headers: { Cookie: cookie, Expect: '100-continue', 'Transfer-Encoding': 'chunked', ...(upload ? { 'X-File-Name': 'slow.txt' } : { 'Content-Type': 'application/json' }) } }, res => {
          let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
        }); req.on('error', reject); req.on('continue', ready); req.write(upload ? 'first-' : '{"title":"forbidden",'); pending.push(req);
      });
      return { result, started, end: () => req.end(upload ? 'second' : '"version":0}') };
    };
    const json = start('projects/' + project, false);
    const upload = start(`projects/${project}/tasks/${task}/attachments`, true);
    // Node emits the request handler immediately after sending automatic 100 Continue;
    // observing both interim responses proves both handlers have begun before revocation.
    await Promise.all([json.started, upload.started]);
    let intent: any;
    for (let i = 0; i < 100; i++) { intent = db.prepare("SELECT id FROM file_jobs WHERE kind='upload'").get(); if (intent && existsSync(join(f.directory, 'uploads', intent.id + '.part'))) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(intent && existsSync(join(f.directory, 'uploads', intent.id + '.part')));
    const auditBefore = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n;
    if (revoke === 'delete') assert.equal((await f.call('users', { id: 'editor' }, f.cookie, 'DELETE')).status, 200);
    if (revoke === 'logout') assert.equal((await f.call('logout', {}, cookie)).status, 200);
    if (revoke === 'downgrade') db.exec("UPDATE users SET data=json_set(data,'$.role','viewer') WHERE id='editor'");
    json.end(); upload.end();
    for (const result of await Promise.all([json.result, upload.result])) assert.equal(result.status, revoke === 'downgrade' ? 403 : 401);
    const row = db.prepare('SELECT data,version,revision FROM projects WHERE id=?').get(project)!;
    assert.equal(JSON.parse(String(row.data)).title, 'original'); assert.equal(row.version, 0); assert.equal(row.revision, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attachments').get()!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get()!.n, auditBefore);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM file_jobs').get()!.n, 0);
    assert.equal(existsSync(join(f.directory, 'uploads', intent.id)), false);
    assert.equal(readFileSync(join(f.directory, 'quarantine', 'jobs', intent.id, 'file'), 'utf8'), 'first-second');
  } finally { for (const req of pending) req.destroy(); db.close(); await f.stop(); }
});
