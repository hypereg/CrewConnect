import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

test('shared cruise workflow enforces cabin capacity, event limits and role ownership', async t => {
  delete process.env.VERCEL;
  process.env.NODE_ENV = 'test';
  delete process.env.SOCIAL_MONGODB_URI;
  delete process.env.MONGODB_URI;
  process.env.SOCIAL_MONGODB_DATABASE = 'crewconnect_social_test_' + Date.now();
  process.env.DEMO_ADMIN_EMAIL = 'admin@example.test';
  process.env.DEMO_ADMIN_CODE = 'crew-admin-demo';
  const {default: social} = await import('../api/social.mjs');
  const server = createServer(social).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  function client() {
    let cookie;
    return async (action, data, expected = 200) => {
      const response = await fetch(origin + '/api/social' + (typeof action === 'string' && action.startsWith('?') ? action : ''), {
        method: data ? 'POST' : 'GET',
        headers: {...(cookie && {cookie}), ...(data && {'Content-Type': 'application/json', origin})},
        ...(data && {body: JSON.stringify({action, ...data})})
      });
      const nextCookie = response.headers.get('set-cookie');
      if (nextCookie) cookie = nextCookie.split(';', 1)[0];
      const json = await response.json();
      assert.equal(response.status, expected, JSON.stringify(json));
      return json;
    };
  }
  const admin = client(), planner = client(), otherPlanner = client(), guestA = client(), guestB = client(), extra = client();
  const login = (client, email, code, expected) => client('login', {email, code}, expected);
  const register = (client, token, name, expected) =>
    client('register', {token, email: name.toLowerCase() + '@example.test', name, code: '123456'}, expected);
  const invite = url => new URLSearchParams(new URL(url).hash.split('?')[1]).get('kod');
  await login(admin, 'admin@example.test', 'crew-admin-demo');
  const {voyage} = await admin('createVoyage', {name: 'Rejs testowy', timeZone: 'Europe/Warsaw'});
  const {cabins: [cabin]} = await admin('addCabin', {label: '101', capacity: 2, voyageId: voyage.id});
  const {print: first} = await admin('issueQr', {id: cabin.id});
  assert.match(first.image, /^data:image\/gif;base64,/);
  const firstToken = invite(first.url);
  assert.equal((await guestA('?invite=' + firstToken)).cabin, '101');
  assert.equal((await register(guestA, firstToken, 'Ala')).user.cabin, '101');
  const {print: renewed} = await admin('issueQr', {id: cabin.id});
  await guestB('?invite=' + firstToken, undefined, 404);
  const renewedToken = invite(renewed.url);
  const registrations = await Promise.allSettled([register(guestB, renewedToken, 'Ola'), register(extra, renewedToken, 'Ewa')]);
  assert.equal(registrations.filter(item => item.status === 'fulfilled').length, 1);
  const guest = registrations[0].status === 'fulfilled' ? guestB : extra;
  const guestName = guest === guestB ? 'Ola' : 'Ewa';
  assert.equal((await guest('?invite=' + renewedToken)).full, true);
  assert.equal((await guestA()).user.cabin, '101');

  const staffA = await admin('createPlanner', {name: 'Organizator', email: 'planner@example.test'});
  const staffB = await admin('createPlanner', {name: 'Drugi planner', email: 'planner2@example.test'});
  await login(planner, staffA.plannerEmail, '123456', 401);
  await login(planner, staffA.plannerEmail, staffA.plannerCode);
  await login(otherPlanner, staffB.plannerEmail, staffB.plannerCode);
  const future = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) + 'T18:00';
  const eventFields = {title: 'Planszówki', place: 'Mesa', category: 'Gry', localTime: future(3), capacity: 1};
  const draft = (await planner('saveEvent', {...eventFields, publish: false})).events[0];
  assert.equal(draft.status, 'draft');
  assert.deepEqual((await guest()).events, []);
  await guest('saveEvent', {...eventFields, publish: true}, 403);
  const event = (await planner('saveEvent', {...eventFields, id: draft.id, revision: draft.revision, publish: true})).events[0];
  assert.equal((await guest()).events[0].title, 'Planszówki');
  assert.equal((await guest()).events[0].attendees, undefined);
  await otherPlanner('cancelEvent', {id: event.id}, 403);
  const bookings = await Promise.allSettled([guestA('join', {id: event.id}), guest('join', {id: event.id})]);
  assert.equal(bookings.filter(item => item.status === 'fulfilled').length, 1);
  const winner = bookings[0].status === 'fulfilled' ? guestA : guest;
  const loser = winner === guestA ? guest : guestA;
  await loser('join', {id: event.id}, 409);
  assert.deepEqual((await planner()).events[0].attendees, [winner === guestA ? 'Ala' : guestName]);
  await planner('saveEvent', {...eventFields, localTime: future(4), place: 'Pokład', id: event.id, revision: event.revision, publish: true});
  assert.deepEqual((await winner()).events[0].changes, ['termin', 'miejsce']);
  assert.equal((await winner()).events[0].joined, true);
  await planner('cancelEvent', {id: event.id});
  assert.equal((await winner()).events[0].status, 'cancelled');
  assert.deepEqual((await loser()).events, []);

  const ala = await guestA('profile', {name: 'Ala', bio: 'Lubię gry', interests: 'Planszówki', visible: true});
  const guestProfile = await guest('profile', {name: guestName, visible: true});
  await guestA('choose', {id: guestProfile.user.id, choice: 'connect'});
  assert.equal((await guestA()).profiles[0].match, false);
  await guestA('sendMessage', {id: guestProfile.user.id, message: 'Ahoj!'}, 404);
  await guest('choose', {id: ala.user.id, choice: 'connect'});
  assert.equal((await guestA()).profiles[0].match, true);
  assert.equal((await guestA()).profiles[0].cabin, undefined);
  await guestA('sendMessage', {id: guestProfile.user.id, message: 'Ahoj!'});
  assert.equal((await guest('?chat=' + ala.user.id)).messages[0].text, 'Ahoj!');
  await planner('?chat=' + ala.user.id, undefined, 404);

  await admin('togglePlanner', {id: staffA.planners.find(item => item.email === staffA.plannerEmail).id, active: false});
  assert.equal((await planner()).user, null);
  await admin('closeVoyage', {id: voyage.id});
  await guestA('?invite=' + renewedToken, undefined, 404);
  assert.equal((await guestA()).access, false);
  assert.equal((await admin()).events[0].voyageId, voyage.id);
});
