import { AppleSocialMediaAdvisory } from '../types';

/**
 * Copy social-media answers only when the caller set a boolean.
 * Missing values stay off the payload so current `@expo/apple-utils`
 * builds, which do not know these attributes, keep their existing request.
 */
export function definedSocialMediaAdvisory(
  attributes: AppleSocialMediaAdvisory
): AppleSocialMediaAdvisory {
  const advisory: AppleSocialMediaAdvisory = {};
  if (typeof attributes.socialMedia === 'boolean') {
    advisory.socialMedia = attributes.socialMedia;
  }
  if (typeof attributes.socialMediaAgeRestricted === 'boolean') {
    advisory.socialMediaAgeRestricted = attributes.socialMediaAgeRestricted;
  }
  return advisory;
}
