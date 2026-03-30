import { buildJsonOutput, formatAscAppLinkStatus } from '../utils';

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
    expect(output.ok).toBe(true);
    expect(output.action).toBe('status');
    expect(output.project).toBe('@testuser/testapp');
    expect(output.connected).toBe(true);
    expect(output.appStoreConnectApp).not.toBeNull();
    expect(output.appStoreConnectApp!.ascAppIdentifier).toBe('1234567890');
    expect(output.appStoreConnectApp!.name).toBe('Test App');
    expect(output.appStoreConnectApp!.bundleIdentifier).toBe('com.test.app');
  });

  it('returns disconnected output', () => {
    const output = buildJsonOutput('status', mockMetadataDisconnected);
    expect(output.ok).toBe(true);
    expect(output.connected).toBe(false);
    expect(output.appStoreConnectApp).toBeNull();
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
