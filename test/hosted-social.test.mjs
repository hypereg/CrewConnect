import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';

test('hosted events reuse the existing admin login and keep sessions valid across instances', async t => {
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = 'mongodb://localhost:27017';
  process.env.MONGODB_DATABASE = 'crewconnect_test';
  delete process.env.SOCIAL_MONGODB_URI;
  delete process.env.SOCIAL_MONGODB_DATABASE;
  delete process.env.DEMO_ADMIN_EMAIL;
  delete process.env.DEMO_ADMIN_CODE;
  delete process.env.DEMO_SESSION_SECRET;

  const key = randomBytes(32).toString('hex');
  let admin;
  let settings;
  const state = {voyages: [], cabins: [], events: [], accounts: [], choices: []};
  t.mock.method(MongoClient.prototype, 'connect', async function () { return this; });
  t.mock.method(MongoClient.prototype, 'db', name => ({
    collection(collection) {
      if (name === 'crewconnect_test') {
        assert.equal(collection, 'crewAdminConfig');
        return {findOne: async () => admin};
      }
      assert.equal(name, 'crewconnect_test_social_demo');
      if (collection === 'socialSettings') {
        return {findOneAndUpdate: async (filter, update) => {
          assert.deepEqual(filter, {_id: 'session'});
          settings ??= update.$setOnInsert;
          return settings;
        }};
      }
      assert.equal(collection, 'demoState');
      return {findOne: async () => structuredClone(state)};
    }
  }));

  async function originFor(handler) {
    const server = createServer(handler).listen(0, '127.0.0.1');
    t.after(() => server.close());
    await once(server, 'listening');
    return 'http://127.0.0.1:' + server.address().port;
  }
  const primary = await originFor((await import('../api/social.mjs')).default);
  const replica = await originFor((await import('../api/social.mjs?replica')).default);
  const getBoard = (origin, headers) => fetch(origin + '/api/social', {headers});
  const login = code => fetch(primary + '/api/social', {
    method: 'POST', headers: {'Content-Type': 'application/json', origin: primary},
    body: JSON.stringify({action: 'login', email: 'admin@example.test', code})
  });

  const unavailable = await getBoard(primary);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'DEMO_NOT_CONFIGURED');
  assert.equal(settings, undefined);

  admin = {digest: createHash('sha256').update('crewconnect-admin:' + key).digest('hex')};
  assert.deepEqual(await (await getBoard(primary)).json(), {user: null});
  assert.equal((await login('12345')).status, 401);
  const signedIn = await login(key);
  assert.equal(signedIn.status, 200);
  const session = signedIn.headers.getSetCookie()[0];
  assert.match(session, /; Secure$/);
  const remote = await getBoard(replica, {cookie: session.split(';')[0]});
  assert.equal((await remote.json()).user.role, 'admin');
});
