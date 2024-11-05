import merge from 'ts-deepmerge';

import { getNewAndroidApiMock } from './fixtures-android';
import { getAppstoreMock } from './fixtures-appstore';
import { testAppJson, testUsername } from './fixtures-constants';
import { getNewIosApiMock } from './fixtures-ios';
import { CredentialsContext } from '../context';

export function createCtxMock(mockOverride: Record<string, any> = {}): CredentialsContext {
  const defaultMock = {
    ios: getNewIosApiMock(),
    android: getNewAndroidApiMock(),
    appStore: getAppstoreMock(),
    bestEffortAppStoreAuthenticateAsync: jest.fn(),
    ensureAppleCtx: jest.fn(),
    ensureProjectContext: jest.fn(),
    user: {
      __typename: 'User',
      username: testUsername,
      accounts: [{ id: 'test-account-id', name: testUsername }],
    },
    hasAppleCtx: jest.fn(() => true),
    hasProjectContext: true,
    getExpoConfigAsync: async () => testAppJson,
    projectDir: '.',
    getProjectIdAsync: async () => 'test-project-id',
  };
  return merge(defaultMock, mockOverride) as any;
}
