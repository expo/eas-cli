import { BuildPhase } from '@expo/eas-build-job';
import MockDate from 'mockdate';
import { v4 as uuid } from 'uuid';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { LogsState } from '../../commandUtils/logs/state';
import { groupLogLinesIntoSteps } from '../../commandUtils/logs/parseLogs';
import { JobLogs } from '../../commandUtils/logs/types';
import { LogsWatcher } from '../../commandUtils/logs/watcher';
import {
  AppPlatform,
  BuildFragment,
  BuildPriority,
  BuildStatus,
} from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import { Ora, isSpinnerEnabled, ora } from '../../ora';
import { createRealtimeLogsClient } from '../../utils/centrifuge';
import { sleepAsync } from '../../utils/promise';
import { waitForBuildEndAsync } from '../build';
import { ConcurrencyLimitMessage, TREATMENT_SPINNER_TEXT } from '../concurrencyLimitMessage';

jest.mock('cli-progress');
jest.mock('../../ora', () => ({
  ...jest.requireActual('../../ora'),
  ora: jest.fn(),
  isSpinnerEnabled: jest.fn(),
}));
jest.mock('../../commandUtils/logs/watcher', () => ({
  LogsWatcher: jest.fn(),
}));
jest.mock('../../utils/centrifuge', () => ({
  createRealtimeLogsClient: jest.fn(),
}));
jest.mock('../../graphql/queries/BuildQuery', () => ({
  BuildQuery: {
    byIdAsync: jest.fn(),
  },
}));
jest.mock('../../utils/promise', () => ({
  ...jest.requireActual('../../utils/promise'),
  sleepAsync: jest.fn(),
}));

const graphqlClient = {} as unknown as ExpoGraphqlClient;

function createBuildFragment(
  status: BuildStatus,
  {
    id = 'build-id',
    platform = AppPlatform.Android,
    priority = BuildPriority.Normal,
    queue,
  }: {
    id?: string;
    platform?: AppPlatform;
    priority?: BuildPriority;
    queue?: Pick<
      BuildFragment,
      'initialQueuePosition' | 'queuePosition' | 'estimatedWaitTimeLeftSeconds'
    >;
  } = {}
): BuildFragment {
  return {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    platform,
    logFiles: [],
    priority,
    ...queue,
    app: {
      __typename: 'App',
      slug: 'test-project',
      id: uuid(),
      name: 'test-project',
      ownerAccount: {
        __typename: 'Account',
        id: uuid(),
        name: 'test-account',
      },
    },
    status,
    isForIosSimulator: false,
  };
}

function createSpinner(): Ora {
  const spinner: Record<string, unknown> = {
    text: '',
    prefixText: '',
    isSpinning: true,
    start: jest.fn(() => spinner),
    stop: jest.fn(() => spinner),
    stopAndPersist: jest.fn(() => spinner),
    succeed: jest.fn(() => spinner),
    fail: jest.fn(() => spinner),
    warn: jest.fn(() => spinner),
  };
  return spinner as unknown as Ora;
}

function setBuildStatuses(statuses: BuildStatus[]): void {
  const mocked = jest.mocked(BuildQuery.byIdAsync);
  for (const status of statuses) {
    mocked.mockResolvedValueOnce(createBuildFragment(status));
  }
}

/** One status queue per build ID, consumed in order on each poll. */
function setBuildStatusesById(statusesById: Record<string, BuildStatus[]>): void {
  const queues = new Map(Object.entries(statusesById).map(([id, s]) => [id, [...s]]));
  jest.mocked(BuildQuery.byIdAsync).mockImplementation(async (_client, buildId) => {
    const status = queues.get(buildId)?.shift();
    if (!status) {
      throw new Error(`No more statuses for ${buildId}`);
    }
    const platform = buildId === 'build-ios' ? AppPlatform.Ios : AppPlatform.Android;
    return createBuildFragment(status, { id: buildId, platform });
  });
}

function createConcurrencyLimitMessage(shown: boolean): ConcurrencyLimitMessage & {
  maybeShowAsync: jest.Mock;
} {
  return { maybeShowAsync: jest.fn(async () => shown) } as unknown as ConcurrencyLimitMessage & {
    maybeShowAsync: jest.Mock;
  };
}

