import { generalProfile } from './general.mjs';
import { fintechProfile } from './fintech.mjs';
import { healthtechProfile } from './healthtech.mjs';
import { bpoProfile } from './bpo.mjs';
import { ecommerceProfile } from './ecommerce.mjs';

export const profiles = {
  general: generalProfile,
  fintech: fintechProfile,
  healthtech: healthtechProfile,
  bpo: bpoProfile,
  ecommerce: ecommerceProfile
};

export function getProfile(id) {
  return profiles[id] || profiles.general;
}

export function listProfiles() {
  return Object.values(profiles);
}
