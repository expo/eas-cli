import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql/error';

import {
  buildInvalidJsonOutput,
  buildJsonOutput,
  formatAscAppLinkStatus,
  isAscAuthenticationError,
} from '../utils';

const mockMetadataConnected = {
  id: 'app-id',
  fullName: '@testuser/testapp',
  ownerAccount: { id: 'account-id', name: 'testuser', ownerUserActor: null, users: [] },
  appStoreConnectApp: {
    id: 'asc-app-link-id',
    ascAppIdentifier: '1234567890',
    remoteAppStoreConnectApp: {
      ascAppIdentifier: '1234567890',
      bundleIdentifier: 'com.test.app',
      name: 'Test App',
      appStoreIconUrl: null,
    },
  },
};

const mockMetadataDisconnected = {
  id: 'app-id',
  fullName: '@testuser/testapp',
  ownerAccount: { id: 'account-id', name: 'testuser', ownerUserActor: null, users: [] },
  appStoreConnectApp: null,
};

describe('buildJsonOutput', () => {
  it('returns connected output', () => {
    const output = buildJsonOutput('status', mockMetadataConnected);
    expect(output.action).toBe('status');
    expect(output.project).toBe('@testuser/testapp');
    expect(output.status).toBe('connected');
    expect(output.appStoreConnectApp).not.toBeNull();
    expect(output.appStoreConnectApp!.ascAppIdentifier).toBe('1234567890');
    expect(output.appStoreConnectApp!.name).toBe('Test App');
    expect(output.appStoreConnectApp!.bundleIdentifier).toBe('com.test.app');
  });

  it('returns disconnected output', () => {
    const output = buildJsonOutput('status', mockMetadataDisconnected);
    expect(output.status).toBe('not-connected');
    expect(output.appStoreConnectApp).toBeNull();
  });
});

describe('buildInvalidJsonOutput', () => {
  it('returns invalid output', () => {
    const output = buildInvalidJsonOutput('status', 'project-id');
    expect(output.status).toBe('invalid');
    expect(output.project).toBe('project-id');
    expect(output.appStoreConnectApp).toBeNull();
  });
});

describe('isAscAuthenticationError', () => {
  it('returns true for ASC authentication errors', () => {
    const error = new CombinedError({
      graphQLErrors: [
        new GraphQLError(
          'App Store Connect rejected this API key with status 401. Choose a valid API key and try again.'
        ),
      ],
    });
    expect(isAscAuthenticationError(error)).toBe(true);
  });

  it('returns false for other CombinedErrors', () => {
    const error = new CombinedError({
      graphQLErrors: [new GraphQLError('Some other error')],
    });
    expect(isAscAuthenticationError(error)).toBe(false);
  });

  it('returns false for non-CombinedError errors', () => {
    expect(isAscAuthenticationError(new Error('random error'))).toBe(false);
  });
});

describe('formatAscAppLinkStatus', () => {
  it('formats connected status', () => {
    const status = formatAscAppLinkStatus(mockMetadataConnected);
    expect(status).toContain('Connected');
    expect(status).toContain('1234567890');
    expect(status).toContain('Test App');
    expect(status).toContain('com.test.app');
  });

  it('formats disconnected status', () => {
    const status = formatAscAppLinkStatus(mockMetadataDisconnected);
    expect(status).toContain('Not connected');
  });
});
