import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepContext, type BuildStepEnv } from '@expo/steps';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  startDeviceWebPreviewWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { createStartWebPreviewRemoteSessionBuildFunction } from '../startWebPreviewRemoteSession';

jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  getDeviceRunSessionIdOrThrow: jest.fn(),
  getNgrokTunnelDomainOrThrow: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  startDeviceWebPreviewWithTunnelAsync: jest.fn(),
  uploadRemoteSessionConfigAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));

const ctx = {} as CustomBuildContext;
const env = {} as BuildStepEnv;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const stopAsync = jest.fn();

async function runAsync(
  runtimePlatform: BuildRuntimePlatform,
  launchInputs: Record<string, { value: unknown }> = {}
): Promise<void> {
  const buildFunction = createStartWebPreviewRemoteSessionBuildFunction(ctx);
  await buildFunction.fn!(
    {
      logger,
      global: { runtimePlatform },
    } as unknown as BuildStepContext,
    {
      inputs: {
        package_version: { value: '1.2.3' },
        max_duration_seconds: { value: 120 },
        ...launchInputs,
      },
      outputs: {},
      env,
    } as never
  );
}

describe(createStartWebPreviewRemoteSessionBuildFunction, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('device-run-session-id');
    jest.mocked(getNgrokTunnelDomainOrThrow).mockReturnValue('tunnel.example.com');
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockResolvedValue(undefined);
    jest.mocked(startDeviceWebPreviewWithTunnelAsync).mockResolvedValue({
      previewUrl: 'https://web-preview.example.test',
      stopAsync,
    });
    jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue(undefined);
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);
    stopAsync.mockResolvedValue(undefined);
  });

  it.each([
    [BuildRuntimePlatform.DARWIN, true],
    [BuildRuntimePlatform.LINUX, false],
  ])('starts the web preview for %s', async (runtimePlatform, selectsXcode) => {
    await runAsync(runtimePlatform);

    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledTimes(selectsXcode ? 1 : 0);
    expect(startDeviceWebPreviewWithTunnelAsync).toHaveBeenCalledWith(ctx, {
      runtimePlatform,
      baseDomain: 'tunnel.example.com',
      env,
      logger,
      timeoutMs: 60_000,
      packageVersion: '1.2.3',
      launchAppIdentifier: undefined,
      launchArgs: [],
      openUrl: undefined,
    });
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith({
      ctx,
      deviceRunSessionId: 'device-run-session-id',
      remoteConfig: { previewUrl: 'https://web-preview.example.test' },
      logger,
    });
    expect(waitForDeviceRunSessionStoppedAsync).toHaveBeenCalledWith({
      ctx,
      deviceRunSessionId: 'device-run-session-id',
      logger,
      maxDurationSeconds: 120,
      signal: undefined,
    });
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it('declares the launch inputs', () => {
    const buildFunction = createStartWebPreviewRemoteSessionBuildFunction(ctx);
    const globalCtx = createGlobalContextMock();

    expect(
      buildFunction.inputProviders?.map(provider => provider(globalCtx, 'Test step').id)
    ).toEqual([
      'launch_app_identifier',
      'launch_args',
      'open_url',
      'package_version',
      'max_duration_seconds',
    ]);
  });

  it('hands the launch inputs to the web preview and announces them', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, {
      launch_app_identifier: { value: 'host.exp.Exponent' },
      launch_args: { value: ['-EXDevMenuIsOnboardingFinished', '1'] },
      open_url: { value: 'exp://127.0.0.1:8081' },
    });

    expect(startDeviceWebPreviewWithTunnelAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        launchAppIdentifier: 'host.exp.Exponent',
        launchArgs: ['-EXDevMenuIsOnboardingFinished', '1'],
        openUrl: 'exp://127.0.0.1:8081',
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'serve-sim will launch host.exp.Exponent with arguments ' +
        '["-EXDevMenuIsOnboardingFinished","1"], then open exp://127.0.0.1:8081.'
    );
  });

  it('fails before starting anything when a launch is asked for on Android', async () => {
    await expect(
      runAsync(BuildRuntimePlatform.LINUX, {
        launch_app_identifier: { value: 'host.exp.Exponent' },
      })
    ).rejects.toThrow('runs on linux');
    expect(startDeviceWebPreviewWithTunnelAsync).not.toHaveBeenCalled();
  });
});
