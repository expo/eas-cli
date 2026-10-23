import { BuildFunction, BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';

import { type CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { pollAgentDeviceArtifactsForUploadAsync } from '../../utils/agentDeviceArtifacts';
import { startAgentDeviceEventCollectionAsync } from '../../utils/agentDeviceEvents';
import { pollArgentArtifactsForUploadAsync } from '../../utils/argentArtifacts';
import { startArgentEventCollectionAsync } from '../../utils/argentEvents';
import { readIosApplicationIdentifierAsync } from '../../utils/iosAppArtifact';
import { resolveIosSessionStartupAsync } from '../../utils/iosSimulatorSession';
import { readLocalEgressHandoffAsync } from '../../utils/localEgress';
import { resolveLocalEgressServeSimBootEnvironmentAsync } from '../../utils/localEgressGuard';
import {
  uploadRemoteSessionConfigWithLocalEgressAsync,
  withLocalEgressSession,
} from '../../utils/localEgressSession';
import {
  WarmSessionAdoptionError,
  startWarmDeviceSessionHostAsync,
} from '../../utils/warmDeviceSessionHost';
import {
  type WarmIosSession,
  stopWarmIosSessionAsync,
  tryClaimWarmIosSessionAsync,
} from '../../utils/warmIosSession';
import {
  ensureFfmpegInstalledOnceAsync,
  fetchWebPreviewTurnArgsAsync,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { downloadBuildAsync } from '../downloadBuild';
import { createStartAgentDeviceSessionBuildFunction } from '../startAgentDeviceSession';
import { createStartArgentRemoteSessionBuildFunction } from '../startArgentRemoteSession';
import { createStartWebPreviewRemoteSessionBuildFunction } from '../startWebPreviewRemoteSession';
import {
  createStartWarmAgentDeviceSessionBuildFunction,
  createStartWarmArgentRemoteSessionBuildFunction,
  createStartWarmWebPreviewRemoteSessionBuildFunction,
} from '../startWarmIosSimulatorSession';

jest.mock('../startAgentDeviceSession');
jest.mock('../startArgentRemoteSession');
jest.mock('../startWebPreviewRemoteSession');
jest.mock('../downloadBuild', () => ({ downloadBuildAsync: jest.fn() }));
jest.mock('../../utils/deviceRunSessionWorkerApi', () => ({
  getDeviceRunSessionWorkerApi: jest.fn(),
}));
jest.mock('../../utils/agentDeviceArtifacts');
jest.mock('../../utils/agentDeviceEvents');
jest.mock('../../utils/argentArtifacts');
jest.mock('../../utils/argentEvents');
jest.mock('../../utils/iosAppArtifact');
jest.mock('../../utils/iosSimulatorSession');
jest.mock('../../utils/localEgress');
jest.mock('../../utils/localEgressGuard');
jest.mock('../../utils/localEgressSession', () => ({
  withLocalEgressSession: jest.fn(
    jest.requireActual('../../utils/localEgressSession').withLocalEgressSession
  ),
  uploadRemoteSessionConfigWithLocalEgressAsync: jest.fn(),
}));
jest.mock('../../utils/warmIosSession');
jest.mock('../../utils/warmDeviceSessionHost', () => ({
  WarmSessionAdoptionError: class WarmSessionAdoptionError extends Error {},
  startWarmDeviceSessionHostAsync: jest.fn(),
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
  fetchWebPreviewTurnArgsAsync: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));

const ctx = { graphqlClient: {} } as CustomBuildContext;
const old = jest.fn();
const stopWarm = jest.fn();
const stopEvents = jest.fn();
const stopTunnel = jest.fn();
const finishHost = jest.fn();
const host = {
  openPreviewAsync: jest.fn(),
  getLastPreviewActivityAt: jest.fn(),
  finishAsync: finishHost,
};
let warm: WarmIosSession;
const engines = [
  [
    'serve-sim',
    createStartWarmWebPreviewRemoteSessionBuildFunction,
    createStartWebPreviewRemoteSessionBuildFunction,
    'start_serve_sim_remote_session',
  ],
  [
    'agent-device',
    createStartWarmAgentDeviceSessionBuildFunction,
    createStartAgentDeviceSessionBuildFunction,
    'start_agent_device_session',
  ],
  [
    'argent',
    createStartWarmArgentRemoteSessionBuildFunction,
    createStartArgentRemoteSessionBuildFunction,
    'start_argent_remote_session',
  ],
] as const;

function invocation(
  inputValues: Record<string, unknown> = {},
  env: Record<string, string> = {},
  signal?: AbortSignal
) {
  return [
    {
      logger: { info: jest.fn(), warn: jest.fn() },
      global: {
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        staticContext: { job: { secrets: { robotAccessToken: 'robot' } } },
      },
    } as unknown as BuildStepContext,
    {
      inputs: Object.fromEntries(
        Object.entries({ boot_simulator: true, ...inputValues }).map(([key, value]) => [
          key,
          { value },
        ])
      ),
      outputs: {},
      signal,
      env: {
        DEVICE_RUN_SESSION_ID: 'session',
        EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'tunnel.example',
        NGROK_AUTHTOKEN: 'ngrok-secret',
        EAS_USE_WARM_SIMULATOR: '1',
        ...env,
      },
    },
  ] as const;
}

beforeEach(() => {
  jest.clearAllMocks();
  old.mockResolvedValue(undefined);
  stopWarm.mockResolvedValue(undefined);
  stopTunnel.mockResolvedValue(undefined);
  stopEvents.mockResolvedValue(undefined);
  warm = {
    device: { udid: 'UDID', name: 'iPhone 17' },
    serveSim: { pid: 10, port: 3200, token: 'serve-token' },
    tools: { pid: 20, port: 3201, token: 'tools-token' },
    agentDeviceStateDir: '/warm/agent',
    argentEventLogPath: '/warm/argent-events',
    process: {
      pid: 10,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopWarm,
    },
  };
  for (const [, , factory, id] of engines) {
    jest
      .mocked(factory)
      .mockReturnValue(new BuildFunction({ namespace: 'eas', id, fn: old, inputProviders: [] }));
  }
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue(null);
  jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue(null);
  jest
    .mocked(resolveIosSessionStartupAsync)
    .mockResolvedValue({ launch: {}, iosStartup: { iosSimulatorUdid: 'UDID' } });
  jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
  jest.mocked(stopWarmIosSessionAsync).mockResolvedValue(undefined);
  jest.mocked(startWarmDeviceSessionHostAsync).mockResolvedValue(host);
  host.openPreviewAsync.mockResolvedValue({
    previewPageUrl: 'https://preview.example/new-job',
    apiUrl: 'https://fresh.example',
    previewToken: 'serve-token',
  });
  finishHost.mockImplementation(stopWarm);
  jest.mocked(startNgrokTunnelAsync).mockResolvedValue({
    url: 'https://fresh-tools.example',
    subdomainId: 'new-job',
    stopAsync: stopTunnel,
  });
  for (const collector of [startAgentDeviceEventCollectionAsync, startArgentEventCollectionAsync]) {
    jest
      .mocked(collector)
      .mockResolvedValue({ stopAsync: stopEvents, getLastEventObservedAt: () => undefined });
  }
  jest.mocked(pollAgentDeviceArtifactsForUploadAsync).mockResolvedValue(undefined);
  jest.mocked(pollArgentArtifactsForUploadAsync).mockResolvedValue(undefined);
  jest.mocked(uploadRemoteSessionConfigWithLocalEgressAsync).mockResolvedValue(undefined);
  jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);
  jest.mocked(ensureFfmpegInstalledOnceAsync).mockResolvedValue(undefined);
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockResolvedValue([]);
  jest.mocked(downloadBuildAsync).mockResolvedValue({ artifactPath: '/tmp/Fixture.app' });
  jest.mocked(readIosApplicationIdentifierAsync).mockResolvedValue('dev.fixture');
});

it.each(engines)(
  'adopts %s and reports fresh per-job endpoints without invoking v1',
  async (engine, factory, originalFactory) => {
    const original = originalFactory(ctx);
    const fn = factory(ctx);
    expect(fn.id).toBe(original.id.replace('start_', 'start_warm_'));
    expect(fn.inputProviders).toBe(originalFactory(ctx).inputProviders);
    await fn.fn!(...invocation());
    expect(old).not.toHaveBeenCalled();
    expect(withLocalEgressSession).toHaveBeenCalledTimes(1);
    expect(tryClaimWarmIosSessionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ engine, requestedDevice: undefined })
    );
    expect(host.openPreviewAsync).toHaveBeenCalledTimes(1);
    expect(ensureFfmpegInstalledOnceAsync).not.toHaveBeenCalled();
    expect(uploadRemoteSessionConfigWithLocalEgressAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining(
          engine === 'serve-sim'
            ? { previewUrl: 'https://preview.example/new-job' }
            : engine === 'agent-device'
              ? {
                  agentDeviceRemoteSessionUrl: 'https://fresh-tools.example',
                  agentDeviceRemoteSessionToken: 'tools-token',
                }
              : { toolsUrl: 'https://fresh-tools.example', toolsAuthToken: 'tools-token' }
        ),
      })
    );
    expect(finishHost).toHaveBeenCalledTimes(1);
  }
);

