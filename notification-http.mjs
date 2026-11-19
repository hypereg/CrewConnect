import {MongoClient} from 'mongodb';
import {workspaceId} from './workspace-session.mjs';
import {discoveryId} from './discovery-profile.mjs';

const {MONGODB_URI, MONGODB_DATABASE = 'crewconnect'} = process.env;
const limit = 50;
let connection;
function database() {
  if (!connection) {
    connection = new MongoClient(MONGODB_URI, {serverSelectionTimeoutMS: 5000}).connect()
      .catch(error => { connection = undefined; throw error; });
  }
  return connection.then(client => client.db(MONGODB_DATABASE));
}
const send = (res,status,data) => res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data));

async function actionBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024) throw new SyntaxError();
  }
  return JSON.parse(raw);
}

export default async function notifications(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    const session = workspaceId(req);
    if (!session) return send(res,401,{error:'Dodaj swój profil, aby otrzymywać powiadomienia.'});
    const db = await database();
    const workspaces = db.collection('workspaces');
    const accountFilter = {_id:session,archived:{$ne:true},'snapshot.userProfile.id':{$exists:true}};
    const user = await workspaces.findOne(accountFilter,{projection:{'snapshot.userProfile.id':1,notificationState:1}});
    if (!user) return send(res,401,{error:'Profil jest niedostępny.'});
    if (req.method === 'POST') {
      if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host ||
          req.headers['sec-fetch-site'] === 'cross-site') return send(res,403,{error:'Niedozwolone źródło.'});
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res,415,{error:'Wymagany JSON.'});
      const body = await actionBody(req);
      const now = new Date();
      if (body?.action === 'clear' || body?.action === 'readAll') {
        const cutoff = typeof body.through === 'string' ? new Date(body.through) : null;
        if (!cutoff || !Number.isFinite(+cutoff) || cutoff > now) return send(res,400,{error:'Nieprawidłowa data powiadomień.'});
        const field = body.action === 'clear' ? 'clearedAt' : 'readAt';
        await workspaces.updateOne(accountFilter,{$max:{['notificationState.'+field]:cutoff}});
      } else if (body?.action === 'read' && typeof body.id === 'string' &&
          /^(event|message):[a-f0-9-]{36}$/.test(body.id)) {
        await workspaces.updateOne(accountFilter,[{$set:{'notificationState.readIds':
          {$slice:[{$concatArrays:[{$setDifference:[{$ifNull:['$notificationState.readIds',[]]},[body.id]]},[body.id]]},-100]}}}]);
      } else return send(res,400,{error:'Nieznana operacja.'});
      return send(res,200,{ok:true});
    }
    if (req.method !== 'GET') return send(res,405,{error:'Niedozwolona metoda.'});
    const now = new Date();
    const saved = user.notificationState ?? {};
    const since = new Date(Math.max(+new Date(saved.clearedAt ?? 0),+now - 30*86400000));
    const me = discoveryId(session);
    const [events,messages] = await Promise.all([
      db.collection('events').find({createdAt:{$gt:since,$lte:now},owner:{$ne:user.snapshot.userProfile.id}},
        {projection:{_id:1,title:1,createdAt:1}}).sort({createdAt:-1}).limit(limit).toArray(),
      db.collection('discovery_matches').aggregate([
        {$match:{$and:[{likes:me},{likes:{$size:2}}]}},
        {$unwind:'$messages'},
        {$match:{'messages.sender':{$ne:me},'messages.at':{$gt:since,$lte:now},'messages.deletedAt':{$exists:false}}},
        {$sort:{'messages.at':-1}},{$limit:limit},
        {$project:{_id:0,id:'$messages.id',peer:'$messages.sender',at:'$messages.at'}}
      ]).toArray()
    ]);
    const peers = await db.collection('discovery_profiles').find({_id:{$in:[...new Set(messages.map(item=>item.peer))]}},
      {projection:{name:1}}).toArray();
    const names = new Map(peers.map(item=>[item._id,item.name]));
    const seen = new Set(saved.readIds ?? []);
    const readAt = +new Date(saved.readAt ?? 0);
    const items = [
      ...events.map(item=>({id:'event:'+item._id,kind:'event',target:item._id,title:item.title,at:item.createdAt})),
      ...messages.filter(item=>names.has(item.peer)).map(item=>({
        id:'message:'+item.id,kind:'message',target:item.peer,title:names.get(item.peer),at:item.at
      }))
    ].sort((a,b)=>b.at-a.at).slice(0,limit)
      .map(item=>({...item,unread:+item.at>readAt&&!seen.has(item.id)}));
    return send(res,200,{items,through:now.toISOString()});
  } catch(error) {
    if (error instanceof SyntaxError) return send(res,400,{error:'Nieprawidłowy formularz.'});
    console.error('CrewConnect notifications failed',error.code??error.name);
    return send(res,503,{error:'Powiadomienia są chwilowo niedostępne.'});
  }
}
