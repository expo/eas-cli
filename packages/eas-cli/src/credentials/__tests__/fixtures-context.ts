import merge from 'lodash/merge';

import { CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { getAndroidApiMockWithoutCredentials } from './fixtures-android';
import { getAppstoreMock } from './fixtures-appstore';
import { testAppJson, testUsername } from './fixtures-constants';
import { getIosApiMockWithoutCredentials } from './fixtures-ios';
import { getNewIosApiMockWithoutCredentials } from './fixtures-new-ios';

export function createCtxMock(mockOverride: Record<string, any> = {}): Context {
  const defaultMock = {
    ios: getIosApiMockWithoutCredentials(),
    newIos: getNewIosApiMockWithoutCredentials(),
    android: getAndroidApiMockWithoutCredentials(),
    appStore: getAppstoreMock(),
    ensureAppleCtx: jest.fn(),
    ensureProjectContext: jest.fn(),
    user: {
      __typename: 'User',
      username: testUsername,
      accounts: [{ id: 'test-account-id', name: testUsername }],
    },
    hasAppleCtx: jest.fn(() => true),
    hasProjectContext: true,
    exp: testAppJson,
    projectDir: '.',
  };
  return merge(defaultMock, mockOverride) as any;
}

export function createManagerMock(mockOverride: Record<string, any> = {}): CredentialsManager {
  return merge(
    {
      runActionAsync: jest.fn(() => {
        throw new Error('unexpected call'); // should be implemented in test directly
      }),
    },
    mockOverride
  ) as any;
}
