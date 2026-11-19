import {MongoClient} from 'mongodb';
import {workspaceId} from '../workspace-session.mjs';
import {restaurantExamples} from './restaurants.mjs';

const {MONGODB_URI, MONGODB_DATABASE = 'crewconnect'} = process.env;
const shipClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'Europe/Warsaw', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
});
let connecting;
function database() {
  if (!connecting) {
    connecting = new MongoClient(MONGODB_URI, {serverSelectionTimeoutMS:5000}).connect()
      .catch(error => { connecting = undefined; throw error; });
  }
  return connecting.then(client => client.db(MONGODB_DATABASE));
}

export default async function statistics(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.writeHead(405).end();
  const send = (status, value) => res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
  try {
    const db = await database();
    const workspaces = db.collection('workspaces');
    const activeAccount = {archived:{$ne:true},'snapshot.userProfile.id':{$exists:true}};
    const bookings = db.collection('restaurantBookings');
    const reviews = db.collection('restaurantReviews');
    const session = workspaceId(req);
    const user = session && await workspaces.findOne({_id:session,...activeAccount},{projection:{_id:1}});
    const [day,time] = shipClock.format(new Date(Date.now() - 90 * 60000)).split(' ');
    const [today,now] = shipClock.format(new Date()).split(' ');
    const upcoming = {$or:[{date:{$gt:today}},{date:today,time:{$gt:now}}]};
    const [members, publicProfiles, matches, events, custom, booked, rated, ownBookings, ownReviews] = await Promise.all([
      workspaces.countDocuments(activeAccount),
      db.collection('discovery_profiles').countDocuments({example:{$ne:true}}),
      db.collection('discovery_matches').aggregate([
        {$match:{likes:{$size:2}}},
        {$lookup:{from:'discovery_profiles',localField:'likes',foreignField:'_id',as:'profiles'}},
        {$match:{profiles:{$size:2}}}, {$count:'total'}
      ]).toArray(),
      db.collection('events').find({},{projection:{slots:1,votes:1}}).toArray(),
      db.collection('restaurants').find({},{projection:{_id:0,id:1,name:1}}).toArray(),
      bookings.aggregate([{$group:{_id:'$restaurantId',bookings:{$sum:1},seats:{$sum:'$guests'},
        pastSeats:{$sum:{$cond:[{$or:[{$lt:['$date',day]},{$and:[{$eq:['$date',day]},{$lte:['$time',time]}]}]},'$guests',0]}}}}]).toArray(),
      reviews.aggregate([{$group:{_id:'$restaurantId',reviews:{$sum:1},average:{$avg:'$rating'}}}]).toArray(),
      user ? bookings.countDocuments({owner:session,...upcoming}) : null,
      user ? reviews.countDocuments({owner:session}) : null
    ]);
    let scheduled = 0;
    let signups = 0;
    for (const event of events) {
      const votes = Object.values(event.votes ?? {});
      signups += votes.length;
      if (votes.length >= 2 && event.slots.some((_,index) => votes.every(vote => vote.includes(index)))) scheduled++;
    }
    const bookingCounts = new Map(booked.map(item=>[item._id,item]));
    const reviewCounts = new Map(rated.map(item=>[item._id,item]));
    const places = [...restaurantExamples,...custom].map(place => {
      const booking = bookingCounts.get(place.id);
      const review = reviewCounts.get(place.id);
      return {id:place.id,name:place.name,bookings:booking?.bookings ?? 0,seats:booking?.seats ?? 0,
        pastSeats:booking?.pastSeats ?? 0,reviews:review?.reviews ?? 0,average:review?.average ?? null};
    });
    return send(200,{members,publicProfiles,matches:matches[0]?.total ?? 0,events:events.length,scheduled,signups,places,
      own:user ? {bookings:ownBookings,reviews:ownReviews} : null});
  } catch (error) {
    console.error('CrewConnect statistics failed',error.code ?? error.name);
    return send(503,{error:'Statystyki są chwilowo niedostępne.'});
  }
}
