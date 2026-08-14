import { vol } from 'memfs';

import { getPrivateExpoConfigAsync } from '../expoConfig';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppUploadSessionType } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { uploadAppScopedFileAtPathToGCSAsync } from '../../uploads';
import { maybeSetProjectIconFromAppConfigAsync, resolveAppConfigIconAsync } from '../projectIcon';

jest.mock('fs');
jest.mock('../expoConfig');
jest.mock('../../graphql/queries/AppQuery');
jest.mock('../../log');
jest.mock('../../uploads');

const mockGetPrivateExpoConfigAsync = jest.mocked(getPrivateExpoConfigAsync);
const mockByIdProfileImageUrlAsync = jest.mocked(AppQuery.byIdProfileImageUrlAsync);
const mockUploadAsync = jest.mocked(uploadAppScopedFileAtPathToGCSAsync);

const graphqlClient = {} as ExpoGraphqlClient;
const projectDir = '/app';
const projectId = 'project-123';

function mockAppConfig(exp: Record<string, any>): void {
  mockGetPrivateExpoConfigAsync.mockResolvedValue({
    name: 'testing 123',
    slug: 'testing-123',
    ...exp,
  } as any);
}

beforeEach(() => {
  vol.reset();
  jest.clearAllMocks();
});

describe(resolveAppConfigIconAsync, () => {
  it('resolves the icon field relative to the project directory', async () => {
    vol.fromJSON({ '/app/assets/icon.png': 'fake-png-bytes' });
    mockAppConfig({ icon: './assets/icon.png' });

    await expect(resolveAppConfigIconAsync(projectDir)).resolves.toEqual({
      field: 'icon',
      path: '/app/assets/icon.png',
    });
  });

  it('falls back to ios.icon when the top-level icon file is missing', async () => {
    vol.fromJSON({ '/app/assets/ios-icon.png': 'fake-png-bytes' });
    mockAppConfig({ icon: './assets/missing.png', ios: { icon: './assets/ios-icon.png' } });

    await expect(resolveAppConfigIconAsync(projectDir)).resolves.toEqual({
      field: 'ios.icon',
      path: '/app/assets/ios-icon.png',
    });
  });

  it('uses the light variant when ios.icon is a per-appearance map', async () => {
    vol.fromJSON({ '/app/assets/light.png': 'fake-png-bytes' });
    mockAppConfig({
      ios: { icon: { light: './assets/light.png', dark: './assets/dark.png' } },
    });

    await expect(resolveAppConfigIconAsync(projectDir)).resolves.toEqual({
      field: 'ios.icon',
      path: '/app/assets/light.png',
    });
  });

  it('falls back to the Android adaptive icon foreground', async () => {
    vol.fromJSON({ '/app/assets/foreground.png': 'fake-png-bytes' });
    mockAppConfig({
      android: { adaptiveIcon: { foregroundImage: './assets/foreground.png' } },
    });

    await expect(resolveAppConfigIconAsync(projectDir)).resolves.toEqual({
      field: 'android.adaptiveIcon.foregroundImage',
      path: '/app/assets/foreground.png',
    });
  });

  it('ignores a remote icon URL', async () => {
    mockAppConfig({ icon: 'https://example.com/icon.png' });

    await expect(resolveAppConfigIconAsync(projectDir)).resolves.toBeNull();
  });

  it('returns null when the app config has no icon', async () => {
    mockAppConfig({});

    await expect(resolveAppConfigIconAsync(projectDir)).resolves.toBeNull();
  });

  it('returns null when the app config cannot be read', async () => {
    mockGetPrivateExpoConfigAsync.mockRejectedValue(new Error('Invalid app config.'));

    await expect(resolveAppConfigIconAsync(projectDir)).resolves.toBeNull();
  });
});

describe(maybeSetProjectIconFromAppConfigAsync, () => {
  it('uploads the app config icon when the project has none', async () => {
    vol.fromJSON({ '/app/assets/icon.png': 'fake-png-bytes' });
    mockAppConfig({ icon: './assets/icon.png' });
    mockByIdProfileImageUrlAsync.mockResolvedValue(null);

    await expect(
      maybeSetProjectIconFromAppConfigAsync(graphqlClient, { projectId, projectDir })
    ).resolves.toEqual({
      status: 'set',
      icon: { field: 'icon', path: '/app/assets/icon.png' },
    });
    expect(mockUploadAsync).toHaveBeenCalledWith(graphqlClient, {
      type: AppUploadSessionType.ProfileImageUpload,
      appId: projectId,
      path: '/app/assets/icon.png',
    });
  });

  it('does not overwrite an icon the project already has', async () => {
    vol.fromJSON({ '/app/assets/icon.png': 'fake-png-bytes' });
    mockAppConfig({ icon: './assets/icon.png' });
    mockByIdProfileImageUrlAsync.mockResolvedValue('https://example.com/existing.png');

    await expect(
      maybeSetProjectIconFromAppConfigAsync(graphqlClient, { projectId, projectDir })
    ).resolves.toEqual({ status: 'skipped', reason: 'icon-already-set' });
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('skips without a server round-trip when the app config has no icon', async () => {
    mockAppConfig({});

    await expect(
      maybeSetProjectIconFromAppConfigAsync(graphqlClient, { projectId, projectDir })
    ).resolves.toEqual({ status: 'skipped', reason: 'no-icon-in-app-config' });
    expect(mockByIdProfileImageUrlAsync).not.toHaveBeenCalled();
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('skips an unsupported image format instead of throwing', async () => {
    vol.fromJSON({ '/app/assets/icon.gif': 'fake-gif-bytes' });
    mockAppConfig({ icon: './assets/icon.gif' });

    await expect(
      maybeSetProjectIconFromAppConfigAsync(graphqlClient, { projectId, projectDir })
    ).resolves.toEqual({ status: 'skipped', reason: 'invalid-icon' });
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('skips an image over the size limit instead of throwing', async () => {
    vol.fromJSON({ '/app/assets/icon.png': 'x'.repeat(10 * 1024 * 1024 + 1) });
    mockAppConfig({ icon: './assets/icon.png' });

    await expect(
      maybeSetProjectIconFromAppConfigAsync(graphqlClient, { projectId, projectDir })
    ).resolves.toEqual({ status: 'skipped', reason: 'invalid-icon' });
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('does not propagate an upload failure', async () => {
    vol.fromJSON({ '/app/assets/icon.png': 'fake-png-bytes' });
    mockAppConfig({ icon: './assets/icon.png' });
    mockByIdProfileImageUrlAsync.mockResolvedValue(null);
    mockUploadAsync.mockRejectedValue(new Error('Upload session expired'));

    await expect(
      maybeSetProjectIconFromAppConfigAsync(graphqlClient, { projectId, projectDir })
    ).resolves.toEqual({ status: 'skipped', reason: 'upload-failed' });
  });
});
