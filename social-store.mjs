import { MongoClient } from 'mongodb';

export function createSocialStore(uri, database) {
  const collection = uri && new MongoClient(uri, {serverSelectionTimeoutMS: 5000, maxPoolSize: 5})
    .db(database).collection('demoState');
  const initial = {_id: 'social', revision: 0, voyages: [], cabins: [], accounts: [], events: [], choices: []};
  let memory = initial;

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

  return {read, change};
}
