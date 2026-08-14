import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { BuildRuntimePlatform } from '@expo/steps';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { Datadog } from '../../../datadog';
import { createInstallMaestroBuildFunction } from '../installMaestro';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../datadog', () => ({
  Datadog: {
    distribution: jest.fn(),
  },
}));

const mockedSpawn = jest.mocked(spawn);

async function writeInstalledWdaVersion(homeDirectory: string, version: string): Promise<void> {
  const wdaDirectory = path.join(
    homeDirectory,
    '.maestro-runner',
    'drivers',
    'ios',
    'WebDriverAgent'
  );
  await fs.promises.mkdir(wdaDirectory, { recursive: true });
  await fs.promises.writeFile(path.join(wdaDirectory, 'package.json'), JSON.stringify({ version }));
}

describe('createInstallMaestroBuildFunction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `maestro --version` reports an installed version; `java -version` succeeds.
    // With no requested version and Maestro present, the step skips installation.
    mockedSpawn.mockImplementation((async (command: string) => ({
      stdout: command === 'maestro' ? '1.41.0\n' : '',
    })) as any);
  });

  it('reports the detected Maestro version to Datadog on EAS Build VMs', async () => {
    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock();
    globalCtx.updateEnv({ EAS_BUILD_RUNNER: 'eas-build' });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, { callInputs: {} });

    await step.executeAsync();

    expect(step.getOutputValueByName('maestro_version')).toBe('1.41.0');
    expect(Datadog.distribution).toHaveBeenCalledWith('eas.maestro.install', 1, {
      maestro_version: '1.41.0',
      maestro_backend: 'maestro',
    });
  });

  it('does not report to Datadog outside EAS Build VMs', async () => {
    const installMaestro = createInstallMaestroBuildFunction();
    const step = installMaestro.createBuildStepFromFunctionCall(createGlobalContextMock(), {
      callInputs: {},
    });

    await step.executeAsync();

    expect(Datadog.distribution).not.toHaveBeenCalled();
  });

  it('extracts the version when `maestro --version` prints an analytics notice', async () => {
    mockedSpawn.mockImplementation((async (command: string) => ({
      stdout:
        command === 'maestro'
          ? 'Anonymous analytics enabled. To opt out, set MAESTRO_CLI_NO_ANALYTICS environment variable to any value before running Maestro.\n2.0.10\n'
          : '',
    })) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock();
    globalCtx.updateEnv({ EAS_BUILD_RUNNER: 'eas-build' });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, { callInputs: {} });

    await step.executeAsync();

    expect(step.getOutputValueByName('maestro_version')).toBe('2.0.10');
    expect(Datadog.distribution).toHaveBeenCalledWith('eas.maestro.install', 1, {
      maestro_version: '2.0.10',
      maestro_backend: 'maestro',
    });
  });

  it('uses the trailing version when the notice itself contains an earlier version-like string', async () => {
    mockedSpawn.mockImplementation((async (command: string) => ({
      stdout: command === 'maestro' ? 'Analytics schema v2.0.0 enabled.\n2.0.10\n' : '',
    })) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock();
    globalCtx.updateEnv({ EAS_BUILD_RUNNER: 'eas-build' });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, { callInputs: {} });

    await step.executeAsync();

    expect(step.getOutputValueByName('maestro_version')).toBe('2.0.10');
  });

  it('checks maestro-runner when selected by input', async () => {
    mockedSpawn.mockImplementation((async (command: string) => ({
      stdout:
        command === 'maestro-runner'
          ? 'maestro-runner 1.2.3\n  Commit:  abc123\n  Built:   2026-08-13\n  Go:      go1.26.5\n  OS/Arch: darwin/arm64\n'
          : '',
    })) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock();
    globalCtx.updateEnv({ EAS_BUILD_RUNNER: 'eas-build' });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { backend: 'maestro-runner' },
    });

    await step.executeAsync();

    expect(mockedSpawn).toHaveBeenCalledTimes(2);
    expect(mockedSpawn.mock.calls.map(([command]) => command)).toEqual([
      'maestro-runner',
      'maestro-runner',
    ]);
    expect(step.getOutputValueByName('maestro_version')).toBe('1.2.3');
    expect(Datadog.distribution).toHaveBeenCalledWith('eas.maestro.install', 1, {
      maestro_version: '1.2.3',
      maestro_backend: 'maestro-runner',
    });
  });

  it('selects maestro-runner from EAS_MAESTRO_BACKEND', async () => {
    mockedSpawn.mockImplementation((async (command: string) => ({
      stdout: command === 'maestro-runner' ? 'maestro-runner 1.2.3\n' : '',
    })) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock();
    globalCtx.updateEnv({
      EAS_BUILD_RUNNER: 'eas-build',
      EAS_MAESTRO_BACKEND: 'maestro-runner',
    });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, { callInputs: {} });

    await step.executeAsync();

    expect(mockedSpawn.mock.calls.map(([command]) => command)).toEqual([
      'maestro-runner',
      'maestro-runner',
    ]);
  });

  it('installs the latest maestro-runner version when it is missing', async () => {
    let versionChecks = 0;
    mockedSpawn.mockImplementation((async (command: string) => {
      if (command === 'maestro-runner' && versionChecks++ === 0) {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return { stdout: command === 'maestro-runner' ? 'maestro-runner 1.2.3\n' : '' };
    }) as any);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '#!/bin/sh\n',
    } as Response);
    const originalPath = process.env.PATH;

    try {
      const installMaestro = createInstallMaestroBuildFunction();
      const globalCtx = createGlobalContextMock();
      globalCtx.updateEnv({
        EAS_BUILD_RUNNER: 'eas-build',
        HOME: '/home/expo',
        PATH: '/usr/bin',
      });
      const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
        callInputs: { backend: 'maestro-runner' },
      });

      await step.executeAsync();

      expect(fetchSpy).toHaveBeenCalledWith('https://open.devicelab.dev/install/maestro-runner');
      expect(mockedSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/install_maestro_runner.*\/install_maestro_runner\.sh$/),
        [],
        expect.objectContaining({ env: expect.objectContaining({ HOME: '/home/expo' }) })
      );
      expect(mockedSpawn).toHaveBeenLastCalledWith(
        'maestro-runner',
        ['--version'],
        expect.objectContaining({
          env: expect.objectContaining({
            PATH: expect.stringMatching(/^\/home\/expo\/\.maestro-runner\/bin:/),
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
      process.env.PATH = originalPath;
    }
  });

  it('installs maestro-runner 1.1.15 on Xcode versions below 26', async () => {
    let versionChecks = 0;
    mockedSpawn.mockImplementation((async (command: string) => {
      switch (command) {
        case 'xcodebuild':
          return { stdout: 'Xcode 16.4\nBuild version 16F6\n' };
        case 'maestro-runner':
          return {
            stdout: versionChecks++ === 0 ? 'maestro-runner 1.1.23\n' : 'maestro-runner 1.1.15\n',
          };
        default:
          return { stdout: '' };
      }
    }) as any);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      text: async () => '#!/bin/sh\n',
    } as Response);
    const originalPath = process.env.PATH;

    try {
      const installMaestro = createInstallMaestroBuildFunction();
      const globalCtx = createGlobalContextMock({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
      });
      globalCtx.updateEnv({
        EAS_BUILD_RUNNER: 'eas-build',
        HOME: '/home/expo',
        PATH: '/usr/bin',
      });
      const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
        callInputs: { backend: 'maestro-runner' },
      });

      await step.executeAsync();

      expect(mockedSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/install_maestro_runner.*\/install_maestro_runner\.sh$/),
        ['--version', '1.1.15'],
        expect.objectContaining({ env: expect.objectContaining({ HOME: '/home/expo' }) })
      );
      expect(step.getOutputValueByName('maestro_version')).toBe('1.1.15');
    } finally {
      fetchSpy.mockRestore();
      process.env.PATH = originalPath;
    }
  });

  it('does not check Xcode when a compatible maestro-runner version is installed', async () => {
    mockedSpawn.mockImplementation((async (command: string) => {
      if (command === 'xcodebuild') {
        throw new Error('xcodebuild should not be called');
      }
      return { stdout: command === 'maestro-runner' ? 'maestro-runner 1.1.15\n' : '' };
    }) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
    });
    globalCtx.updateEnv({
      EAS_BUILD_RUNNER: 'eas-build',
      HOME: '/home/expo',
      PATH: '/usr/bin',
    });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { backend: 'maestro-runner' },
    });

    await step.executeAsync();

    expect(mockedSpawn).not.toHaveBeenCalledWith(
      'xcodebuild',
      expect.anything(),
      expect.anything()
    );
    expect(step.getOutputValueByName('maestro_version')).toBe('1.1.15');
  });

  it('checks Xcode for latest when a compatible maestro-runner version is installed', async () => {
    mockedSpawn.mockImplementation((async (command: string) => {
      switch (command) {
        case 'xcodebuild':
          return { stdout: 'Xcode 16.4\nBuild version 16F6\n' };
        case 'maestro-runner':
          return { stdout: 'maestro-runner 1.1.15\n' };
        default:
          return { stdout: '' };
      }
    }) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
    });
    globalCtx.updateEnv({
      EAS_BUILD_RUNNER: 'eas-build',
      HOME: '/home/expo',
      PATH: '/usr/bin',
    });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { backend: 'maestro-runner', maestro_version: 'latest' },
    });

    await step.executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'xcodebuild',
      ['-version'],
      expect.objectContaining({ env: expect.anything() })
    );
    expect(step.getOutputValueByName('maestro_version')).toBe('1.1.15');
  });

  it('installs the latest maestro-runner version on Xcode 26', async () => {
    let versionChecks = 0;
    mockedSpawn.mockImplementation((async (command: string) => {
      if (command === 'xcodebuild') {
        return { stdout: 'Xcode 26.0\nBuild version 17A324\n' };
      }
      if (command === 'maestro-runner' && versionChecks++ === 0) {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return { stdout: command === 'maestro-runner' ? 'maestro-runner 1.1.23\n' : '' };
    }) as any);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      text: async () => '#!/bin/sh\n',
    } as Response);
    const originalPath = process.env.PATH;

    try {
      const installMaestro = createInstallMaestroBuildFunction();
      const globalCtx = createGlobalContextMock({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
      });
      globalCtx.updateEnv({
        EAS_BUILD_RUNNER: 'eas-build',
        HOME: '/home/expo',
        PATH: '/usr/bin',
      });
      const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
        callInputs: { backend: 'maestro-runner' },
      });

      await step.executeAsync();

      expect(mockedSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/install_maestro_runner.*\/install_maestro_runner\.sh$/),
        [],
        expect.objectContaining({ env: expect.objectContaining({ HOME: '/home/expo' }) })
      );
      expect(step.getOutputValueByName('maestro_version')).toBe('1.1.23');
    } finally {
      fetchSpy.mockRestore();
      process.env.PATH = originalPath;
    }
  });

  it('throws a system error when the Xcode version cannot be determined', async () => {
    mockedSpawn.mockImplementation((async (command: string) => {
      if (command === 'xcodebuild') {
        return { stdout: 'unexpected output' };
      }
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
    });
    globalCtx.updateEnv({
      EAS_BUILD_RUNNER: 'eas-build',
      HOME: '/home/expo',
      PATH: '/usr/bin',
    });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { backend: 'maestro-runner' },
    });

    await expect(step.executeAsync()).rejects.toThrow(SystemError);
  });

  it('rejects a requested maestro-runner version that is incompatible with Xcode', async () => {
    mockedSpawn.mockImplementation((async (command: string) => {
      if (command === 'xcodebuild') {
        return { stdout: 'Xcode 16.4\nBuild version 16F6\n' };
      }
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }) as any);

    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
    });
    globalCtx.updateEnv({
      EAS_BUILD_RUNNER: 'eas-build',
      HOME: '/home/expo',
      PATH: '/usr/bin',
    });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { backend: 'maestro-runner', maestro_version: '1.1.23' },
    });

    const executePromise = step.executeAsync();
    await expect(executePromise).rejects.toThrow(UserError);
    await expect(executePromise).rejects.toMatchObject({
      errorCode: 'ERR_MAESTRO_INVALID_INPUT',
      message:
        'maestro-runner 1.1.23 is not compatible with Xcode 16.4.0. Use maestro-runner 1.1.15 or an Xcode 26+ image.',
    });
  });

  it('installs the requested maestro-runner version', async () => {
    let versionChecks = 0;
    mockedSpawn.mockImplementation((async (command: string) => {
      if (command === 'maestro-runner' && versionChecks++ === 0) {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return { stdout: command === 'maestro-runner' ? 'maestro-runner 1.0.9\n' : '' };
    }) as any);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      text: async () => '#!/bin/sh\n',
    } as Response);
    const originalPath = process.env.PATH;

    try {
      const installMaestro = createInstallMaestroBuildFunction();
      const globalCtx = createGlobalContextMock();
      globalCtx.updateEnv({
        EAS_BUILD_RUNNER: 'eas-build',
        HOME: '/home/expo',
        PATH: '/usr/bin',
      });
      const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
        callInputs: { backend: 'maestro-runner', maestro_version: '1.0.9' },
      });

      await step.executeAsync();

      expect(mockedSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/install_maestro_runner.*\/install_maestro_runner\.sh$/),
        ['--version', '1.0.9'],
        expect.objectContaining({ env: expect.objectContaining({ HOME: '/home/expo' }) })
      );
    } finally {
      jest.restoreAllMocks();
      process.env.PATH = originalPath;
    }
  });

  it('installs the prebuilt WDA cache for each available iOS runtime', async () => {
    const homeDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'install-maestro-test-')
    );
    mockedSpawn.mockImplementation((async (command: string, args: string[]) => {
      if (command === 'maestro-runner') {
        return { stdout: 'maestro-runner 1.2.3\n' };
      }
      if (command === 'xcrun') {
        return {
          stdout: JSON.stringify({
            runtimes: [
              {
                identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-3',
                isAvailable: true,
                version: '18.3',
              },
              {
                identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0',
                isAvailable: true,
                version: '26.0',
              },
              {
                identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5',
                isAvailable: false,
                version: '17.5',
              },
            ],
          }),
        };
      }
      if (command === 'xcodebuild') {
        return { stdout: 'Xcode 26.0\nBuild version 17A324\n' };
      }
      if (command === 'tar') {
        const maestroRunnerHome = args[args.indexOf('-C') + 1];
        const productsDirectory = path.join(
          maestroRunnerHome,
          'cache',
          'wda-builds',
          'generic',
          'DerivedData',
          'Build',
          'Products'
        );
        await fs.promises.mkdir(productsDirectory, { recursive: true });
        await fs.promises.writeFile(
          path.join(productsDirectory, 'WebDriverAgentRunner.xctestrun'),
          'cached'
        );
      }
      return { stdout: '' };
    }) as any);

    try {
      await writeInstalledWdaVersion(homeDirectory, '11.1.3');
      const installMaestro = createInstallMaestroBuildFunction();
      const globalCtx = createGlobalContextMock({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
      });
      globalCtx.updateEnv({
        EAS_BUILD_RUNNER: 'eas-build',
        HOME: homeDirectory,
      });
      const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
        callInputs: { backend: 'maestro-runner' },
      });

      await step.executeAsync();

      expect(mockedSpawn).toHaveBeenCalledWith(
        'curl',
        expect.arrayContaining([
          'https://storage.googleapis.com/turtle-v2/maestro-runner-wda-cache/xcode-26.0-wda-11.1.3.tar.gz',
        ]),
        expect.objectContaining({ env: expect.objectContaining({ HOME: homeDirectory }) })
      );
      for (const runtimeVersion of ['18.3', '26.0']) {
        await expect(
          fs.promises.readFile(
            path.join(
              homeDirectory,
              '.maestro-runner',
              'cache',
              'wda-builds',
              `sim-ios${runtimeVersion}-iphone`,
              'DerivedData',
              'Build',
              'Products',
              'WebDriverAgentRunner.xctestrun'
            ),
            'utf8'
          )
        ).resolves.toBe('cached');
      }
      await expect(
        fs.promises.access(
          path.join(homeDirectory, '.maestro-runner', 'cache', 'wda-builds', 'sim-ios17.5-iphone')
        )
      ).rejects.toThrow();
    } finally {
      await fs.promises.rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it('does not download the WDA cache when the installed WDA version is unknown', async () => {
    mockedSpawn.mockResolvedValue({ stdout: 'maestro-runner 1.2.3\n' } as any);
    const installMaestro = createInstallMaestroBuildFunction();
    const globalCtx = createGlobalContextMock({
      runtimePlatform: BuildRuntimePlatform.DARWIN,
    });
    globalCtx.updateEnv({ EAS_BUILD_RUNNER: 'eas-build', HOME: '/home/expo' });
    const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { backend: 'maestro-runner' },
    });

    await step.executeAsync();

    expect(mockedSpawn.mock.calls.map(([command]) => command)).toEqual([
      'maestro-runner',
      'maestro-runner',
    ]);
  });

  it('continues when the prebuilt WDA cache is not available', async () => {
    mockedSpawn.mockImplementation((async (command: string) => {
      switch (command) {
        case 'maestro-runner':
          return { stdout: 'maestro-runner 1.2.3\n' };
        case 'xcodebuild':
          return { stdout: 'Xcode 26.5\nBuild version 17F90\n' };
        case 'xcrun':
          return {
            stdout: JSON.stringify({
              runtimes: [
                {
                  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
                  isAvailable: true,
                  version: '26.5',
                },
              ],
            }),
          };
        case 'curl':
          throw new Error('HTTP 404');
        default:
          return { stdout: '' };
      }
    }) as any);
    const homeDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'install-maestro-test-')
    );

    try {
      await writeInstalledWdaVersion(homeDirectory, '11.1.3');
      const installMaestro = createInstallMaestroBuildFunction();
      const globalCtx = createGlobalContextMock({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
      });
      globalCtx.updateEnv({ EAS_BUILD_RUNNER: 'eas-build', HOME: homeDirectory });
      const step = installMaestro.createBuildStepFromFunctionCall(globalCtx, {
        callInputs: { backend: 'maestro-runner' },
      });

      await expect(step.executeAsync()).resolves.toBeUndefined();
      expect(step.getOutputValueByName('maestro_version')).toBe('1.2.3');
    } finally {
      await fs.promises.rm(homeDirectory, { force: true, recursive: true });
    }
  });
});
