import { RealtimeLogsTargetType } from '../../../graphql/generated';
import { RealtimeLogsClient } from '../../../utils/centrifuge';
import { LogSource, LogsWatcher } from '../watcher';

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
    publish: data => {
      listeners.forEach(listener => {
        listener(data);
      });
    },
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

describe(LogsWatcher, () => {
  let fetchRawLogLinesAsync: jest.Mock;

  beforeEach(() => {
    fetchRawLogLinesAsync = jest
      .fn()
      .mockResolvedValue([{ logId: '1', buildStepId: 'install', msg: 'from the file' }]);
  });

  function inProgressSource(overrides: Partial<LogSource> = {}): LogSource {
    return {
      key: 'job1',
      realtimeTarget: { type: RealtimeLogsTargetType.JobRun, id: 'job-run-id' },
      isInProgress: true,
      fetchRawLogLinesAsync,
      ...overrides,
    };
  }

  it('subscribes once per in-progress source', async () => {
    const fake = createFakeClient();
    const watcher = new LogsWatcher(
      () => fake.client,
      () => {}
    );

    await watcher.syncAsync([inProgressSource()]);
    await watcher.syncAsync([inProgressSource()]);

    expect(fake.subscribeCalls).toEqual([
      { target: { type: RealtimeLogsTargetType.JobRun, id: 'job-run-id' } },
    ]);
  });

  it('reports realtime logs as they arrive', async () => {
    const fake = createFakeClient();
    const onRealtimeLogs = jest.fn();
    const watcher = new LogsWatcher(() => fake.client, onRealtimeLogs);
    await watcher.syncAsync([inProgressSource()]);

    fake.publish([{ logId: '2', buildStepId: 'install', msg: 'pushed' }]);

    expect(onRealtimeLogs).toHaveBeenCalledTimes(1);
  });

  it('does not report a publication that carries no usable log lines', async () => {
    const fake = createFakeClient();
    const onRealtimeLogs = jest.fn();
    const watcher = new LogsWatcher(() => fake.client, onRealtimeLogs);
    await watcher.syncAsync([inProgressSource()]);

    fake.publish([{ msg: 'no logId' }]);

    expect(onRealtimeLogs).not.toHaveBeenCalled();
  });

  it('still fetches logs when the realtime logs client is unavailable', async () => {
    const watcher = new LogsWatcher(
      () => null,
      () => {}
    );

    await watcher.syncAsync([inProgressSource()]);

    expect(fetchRawLogLinesAsync).toHaveBeenCalledTimes(1);
  });

  it('fetches logs on every sync while in progress, and stops once the source is not', async () => {
    const fake = createFakeClient();
    const watcher = new LogsWatcher(
      () => fake.client,
      () => {}
    );

    await watcher.syncAsync([inProgressSource()]);
    await watcher.syncAsync([inProgressSource()]);
    expect(fetchRawLogLinesAsync).toHaveBeenCalledTimes(2);

    await watcher.syncAsync([inProgressSource({ isInProgress: false })]);
    expect(fetchRawLogLinesAsync).toHaveBeenCalledTimes(2);
  });

  it('does not fetch logs for a source that is not in progress', async () => {
    const fake = createFakeClient();
    const watcher = new LogsWatcher(
      () => fake.client,
      () => {}
    );

    await watcher.syncAsync([inProgressSource({ isInProgress: false })]);

    expect(fetchRawLogLinesAsync).not.toHaveBeenCalled();
  });

  it('closes the subscription when a source leaves in-progress', async () => {
    const fake = createFakeClient();
    const watcher = new LogsWatcher(
      () => fake.client,
      () => {}
    );

    await watcher.syncAsync([inProgressSource()]);
    expect(fake.closeCount()).toBe(0);

    await watcher.syncAsync([inProgressSource({ isInProgress: false })]);
    expect(fake.closeCount()).toBe(1);
  });

  it('closes the client and its subscriptions', async () => {
    const fake = createFakeClient();
    const watcher = new LogsWatcher(
      () => fake.client,
      () => {}
    );

    await watcher.syncAsync([inProgressSource()]);
    watcher.close();

    expect(fake.closeCount()).toBe(2);
  });
});
