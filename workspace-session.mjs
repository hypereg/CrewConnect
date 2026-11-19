import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

const browserCookieName = 'crew_demo_login';
const cookieAge = 31_536_000;
const codeLifetime = 10 * 60 * 1000;
const legacyCode = /^[a-f0-9]{64}$/;

function readCookie(req, name) {
  return req.headers.cookie?.match(new RegExp('(?:^|; *)' + name + '=([a-f0-9]{64})(?:;|$)'))?.[1];
}

function cookie(name, value, path) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  return name + '=' + value + '; HttpOnly; SameSite=Strict; Path=' + path +
    '; Max-Age=' + (value ? cookieAge : 0) + secure;
}

export const workspaceId = req => readCookie(req, 'crew_workspace');
export const workspaceCookie = id => cookie('crew_workspace', id, '/');
const browserCookie = token => cookie(browserCookieName, token, '/api/workspace');
const digest = value => createHash('sha256').update(value).digest('hex');
export const recoveryDigest = code => digest('crewconnect-recovery:' + code);
const codeDigest = (token, code) => createHmac('sha256', token).update(code).digest('hex');

function loginEmail(value) {
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return address.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

function sendJson(res, data) {
  return res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(data));
}

async function completeLogin(res, store, filter) {
  const account = await store.findOneAndUpdate({...filter, archived: {$ne: true}}, {$unset: {recovery: '', demoLogin: ''}},
    {projection: {_id: 1, snapshot: 1}});
  if (!account) return false;
  res.setHeader('Set-Cookie', [workspaceCookie(account._id), browserCookie('')]);
  sendJson(res, account.snapshot);
  return true;
}

export async function accountSession(req, res, getStore) {
  const origin = URL.parse(req.headers.origin ?? '');
  if (req.headers['sec-fetch-site'] === 'cross-site' || !origin || origin.host !== req.headers.host ||
      !['http:', 'https:'].includes(origin.protocol)) return res.writeHead(403).end();
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return res.writeHead(415).end();

  let data = req.body;
  if (data === undefined) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1024) return res.writeHead(413).end();
    }
    data = raw;
  }
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return res.writeHead(400).end(); }
  }

  if (data?.action === 'login' && typeof data.code === 'string' && legacyCode.test(data.code) && !data.email) {
    const recovery = recoveryDigest(data.code);
    if (!await completeLogin(res, getStore(), {recovery})) return res.writeHead(401).end();
    return;
  }

  const email = loginEmail(data?.email);
  if (!email) return res.writeHead(400).end();
  if (data.action === 'logout') {
    const id = workspaceId(req);
    if (!id) return res.writeHead(401).end();
    const token = randomBytes(32).toString('hex');
    const result = await getStore().updateOne({_id: id, archived: {$ne: true}, 'snapshot.userProfile.id': {$exists: true}},
      {$set: {demoLogin: {email, browser: digest(token)}}, $unset: {recovery: ''}});
    if (!result.matchedCount) return res.writeHead(409).end();
    res.setHeader('Set-Cookie', [workspaceCookie(''), browserCookie(token)]);
    return res.writeHead(204).end();
  }

  if (!['requestLoginCode', 'login'].includes(data.action)) return res.writeHead(400).end();
  const token = readCookie(req, browserCookieName);
  if (!token) return res.writeHead(401).end();
  const store = getStore();
  const profile = {archived: {$ne: true}, 'demoLogin.email': email, 'demoLogin.browser': digest(token)};
  if (data.action === 'requestLoginCode') {
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const result = await store.updateOne(profile, {$set: {
      'demoLogin.code': codeDigest(token, code),
      'demoLogin.expiresAt': new Date(Date.now() + codeLifetime),
      'demoLogin.attempts': 5
    }});
    if (!result.matchedCount) return res.writeHead(401).end();
    return sendJson(res, {code});
  }

  if (typeof data.code !== 'string' || !/^\d{6}$/.test(data.code)) return res.writeHead(400).end();
  const active = {...profile, 'demoLogin.expiresAt': {$gt: new Date()}, 'demoLogin.attempts': {$gt: 0}};
  if (await completeLogin(res, store, {...active, 'demoLogin.code': codeDigest(token, data.code)})) return;
  await store.updateOne(active, {$inc: {'demoLogin.attempts': -1}});
  return res.writeHead(401).end();
}
