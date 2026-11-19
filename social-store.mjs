import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';

export function createSocialStore(uri, database) {
  const db = uri && new MongoClient(uri, {serverSelectionTimeoutMS: 5000, maxPoolSize: 5}).db(database);
  const collection = db && db.collection('demoState');
  const initial = {_id: 'social', revision: 0, voyages: [], cabins: [], accounts: [], events: [], choices: []};
  let memory = initial;
  let signingKey;

  function sessionSecret() {
    signingKey ??= (async () => {
      const settings = db.collection('socialSettings');
      const filter = {_id: 'session'};
      let record;
      try {
        record = await settings.findOneAndUpdate(filter, {$setOnInsert: {key: randomBytes(32).toString('hex')}},
          {upsert: true, returnDocument: 'after', projection: {key: 1}});
      } catch (error) {
        if (error.code !== 11000) throw error;
        record = await settings.findOne(filter, {projection: {key: 1}});
      }
      if (!/^[a-f0-9]{64}$/.test(record?.key ?? '')) throw new Error('Invalid social session secret.');
      return Buffer.from(record.key, 'hex');
    })().catch(error => {
      signingKey = undefined;
      throw error;
    });
    return signingKey;
  }

  async function read() {
    if (!collection) return structuredClone(memory);
    const current = await collection.findOne({_id: initial._id});
    if (current) return current;
    const { _id, ...defaults } = initial;
    await collection.updateOne({_id}, {$setOnInsert: defaults}, {upsert: true}).catch(error => {
      if (error.code !== 11000) throw error;
    });
    return collection.findOne({_id});
  }

  // A demo-sized snapshot keeps capacity checks and state changes in the same atomic write.
  async function change(update) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await read();
      const result = update(state);
      const {_id, revision, ...fields} = state;
      if (!collection) {
        if (memory.revision !== revision) continue;
        memory = {...state, revision: revision + 1};
        return result;
      }
      const written = await collection.updateOne({_id, revision}, {$set: fields, $inc: {revision: 1}});
      if (written.matchedCount) return result;
    }
    throw Object.assign(new Error('Dane się zmieniły. Spróbuj ponownie.'), {status: 409});
  }

  return {read, change, sessionSecret};
}
