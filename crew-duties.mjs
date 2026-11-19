import {createHash, timingSafeEqual} from 'node:crypto';
import {draftReport, fail, json, readBytes} from './report-draft.mjs';

const kinds = ['Warta', 'Obowiązek'];
const statuses = ['Wykonano', 'W trakcie', 'Wymaga uwagi'];
const validId = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const clean = value => typeof value === 'string' ? value.trim() : '';
const hash = value => createHash('sha256').update(value).digest();
const defaultMembers = [
  {id: 'marek', name: 'Marek Nowak'},
  {id: 'anna', name: 'Anna Kowalska'},
  {id: 'piotr', name: 'Piotr Zieliński'}
];

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+day) && day.toISOString().startsWith(value);
}

function validTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    && validDay(value.slice(0, 10));
}

function readMembers(config) {
  if (!config) return defaultMembers;
  const invalid = () => new Error('Set CREW_MEMBERS to a JSON list of crew members with unique IDs and display names.');
  let members;
  try {
    members = JSON.parse(config);
  } catch {
    throw invalid();
  }
  if (!Array.isArray(members) || !members.length || members.some(member =>
    !validId(member?.id) || !clean(member.name) || member.name.length > 100
  ) || new Set(members.map(member => member.id)).size !== members.length) throw invalid();
  return members;
}

async function snapshot(duties, reports, members, user, voiceEnabled) {
  const [records, standalone] = await Promise.all([
    duties.find().sort({starts: 1}).toArray(), reports.find().toArray()
  ]);
  const journal = standalone.map(({_id, ...report}) => ({id: _id, ...report}));
  const assignments = records.map(({_id, report, ...duty}) => {
    if (report) journal.push({
      ...report, id: _id, dutyId: _id, owner: duty.assignee,
      title: duty.title, date: duty.starts.slice(0, 10)
    });
    return {id: _id, ...duty};
  });
  return json({
    user: {id: user.id, name: user.name},
    members: members.map(({id, name}) => ({id, name})), duties: assignments, reports: journal, voiceEnabled
  });
}

async function saveDuty(duties, data, members) {
  const {id, kind, assignee, starts, ends} = data;
  const title = clean(data.title);
  if (!validId(id) || !title || title.length > 100 || !kinds.includes(kind) ||
      !members.some(person => person.id === assignee) || !validTime(starts) || !validTime(ends) || ends <= starts) {
    return fail('Sprawdź nazwę, przydział i godziny.');
  }
  try {
    await duties.updateOne({
      _id: id, $or: [{assignee}, {completed: false, report: {$exists: false}}]
    }, {
      $set: {title, kind, assignee, starts, ends}, $setOnInsert: {completed: false}
    }, {upsert: true});
    return json({});
  } catch (error) {
    if (error.code !== 11000) throw error;
    return fail('Przydział ma już wykonanie albo raport. Odśwież harmonogram.', 409);
  }
}

async function setCompletion(duties, data, user) {
  if (!validId(data.id) || typeof data.completed !== 'boolean') return fail('Podaj stan wykonania.');
  const result = await duties.updateOne({_id: data.id, assignee: user.id}, {$set: {completed: data.completed}});
  return result.matchedCount ? json({}) : fail('Ten przydział nie należy do Ciebie.', 403);
}

async function saveReport(duties, reports, data, user) {
  const {id, dutyId, status, date} = data;
  const notes = clean(data.notes);
  if (!validId(id) || !statuses.includes(status) || notes.length > 1000) {
    return fail('Sprawdź status i treść raportu.');
  }
  if (dutyId != null) {
    if (dutyId !== id) return fail('Nieprawidłowy przydział.');
    const result = await duties.updateOne({_id: dutyId, assignee: user.id}, {$set: {report: {status, notes}}});
    return result.matchedCount ? json({}) : fail('Ten przydział nie należy do Ciebie.', 403);
  }
  const title = clean(data.title);
  if (!title || title.length > 100 || !validDay(date)) return fail('Sprawdź nazwę i datę raportu.');
  try {
    await reports.updateOne({_id: id, owner: user.id}, {$set: {title, date, status, notes}}, {upsert: true});
    return json({});
  } catch (error) {
    if (error.code !== 11000) throw error;
    return fail('Ten raport nie należy do Ciebie.', 403);
  }
}

export function createDutyApi(db, {CREW_MEMBERS, CREW_PASSWORD, NVIDIA_API_KEY} = {}) {
  const members = readMembers(CREW_MEMBERS);
  const passwordHash = CREW_PASSWORD ? hash(CREW_PASSWORD) : null;
  const duties = db?.collection('crewDuties');
  const reports = db?.collection('crewDutyReports');
  const voiceEnabled = Boolean(passwordHash && NVIDIA_API_KEY);
  return async (path, request) => {
    const isSchedule = path === '/api/duties' && request.method === 'GET';
    if (isSchedule && (!db || !passwordHash)) return json({demo: true, voiceEnabled});
    if (!passwordHash) {
      return fail('Na serwerze trzeba ustawić wspólne hasło załogi.', 503);
    }
    const encoded = request.headers.get('Authorization')?.match(/^Basic ([\w+/=]{1,1024})$/)?.[1];
    const credentials = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    const separator = credentials.indexOf(':');
    if (separator === -1 || !timingSafeEqual(hash(credentials.slice(separator + 1)), passwordHash)) {
      return fail(encoded ? 'Hasło załogi jest nieprawidłowe.' : 'Zaloguj się hasłem załogi.', 401);
    }
    if (path === '/api/reports/draft' && request.method === 'POST') return draftReport(request, NVIDIA_API_KEY);
    if (!db) return fail('Wspólne zapisy wymagają bazy MongoDB.', 503);
    const memberId = credentials.slice(0, separator);
    const user = members.find(person => person.id === memberId);
    if (isSchedule) {
      return snapshot(duties, reports, members, user || members[0], voiceEnabled);
    }
    if (!user) return fail('Wybierz profil załogi.', 403);
    if (request.method !== 'POST') return fail('Nieznana operacja.', 404);
    if (request.headers.get('Content-Type') !== 'application/json') return fail('Nieprawidłowy formularz.', 415);
    const bytes = await readBytes(request, 8192);
    let data;
    try {
      data = bytes && JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return fail('Nieprawidłowy formularz.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('Nieprawidłowy formularz.');
    if (path === '/api/duties') return saveDuty(duties, data, members);
    if (path === '/api/duties/completion') return setCompletion(duties, data, user);
    if (path === '/api/reports') return saveReport(duties, reports, data, user);
    return fail('Nieznana operacja.', 404);
  };
}
