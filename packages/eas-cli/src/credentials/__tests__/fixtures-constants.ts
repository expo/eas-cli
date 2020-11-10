import { User } from '../../user/User';

export const jester: User = {
  username: 'jester',
  userId: 'jester-id',
  accounts: [{ id: 'jester-account-id', name: 'jester' }],
};

export const jester2: User = {
  username: 'jester2',
  userId: 'jester2-id',
  accounts: [{ id: 'jester2-account-id', name: 'jester2' }],
};

export const testUsername = jester.username;
export const testSlug = 'testApp';
export const testBundleIdentifier = 'test.com.app';
export const testPackageName = 'test.com.app';
export const testExperienceName = `@${testUsername}/${testSlug}`;
export const testJester2ExperienceName = `@${jester2.username}/${testSlug}`;
export const testAppLookupParams = {
  accountName: testUsername,
  projectName: testSlug,
  bundleIdentifier: testBundleIdentifier,
};

export const testAppJson = {
  name: 'testing 123',
  version: '0.1.0',
  slug: testSlug,
  sdkVersion: '38.0.0',
  ios: { bundleIdentifier: testBundleIdentifier },
};

export const testAppJsonWithDifferentOwner = {
  ...testAppJson,
  owner: jester2.username,
};
