import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {workspaceId} from '../workspace-session.mjs';

const {MONGODB_URI, MONGODB_DATABASE = 'crewconnect'} = process.env;
const times = ['12:00', '13:30', '15:00', '17:00', '18:30', '20:00', '21:30'];
export const restaurantExamples = [
  {id: 'mesa-horizon', name: 'Mesa Horizon', cuisine: 'Kuchnia europejska', deck: 'Pokład 5',
    description: 'Bistro na wspólny lunch i kolację.', tables: [2, 2, 4, 4, 6], theme: 'ocean',
    menu: [{name:'Krem z pieczonych pomidorów', price:1900}, {name:'Dorsz z warzywami', price:4900}, {name:'Sernik cytrynowy', price:1900}]},
  {id: 'porto', name: 'Porto', cuisine: 'Kuchnia włoska', deck: 'Pokład 7',
    description: 'Pizza z pieca i makarony inspirowane śródziemnomorskimi portami.', tables: [2, 4, 4, 6], theme: 'ember',
    menu: [{name:'Bruschetta z pomidorami', price:2200}, {name:'Pizza Margherita', price:3700}, {name:'Tiramisu', price:2300}]},
  {id: 'latarnia', name: 'Latarnia', cuisine: 'Kawiarnia', deck: 'Pokład 9',
    description: 'Kawa, ciasta i małe przekąski z widokiem na morze.', tables: [2, 2, 4], theme: 'lagoon',
    menu: [{name:'Flat white', price:1400}, {name:'Tost z mozzarellą', price:2600}, {name:'Ciasto czekoladowe', price:2100}]}
];
const send = (res, status, body) => res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(body));
const clean = value => typeof value === 'string' ? value.trim() : '';
let connection;
function database() {
  if (!connection) {
    connection = new MongoClient(MONGODB_URI, {serverSelectionTimeoutMS: 5000}).connect()
      .catch(error => { connection = undefined; throw error; });
  }
  return connection.then(client => client.db(MONGODB_DATABASE));
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8192) throw new SyntaxError();
  }
  return JSON.parse(raw);
}

const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'Europe/Warsaw', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
});
function validDate(date, time) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !times.includes(time)) return false;
  const day = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(+day) || day.toISOString().slice(0, 10) !== date) return false;
  const latest = clock.format(new Date(Date.now() + 30 * 86400000)).slice(0, 10);
  return date + ' ' + time > clock.format(new Date()) && date <= latest;
}

function restaurantInput(body) {
  const name = clean(body.name), cuisine = clean(body.cuisine), deck = clean(body.deck), description = clean(body.description);
  if (!name || name.length > 65 || !cuisine || cuisine.length > 60 || !deck || deck.length > 40 || description.length > 240 ||
      !Number.isInteger(body.tableCount) || body.tableCount < 1 || body.tableCount > 20 ||
      !Array.isArray(body.menu) || body.menu.length < 1 || body.menu.length > 12) return null;
  if (!body.menu.every(item => clean(item?.name) && clean(item.name).length <= 80 &&
      Number.isInteger(item.price) && item.price >= 0 && item.price <= 100000)) return null;
  return {id:randomUUID(), name, cuisine, deck, description, theme:'ocean',
    tables:Array.from({length:body.tableCount}, (_, index) => [4, 2, 6][index % 3]),
    menu:body.menu.map(item => ({name:clean(item.name), price:item.price}))};
}

