import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { installAndLaunchBuildAsync } from '../installAndLaunchBuild';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectoryAsync(): Promise<string> {
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'install-and-launch-build-test-')
  );
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}

describe(installAndLaunchBuildAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
  });

  afterAll(async () => {
    await Promise.all(
      temporaryDirectories.map(temporaryDirectory =>
        fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
      )
    );
  });

  it('installs and launches an iOS Simulator .app', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'Example.app');
    await fs.promises.mkdir(artifactPath);
    const logger = createMockLogger();
    mockedSpawn.mockResolvedValueOnce({
      stdout: 'com.example.app\n',
      stderr: '',
    } as any);

    await installAndLaunchBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn.mock.calls).toEqual([
      [
        'plutil',
        ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(artifactPath, 'Info.plist')],
        { stdio: 'pipe', env: {} },
      ],
      ['xcrun', ['simctl', 'install', 'booted', artifactPath], { env: {}, logger }],
      ['xcrun', ['simctl', 'launch', 'booted', 'com.example.app'], { env: {}, logger }],
    ]);
  });

  it('installs and launches an Android Emulator .apk', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'example.apk');
    await fs.promises.writeFile(artifactPath, 'apk');
    const logger = createMockLogger();
    mockedSpawn.mockResolvedValueOnce({
      stdout:
        "package: name='com.example.app'\nlaunchable-activity: name='com.example.app.MainActivity'\n",
      stderr: '',
    } as any);

    await installAndLaunchBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn.mock.calls).toEqual([
      ['aapt', ['dump', 'badging', artifactPath], { stdio: 'pipe', env: {} }],
      ['adb', ['install', '-r', artifactPath], { env: {}, logger }],
      [
        'adb',
        ['shell', 'am', 'start', '-n', 'com.example.app/com.example.app.MainActivity'],
        { env: {}, logger },
      ],
    ]);
  });

  it.each([
    [BuildRuntimePlatform.DARWIN, 'example.ipa'],
    [BuildRuntimePlatform.LINUX, 'example.aab'],
  ])('rejects an incompatible %s artifact', async (runtimePlatform, filename) => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, filename);
    await fs.promises.writeFile(artifactPath, 'artifact');

    await expect(
      installAndLaunchBuildAsync({
        artifactPath,
        runtimePlatform,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_INVALID_ARTIFACT' });

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects an Android artifact without a launchable activity', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'example.apk');
    await fs.promises.writeFile(artifactPath, 'apk');
    mockedSpawn.mockResolvedValue({
      stdout: "package: name='com.example.app'\n",
      stderr: '',
    } as any);

    await expect(
      installAndLaunchBuildAsync({
        artifactPath,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_MISSING_APP_IDENTIFIER' });
  });
});
