import { UserError } from '@expo/eas-build-job';
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

  it('installs an Android Emulator .apk with an uppercase .APK extension', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'release.APK');
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

  it('classifies aapt2 dump badging non-zero exit failures as invalid artifact UserError with stderr', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, '2123268320665243870.apk');
    await fs.promises.writeFile(artifactPath, '<html>not an apk</html>');
    const aapt2Error = Object.assign(
      new Error(`aapt2 dump badging ${artifactPath} exited with non-zero code: 1`),
      {
        status: 1,
        signal: null,
        stdout: '',
        stderr: `W/ziparchive: Unable to open '${artifactPath}': Invalid file\nerror: failed opening zip: Invalid file.\n`,
      }
    );
    mockedSpawn.mockRejectedValueOnce(aapt2Error);

    const error = await installBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger: createMockLogger(),
    }).catch(err => err);

    expect(error).toBeInstanceOf(UserError);
    expect(error).toMatchObject({
      errorCode: 'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      cause: aapt2Error,
    });
    expect(error.message).toContain('2123268320665243870.apk');
    expect(error.message).toContain(
      'Android Emulator sessions require a valid .apk build artifact'
    );
    expect(error.message).toContain('not an .aab, HTML page, or archive download');
    expect(error.message).toContain('aapt2 stderr:');
    expect(error.message).toContain('error: failed opening zip: Invalid file.');
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('omits aapt2 stderr suffix when stderr is empty on non-zero exit', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'empty.apk');
    await fs.promises.writeFile(artifactPath, '');
    mockedSpawn.mockRejectedValueOnce(
      Object.assign(new Error('aapt2 exited with non-zero code: 1'), {
        status: 1,
        signal: null,
        stdout: '',
        stderr: '   \n',
      })
    );

    const error = await installBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger: createMockLogger(),
    }).catch(err => err);

    expect(error).toBeInstanceOf(UserError);
    expect(error).toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_INVALID_ARTIFACT' });
    expect(error.message).not.toContain('aapt2 stderr:');
  });

  it('truncates long aapt2 stderr while preserving the trailing error details', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'corrupt.apk');
    await fs.promises.writeFile(artifactPath, 'corrupt');
    const longWarnings = 'W/ziparchive: noisy warning line\n'.repeat(40);
    const trailingError = 'error: failed to parse binary AndroidManifest.xml.';
    mockedSpawn.mockRejectedValueOnce(
      Object.assign(new Error('aapt2 exited with non-zero code: 1'), {
        status: 1,
        signal: null,
        stdout: '',
        stderr: `${longWarnings}${trailingError}\n`,
      })
    );

    const error = await installBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger: createMockLogger(),
    }).catch(err => err);

    expect(error).toBeInstanceOf(UserError);
    expect(error).toMatchObject({ errorCode: 'EAS_INSTALL_BUILD_INVALID_ARTIFACT' });
    const stderrSection = error.message.split('aapt2 stderr: ')[1];
    expect(stderrSection).toBeDefined();
    expect(stderrSection.length).toBeLessThanOrEqual(500);
    expect(stderrSection.startsWith('…')).toBe(true);
    expect(stderrSection).toContain(trailingError);
  });

  it('rethrows aapt2 exit code 1 without classifying as UserError when the artifact file is unreadable', async () => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'unreadable.apk');
    await fs.promises.writeFile(artifactPath, 'apk');
    const aapt2Error = Object.assign(
      new Error(`aapt2 dump badging ${artifactPath} exited with non-zero code: 1`),
      {
        status: 1,
        signal: null,
        stdout: '',
        stderr: `${artifactPath}: error: failed to open APK: Permission denied.\n`,
      }
    );
    mockedSpawn.mockRejectedValueOnce(aapt2Error);
    const accessSpy = jest
      .spyOn(fs.promises, 'access')
      .mockRejectedValueOnce(
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      );

    try {
      const error = await installBuildAsync({
        artifactPath,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      }).catch(err => err);

      expect(error).toBe(aapt2Error);
      expect(error).not.toBeInstanceOf(UserError);
    } finally {
      accessSpy.mockRestore();
    }
  });

  it.each([
    [
      'ENOENT (missing aapt2 binary)',
      Object.assign(new Error('spawn aapt2 ENOENT'), {
        code: 'ENOENT',
        status: null,
        signal: null,
        stderr: '',
      }),
    ],
    [
      'EACCES (unexecutable aapt2 binary)',
      Object.assign(new Error('spawn aapt2 EACCES'), {
        code: 'EACCES',
        status: null,
        signal: null,
        stderr: '',
      }),
    ],
    [
      'signal termination (SIGKILL)',
      Object.assign(new Error('aapt2 exited with signal: SIGKILL'), {
        status: null,
        signal: 'SIGKILL',
        stderr: '',
      }),
    ],
    [
      'exec/shared-library exit code 127',
      Object.assign(new Error('aapt2 exited with non-zero code: 127'), {
        status: 127,
        signal: null,
        stderr: 'aapt2: error while loading shared libraries',
      }),
    ],
  ])('rethrows %s without classifying as UserError', async (_label, spawnError) => {
    const temporaryDirectory = await makeTemporaryDirectoryAsync();
    const artifactPath = path.join(temporaryDirectory, 'example.apk');
    await fs.promises.writeFile(artifactPath, 'apk');
    mockedSpawn.mockRejectedValueOnce(spawnError);

    const error = await installBuildAsync({
      artifactPath,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger: createMockLogger(),
    }).catch(err => err);

    expect(error).toBe(spawnError);
    expect(error).not.toBeInstanceOf(UserError);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });
});