it.each(engines)('delegates %s directly to v1 when the flag is off', async (_engine, factory) => {
  const args = invocation({}, { EAS_USE_WARM_SIMULATOR: '0' });
  await factory(ctx).fn!(...args);
  expect(old).toHaveBeenCalledWith(...args);
  expect(withLocalEgressSession).not.toHaveBeenCalled();
  expect(tryClaimWarmIosSessionAsync).not.toHaveBeenCalled();
});

it.each(['SIMCTL_CHILD_TEST'])('lets claim check the job-specific %s override', async input => {
  const args = invocation({}, { [input]: '1' });
  jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValueOnce(undefined);
  await createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...args);
  expect(old).toHaveBeenCalledWith(...args);
  expect(tryClaimWarmIosSessionAsync).toHaveBeenCalledWith(
    expect.objectContaining({ env: expect.objectContaining({ [input]: '1' }) })
  );
});

it('delegates preflight misses and typed CLI failures, never arbitrary startup failures', async () => {
  const args = invocation();
  jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValueOnce(undefined);
  await createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...args);
  expect(old).toHaveBeenCalledTimes(1);
  jest
    .mocked(startWarmDeviceSessionHostAsync)
    .mockRejectedValueOnce(new WarmSessionAdoptionError());
  await createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...args);
  expect(old).toHaveBeenCalledTimes(2);
  const error = new Error('app.launch failed');
  jest.mocked(startWarmDeviceSessionHostAsync).mockRejectedValueOnce(error);
  await expect(createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...args)).rejects.toBe(
    error
  );
  expect(old).toHaveBeenCalledTimes(2);
});

