import spawnAsync from '@expo/spawn-async';

import { detectProjectSdkVersionAsync } from '../../project/detectProjectSdkVersionAsync';
import { resolveExpoGoApplicationArchiveUrlAsync } from '../expoGo';

jest.mock('@expo/spawn-async');
jest.mock('../../project/detectProjectSdkVersionAsync');

const projectDir = '/test/project';
const mockDetectProjectSdkVersionAsync = jest.mocked(detectProjectSdkVersionAsync);
const mockSpawnAsync = jest.mocked(spawnAsync);

describe(resolveExpoGoApplicationArchiveUrlAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetectProjectSdkVersionAsync.mockResolvedValue('55.0.0');
    mockSpawnAsync.mockResolvedValue({
      stdout: 'https://example.test/expo-go.tar.gz\n',
    } as never);
  });

  it.each(['ios', 'android'] as const)(
    'resolves the Expo Go URL for SDK 55 on %s',
    async platform => {
      await expect(resolveExpoGoApplicationArchiveUrlAsync({ platform, projectDir })).resolves.toBe(
        'https://example.test/expo-go.tar.gz'
      );

      expect(mockSpawnAsync).toHaveBeenCalledWith(
        'npx',
        ['--yes', 'expo-go', 'url', platform, '55'],
        {
          cwd: projectDir,
          stdio: 'pipe',
        }
      );
    }
  );

  it.each([undefined, 'UNVERSIONED'])(
    'rejects an undetectable SDK version (%s)',
    async sdkVersion => {
      mockDetectProjectSdkVersionAsync.mockResolvedValue(sdkVersion);

      await expect(
        resolveExpoGoApplicationArchiveUrlAsync({ platform: 'ios', projectDir })
      ).rejects.toThrow(
        "Unable to determine this project's Expo SDK version, so Expo Go could not be selected."
      );
      expect(mockSpawnAsync).not.toHaveBeenCalled();
    }
  );

  it('reports how to diagnose an expo-go failure', async () => {
    mockSpawnAsync.mockRejectedValue(new Error('network unavailable') as never);

    await expect(
      resolveExpoGoApplicationArchiveUrlAsync({ platform: 'android', projectDir })
    ).rejects.toThrow(
      'Failed to resolve the Expo Go download URL for SDK 55 on android. network unavailable ' +
        'Run "npx expo-go url android 55" to diagnose the problem'
    );
  });

  it.each(['', 'not a URL', 'file:///tmp/expo-go.app'])(
    'rejects an invalid expo-go URL (%s)',
    async stdout => {
      mockSpawnAsync.mockResolvedValue({ stdout } as never);

      await expect(
        resolveExpoGoApplicationArchiveUrlAsync({ platform: 'ios', projectDir })
      ).rejects.toThrow('expo-go returned an invalid download URL for SDK 55 on ios.');
    }
  );
});
