import spawn from '@expo/turtle-spawn';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isPreinstalledExpoGoAsync, readIosApplicationIdentifierAsync } from '../iosAppArtifact';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

describe(readIosApplicationIdentifierAsync, () => {
  let directory: string;
  let artifactPath: string;

  beforeEach(async () => {
    jest.mocked(spawn).mockReset();
    directory = await mkdtemp(path.join(os.tmpdir(), 'ios-app-artifact-'));
    artifactPath = path.join(directory, 'Example.app');
    await mkdir(artifactPath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads app metadata without installing or launching', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: 'com.example.app\n', stderr: '' } as never);
    await expect(readIosApplicationIdentifierAsync({ artifactPath, env: {} })).resolves.toBe(
      'com.example.app'
    );
    expect(jest.mocked(spawn).mock.calls).toEqual([
      [
        'plutil',
        ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(artifactPath, 'Info.plist')],
        { stdio: 'pipe', env: {} },
      ],
    ]);
  });

  it.each(['missing', 'file', 'wrong extension'])('rejects an invalid artifact: %s', async kind => {
    await rm(artifactPath, { recursive: true });
    if (kind === 'file') {
      await writeFile(artifactPath, 'not an app directory');
    } else if (kind === 'wrong extension') {
      artifactPath = path.join(directory, 'Example.ipa');
      await mkdir(artifactPath);
    }
    await expect(
      readIosApplicationIdentifierAsync({ artifactPath, env: {} })
    ).rejects.toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_INVALID_ARTIFACT' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects a missing bundle identifier', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: '  ', stderr: '' } as never);
    await expect(
      readIosApplicationIdentifierAsync({ artifactPath, env: {} })
    ).rejects.toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_MISSING_IDENTIFIER' });
  });
});

describe(isPreinstalledExpoGoAsync, () => {
  const preinstalled = {
    bundleIdentifier: 'host.exp.Exponent',
    shortVersion: '58.0.7',
    version: '58.0.7',
  };
  function plist(values: Record<string, string>) {
    jest.mocked(spawn).mockImplementation((async (_command: string, args: string[]) => ({
      stdout: `${values[args[1]]}\n`,
    })) as never);
  }
  const app = (shortVersion: string, bundleIdentifier = 'host.exp.Exponent') => ({
    CFBundleIdentifier: bundleIdentifier,
    CFBundleShortVersionString: shortVersion,
    CFBundleVersion: shortVersion,
  });

  beforeEach(() => {
    jest.mocked(spawn).mockReset();
  });

  it('matches the preinstalled Expo Go without asking the Simulator', async () => {
    plist(app('58.0.7'));
    await expect(
      isPreinstalledExpoGoAsync({ appPath: '/job/Expo Go.app', preinstalled, env: {} })
    ).resolves.toBe(true);
    expect(jest.mocked(spawn).mock.calls.every(([command]) => command === 'plutil')).toBe(true);
  });

  it('does not match a different Expo Go version', async () => {
    plist(app('58.0.6'));
    await expect(
      isPreinstalledExpoGoAsync({ appPath: '/job/Expo Go.app', preinstalled, env: {} })
    ).resolves.toBe(false);
  });

  it('never matches a custom build, even with the same version', async () => {
    plist(app('58.0.7', 'com.example.app'));
    await expect(
      isPreinstalledExpoGoAsync({
        appPath: '/job/Example.app',
        preinstalled: { ...preinstalled, bundleIdentifier: 'com.example.app' },
        env: {},
      })
    ).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not match an app it cannot read', async () => {
    jest.mocked(spawn).mockRejectedValue(new Error('plutil failed'));
    await expect(
      isPreinstalledExpoGoAsync({ appPath: '/job/Expo Go.app', preinstalled, env: {} })
    ).resolves.toBe(false);
  });
});
