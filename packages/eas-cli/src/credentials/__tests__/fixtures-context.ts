import merge from 'ts-deepmerge';

import { TargetCredentialsContext } from '../context';
import { getNewAndroidApiMock } from './fixtures-android';
import { getAppstoreMock } from './fixtures-appstore';
import { testAppJson, testUsername } from './fixtures-constants';
import { getNewIosApiMock, testTarget } from './fixtures-ios';

export function createCtxMock(mockOverride: Record<string, any> = {}): TargetCredentialsContext {
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
    exp: testAppJson,
    projectDir: '.',
    createTargetContext: jest.fn(() => createCtxMock(mockOverride)),
    target: testTarget,
  };
  return merge(defaultMock, mockOverride) as any;
}
