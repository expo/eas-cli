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
import {
  createWarmDeviceSessionServer,
  runOnWarmIosSimulatorAsync,
} from '../../utils/warmDeviceSessionHost';
import { type WarmIosSession } from '../../utils/warmIosSession';
import { watchDeviceRunSessionStartup } from '../../utils/deviceRunSessionStartup';
import { createStartupWatchMock } from '../../../__tests__/utils/startupWatch';
import { createStartWebPreviewRemoteSessionBuildFunction } from '../startWebPreviewRemoteSession';

jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/warmDeviceSessionHost');
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
jest.mock('../../utils/deviceRunSessionStartup', () => ({
  watchDeviceRunSessionStartup: jest.fn(),
}));

const ctx = {} as CustomBuildContext;
const env = { NGROK_AUTHTOKEN: 'ngrok-token', PATH: '/usr/bin' } as BuildStepEnv;
const childEnv = { PATH: '/usr/bin' } as BuildStepEnv;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const stopAsync = jest.fn();

async function runAsync(
  runtimePlatform: BuildRuntimePlatform,
  launchInputs: Record<string, { value: unknown }> = {},
  signal?: AbortSignal
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
      signal,
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
        sharePageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.example.test',
        closeAsync: jest.fn(),
      }),
      getLastPreviewActivityAt: jest.fn(),
      finishAsync: stopAsync,
    });
    jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue('started');
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);
    jest.mocked(watchDeviceRunSessionStartup).mockImplementation(createStartupWatchMock);
    stopAsync.mockResolvedValue(undefined);
  });

  it('does not start a host when the parent aborts during Xcode selection', async () => {
    const controller = new AbortController();
    const failure = new Error('parent step cancelled');
    jest
      .mocked(selectXcodeDeveloperDirectoryAsync)
      .mockImplementationOnce(async () => controller.abort(failure));
    await expect(runAsync(BuildRuntimePlatform.DARWIN, {}, controller.signal)).rejects.toBe(
      failure
    );
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    expect(watchDeviceRunSessionStartup).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.finishAsync
    ).toHaveBeenCalled();
  });

  it('keeps watching startup when warm adoption retries cold', async () => {
    const adoption = new Error('warm adoption failed');
    jest.mocked(runOnWarmIosSimulatorAsync).mockImplementation(async (_claim, run) => {
      try {
        return await run({
          device: { udid: 'selected-ios-udid', name: 'iPhone 17' },
        } as WarmIosSession);
      } catch (error) {
        if (error !== adoption) {
          throw error;
        }
        return await run(undefined);
      }
    });
    jest.mocked(startDeviceSessionHostAsync).mockImplementationOnce(async (_ctx, options) => {
      options.onStartupError?.(adoption);
      throw adoption;
    });
    await expect(
      Promise.resolve(
        createStartWebPreviewRemoteSessionBuildFunction(ctx, { warm: true }).fn!(
          { logger, global: { runtimePlatform: BuildRuntimePlatform.DARWIN } } as never,
          {
            inputs: {
              boot_simulator: { value: true },
              package_version: { value: undefined },
              max_idle_time_minutes: { value: undefined },
            },
            outputs: {},
            env,
          } as never
        )
      )
    ).resolves.toBeUndefined();
    expect(watchDeviceRunSessionStartup).toHaveBeenCalledTimes(1);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'observes Stop during warm claim and preserves cleanup failure=%s',
    async failCleanup => {
      let entered!: () => void;
      const claiming = new Promise<void>(resolve => {
        entered = resolve;
      });
      const cleanup = new Error('warm cleanup failed');
      jest.mocked(runOnWarmIosSimulatorAsync).mockImplementation(async claim => {
        entered();
        await new Promise<void>((_resolve, reject) => {
          claim.signal!.addEventListener(
            'abort',
            () =>
              reject(
                failCleanup
                  ? new AggregateError([claim.signal!.reason, cleanup])
                  : claim.signal!.reason
              ),
            { once: true }
          );
        });
      });
      const running = createStartWebPreviewRemoteSessionBuildFunction(ctx, { warm: true }).fn!(
        { logger, global: { runtimePlatform: BuildRuntimePlatform.DARWIN } } as never,
        {
          inputs: {
            package_version: { value: undefined },
            max_idle_time_minutes: { value: undefined },
          },
          outputs: {},
          env,
        } as never
      ) as Promise<void>;
      running.catch(() => {});
      await claiming;
      jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.stop();
      if (failCleanup) {
        await expect(running).rejects.toMatchObject({ errors: expect.arrayContaining([cleanup]) });
      } else {
        await expect(running).resolves.toBeUndefined();
      }
      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    }
  );
  it('adopts the claimed warm Simulator when the warm step runs', async () => {
    const warmServer = { port: 3200 } as never;
    const warm = { device: { udid: 'SELECTED-IOS-UDID', name: 'iPhone 17' } } as WarmIosSession;
    jest.mocked(createWarmDeviceSessionServer).mockReturnValue(warmServer);
    jest.mocked(runOnWarmIosSimulatorAsync).mockImplementation((_claim, run) => run(warm));
    const buildFunction = createStartWebPreviewRemoteSessionBuildFunction(ctx, { warm: true });
    expect(buildFunction.id).toBe('start_warm_serve_sim_remote_session');
    await buildFunction.fn!(
      { logger, global: { runtimePlatform: BuildRuntimePlatform.DARWIN } } as never,
      { inputs: { device_identifier: { value: 'iPhone 17' } }, outputs: {}, env } as never
    );
    expect(runOnWarmIosSimulatorAsync).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'serve-sim', requestedDevice: 'iPhone 17' }),
      expect.any(Function)
    );
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ iosSimulatorUdid: 'SELECTED-IOS-UDID' }),
      warmServer
    );
  });

  it('passes the resolved version to cold setup after a warm version mismatch', async () => {
    jest
      .mocked(runOnWarmIosSimulatorAsync)
      .mockImplementation((_claim, run) => run(undefined, '0.14.0'));
    await createStartWebPreviewRemoteSessionBuildFunction(ctx, { warm: true }).fn!(
      { logger, global: { runtimePlatform: BuildRuntimePlatform.DARWIN } } as never,
      { inputs: { package_version: { value: 'latest' } }, outputs: {}, env } as never
    );
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ packageVersion: '0.14.0' })
    );
  });

  it('uses preview activity to reset the configured idle timeout', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, { max_idle_time_minutes: { value: 5 } });
    const { idleTimeout } = jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.calls[0][0];
    expect(idleTimeout?.maxIdleTimeMinutes).toBe(5);
    expect(idleTimeout?.getLastEventObservedAt()).toBeUndefined();
    const host = await jest.mocked(startDeviceSessionHostAsync).mock.results[0].value;
    const observedAt = new Date();
    jest.mocked(host.getLastPreviewActivityAt).mockReturnValue(observedAt);
    expect(idleTimeout?.getLastPreviewActivityAt?.()).toBe(observedAt);
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it.each([BuildRuntimePlatform.DARWIN, BuildRuntimePlatform.LINUX])(
    'leaves the idle timer disabled when omitted on %s',
    async runtimePlatform => {
      await runAsync(runtimePlatform);
      expect(waitForDeviceRunSessionStoppedAsync).toHaveBeenCalledWith(
        expect.objectContaining({ idleTimeout: undefined, maxDurationSeconds: 120 })
      );
    }
  );

  it('leaves the idle timer disabled for zero', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, {
      max_idle_time_minutes: { value: 0 },
    });
    expect(waitForDeviceRunSessionStoppedAsync).toHaveBeenCalledWith(
      expect.objectContaining({ idleTimeout: undefined, maxDurationSeconds: 120 })
    );
  });

  it('rejects an Android idle timeout before starting the host', async () => {
    await expect(
      runAsync(BuildRuntimePlatform.LINUX, {
        max_idle_time_minutes: { value: 5 },
      })
    ).rejects.toThrow('Omit max_idle_time_minutes for Android sessions.');
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    expect(waitForDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
  });

  it.each([BuildRuntimePlatform.DARWIN, BuildRuntimePlatform.LINUX])(
    'handles Stop while the %s host starts',
    async runtimePlatform => {
      let hostEntered!: () => void;
      const entered = new Promise<void>(resolve => {
        hostEntered = resolve;
      });
      jest.mocked(startDeviceSessionHostAsync).mockImplementationOnce((_ctx, { signal }) => {
        hostEntered();
        return new Promise((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('host aborted')), { once: true })
        );
      });
      const running = runAsync(runtimePlatform);
      running.catch(() => {});
      await entered;
      const watch = jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value;
      watch.stop();
      await expect(running).resolves.toBeUndefined();
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
      expect(waitForDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
      expect(watch.finishAsync).toHaveBeenCalled();
    }
  );

  it.each([BuildRuntimePlatform.DARWIN, BuildRuntimePlatform.LINUX])(
    'preserves an earlier %s host failure when Stop arrives during cleanup',
    async runtimePlatform => {
      const failure = new Error('Host became ready without a session token');
      let cleanupEntered!: () => void;
      const entered = new Promise<void>(resolve => {
        cleanupEntered = resolve;
      });
      let finishCleanup!: () => void;
      const cleanup = new Promise<void>(resolve => {
        finishCleanup = resolve;
      });
      jest.mocked(startDeviceSessionHostAsync).mockImplementationOnce(async (_ctx, options) => {
        options.onStartupError?.(failure);
        cleanupEntered();
        await cleanup;
        throw failure;
      });
      const running = runAsync(runtimePlatform);
      running.catch(() => {});
      try {
        await entered;
        jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.stop();
      } finally {
        finishCleanup();
      }
      await expect(running).rejects.toBe(failure);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
      expect(waitForDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
    }
  );

  it('keeps a teardown failure visible after Stop during preview setup', async () => {
    let previewEntered!: () => void;
    let finishPreview!: (value: {
      previewPageUrl: string;
      apiUrl: string;
      closeAsync: () => Promise<void>;
    }) => void;
    const entered = new Promise<void>(resolve => {
      previewEntered = resolve;
    });
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
      openPreviewAsync: () => {
        previewEntered();
        return new Promise(resolve => {
          finishPreview = resolve;
        });
      },
      finishAsync: stopAsync,
      getLastPreviewActivityAt: jest.fn(),
    });
    const failed = new Error('host teardown failed');
    stopAsync.mockRejectedValueOnce(failed);
    const running = runAsync(BuildRuntimePlatform.LINUX);
    running.catch(() => {});
    await entered;
    const watch = jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value;
    watch.stop();
    finishPreview({
      previewPageUrl: 'https://preview.test',
      apiUrl: 'https://server.test',
      closeAsync: async () => {},
    });
    await expect(running).rejects.toBe(failed);
    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it('retires the startup watcher before lifetime waiting', async () => {
    await runAsync(BuildRuntimePlatform.LINUX);
    const watch = jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value;
    expect(watch.completeAsync.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.invocationCallOrder[0]
    );
  });

  it('reports the session token when serve-sim minted one', async () => {
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        sharePageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.example.test',
        previewToken: 'tok-1',
        closeAsync: jest.fn(),
      }),
      getLastPreviewActivityAt: jest.fn(),
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

  it('logs the authenticated link while publishing the public frame URL', async () => {
    const privatePreviewUrl = 'https://expo.dev/private-preview';
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        sharePageUrl: privatePreviewUrl,
        apiUrl: 'https://web-preview.example.test',
        closeAsync: jest.fn(),
      }),
      getLastPreviewActivityAt: jest.fn(),
      finishAsync: stopAsync,
    });

    await runAsync(BuildRuntimePlatform.DARWIN, {
      public_preview: { value: false },
      private_preview_url: { value: privatePreviewUrl },
    });

    expect(logger.info).toHaveBeenCalledWith(
      `Preview URL: ${privatePreviewUrl} (server: https://web-preview.example.test).`
    );
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
        }),
      })
    );
  });

  it('does not log the public link when a private job lacks its authenticated URL', async () => {
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.example.test',
        closeAsync: jest.fn(),
      }),
      getLastPreviewActivityAt: jest.fn(),
      finishAsync: stopAsync,
    });
    await runAsync(BuildRuntimePlatform.DARWIN, { public_preview: { value: false } });

    expect(logger.info).toHaveBeenCalledWith('Private preview URL unavailable for this session.');
    expect(jest.mocked(logger.info).mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.stringContaining('/simulator-preview/preview-id')]),
      ])
    );
  });

  it.each(['preview', 'config', 'wait'])('finishes the session after %s fails', async phase => {
    const error = new Error(`${phase} failed`);
    if (phase === 'preview') {
      jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
        openPreviewAsync: jest.fn().mockRejectedValue(error),
        getLastPreviewActivityAt: jest.fn(),
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

    expect(
      jest
        .mocked(logger.info)
        .mock.calls.filter(
          ([message]) =>
            message ===
            'Preview URL: https://expo.dev/simulator-preview/preview-id (server: https://web-preview.example.test).'
        )
    ).toHaveLength(1);
    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledTimes(selectsXcode ? 1 : 0);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(ctx, {
      runtimePlatform,
      env: childEnv,
      logger,
      timeoutMs: 60_000,
      preview: { baseDomain: 'tunnel.example.com', authtoken: 'ngrok-token' },
      signal: expect.any(AbortSignal),
      onStartupError: expect.any(Function),
      ...(selectsXcode
        ? {
            iosSimulatorUdid: 'SELECTED-IOS-UDID',
            installAppPath: undefined,
            bootEnv: undefined,
          }
        : {}),
      packageVersion: '1.2.3',
      disableShare: false,
      frameAncestors: [],
      corsOrigins: [],
      launchAppIdentifier: undefined,
      launchArgs: [],
      openUrl: undefined,
      networkCapture: false,
      networkCaptureFields: [],
    });
    const host = await jest.mocked(startDeviceSessionHostAsync).mock.results[0].value;
    expect(host.openPreviewAsync).toHaveBeenCalledWith();
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith({
      ctx,
      deviceRunSessionId: 'device-run-session-id',
      remoteConfig: {
        webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
        previewUrl: 'https://expo.dev/simulator-preview/preview-id',
        previewApiUrl: 'https://web-preview.example.test',
      },
      logger,
      signal: expect.any(AbortSignal),
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
      'public_preview',
      'private_preview_url',
      'frame_ancestors',
      'cors_origins',
      'package_version',
      'max_idle_time_minutes',
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
  it.each([true, false])(
    'maps public_preview=%s to the native Share option',
    async publicPreview => {
      await runAsync(BuildRuntimePlatform.DARWIN, {
        public_preview: { value: publicPreview },
        private_preview_url: { value: 'https://expo.dev/private-preview' },
      });
      expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          disableShare: !publicPreview,
          privatePreviewUrl: 'https://expo.dev/private-preview',
        })
      );
    }
  );

  it('hands frame_ancestors to the session host', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, {
      frame_ancestors: { value: ['https://embed.example.test'] },
    });
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ frameAncestors: ['https://embed.example.test'] })
    );
  });

  it('hands cors_origins to the session host', async () => {
    await runAsync(BuildRuntimePlatform.DARWIN, {
      cors_origins: { value: ['https://app.example.test'] },
    });
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ corsOrigins: ['https://app.example.test'] })
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
