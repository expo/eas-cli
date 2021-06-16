import merge from 'lodash/merge';

import { Context } from '../context';
import { getNewAndroidApiMockWithoutCredentials } from './fixtures-android';
import { getAppstoreMock } from './fixtures-appstore';
import { testAppJson, testUsername } from './fixtures-constants';
import { getNewIosApiMockWithoutCredentials } from './fixtures-ios';

export function createCtxMock(mockOverride: Record<string, any> = {}): Context {
  const defaultMock = {
    ios: getNewIosApiMockWithoutCredentials(),
    android: getNewAndroidApiMockWithoutCredentials(),
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
    exp: testAppJson,
    projectDir: '.',
  };
  return merge(defaultMock, mockOverride) as any;
}