/** Moves the clock past the NEW-status grace period on every poll. */
function advanceClockOnSleep(): void {
  jest.mocked(sleepAsync).mockImplementation(async () => {
    MockDate.set(Date.now() + 16_000);
  });
}

const GRACE_TEXT = 'Waiting for build to get enqueued…';
const CONTROL_TEXT_PREFIX = 'Build concurrency limit reached for your account.';

describe(waitForBuildEndAsync, () => {
  let spinner: Ora;
  let publish: () => void;
  let watcherClose: jest.Mock;
  let logs: JobLogs;

  beforeEach(() => {
    jest.clearAllMocks();
    spinner = createSpinner();
    logs = new Map();
    publish = () => {};
    watcherClose = jest.fn();

    jest.mocked(ora).mockReturnValue(spinner);
    jest.mocked(LogsWatcher).mockImplementation(((
      _createRealtimeLogsClient: unknown,
      onRealtimeLogs: () => void
    ) => {
      publish = onRealtimeLogs;
      return {
        syncAsync: jest.fn(async () =>
          new Map<string, LogsState>([
            ['build-id', { getLogs: () => logs, markCompleted: jest.fn() } as unknown as LogsState],
          ])
        ),
        close: watcherClose,
      };
    }) as unknown as () => LogsWatcher);
    jest.mocked(sleepAsync).mockImplementation(async () => {
      publish();
    });
    MockDate.set('2026-10-12T00:00:00.000Z');
  });

  afterEach(() => {
    MockDate.reset();
  });

  it('does not create a watcher when the spinner is disabled', async () => {
    jest.mocked(isSpinnerEnabled).mockReturnValue(false);
    setBuildStatuses([BuildStatus.Finished]);

    await waitForBuildEndAsync(graphqlClient, { buildIds: ['build-id'], accountName: 'acct' });

    expect(LogsWatcher).not.toHaveBeenCalled();
    expect(createRealtimeLogsClient).not.toHaveBeenCalled();
  });

  it('renders the current phase and its log tail on publication while in progress', async () => {
    jest.mocked(isSpinnerEnabled).mockReturnValue(true);
    setBuildStatuses([BuildStatus.InProgress, BuildStatus.Finished]);
    jest.mocked(sleepAsync).mockImplementationOnce(async () => {
      logs = groupLogLinesIntoSteps([
        { phase: BuildPhase.INSTALL_DEPENDENCIES, msg: 'npm ci' },
        { phase: BuildPhase.INSTALL_DEPENDENCIES, msg: 'added 1 package' },
      ]);
      publish();
    });

    await waitForBuildEndAsync(graphqlClient, { buildIds: ['build-id'], accountName: 'acct' });

    expect(LogsWatcher).toHaveBeenCalledTimes(1);
    expect(spinner.text).toContain('Build in progress...');
    expect(spinner.text).toContain('Install dependencies');
    expect(spinner.text).toContain('added 1 package');
    expect(watcherClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a publication that arrives while the build is queued', async () => {
    jest.mocked(isSpinnerEnabled).mockReturnValue(true);
    setBuildStatuses([BuildStatus.InProgress, BuildStatus.InQueue, BuildStatus.Finished]);
    logs = groupLogLinesIntoSteps([{ phase: BuildPhase.INSTALL_DEPENDENCIES, msg: 'npm ci' }]);

    await waitForBuildEndAsync(graphqlClient, { buildIds: ['build-id'], accountName: 'acct' });

    expect(jest.mocked(sleepAsync).mock.calls.length).toBe(2);
    expect(spinner.text).toBe('Build queued...');
  });

  it('suggests the priority queue when a free-tier build gets a queue position', async () => {
    jest.mocked(isSpinnerEnabled).mockReturnValue(false);
    const logSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});
    const queue = { initialQueuePosition: 4, queuePosition: 2, estimatedWaitTimeLeftSeconds: 60 };
    jest
      .mocked(BuildQuery.byIdAsync)
      .mockResolvedValueOnce(createBuildFragment(BuildStatus.InQueue, { queue }))
      .mockResolvedValueOnce(createBuildFragment(BuildStatus.Finished));

    await waitForBuildEndAsync(graphqlClient, { buildIds: ['build-id'], accountName: 'acct' });

    const logged = logSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(logged).toContain('Start builds sooner in the priority queue.');
    expect(logged).toContain('Sign up for a paid plan at');
    expect(logged).toContain('/accounts/acct/settings/billing');
    expect(logged).toContain('Waiting in Free tier queue');
    logSpy.mockRestore();
  });

  describe('concurrency limit message', () => {
    beforeEach(() => {
      jest.mocked(isSpinnerEnabled).mockReturnValue(false);
    });

    it('shows the grace text and does not consult the message inside the grace period', async () => {
      const message = createConcurrencyLimitMessage(true);
      setBuildStatuses([BuildStatus.New, BuildStatus.Finished]);

      await waitForBuildEndAsync(graphqlClient, {
        buildIds: ['build-id'],
        accountName: 'acct',
        concurrencyLimitMessage: message,
      });

      expect(spinner.text).toBe(GRACE_TEXT);
      expect(message.maybeShowAsync).not.toHaveBeenCalled();
    });

    it('keeps the existing text when no message is given', async () => {
      advanceClockOnSleep();
      setBuildStatuses([BuildStatus.New, BuildStatus.New, BuildStatus.Finished]);

      await waitForBuildEndAsync(graphqlClient, { buildIds: ['build-id'], accountName: 'acct' });

      expect(spinner.text).toContain(CONTROL_TEXT_PREFIX);
      expect(spinner.text).toContain('/accounts/acct/settings/billing');
    });

    it('switches to the treatment spinner text when the message was shown', async () => {
      advanceClockOnSleep();
      const message = createConcurrencyLimitMessage(true);
      setBuildStatuses([
        BuildStatus.New,
        BuildStatus.New,
        BuildStatus.New,
        BuildStatus.Finished,
      ]);

      await waitForBuildEndAsync(graphqlClient, {
        buildIds: ['build-id'],
        accountName: 'acct',
        concurrencyLimitMessage: message,
      });

      expect(spinner.text).toBe(TREATMENT_SPINNER_TEXT);
      expect(message.maybeShowAsync).toHaveBeenCalledTimes(2);
    });

    it('keeps the existing text when the message was not shown', async () => {
      advanceClockOnSleep();
      const message = createConcurrencyLimitMessage(false);
      setBuildStatuses([BuildStatus.New, BuildStatus.New, BuildStatus.Finished]);

      await waitForBuildEndAsync(graphqlClient, {
        buildIds: ['build-id'],
        accountName: 'acct',
        concurrencyLimitMessage: message,
      });

      expect(spinner.text).toContain(CONTROL_TEXT_PREFIX);
      expect(message.maybeShowAsync).toHaveBeenCalledTimes(1);
    });

    it('consults the message once per poll for multi-platform builds', async () => {
      advanceClockOnSleep();
      const message = createConcurrencyLimitMessage(true);
      setBuildStatusesById({
        'build-android': [BuildStatus.New, BuildStatus.New, BuildStatus.Finished],
        'build-ios': [BuildStatus.New, BuildStatus.New, BuildStatus.Finished],
      });

      await waitForBuildEndAsync(graphqlClient, {
        buildIds: ['build-android', 'build-ios'],
        accountName: 'acct',
        concurrencyLimitMessage: message,
      });

      expect(message.maybeShowAsync).toHaveBeenCalledTimes(1);
      expect(spinner.text).toContain('Android build - status:');
      expect(spinner.text).toContain('iOS build - status:');
      expect(spinner.text.split('(concurrency limit reached)')).toHaveLength(3);
    });

    it('resets the NEW-status timer between runs', async () => {
      advanceClockOnSleep();
      setBuildStatuses([BuildStatus.New, BuildStatus.New, BuildStatus.Finished]);
      await waitForBuildEndAsync(graphqlClient, { buildIds: ['build-id'], accountName: 'acct' });
      expect(spinner.text).toContain(CONTROL_TEXT_PREFIX);

      setBuildStatuses([BuildStatus.New, BuildStatus.Finished]);
      await waitForBuildEndAsync(graphqlClient, { buildIds: ['build-id'], accountName: 'acct' });

      expect(spinner.text).toBe(GRACE_TEXT);
    });
  });
});