it('preserves an app preparation failure when stopping the session also fails', async () => {
  const appError = new Error('app metadata failed');
  const cleanupError = new Error('cleanup failed');
  jest.mocked(resolveIosSessionStartupAsync).mockRejectedValueOnce(appError);
  stopWarm.mockRejectedValueOnce(cleanupError);
  const args = invocation({ install_app_path: '/tmp/Fixture.app' });
  await expect(createStartWarmAgentDeviceSessionBuildFunction(ctx).fn!(...args)).rejects.toBe(
    appError
  );
  expect(args[0].logger.warn).toHaveBeenCalledWith({ err: cleanupError }, expect.any(String));
  expect(old).not.toHaveBeenCalled();
  expect(startWarmDeviceSessionHostAsync).not.toHaveBeenCalled();
});

it('does not fall back after a typed CLI error when preparation could not be released', async () => {
  const cleanupError = new Error('cleanup failed');
  jest
    .mocked(startWarmDeviceSessionHostAsync)
    .mockRejectedValueOnce(new WarmSessionAdoptionError());
  stopWarm.mockRejectedValueOnce(cleanupError);
  await expect(
    createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...invocation())
  ).rejects.toBe(cleanupError);
  expect(old).not.toHaveBeenCalled();
});

it.each(engines)(
  'preserves %s local app identity, launch arguments, and deep link',
  async (_engine, factory) => {
    jest
      .mocked(resolveIosSessionStartupAsync)
      .mockImplementation(
        jest.requireActual('../../utils/iosSimulatorSession').resolveIosSessionStartupAsync
      );
    warm.device.udid = 'A8E19807-41B2-4785-9558-08C1D52833C9';
    await factory(ctx).fn!(
      ...invocation({
        install_app_path: '/tmp/Fixture.app',
        launch_args: ['--test'],
        open_url: 'fixture://route',
      })
    );
    expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        installAppPath: '/tmp/Fixture.app',
        launchAppIdentifier: 'dev.fixture',
        launchArgs: ['--test'],
        openUrl: 'fixture://route',
      }),
      warm,
      expect.anything()
    );
    expect(downloadBuildAsync).not.toHaveBeenCalled();
  }
);

