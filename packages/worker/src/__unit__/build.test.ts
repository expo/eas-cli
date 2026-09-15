import { Builders, runDeviceRunSessionJobAsync, runGenericJobAsync } from '@expo/build-tools';
import {
  ArchiveSourceType,
  BuildTrigger,
  DeviceRunSession,
  Job,
  Platform,
} from '@expo/eas-build-job';

import { build } from '../build';

jest.mock('@expo/build-tools', () => {
  const actual = jest.requireActual('@expo/build-tools');
  return {
    ...actual,
    Builders: { androidBuilder: jest.fn(), iosBuilder: jest.fn() },
    TurtleSshSession: { isSshEnabled: () => false },
    runGenericJobAsync: jest.fn(),
    runDeviceRunSessionJobAsync: jest.fn(),
  };
});
jest.mock('../runtimeEnvironment', () => ({ prepareRuntimeEnvironment: jest.fn() }));
jest.mock('../displayRuntimeInfo', () => ({ displayWorkerRuntimeInfo: jest.fn() }));
jest.mock('../workingdir', () => ({ cleanUpWorkingdir: jest.fn() }));
jest.mock('../config', () => {
  const actual = jest.requireActual('../config').default;
  return { __esModule: true, default: { ...actual, env: 'production' } };
});
jest.mock('../logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedRunDeviceRunSessionJobAsync = jest.mocked(runDeviceRunSessionJobAsync);
const mockedRunGenericJobAsync = jest.mocked(runGenericJobAsync);
const mockedBuilders = jest.mocked(Builders);

const sharedJobFields: Omit<DeviceRunSession.Job, 'type' | 'session' | 'device'> = {
  triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
  projectArchive: { type: ArchiveSourceType.NONE },
  secrets: { robotAccessToken: 'token', environmentSecrets: [] },
  expoDevUrl: 'https://expo.dev/',
  builderEnvironment: { image: 'latest', env: {} },
  initiatingUserId: 'user-id',
  appId: 'app-id',
};

const deviceRunSessionJob: DeviceRunSession.Job = {
  ...sharedJobFields,
  type: DeviceRunSession.JobType.DEVICE_RUN_SESSION,
  session: {
    id: 'session-id',
    controller: DeviceRunSession.Controller.WEB_PREVIEW_ONLY,
    maxDurationSeconds: 600,
    ngrokTunnelDomain: 'sim.example.test',
  },
  device: { platform: Platform.IOS },
};

const genericJob: Job = {
  ...sharedJobFields,
  steps: [{ id: 'step', name: 'Step', run: 'true', shell: 'sh' }],
};

function createContext(job: Job): any {
  const logger: Record<string, jest.Mock> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return {
    job,
    logger,
    runBuildPhase: jest.fn(async (_phase: unknown, fn: () => Promise<unknown>) => await fn()),
  };
}

function createAnalytics(): any {
  return { logEvent: jest.fn(), flushEventsAsync: jest.fn(async () => {}) };
}

describe(build, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRunDeviceRunSessionJobAsync.mockResolvedValue(undefined);
    mockedRunGenericJobAsync.mockResolvedValue({
      runResult: { ok: true } as never,
      buildWorkflow: {} as never,
    });
  });

  it('runs device run session jobs with the dedicated runner', async () => {
    const ctx = createContext(deviceRunSessionJob);

    const artifacts = await build({ ctx, buildId: 'job-run-id', analytics: createAnalytics() });

    expect(artifacts).toEqual({});
    expect(mockedRunDeviceRunSessionJobAsync).toHaveBeenCalledWith(ctx);
    expect(mockedRunGenericJobAsync).not.toHaveBeenCalled();
    expect(mockedBuilders.iosBuilder).not.toHaveBeenCalled();
  });

  it('still runs generic jobs with the steps runner', async () => {
    const ctx = createContext(genericJob);

    await build({ ctx, buildId: 'job-run-id', analytics: createAnalytics() });

    expect(mockedRunGenericJobAsync).toHaveBeenCalledWith(ctx);
    expect(mockedRunDeviceRunSessionJobAsync).not.toHaveBeenCalled();
  });

  it('propagates the runner error so the job run is reported as errored', async () => {
    const error = new Error('simulator did not boot');
    mockedRunDeviceRunSessionJobAsync.mockRejectedValue(error);
    const analytics = createAnalytics();

    await expect(
      build({ ctx: createContext(deviceRunSessionJob), buildId: 'job-run-id', analytics })
    ).rejects.toBe(error);
    expect(analytics.flushEventsAsync).toHaveBeenCalled();
  });
});
