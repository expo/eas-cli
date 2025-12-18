/**
 * TODO: Move to eas-build repo
 */
import invariant from 'invariant';

const EXPERIENCE_NAME_REGEX = /^@(.*?)\/(.*)/; // @<captureGroup1>/<captureGroup2>
const SLUG_REGEX_STRICT = /^[a-zA-Z0-9_\\-]+$/; // from xdl-schemas slug

export const isValidExperienceName = (experienceName: string): boolean => {
  const matches = experienceName.match(EXPERIENCE_NAME_REGEX);
  return matches !== null && matches[1].length > 0 && matches[2].length > 0;
};

export const experienceToAccountName = (experienceName: string): string => {
  const matches = experienceName.match(EXPERIENCE_NAME_REGEX);
  const accountName = matches ? matches[1] : null;
  invariant(accountName, `The experience name "${experienceName}" is malformed`);
  return accountName;
};

export const fullNameToSlug = (fullName: string): string | null => {
  const match = fullName.match(EXPERIENCE_NAME_REGEX);
  return match ? match[2] : null;
};

export const isValidSlugStrict = (slug: string): boolean => SLUG_REGEX_STRICT.test(slug);

// keep this list in sync with our project creation CLI https://github.com/expo/expo/blob/main/packages/create-expo/src/Template.ts
export const FORBIDDEN_NAMES = [
  'react-native',
  'react',
  'react-dom',
  'react-native-web',
  'expo',
  'expo-router',
];

export function isSlugForbidden(slug: string): boolean {
  return FORBIDDEN_NAMES.includes(slug);
}