it('does not retry v1 after a tunnel fails or an adopted session is cancelled', async () => {
  const tunnelError = new Error('tunnel failed');
  jest.mocked(startNgrokTunnelAsync).mockRejectedValueOnce(tunnelError);
  await expect(
    createStartWarmArgentRemoteSessionBuildFunction(ctx).fn!(...invocation())
  ).rejects.toBe(tunnelError);
  const abort = new AbortController();
  const cancelled = new Error('cancelled');
  jest.mocked(waitForDeviceRunSessionStoppedAsync).mockImplementationOnce(async () => {
    abort.abort(cancelled);
    throw cancelled;
  });
  await expect(
    createStartWarmAgentDeviceSessionBuildFunction(ctx).fn!(...invocation({}, {}, abort.signal))
  ).rejects.toBe(cancelled);
  expect(old).not.toHaveBeenCalled();
  expect(finishHost).toHaveBeenCalledTimes(2);
});

it('finishes the accepted host when cancellation happens before the session wrapper enters', async () => {
  const controller = new AbortController();
  const cancelled = new Error('cancelled after adoption');
  jest.mocked(startWarmDeviceSessionHostAsync).mockImplementationOnce(async () => {
    controller.abort(cancelled);
    return host;
  });
  await expect(
    createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(
      ...invocation({}, {}, controller.signal)
    )
  ).rejects.toBe(cancelled);
  expect(finishHost).toHaveBeenCalledTimes(1);
  expect(host.openPreviewAsync).not.toHaveBeenCalled();
  expect(old).not.toHaveBeenCalled();
});

it('waits for tool artifacts to drain before stopping the shared warm host', async () => {
  let release!: () => void;
  let entered!: () => void;
  const drained = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  jest.mocked(pollArgentArtifactsForUploadAsync).mockImplementationOnce(async () => {
    entered();
    await drained;
  });
  const running = createStartWarmArgentRemoteSessionBuildFunction(ctx).fn!(...invocation());
  try {
    await started;
    await new Promise(resolve => setImmediate(resolve));
    expect(finishHost).not.toHaveBeenCalled();
  } finally {
    release();
    await running;
  }
  expect(finishHost).toHaveBeenCalledTimes(1);
});

