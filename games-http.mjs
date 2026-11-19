import {randomInt,randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {workspaceId} from './workspace-session.mjs';
import {restaurantExamples} from './api/restaurants.mjs';

const {MONGODB_URI,MONGODB_DATABASE='crewconnect'}=process.env;
const welcomeLimit=3;
const send=(res,status,data)=>res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data));
let connecting;
function mongoClient(){
  if(!connecting){
    connecting=new MongoClient(MONGODB_URI,{serverSelectionTimeoutMS:5000}).connect()
      .catch(error=>{connecting=undefined;throw error;});
  }
  return connecting;
}

export default async function games(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    if(!['GET','POST'].includes(req.method)) return send(res,405,{error:'Niedozwolona metoda.'});
    const owner=workspaceId(req);
    if(!owner) return send(res,401,{error:'Zapisz swój profil, aby wziąć udział w losowaniu.'});
    const client=await mongoClient();
    const db=client.db(MONGODB_DATABASE);
    const profile=await db.collection('workspaces').findOne({_id:owner,archived:{$ne:true},
      'snapshot.userProfile.id':{$exists:true}},{projection:{_id:1}});
    if(!profile) return send(res,401,{error:'Zapisz swój profil, aby wziąć udział w losowaniu.'});
    const progress=db.collection('gameSpins');
    const coupons=db.collection('restaurantCoupons');
    const key='welcome:'+owner;
    if(req.method==='GET'){
      const [welcome,available]=await Promise.all([
        progress.findOne({_id:key}),
        coupons.find({owner,expiresAt:{$gt:new Date()}},{projection:{_id:0,owner:0}}).sort({expiresAt:1}).toArray()
      ]);
      return send(res,200,{remaining:Math.max(0,welcomeLimit-(welcome?.spins??0)),coupons:available});
    }
    if(!req.headers.origin || new URL(req.headers.origin).host!==req.headers.host ||
        req.headers['sec-fetch-site']==='cross-site') return send(res,403,{error:'Niedozwolone źródło.'});
    await progress.updateOne({_id:key},{$setOnInsert:{spins:0,won:false}},{upsert:true}).catch(error=>{
      if(error.code!==11000)throw error;
    });
    const result=await client.withSession(session=>session.withTransaction(async()=>{
      const welcome=await progress.findOne({_id:key},{session});
      if((welcome?.spins??0)>=welcomeLimit) return null;
      const win=!welcome?.won && randomInt(4)===0;
      await progress.updateOne({_id:key},{$inc:{spins:1},$set:{won:Boolean(welcome?.won||win)}},{session});
      let coupon=null;
      if(win){
        const restaurant=restaurantExamples[randomInt(restaurantExamples.length)];
        coupon={id:randomUUID(),restaurantId:restaurant.id,restaurantName:restaurant.name,
          freeItem:restaurant.menu.at(-1).name,expiresAt:new Date(Date.now()+7*86400000)};
        await coupons.insertOne({_id:coupon.id,owner,...coupon},{session});
      }
      return {coupon,remaining:welcomeLimit-(welcome?.spins??0)-1};
    }));
    return result?send(res,200,result):send(res,409,{error:'Wykorzystano wszystkie trzy losowania powitalne.'});
  }catch(error){
    console.error('CrewConnect welcome draw failed',error.code??error.name);
    return send(res,503,{error:'Losowanie jest chwilowo niedostępne.'});
  }
}
