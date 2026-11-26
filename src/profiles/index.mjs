import { generalProfile } from './general.mjs';

export const profiles = {
  general: generalProfile,
};

export function getProfile(id) {
  if (id == null) return profiles.general;
  if (!Object.hasOwn(profiles, id))
    throw new Error(`Invalid profile "${id}". Valid profiles: ${Object.keys(profiles).join(', ')}`);
  return profiles[id];
}

export function listProfiles() {
  return Object.values(profiles);
}