it('stops agent-device polling without cancelling transfers and drains before host shutdown', async () => {
  const cancellation = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const draining = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  let stopPollingSignal!: AbortSignal;
  jest
    .mocked(pollAgentDeviceArtifactsForUploadAsync)
    .mockImplementationOnce(async (_ctx, options) => {
      expect(options.signal).toBe(cancellation.signal);
      stopPollingSignal = options.stopPollingSignal!;
      entered();
      await draining;
    });
  const running = createStartWarmAgentDeviceSessionBuildFunction(ctx).fn!(
    ...invocation({}, {}, cancellation.signal)
  );
  try {
    await started;
    await new Promise(resolve => setImmediate(resolve));
    expect(stopPollingSignal.aborted).toBe(true);
    expect(cancellation.signal.aborted).toBe(false);
    expect(finishHost).not.toHaveBeenCalled();
  } finally {
    release();
    await running;
  }
  expect(finishHost).toHaveBeenCalledTimes(1);
  expect(old).not.toHaveBeenCalled();
});

it('configures requested capture during CLI adoption before app actions instead of choosing v1', async () => {
  await createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(
    ...invocation({ network_capture: true, network_capture_fields: ['header', 'query'] })
  );
  expect(tryClaimWarmIosSessionAsync).toHaveBeenCalledWith(
    expect.objectContaining({ engine: 'serve-sim' })
  );
  expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ networkCapture: true, networkCaptureFields: ['header', 'query'] }),
    warm,
    expect.anything()
  );
  expect(old).not.toHaveBeenCalled();
});

it.each(engines)(
  'passes the raw selector to %s claim before resolving app inputs',
  async (engine, factory) => {
    warm.device = { udid: 'ACTUAL-UDID', name: 'iPhone 17 Pro' };
    await factory(ctx).fn!(...invocation({ device_identifier: 'iPhone 17 Pro' }));
    expect(tryClaimWarmIosSessionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ engine, requestedDevice: 'iPhone 17 Pro' })
    );
    expect(resolveIosSessionStartupAsync).toHaveBeenCalledWith(
      expect.objectContaining({ deviceIdentifier: 'ACTUAL-UDID' })
    );
    expect(jest.mocked(tryClaimWarmIosSessionAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(resolveIosSessionStartupAsync).mock.invocationCallOrder[0]
    );
  }
);

it('does not resolve a device on a preflight miss, or cold-fallback after failed cleanup', async () => {
  jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValueOnce(undefined);
  await createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...invocation());
  expect(resolveIosSessionStartupAsync).not.toHaveBeenCalled();
  const cleanupError = new Error('stop timed out');
  jest.mocked(tryClaimWarmIosSessionAsync).mockRejectedValueOnce(cleanupError);
  await expect(
    createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...invocation())
  ).rejects.toBe(cleanupError);
  expect(old).toHaveBeenCalledTimes(1);
  expect(startWarmDeviceSessionHostAsync).not.toHaveBeenCalled();
});

it('checks local boot environment eligibility before worker adoption or device resolution', async () => {
  jest
    .mocked(resolveLocalEgressServeSimBootEnvironmentAsync)
    .mockResolvedValueOnce({ SERVE_SIM_ADDITIONAL_DYLIBS: '/guard.dylib' });
  await createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...invocation());
  expect(stopWarmIosSessionAsync).toHaveBeenCalledTimes(1);
  expect(tryClaimWarmIosSessionAsync).not.toHaveBeenCalled();
  expect(resolveIosSessionStartupAsync).not.toHaveBeenCalled();
  expect(old).toHaveBeenCalledTimes(1);
});

it('uses the shared application resolver with a returned UUID without listing devices', async () => {
  const udid = 'A8E19807-41B2-4785-9558-08C1D52833C9';
  warm.device = { udid, name: 'iPhone 17 Pro' };
  const list = jest
    .spyOn(IosSimulatorUtils, 'getAvailableDevicesAsync')
    .mockRejectedValue(new Error('unexpected device list'));
  jest
    .mocked(resolveIosSessionStartupAsync)
    .mockImplementationOnce(
      jest.requireActual('../../utils/iosSimulatorSession').resolveIosSessionStartupAsync
    );
  try {
    await createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(
      ...invocation({ device_identifier: 'iPhone 17 Pro' })
    );
    expect(list).not.toHaveBeenCalled();
    expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ iosSimulatorUdid: udid }),
      warm,
      expect.anything()
    );
  } finally {
    list.mockRestore();
  }
});

