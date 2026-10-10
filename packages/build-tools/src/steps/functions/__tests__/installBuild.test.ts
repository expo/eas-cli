import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createInstallBuildFunction, installBuildAsync } from '../installBuild';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectoryAsync(): Promise<string> {
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'install-build-test-')
  );
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}

describe(installBuildAsync, () => {
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

  it('installs an iOS Simulator .app', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'Example.app');
    await fs.promises.mkdir(artifactPath);
    const logger = createMockLogger();
    mockedSpawn.mockResolvedValueOnce({ stdout: 'com.example.app\n', stderr: '' } as any);

    const result = await installBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(result).toEqual({ applicationIdentifier: 'com.example.app' });
    expect(mockedSpawn.mock.calls).toEqual([
      [
        'plutil',
        ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(artifactPath, 'Info.plist')],
        { stdio: 'pipe', env: {} },
      ],
      ['xcrun', ['simctl', 'install', 'booted', artifactPath], { env: {}, logger }],
    ]);
  });

  it('installs an Android Emulator .apk', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'example.apk');
    await fs.promises.writeFile(artifactPath, 'apk');
    const logger = createMockLogger();
    mockedSpawn.mockResolvedValueOnce({
      stdout:
        "package: name='com.example.app'\nlaunchable-activity: name='com.example.app.MainActivity'\n",
      stderr: '',
    } as any);

    const result = await installBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(result).toEqual({
      applicationIdentifier: 'com.example.app',
      activityName: 'com.example.app.MainActivity',
    });
    expect(mockedSpawn.mock.calls).toEqual([
      ['aapt2', ['dump', 'badging', artifactPath], { stdio: 'pipe', env: {} }],
      ['adb', ['install', '-r', artifactPath], { env: {}, logger }],
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
      installBuildAsync({
        artifactPath,
        runtimePlatform,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_INVALID_ARTIFACT' });

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('installs an Android artifact without a launchable activity', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'example.apk');
    await fs.promises.writeFile(artifactPath, 'apk');
    const logger = createMockLogger();
    mockedSpawn.mockResolvedValue({
      stdout: "package: name='com.example.app'\n",
      stderr: '',
    } as any);

    const result = await installBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(result).toEqual({ applicationIdentifier: 'com.example.app' });
    expect(mockedSpawn.mock.calls).toEqual([
      ['aapt2', ['dump', 'badging', artifactPath], { stdio: 'pipe', env: {} }],
      ['adb', ['install', '-r', artifactPath], { env: {}, logger }],
    ]);
  });

  it('exposes the installed application identifier and activity as step outputs', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'example.apk');
    await fs.promises.writeFile(artifactPath, 'apk');
    mockedSpawn.mockResolvedValueOnce({
      stdout:
        "package: name='com.example.app'\nlaunchable-activity: name='com.example.app.MainActivity'\n",
      stderr: '',
    } as any);

    const installBuild = createInstallBuildFunction();
    const buildStep = installBuild.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX }),
      { callInputs: { artifact_path: artifactPath } }
    );
    await buildStep.executeAsync();

    expect(buildStep.outputById.application_identifier.value).toBe('com.example.app');
    expect(buildStep.outputById.activity_name.value).toBe('com.example.app.MainActivity');
  });
});