export default async function restaurants(req, res) {
  res.setHeader('Cache-Control','no-store');
  try {
    const session = workspaceId(req);
    if (!MONGODB_URI && req.method === 'GET') return send(res,200,{restaurants:restaurantExamples,times,reservations:[],canBook:false});
    const db = await database();
    const catalog = db.collection('restaurants');
    const bookings = db.collection('restaurantBookings');
    const coupons = db.collection('restaurantCoupons');
    const reviews = db.collection('restaurantReviews');
    const user = session && await db.collection('workspaces').findOne(
      {_id:session, archived:{$ne:true}, 'snapshot.userProfile.id':{$exists:true}}, {projection:{'snapshot.userProfile.name':1}});
    if (req.method === 'GET') {
      const [custom, reservations, ratings, ownReviews, ownCoupons] = await Promise.all([
        catalog.find({}, {projection:{_id:0,owner:0}}).sort({name:1}).toArray(),
        user ? bookings.find({owner:session, date:{$gte:clock.format(new Date()).slice(0,10)}},
          {projection:{_id:0,owner:0,ownSlot:0}}).sort({date:1,time:1}).toArray() : [],
        reviews.aggregate([{$group:{_id:'$restaurantId',average:{$avg:'$rating'},count:{$sum:1},
          latest:{$topN:{n:3,sortBy:{updatedAt:-1},output:{author:'$author',rating:'$rating',comment:'$comment'}}}}},
          {$project:{_id:0,restaurantId:'$_id',average:1,count:1,latest:1}}]).toArray(),
        user ? reviews.find({owner:session},{projection:{_id:0,restaurantId:1,rating:1,comment:1}}).toArray() : [],
        user ? coupons.find({owner:session,bookingId:{$exists:false},expiresAt:{$gt:new Date()}},
          {projection:{_id:0,id:1,restaurantId:1,percent:1,freeItem:1}}).toArray() : []
      ]);
      return send(res,200,{restaurants:[...restaurantExamples,...custom],times,reservations,ratings,ownReviews,ownCoupons,canBook:Boolean(user)});
    }
    if (req.method !== 'POST') return send(res,405,{error:'Niedozwolona metoda.'});
    if (!req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site' ||
        new URL(req.headers.origin).host !== req.headers.host) return send(res,403,{error:'Niedozwolone źródło.'});
    if (!user) return send(res,401,{error:'Najpierw zapisz swój profil CrewConnect.'});
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res,415,{error:'Wymagany JSON.'});
    const body = await readBody(req);
    if (body?.action === 'addRestaurant') {
      const restaurant = restaurantInput(body);
      if (!restaurant) return send(res,400,{error:'Sprawdź dane restauracji, liczbę stolików i menu.'});
      await catalog.insertOne({_id:restaurant.id,...restaurant,owner:session});
      return send(res,201,{id:restaurant.id});
    }
    if (body?.action === 'cancel') {
      if (typeof body.id !== 'string') return send(res,400,{error:'Nieprawidłowa rezerwacja.'});
      const client = await connection;
      const [today, timeNow] = clock.format(new Date()).split(' ');
      const result = await client.withSession(transaction => transaction.withTransaction(async () => {
        const removed = await bookings.findOneAndDelete({id:body.id,owner:session,
          $or:[{date:{$gt:today}},{date:today,time:{$gt:timeNow}}]},{session:transaction});
        if (removed?.couponId) {
          await coupons.updateOne({_id:removed.couponId,owner:session,bookingId:removed.id},
            {$unset:{bookingId:''}},{session:transaction});
        }
        return removed;
      }));
      return result ? send(res,200,{}) : send(res,404,{error:'Nie znaleziono Twojej nadchodzącej rezerwacji.'});
    }
    if (body?.action === 'review') {
      const {restaurantId,rating} = body;
      const comment = clean(body.comment);
      if (typeof restaurantId !== 'string' || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 360) {
        return send(res,400,{error:'Podaj ocenę od 1 do 5 i komentarz do 360 znaków.'});
      }
      if (!restaurantExamples.some(item => item.id === restaurantId) && !await catalog.findOne({_id:restaurantId})) {
        return send(res,404,{error:'Nie znaleziono restauracji.'});
      }
      await reviews.updateOne({_id:session+':'+restaurantId},{$set:{
        restaurantId,owner:session,author:user.snapshot.userProfile.name,rating,comment,updatedAt:new Date()
      }},{upsert:true});
      return send(res,200,{});
    }
    if (body?.action !== 'reserve') return send(res,400,{error:'Nieznana operacja.'});
    const {restaurantId,date,time,guests,couponId} = body;
    if (couponId && (typeof couponId !== 'string' || !/^[a-f0-9-]{36}$/.test(couponId))) return send(res,400,{error:'Nieprawidłowy kupon.'});
    if (typeof restaurantId !== 'string' || !validDate(date,time) || !Number.isInteger(guests) || guests < 1 || guests > 6) {
      return send(res,400,{error:'Wybierz przyszły termin do 30 dni i podaj liczbę osób od 1 do 6.'});
    }
    const restaurant = restaurantExamples.find(item => item.id === restaurantId) ?? await catalog.findOne({_id:restaurantId});
    if (!restaurant) return send(res,404,{error:'Nie znaleziono restauracji.'});
    const tableOptions = restaurant.tables.map((size,index) => ({size,table:index+1}))
      .filter(item => item.size >= guests).sort((a,b) => a.size-b.size);
    const ownSlot = session + ':' + restaurantId + ':' + date + ':' + time;
    await bookings.createIndex({ownSlot:1},{unique:true,sparse:true});
    for (const {table} of tableOptions) {
      const booking = {id:randomUUID(),restaurantId,restaurantName:restaurant.name,date,time,guests,table,owner:session,ownSlot};
      try {
        const stored = {_id:[restaurantId,date,time,table].join(':'),...booking};
        if (couponId) {
          const client = await connection;
          const redeemed = await client.withSession(transaction => transaction.withTransaction(async () => {
            const coupon = await coupons.findOneAndUpdate({_id:couponId,owner:session,restaurantId,bookingId:{$exists:false},expiresAt:{$gt:new Date()}},
              {$set:{bookingId:booking.id}},{session:transaction});
            if (!coupon) return null;
            const reward = coupon.freeItem ? {freeItem:coupon.freeItem} : {discount:coupon.percent};
            await bookings.insertOne({...stored,couponId,...reward},{session:transaction});
            return coupon;
          }));
          if (!redeemed) return send(res,409,{error:'Ten kupon jest nieważny lub został już użyty.'});
          if (redeemed.freeItem) booking.freeItem = redeemed.freeItem;
          else booking.discount = redeemed.percent;
        } else {
          await bookings.insertOne(stored);
        }
        const {owner, ownSlot:slot, ...publicBooking} = booking;
        return send(res,201,publicBooking);
      } catch (error) {
        if (error.code !== 11000) throw error;
        if (await bookings.findOne({ownSlot},{projection:{_id:1}})) return send(res,409,{error:'Masz już rezerwację w tym lokalu na tę godzinę.'});
      }
    }
    return send(res,409,{error:'Nie ma wolnego stolika dla tej liczby osób. Wybierz inną godzinę.'});
  } catch (error) {
    if (error instanceof SyntaxError) return send(res,400,{error:'Nieprawidłowy formularz.'});
    console.error('CrewConnect restaurants failed',error.code ?? error.name);
    return send(res,503,{error:'Restauracje są chwilowo niedostępne.'});
  }
}
