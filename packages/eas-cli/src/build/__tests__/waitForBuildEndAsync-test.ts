import { BuildPhase } from '@expo/eas-build-job';
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
import { Ora, isSpinnerEnabled, ora } from '../../ora';
import { createRealtimeLogsClient } from '../../utils/centrifuge';
import { sleepAsync } from '../../utils/promise';
import { waitForBuildEndAsync } from '../build';

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

function createBuildFragment(status: BuildStatus): BuildFragment {
  return {
    id: 'build-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    platform: AppPlatform.Android,
    logFiles: [],
    priority: BuildPriority.Normal,
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
});