it('owns cleanup after host setup fails and keeps that error when terminal stop also fails', async () => {
  const setupError = new Error('TURN unavailable');
  const stopError = new Error('controller stop failed');
  jest.mocked(startWarmDeviceSessionHostAsync).mockRejectedValueOnce(setupError);
  stopWarm.mockRejectedValueOnce(stopError);
  const args = invocation();
  await expect(createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...args)).rejects.toBe(
    setupError
  );
  expect(stopWarm).toHaveBeenCalledTimes(1);
  expect(args[0].logger.warn).toHaveBeenCalledWith({ err: stopError }, expect.any(String));
  expect(old).not.toHaveBeenCalled();
});

it('awaits positive stop before cold retry after a private CLI handoff failure', async () => {
  let acknowledge!: () => void;
  stopWarm.mockReturnValueOnce(
    new Promise<void>(resolve => {
      acknowledge = resolve;
    })
  );
  jest
    .mocked(startWarmDeviceSessionHostAsync)
    .mockRejectedValueOnce(new WarmSessionAdoptionError());
  const running = createStartWarmWebPreviewRemoteSessionBuildFunction(ctx).fn!(...invocation());
  try {
    for (let i = 0; i < 100 && !stopWarm.mock.calls.length; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(stopWarm).toHaveBeenCalledTimes(1);
    expect(old).not.toHaveBeenCalled();
    acknowledge();
    await running;
    expect(old).toHaveBeenCalledTimes(1);
  } finally {
    acknowledge();
    await running;
  }
});

it('starts TURN alongside claim and passes the same request into warm host startup', async () => {
  let releaseTurn!: (args: string[]) => void;
  const turn = new Promise<string[]>(resolve => {
    releaseTurn = resolve;
  });
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockReturnValueOnce(turn);
  const fn = createStartWarmWebPreviewRemoteSessionBuildFunction(ctx);
  const running = Promise.resolve(fn.fn!(...invocation()));
  let finished = false;
  void running.then(() => {
    finished = true;
  });
  try {
    for (
      let i = 0;
      i < 50 && !jest.mocked(startWarmDeviceSessionHostAsync).mock.calls.length;
      i++
    ) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(fetchWebPreviewTurnArgsAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(fetchWebPreviewTurnArgsAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(tryClaimWarmIosSessionAsync).mock.invocationCallOrder[0]
    );
    expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        preview: { baseDomain: 'tunnel.example', authtoken: 'ngrok-secret' },
      }),
      warm,
      { turnArgs: turn }
    );
    expect(finished).toBe(false);
    releaseTurn([]);
    await running;
  } finally {
    releaseTurn([]);
    await running;
  }
});

