import { getMockWorkflowRunWithJobsFragment } from '../../../../__tests__/commands/utils';
import { RealtimeLogsTargetType, WorkflowJobStatus } from '../../../../graphql/generated';
import { RealtimeLogsClient } from '../../../../utils/centrifuge';
import { fetchAndParseLogsFromJobAsync } from '../parseLogs';
import { WorkflowJobLogsState, WorkflowRunLogsWatcher, realtimeLogsTargetForJob } from '../watcher';
import { WorkflowJobResult, WorkflowRawLogLine } from '../../types';

jest.mock('../parseLogs', () => ({
  ...jest.requireActual('../parseLogs'),
  fetchAndParseLogsFromJobAsync: jest.fn(),
}));

function createFakeClient(): {
  client: RealtimeLogsClient;
  publish: (data: unknown) => void;
  subscribeCalls: unknown[];
  closeCount: () => number;
} {
  const listeners: ((data: unknown) => void)[] = [];
  const subscribeCalls: unknown[] = [];
  let closed = 0;
  return {
    subscribeCalls,
    closeCount: () => closed,
    publish: data => listeners.forEach(listener => listener(data)),
    client: {
      subscribeAsync: async (args, onPublication) => {
        subscribeCalls.push(args);
        listeners.push(onPublication);
        return { close: () => closed++ };
      },
      close: () => closed++,
    },
  };
}

function inProgressJob(): WorkflowJobResult {
  const job = getMockWorkflowRunWithJobsFragment().jobs[0];
  return { ...job, status: WorkflowJobStatus.InProgress };
}

describe(realtimeLogsTargetForJob, () => {
  it('targets the turtle job run when there is one', () => {
    const job = { ...inProgressJob(), turtleJobRun: { id: 'job-run-id' } } as WorkflowJobResult;

    expect(realtimeLogsTargetForJob(job)).toEqual({
      type: RealtimeLogsTargetType.JobRun,
      id: 'job-run-id',
    });
  });

  it('falls back to the build when there is no turtle job run', () => {
    const job = {
      ...inProgressJob(),
      turtleJobRun: null,
      turtleBuild: { id: 'build-id' },
    } as WorkflowJobResult;

    expect(realtimeLogsTargetForJob(job)).toEqual({
      type: RealtimeLogsTargetType.Build,
      id: 'build-id',
    });
  });

  it('has no target when neither is present', () => {
    const job = {
      ...inProgressJob(),
      turtleJobRun: null,
      turtleBuild: null,
      outputs: null,
    } as WorkflowJobResult;

    expect(realtimeLogsTargetForJob(job)).toBeNull();
  });
});

