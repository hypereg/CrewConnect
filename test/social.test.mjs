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
  delete process.env.DEMO_ADMIN_EMAIL;
  delete process.env.DEMO_ADMIN_CODE;
  const {default: social} = await import('../api/social.mjs');
  const server = createServer(social).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  function client() {
    const cookies = new Map();
    return async (action, data, expected = 200) => {
      const response = await fetch(origin + '/api/social' + (typeof action === 'string' && action.startsWith('?') ? action : ''), {
        method: data ? 'POST' : 'GET',
        headers: {cookie: [...cookies.values()].join('; '), ...(data && {'Content-Type': 'application/json', origin})},
        ...(data && {body: JSON.stringify({action, ...data})})
      });
      for (const header of response.headers.getSetCookie()) {
        const value = header.split(';', 1)[0];
        const key = value.slice(0, value.indexOf('='));
        if (value.endsWith('=')) cookies.delete(key);
        else cookies.set(key, value);
      }
      const json = await response.json();
      assert.ok([expected].flat().includes(response.status), JSON.stringify(json));
      return json;
    };
  }
  const admin = client(), planner = client(), otherPlanner = client(), guestB = client(), extra = client();
  let guestA = client();
  const login = (client, email, code, expected) => client('login', {email, code}, expected);
  const register = (client, token, name, expected) =>
    client('register', {token, email: name.toLowerCase() + '@example.test', name}, expected);
  const invite = url => new URLSearchParams(new URL(url).hash.split('?')[1]).get('kod');
  assert.deepEqual(await admin('requestLoginCode', {email: 'admin@example.test'}), {requiresAccessCode: true});
  await login(admin, 'admin@example.test', '12345');
  const {voyage} = await admin('createVoyage', {name: 'Rejs testowy', timeZone: 'Europe/Warsaw'});
  const {cabins: [cabin]} = await admin('addCabin', {label: '101', capacity: 2, voyageId: voyage.id});
  const batch = {voyageId: voyage.id, capacity: 3};
  await admin('addCabins', {...batch, labels: 'A12, 101'}, 409);
  await admin('addCabins', {...batch, labels: '102-105, 104'}, 400);
  await admin('addCabins', {...batch, labels: '300-700'}, 400);
  const added = await admin('addCabins', {...batch, labels: '002–004\nA12, 106'});
  assert.equal(added.addedCabins, 5);
  assert.deepEqual(added.cabins.slice(1).map(item => [item.label, item.capacity]),
    [['002', 3], ['003', 3], ['004', 3], ['A12', 3], ['106', 3]]);
  const {print: first} = await admin('issueQr', {id: cabin.id});
  assert.match(first.image, /^data:image\/gif;base64,/);
  const firstToken = invite(first.url);
  assert.equal((await guestA('?invite=' + firstToken)).cabin, '101');
  assert.equal((await register(guestA, firstToken, 'Ala')).user.cabin, '101');
  await register(extra, firstToken, 'Ala', 409);
  assert.equal((await extra()).user, null);
  const otherCabin = added.cabins.find(item => item.label === 'A12');
  const {print: otherInvite} = await admin('issueQr', {id: otherCabin.id});
  const otherToken = invite(otherInvite.url);
  await register(guestA, otherToken, 'Ala', 409);
  assert.equal((await guestA()).user.cabin, '101');
  for (const name of ['Iza', 'Jan']) {
    assert.equal((await register(client(), otherToken, name)).user.cabin, 'A12');
  }
  const {print: renewed} = await admin('issueQr', {id: cabin.id});
  await guestB('?invite=' + firstToken, undefined, 404);
  const renewedToken = invite(renewed.url);
  const registrations = await Promise.allSettled([register(guestB, renewedToken, 'Ola'), register(extra, renewedToken, 'Ewa')]);
  assert.equal(registrations.filter(item => item.status === 'fulfilled').length, 1);
  const guest = registrations[0].status === 'fulfilled' ? guestB : extra;
  const guestName = guest === guestB ? 'Ola' : 'Ewa';
  assert.equal((await guest('?invite=' + renewedToken)).full, true);
  assert.equal((await guestA()).user.cabin, '101');

  await guestA('logout', {});
  guestA = client();
  const guestEmail = 'ala@example.test';
  await guestA('requestLoginCode', {email: 'unknown@example.test'}, 404);
  await login(guestA, guestEmail, '123456', 401);
  const issueCode = async () => {
    const {code} = await guestA('requestLoginCode', {email: '  ALA@Example.Test  '});
    assert.match(code, /^\d{6}$/);
    assert.equal((await guestA()).user, null);
    return code;
  };
  let loginCode = await issueCode();
  await login(client(), guestEmail, loginCode, 401);
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  try {
    t.mock.timers.tick(600_001);
    await login(guestA, guestEmail, loginCode, 401);
  } finally {
    t.mock.timers.reset();
  }
  loginCode = await issueCode();
  const wrong = loginCode === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) await login(guestA, guestEmail, wrong, 401);
  await login(guestA, guestEmail, loginCode, 401);
  loginCode = await issueCode();
  const attempts = await Promise.all([login(guestA, guestEmail, loginCode, [200, 401]),
    login(guestA, guestEmail, loginCode, [200, 401])]);
  assert.equal(attempts.filter(result => result.user?.cabin === '101').length, 1);
  assert.equal(attempts.filter(result => result.error).length, 1);
  assert.equal((await guestA()).user.name, 'Ala');

  const staffA = await admin('createPlanner', {name: 'Organizator', email: 'planner@example.test'});
  const staffB = await admin('createPlanner', {name: 'Drugi planner', email: 'planner2@example.test'});
  await login(planner, staffA.plannerEmail, '123456', 401);
  await login(planner, staffA.plannerEmail, staffA.plannerCode);
  await login(otherPlanner, staffB.plannerEmail, staffB.plannerCode);
  const future = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) + 'T18:00';
  const eventFields = {title: 'Planszówki', place: 'Mesa', category: 'Gry', localTime: future(3), capacity: 1};
  const draft = (await planner('saveEvent', {...eventFields, publish: false})).events[0];
  assert.equal(draft.status, 'draft');
  assert.equal(draft.source, 'program');
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

  const meetingFields = {title: 'Kawa i rozmowy', placeId: 'cafe-promenade', category: 'Integracja', localTime: future(5)};
  await guestA('saveGuestEvent', {...meetingFields, placeId: 'wymyślone-miejsce'}, 400);
  await planner('saveGuestEvent', meetingFields, 403);
  const creations = await Promise.allSettled([
    guestA('saveGuestEvent', {...meetingFields, publish: false, place: 'Ignorowane', capacity: 1}),
    guestA('saveGuestEvent', meetingFields)
  ]);
  const published = creations.filter(item => item.status === 'fulfilled');
  assert.equal(published.length, 1);
  const meetingId = published[0].value.eventId;
  const meeting = published[0].value.events.find(item => item.id === meetingId);
  assert.deepEqual([meeting.source, meeting.status, meeting.place, meeting.deck, meeting.capacity, meeting.joined],
    ['guest', 'published', 'Café Promenade', 5, null, true]);
  await guestA('saveGuestEvent', meetingFields, 409);
  await guest('saveGuestEvent', {...meetingFields, id: meetingId, revision: meeting.revision}, 403);
  await planner('saveEvent', {...eventFields, id: meetingId, revision: meeting.revision, publish: true}, 403);
  const joined = (await guest('join', {id: meetingId})).events.find(item => item.id === meetingId);
  assert.equal(joined.joined, true);
  assert.equal(joined.count, 2);
  assert.equal(joined.attendees, undefined);
  const editFields = {...meetingFields, id: meetingId, revision: meeting.revision, placeId: 'sorrentos'};
  const edited = (await guestA('saveGuestEvent', editFields)).events.find(item => item.id === meetingId);
  assert.deepEqual(edited.changes, ['miejsce']);
  assert.deepEqual(edited.attendees, ['Ala', guestName]);
  await guestA('saveGuestEvent', editFields, 409);
  await guest('cancelEvent', {id: meetingId}, 403);
  await guestA('cancelEvent', {id: meetingId});
  assert.equal((await guest()).events.find(item => item.id === meetingId).status, 'cancelled');
  const replacement = await guestA('saveGuestEvent', meetingFields);
  await admin('cancelEvent', {id: replacement.eventId});
  assert.equal((await guestA()).events.find(item => item.id === replacement.eventId).status, 'cancelled');

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
  await planner('resetMatches', {}, 403);
  const resetBoard = await guestA('resetMatches', {});
  assert.equal(resetBoard.profiles[0].match, false);
  assert.equal(resetBoard.profiles[0].choice, undefined);
  assert.equal((await guest()).profiles[0].choice, 'connect');
  await guest('?chat=' + ala.user.id, undefined, 404);
  await guestA('choose', {id: guestProfile.user.id, choice: 'connect'});
  assert.equal((await guest('?chat=' + ala.user.id)).messages[0].text, 'Ahoj!');

  await admin('togglePlanner', {id: staffA.planners.find(item => item.email === staffA.plannerEmail).id, active: false});
  assert.equal((await planner()).user, null);
  await admin('closeVoyage', {id: voyage.id});
  await guestA('?invite=' + renewedToken, undefined, 404);
  assert.equal((await guestA()).access, false);
  assert.equal((await admin()).events[0].voyageId, voyage.id);
});
