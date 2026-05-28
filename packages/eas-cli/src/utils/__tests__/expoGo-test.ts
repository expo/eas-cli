import { getConfigFilePaths } from '@expo/config';
import fs from 'fs-extra';

import { ApiV2Client } from '../../api';
import Log from '../../log';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';
import * as downloadUtils from '../download';
import {
  ExpoVersions,
  downloadExpoGoAsync,
  getExpoGoDownloadUrlAsync,
  getExpoGoVersionEntryFromVersions,
  getLatestSdkVersion,
  normalizeSdkVersion,
} from '../expoGo';

jest.mock('@expo/config', () => ({
  ...jest.requireActual('@expo/config'),
  getConfigFilePaths: jest.fn(),
}));
jest.mock('../../project/expoConfig');
jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockGetConfigFilePaths = jest.mocked(getConfigFilePaths);
const mockGetPrivateExpoConfigAsync = jest.mocked(getPrivateExpoConfigAsync);

const versions: ExpoVersions = {
  sdkVersions: {
    '54.0.0': {
      androidClientUrl: 'https://example.com/Exponent-54.apk',
      iosClientUrl: 'https://example.com/Exponent-54.tar.gz',
    },
    '55.0.0': {
      androidClientUrl: 'https://example.com/Exponent-55.apk',
      iosClientUrl: 'https://example.com/Exponent-55.tar.gz',
    },
  },
};

describe('expoGo utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ApiV2Client.prototype, 'getAsync').mockResolvedValue({ data: versions });
    mockGetConfigFilePaths.mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe(normalizeSdkVersion, () => {
    it('normalizes SDK major versions', () => {
      expect(normalizeSdkVersion('55')).toBe('55.0.0');
      expect(normalizeSdkVersion('55.1')).toBe('55.1.0');
      expect(normalizeSdkVersion('55.0.0')).toBe('55.0.0');
      expect(normalizeSdkVersion('UNVERSIONED')).toBe('UNVERSIONED');
    });
  });

  describe(getLatestSdkVersion, () => {
    it('returns the highest semver SDK version', () => {
      expect(getLatestSdkVersion(versions.sdkVersions)).toBe('55.0.0');
    });
  });

  describe(getExpoGoVersionEntryFromVersions, () => {
    it('supports UNVERSIONED by resolving to the latest SDK version', () => {
      const result = getExpoGoVersionEntryFromVersions('UNVERSIONED', versions);

      expect(result.sdkVersion).toBe('55.0.0');
      expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('55.0.0'));
    });

    it('supports "latest" by resolving to the latest SDK version without warning', () => {
      const result = getExpoGoVersionEntryFromVersions('latest', versions);

      expect(result.sdkVersion).toBe('55.0.0');
      expect(Log.warn).not.toHaveBeenCalled();
    });

    it('throws when the SDK version is missing', () => {
      expect(() => getExpoGoVersionEntryFromVersions('53', versions)).toThrow(
        'Unable to find a version of Expo Go for SDK 53.0.0'
      );
    });
  });

  describe(getExpoGoDownloadUrlAsync, () => {
    it('resolves the platform URL for an explicit SDK major version', async () => {
      await expect(getExpoGoDownloadUrlAsync('ios', { sdkVersion: '55' })).resolves.toEqual({
        sdkVersion: '55.0.0',
        url: 'https://example.com/Exponent-55.tar.gz',
      });
    });

    it('uses the current project SDK version when no SDK argument is provided', async () => {
      mockGetConfigFilePaths.mockReturnValue({
        staticConfigPath: '/project/app.json',
        dynamicConfigPath: null,
      });
      mockGetPrivateExpoConfigAsync.mockResolvedValue({ sdkVersion: '54.0.0' } as any);

      await expect(
        getExpoGoDownloadUrlAsync('android', { projectDir: '/project' })
      ).resolves.toEqual({
        sdkVersion: '54.0.0',
        url: 'https://example.com/Exponent-54.apk',
      });
    });

    it('falls back to the latest SDK version when no project SDK is available', async () => {
      await expect(getExpoGoDownloadUrlAsync('android')).resolves.toEqual({
        sdkVersion: '55.0.0',
        url: 'https://example.com/Exponent-55.apk',
      });
    });

    it('resolves the latest SDK version when "latest" is provided', async () => {
      await expect(getExpoGoDownloadUrlAsync('ios', { sdkVersion: 'latest' })).resolves.toEqual({
        sdkVersion: '55.0.0',
        url: 'https://example.com/Exponent-55.tar.gz',
      });
    });
  });

  describe(downloadExpoGoAsync, () => {
    it('extracts iOS tarballs directly into the app cache directory', async () => {
      jest.spyOn(fs, 'readdir').mockRejectedValue(new Error('missing') as never);
      jest.spyOn(fs, 'pathExists').mockResolvedValue(false as never);
      jest.spyOn(fs, 'ensureDir').mockResolvedValue(undefined as never);
      jest.spyOn(fs, 'remove').mockResolvedValue(undefined as never);
      jest.spyOn(downloadUtils, 'downloadFileWithProgressTrackerAsync').mockResolvedValue();
      const extractArchiveSpy = jest
        .spyOn(downloadUtils, 'extractArchiveAsync')
        .mockResolvedValue();

      await expect(downloadExpoGoAsync('ios', { sdkVersion: '55' })).resolves.toMatchObject({
        sdkVersion: '55.0.0',
        url: 'https://example.com/Exponent-55.tar.gz',
      });

      expect(extractArchiveSpy).toHaveBeenCalledWith(
        expect.stringContaining('Exponent-55.tar.gz'),
        expect.stringContaining('Exponent-55.tar.app')
      );
    });

    it('logs the cache directory instead of the cached app path', async () => {
      jest.spyOn(fs, 'readdir').mockRejectedValue(new Error('missing') as never);
      jest.spyOn(fs, 'pathExists').mockResolvedValue(true as never);

      await expect(downloadExpoGoAsync('ios', { sdkVersion: '55' })).resolves.toMatchObject({
        sdkVersion: '55.0.0',
      });

      expect(Log.log).toHaveBeenCalledWith(
        expect.stringMatching(/^Using cached version from .*ios-simulator-app-cache/)
      );
      expect(Log.log).not.toHaveBeenCalledWith(expect.stringContaining('Exponent-55.tar.app'));
    });

    it('writes the Android apk straight to the platform cache without an intermediate copy', async () => {
      jest.spyOn(fs, 'readdir').mockRejectedValue(new Error('missing') as never);
      jest.spyOn(fs, 'pathExists').mockResolvedValue(false as never);
      jest.spyOn(fs, 'ensureDir').mockResolvedValue(undefined as never);
      const downloadSpy = jest
        .spyOn(downloadUtils, 'downloadFileWithProgressTrackerAsync')
        .mockResolvedValue();
      const extractArchiveSpy = jest
        .spyOn(downloadUtils, 'extractArchiveAsync')
        .mockResolvedValue();

      await expect(downloadExpoGoAsync('android', { sdkVersion: '55' })).resolves.toMatchObject({
        sdkVersion: '55.0.0',
        url: 'https://example.com/Exponent-55.apk',
      });

      expect(downloadSpy).toHaveBeenCalledWith(
        'https://example.com/Exponent-55.apk',
        expect.stringMatching(/android-apk-cache.*Exponent-55\.apk$/),
        expect.any(Function),
        'Successfully downloaded Expo Go',
        expect.objectContaining({ showNewLine: false })
      );
      expect(extractArchiveSpy).not.toHaveBeenCalled();
    });
  });
});
