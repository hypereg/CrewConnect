import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { accountSession } from '../workspace-session.mjs';

test('profile demo codes are browser-bound, expire, and can only be used once', async t => {
  const email = 'guest@example.test';
  const id = 'a'.repeat(64);
  const snapshot = {userProfile: {id: 'profile-1'}};
  const profile = {_id: id, snapshot};

  function field(path) {
    const keys = path.split('.');
    const key = keys.pop();
    return [keys.reduce((object, part) => object?.[part], profile), key];
  }
  function apply(filter, changes) {
    const matched = Object.entries(filter).every(([path, expected]) => {
      const [object, key] = field(path);
      if (typeof expected !== 'object') return object?.[key] === expected;
      if ('$exists' in expected) return (object?.[key] !== undefined) === expected.$exists;
      return object?.[key] > expected.$gt;
    });
    if (!matched) return false;
    for (const [path, value] of Object.entries(changes.$set ?? {})) {
      const [object, key] = field(path);
      object[key] = value;
    }
    for (const [path, value] of Object.entries(changes.$inc ?? {})) {
      const [object, key] = field(path);
      object[key] += value;
    }
    for (const key of Object.keys(changes.$unset ?? {})) delete profile[key];
    return true;
  }

  const store = {
    async updateOne(filter, changes) { return {matchedCount: Number(apply(filter, changes))}; },
    async findOneAndUpdate(filter, changes) { return apply(filter, changes) ? profile : null; }
  };
  const server = createServer((req, res) => accountSession(req, res, () => store)).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  function send(action, data, cookie = '', requestOrigin = origin) {
    return fetch(origin + '/api/workspace', {
      method: 'POST', headers: {origin: requestOrigin, 'Content-Type': 'application/json', cookie},
      body: JSON.stringify({action, ...data})
    });
  }

  const logout = await send('logout', {email: '  Guest@Example.Test  '}, 'crew_workspace=' + id);
  assert.equal(logout.status, 204);
  const [clearedSession, recoveryCookie] = logout.headers.getSetCookie();
  assert.match(clearedSession, /^crew_workspace=;/);
  assert.match(recoveryCookie, /; HttpOnly; SameSite=Strict; Path=\/api\/workspace;/);
  const browser = recoveryCookie.split(';')[0];
  assert.equal((await send('requestLoginCode', {email})).status, 401);
  assert.equal((await send('requestLoginCode', {email: 'other@example.test'}, browser)).status, 401);
  assert.equal((await send('requestLoginCode', {email}, browser, 'https://other.example.test')).status, 403);

  async function requestCode() {
    const issued = await send('requestLoginCode', {email}, browser);
    assert.equal(issued.status, 200);
    assert.equal(issued.headers.has('set-cookie'), false);
    const {code} = await issued.json();
    assert.match(code, /^\d{6}$/);
    return code;
  }
  const login = code => send('login', {email, code}, browser);
  let code = await requestCode();
  assert.equal((await send('login', {email, code})).status, 401);
  profile.demoLogin.expiresAt = new Date(0);
  assert.equal((await login(code)).status, 401);

  code = await requestCode();
  const wrong = code === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await login(wrong)).status, 401);
  assert.equal((await login(code)).status, 401);
  code = await requestCode();
  const responses = await Promise.all([login(code), login(code)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  const restored = responses.find(response => response.ok);
  assert.deepEqual(await restored.json(), snapshot);
  assert.match(restored.headers.getSetCookie()[0], new RegExp('^crew_workspace=' + id));
  assert.match(restored.headers.getSetCookie()[1], /^crew_demo_login=;/);

  const oldCode = 'b'.repeat(64);
  profile.recovery = createHash('sha256').update('crewconnect-recovery:' + oldCode).digest('hex');
  assert.deepEqual(await (await send('login', {code: oldCode})).json(), snapshot);
  assert.equal((await send('login', {code: oldCode})).status, 401);
});
