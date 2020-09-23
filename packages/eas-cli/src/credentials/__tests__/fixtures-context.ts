import merge from 'lodash/merge';

import { CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { getAndroidApiMockWithoutCredentials } from './fixtures-android';
import { testAppJson, testUsername } from './fixtures-constants';

export function createCtxMock(mockOverride: Record<string, any> = {}): Context {
  const defaultMock = {
    ios: jest.fn(),
    android: getAndroidApiMockWithoutCredentials(),
    appstore: jest.fn(),
    ensureAppleCtx: jest.fn(),
    user: {
      username: testUsername,
    },
    hasAppleCtx: jest.fn(() => true),
    hasProjectContext: true,
    manifest: testAppJson,
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
      pushNextAction: jest.fn(() => {
        throw new Error('unexpected call'); // should be implemented in test directly
      }),
      popAction: jest.fn(),
    },
    mockOverride
  );
}
