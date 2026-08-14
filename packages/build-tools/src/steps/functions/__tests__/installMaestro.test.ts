import spawn from '@expo/turtle-spawn';

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
            PATH: expect.stringMatching(/:\/home\/expo\/\.maestro-runner\/bin$/),
          }),
        })
      );
    } finally {
      fetchSpy.mockRestore();
      process.env.PATH = originalPath;
    }
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
});
