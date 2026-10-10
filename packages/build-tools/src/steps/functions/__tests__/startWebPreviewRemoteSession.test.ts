import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepContext, type BuildStepEnv } from '@expo/steps';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { createStartWebPreviewRemoteSessionBuildFunction } from '../startWebPreviewRemoteSession';

jest.mock('../../utils/deviceSessionHost');
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: {
    resolveUdidAsync: jest.fn().mockResolvedValue('selected-ios-udid'),
    getAvailableDevicesAsync: jest
      .fn()
      .mockResolvedValue([{ name: 'iPhone 17', udid: 'selected-ios-udid' }]),
  },
}));
jest.mock('../../utils/iosAppArtifact', () => ({
  ...jest.requireActual('../../utils/iosAppArtifact'),
  readIosApplicationIdentifierAsync: jest.fn().mockResolvedValue('dev.example.app'),
}));
jest.mock('../../utils/localEgressGuard', () => ({
  resolveLocalEgressServeSimBootEnvironmentAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  getDeviceRunSessionIdOrThrow: jest.fn(),
  getNgrokTunnelDomainOrThrow: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
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
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.example.test',
        closeAsync: jest.fn(),
      }),
      finishAsync: stopAsync,
    });
    jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue(undefined);
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);
    stopAsync.mockResolvedValue(undefined);
  });

  it('reports the session token when serve-sim minted one', async () => {
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.example.test',
        previewToken: 'tok-1',
        closeAsync: jest.fn(),
      }),
      finishAsync: stopAsync,
    });

    await runAsync(BuildRuntimePlatform.DARWIN);

    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: {
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://web-preview.example.test',
          webPreviewToken: 'tok-1',
          previewToken: 'tok-1',
        },
      })
    );
  });

  it.each(['preview', 'config', 'wait'])('finishes the session after %s fails', async phase => {
    const error = new Error(`${phase} failed`);
    if (phase === 'preview') {
      jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
        openPreviewAsync: jest.fn().mockRejectedValue(error),
        finishAsync: stopAsync,
      });
    } else if (phase === 'config') {
      jest.mocked(uploadRemoteSessionConfigAsync).mockRejectedValueOnce(error);
    } else {
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValueOnce(error);
    }
    await expect(runAsync(BuildRuntimePlatform.LINUX)).rejects.toBe(error);
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    [BuildRuntimePlatform.DARWIN, true],
    [BuildRuntimePlatform.LINUX, false],
  ])('starts the web preview for %s', async (runtimePlatform, selectsXcode) => {
    await runAsync(runtimePlatform, selectsXcode ? { boot_simulator: { value: true } } : {});

    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledTimes(selectsXcode ? 1 : 0);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(ctx, {
      runtimePlatform,
      env,
      logger,
      timeoutMs: 60_000,
      signal: undefined,
      ...(selectsXcode
        ? {
            iosSimulatorUdid: 'SELECTED-IOS-UDID',
            installAppPath: undefined,
            bootEnv: undefined,
          }
        : {}),
      packageVersion: '1.2.3',
      launchAppIdentifier: undefined,
      launchArgs: [],
      openUrl: undefined,
      networkCapture: false,
      networkCaptureFields: [],
    });
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith({
      ctx,
      deviceRunSessionId: 'device-run-session-id',
      remoteConfig: {
        webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
        previewUrl: 'https://expo.dev/simulator-preview/preview-id',
        previewApiUrl: 'https://web-preview.example.test',
      },
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
      'boot_simulator',
      'device_identifier',
      'install_app_path',
      'network_capture',
      'network_capture_fields',
      'package_version',
      'max_duration_seconds',
    ]);
  });

  it('hands the launch inputs to the session host and announces them', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, {
      launch_app_identifier: { value: 'host.exp.Exponent' },
      launch_args: { value: ['-EXDevMenuIsOnboardingFinished', '1'] },
      open_url: { value: 'exp://127.0.0.1:8081' },
    });

    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
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

  it('hands the downloaded app and selected device to serve-sim with initial launch options', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, {
      device_identifier: { value: 'chosen-device' },
      install_app_path: { value: '/tmp/App.app' },
      launch_args: { value: ['--literal', 'value with spaces'] },
      open_url: { value: 'example://home' },
    });
    expect(
      jest.mocked(selectXcodeDeveloperDirectoryAsync).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(IosSimulatorUtils.resolveUdidAsync).mock.invocationCallOrder[0]);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        iosSimulatorUdid: 'SELECTED-IOS-UDID',
        installAppPath: '/tmp/App.app',
        launchAppIdentifier: 'dev.example.app',
        launchArgs: ['--literal', 'value with spaces'],
        openUrl: 'example://home',
      })
    );
  });

  it('hands network capture to the session host', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, {
      network_capture: { value: true },
      network_capture_fields: { value: ['header', 'response-body'] },
    });

    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        networkCapture: true,
        networkCaptureFields: ['header', 'response-body'],
      })
    );
  });

  it('fails before starting anything when network capture is asked for on Android', async () => {
    await expect(
      runAsync(BuildRuntimePlatform.LINUX, {
        network_capture: { value: true },
      })
    ).rejects.toThrow('this session runs on linux');
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  });

  it('fails before starting anything when a launch is asked for on Android', async () => {
    await expect(
      runAsync(BuildRuntimePlatform.LINUX, {
        launch_app_identifier: { value: 'host.exp.Exponent' },
      })
    ).rejects.toThrow('runs on linux');
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  });
});
