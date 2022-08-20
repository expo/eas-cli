import { Actor } from '../../user/User';

export const jester: Actor = {
  __typename: 'User',
  id: 'jester-id',
  username: 'jester',
  accounts: [{ id: 'jester-account-id', name: 'jester' }],
  isExpoAdmin: false,
};

export const jester2: Actor = {
  __typename: 'User',
  id: 'jester2-id',
  username: 'jester2',
  accounts: [{ id: 'jester2-account-id', name: 'jester2' }],
  isExpoAdmin: false,
};

export const testUsername = jester.username;
export const testSlug = 'testApp';
export const testProjectId = '7ef93448-3bc7-4b57-be32-99326dcf24f0';
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
  android: { package: testPackageName },
  extra: {
    eas: {
      projectId: testProjectId,
    },
  },
};

export const testAppJsonWithDifferentOwner = {
  ...testAppJson,
  owner: jester2.username,
};