describe(WorkflowRunLogsWatcher, () => {
  beforeEach(() => {
    jest
      .mocked(fetchAndParseLogsFromJobAsync)
      .mockResolvedValue([{ logId: '1', buildStepId: 'install', msg: 'from the file' }]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('subscribes once per in-progress job', async () => {
    const fake = createFakeClient();
    const watcher = new WorkflowRunLogsWatcher(
      {} as any,
      () => fake.client,
      () => {}
    );
    const job = inProgressJob();

    await watcher.syncJobsAsync([job]);
    await watcher.syncJobsAsync([job]);

    expect(fake.subscribeCalls).toHaveLength(1);
  });

  it('reports realtime logs as they arrive', async () => {
    const fake = createFakeClient();
    const onRealtimeLogs = jest.fn();
    const watcher = new WorkflowRunLogsWatcher({} as any, () => fake.client, onRealtimeLogs);
    await watcher.syncJobsAsync([inProgressJob()]);

    fake.publish([{ logId: '2', buildStepId: 'install', msg: 'pushed' }]);

    expect(onRealtimeLogs).toHaveBeenCalledTimes(1);
  });

  it('does not report a publication that carries no usable log lines', async () => {
    const fake = createFakeClient();
    const onRealtimeLogs = jest.fn();
    const watcher = new WorkflowRunLogsWatcher({} as any, () => fake.client, onRealtimeLogs);
    await watcher.syncJobsAsync([inProgressJob()]);

    fake.publish([{ msg: 'no logId' }]);

    expect(onRealtimeLogs).not.toHaveBeenCalled();
  });

  it('still fetches logs when the realtime logs client is unavailable', async () => {
    const watcher = new WorkflowRunLogsWatcher(
      {} as any,
      () => null,
      () => {}
    );

    await watcher.syncJobsAsync([inProgressJob()]);

    expect(fetchAndParseLogsFromJobAsync).toHaveBeenCalledTimes(1);
  });

  it('fetches logs on every sync while in progress, and stops once the job completes', async () => {
    const fake = createFakeClient();
    const watcher = new WorkflowRunLogsWatcher(
      {} as any,
      () => fake.client,
      () => {}
    );
    const job = inProgressJob();

    await watcher.syncJobsAsync([job]);
    await watcher.syncJobsAsync([job]);
    expect(fetchAndParseLogsFromJobAsync).toHaveBeenCalledTimes(2);

    await watcher.syncJobsAsync([{ ...job, status: WorkflowJobStatus.Success }]);
    expect(fetchAndParseLogsFromJobAsync).toHaveBeenCalledTimes(2);
  });

  it('does not fetch logs for a job that has not started', async () => {
    const fake = createFakeClient();
    const watcher = new WorkflowRunLogsWatcher(
      {} as any,
      () => fake.client,
      () => {}
    );

    await watcher.syncJobsAsync([{ ...inProgressJob(), status: WorkflowJobStatus.New }]);

    expect(fetchAndParseLogsFromJobAsync).not.toHaveBeenCalled();
  });

  it('closes the subscription when a job leaves in-progress', async () => {
    const fake = createFakeClient();
    const watcher = new WorkflowRunLogsWatcher(
      {} as any,
      () => fake.client,
      () => {}
    );
    const job = inProgressJob();

    await watcher.syncJobsAsync([job]);
    expect(fake.closeCount()).toBe(0);

    await watcher.syncJobsAsync([{ ...job, status: WorkflowJobStatus.Failure }]);
    expect(fake.closeCount()).toBe(1);
  });

  it('closes the client and its subscriptions', async () => {
    const fake = createFakeClient();
    const watcher = new WorkflowRunLogsWatcher(
      {} as any,
      () => fake.client,
      () => {}
    );

    await watcher.syncJobsAsync([inProgressJob()]);
    watcher.close();

    expect(fake.closeCount()).toBe(2);
  });
});

function fileLine(logId: string, msg: string): WorkflowRawLogLine {
  return { logId, buildStepId: 'install', msg };
}

function stepMessages(logsState: WorkflowJobLogsState, isCompleted = false): string[] {
  const logs = logsState.getLogs({ isCompleted });
  return Array.from(logs.values()).flatMap(group => group.logLines.map(line => line.msg));
}

describe(WorkflowJobLogsState, () => {
  it('hides realtime lines until the file logs reach them', () => {
    const logsState = new WorkflowJobLogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('5', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first']);
  });

  it('shows realtime lines once a published logId also appears in the file', () => {
    const logsState = new WorkflowJobLogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('2', 'pushed')]);
    logsState.ingestFileLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);
    logsState.ingestRealtimeLogLines([fileLine('3', 'newer')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed', 'newer']);
  });

  it('opens the gate when a publication repeats a logId already in the file', () => {
    const logsState = new WorkflowJobLogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed']);
  });

  it('shows buffered realtime lines once the job is completed even without catch-up', () => {
    const logsState = new WorkflowJobLogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('9', 'pushed')]);

    expect(stepMessages(logsState, true)).toEqual(['first', 'pushed']);
  });

  it('replaces the file snapshot instead of accumulating it', () => {
    const logsState = new WorkflowJobLogsState();
    const keyless: WorkflowRawLogLine = { buildStepId: 'install', msg: 'submission log' };

    logsState.ingestFileLogLines([keyless]);
    logsState.ingestFileLogLines([keyless]);

    expect(stepMessages(logsState)).toEqual(['submission log']);
  });

  it('drops a buffered realtime line once it lands in the file', () => {
    const logsState = new WorkflowJobLogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('2', 'pushed')]);
    logsState.ingestFileLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed']);
  });

  it('ignores publications that are not arrays of log lines', () => {
    const logsState = new WorkflowJobLogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);

    expect(logsState.ingestRealtimeLogLines({ logId: '2', msg: 'not an array' })).toBe(false);
    expect(logsState.ingestRealtimeLogLines(['a string', 42, null])).toBe(false);
    expect(logsState.ingestRealtimeLogLines([{ msg: 'no logId' }])).toBe(false);
    expect(stepMessages(logsState)).toEqual(['first']);
  });

  it('deduplicates a line republished on the same channel', () => {
    const logsState = new WorkflowJobLogsState();
    logsState.ingestFileLogLines([fileLine('1', 'first')]);
    logsState.ingestRealtimeLogLines([fileLine('1', 'first'), fileLine('2', 'pushed')]);
    logsState.ingestRealtimeLogLines([fileLine('2', 'pushed')]);

    expect(stepMessages(logsState)).toEqual(['first', 'pushed']);
  });
});
