import {createHash} from 'node:crypto';

export const discoveryId = session => createHash('sha256').update('crewconnect-discovery:' + session).digest('hex');

export function discoveryFields(profile) {
  const {name, role, bio, interests, intent = '', icebreaker = '', gender = '', age = null} = profile;
  return {name, role, bio, interests, intent, icebreaker, gender, age};
}