it('drains a TURN request when claim fails without starting a host or cold retry', async () => {
  let releaseTurn!: (args: string[]) => void;
  const turn = new Promise<string[]>(resolve => {
    releaseTurn = resolve;
  });
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockReturnValueOnce(turn);
  const failure = new Error('claim failed');
  jest.mocked(tryClaimWarmIosSessionAsync).mockRejectedValueOnce(failure);
  const fn = createStartWarmWebPreviewRemoteSessionBuildFunction(ctx);
  const running = Promise.resolve(fn.fn!(...invocation()));
  const rejected = expect(running).rejects.toBe(failure);
  let finished = false;
  void running.catch(() => {
    finished = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(finished).toBe(false);
  expect(startWarmDeviceSessionHostAsync).not.toHaveBeenCalled();
  expect(old).not.toHaveBeenCalled();
  releaseTurn([]);
  await rejected;
});

it('drains pending TURN before cold fallback on a preflight miss', async () => {
  let releaseTurn!: (args: string[]) => void;
  const turn = new Promise<string[]>(resolve => {
    releaseTurn = resolve;
  });
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockReturnValueOnce(turn);
  jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValueOnce(undefined);
  const fn = createStartWarmWebPreviewRemoteSessionBuildFunction(ctx);
  const running = Promise.resolve(fn.fn!(...invocation()));
  try {
    await new Promise(resolve => setImmediate(resolve));
    expect(tryClaimWarmIosSessionAsync).toHaveBeenCalled();
    expect(old).not.toHaveBeenCalled();
    releaseTurn([]);
    await running;
    expect(old).toHaveBeenCalledTimes(1);
    expect(startWarmDeviceSessionHostAsync).not.toHaveBeenCalled();
  } finally {
    releaseTurn([]);
    await running;
  }
});

it.each(['agent-device', 'argent'] as const)(
  'starts the %s tool tunnel alongside host startup and waits before publishing',
  async engine => {
    let opened!: (tunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof startNgrokTunnelAsync>>>(resolve => {
      opened = resolve;
    });
    jest.mocked(startNgrokTunnelAsync).mockReturnValueOnce(pending);
    const fn =
      engine === 'argent'
        ? createStartWarmArgentRemoteSessionBuildFunction(ctx)
        : createStartWarmAgentDeviceSessionBuildFunction(ctx);
    const running = Promise.resolve(fn.fn!(...invocation()));
    try {
      for (
        let i = 0;
        i < 50 && !jest.mocked(startWarmDeviceSessionHostAsync).mock.calls.length;
        i++
      ) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(startNgrokTunnelAsync).toHaveBeenCalledTimes(1);
      expect(jest.mocked(startNgrokTunnelAsync).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(startWarmDeviceSessionHostAsync).mock.invocationCallOrder[0]
      );
      expect(uploadRemoteSessionConfigWithLocalEgressAsync).not.toHaveBeenCalled();
      opened({ url: 'https://tools.example', subdomainId: 'job', stopAsync: stopTunnel });
      await running;
      expect(uploadRemoteSessionConfigWithLocalEgressAsync).toHaveBeenCalledTimes(1);
      expect(stopTunnel).toHaveBeenCalledTimes(1);
    } finally {
      opened({ url: 'https://tools.example', subdomainId: 'job', stopAsync: stopTunnel });
      await running;
    }
  }
);

it('drains a late tool tunnel before stopping or cold-falling back after adoption failure', async () => {
  let opened!: (tunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof startNgrokTunnelAsync>>>(resolve => {
    opened = resolve;
  });
  jest.mocked(startNgrokTunnelAsync).mockReturnValueOnce(pending);
  jest
    .mocked(startWarmDeviceSessionHostAsync)
    .mockRejectedValueOnce(new WarmSessionAdoptionError());
  const fn = createStartWarmAgentDeviceSessionBuildFunction(ctx);
  const running = Promise.resolve(fn.fn!(...invocation()));
  try {
    for (
      let i = 0;
      i < 50 && !jest.mocked(startWarmDeviceSessionHostAsync).mock.calls.length;
      i++
    ) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
    expect(stopWarm).not.toHaveBeenCalled();
    expect(old).not.toHaveBeenCalled();
    opened({ url: 'https://late-tools.example', subdomainId: 'job', stopAsync: stopTunnel });
    await running;
    expect(stopTunnel).toHaveBeenCalledTimes(1);
    expect(stopTunnel.mock.invocationCallOrder[0]).toBeLessThan(
      stopWarm.mock.invocationCallOrder[0]
    );
    expect(stopWarm.mock.invocationCallOrder[0]).toBeLessThan(old.mock.invocationCallOrder[0]);
    expect(uploadRemoteSessionConfigWithLocalEgressAsync).not.toHaveBeenCalled();
  } finally {
    opened({ url: 'https://late-tools.example', subdomainId: 'job', stopAsync: stopTunnel });
    await running;
  }
});
