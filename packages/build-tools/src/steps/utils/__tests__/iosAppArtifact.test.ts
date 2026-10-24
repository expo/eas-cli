import spawn from '@expo/turtle-spawn';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  isExpoGoVersionInstalledAsync,
  readIosApplicationIdentifierAsync,
} from '../iosAppArtifact';

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

describe(isExpoGoVersionInstalledAsync, () => {
  function plist(values: Record<string, Record<string, string>>) {
    jest.mocked(spawn).mockImplementation((async (command: string, args: string[]) => {
      if (command === 'xcrun') {
        if (!values.installed) {
          throw new Error('No such app');
        }
        return { stdout: '/installed/Expo Go.app\n' };
      }
      const owner = args[5].startsWith('/installed/') ? 'installed' : 'requested';
      return { stdout: `${values[owner][args[1]]}\n` };
    }) as never);
  }
  const expoGo = (version: string) => ({
    CFBundleIdentifier: 'host.exp.Exponent',
    CFBundleShortVersionString: version,
    CFBundleVersion: '1',
  });

  beforeEach(() => {
    jest.mocked(spawn).mockReset();
  });

  it('matches an installed Expo Go with the same version', async () => {
    plist({ requested: expoGo('58.0.7'), installed: expoGo('58.0.7') });
    await expect(
      isExpoGoVersionInstalledAsync({ udid: 'PHONE', appPath: '/job/Expo Go.app', env: {} })
    ).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'get_app_container', 'PHONE', 'host.exp.Exponent', 'app'],
      { stdio: 'pipe', env: {} }
    );
  });

  it('does not match a different Expo Go version', async () => {
    plist({ requested: expoGo('58.0.6'), installed: expoGo('58.0.7') });
    await expect(
      isExpoGoVersionInstalledAsync({ udid: 'PHONE', appPath: '/job/Expo Go.app', env: {} })
    ).resolves.toBe(false);
  });

  it('never matches a custom build, even with the same version', async () => {
    const custom = { ...expoGo('58.0.7'), CFBundleIdentifier: 'com.example.app' };
    plist({ requested: custom, installed: custom });
    await expect(
      isExpoGoVersionInstalledAsync({ udid: 'PHONE', appPath: '/job/Example.app', env: {} })
    ).resolves.toBe(false);
    expect(jest.mocked(spawn).mock.calls.some(([command]) => command === 'xcrun')).toBe(false);
  });

  it('does not match when Expo Go is not installed', async () => {
    plist({ requested: expoGo('58.0.7') });
    await expect(
      isExpoGoVersionInstalledAsync({ udid: 'PHONE', appPath: '/job/Expo Go.app', env: {} })
    ).resolves.toBe(false);
  });
});
