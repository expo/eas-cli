import { TurtleSshSession } from '@expo/build-tools';
import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';

import { startSshSessionPhaseAsync } from '../sshSession';

jest.mock('@expo/build-tools', () => ({
  TurtleSshSession: {
    getWorkflowJobIdOrThrow: jest.fn(() => 'wj-1'),
    getTurtleSshTarget: jest.fn(() => ({ turtleJobRunId: 'jr-1' })),
    getSshRelayServerUrl: jest.fn(() => 'wss://relay.expo.dev'),
    getSshIdleTimeoutSeconds: jest.fn(() => 0),
    formatSshIdleTimeoutForLog: jest.fn(() => '15 minutes'),
    startSshSessionAsync: jest.fn(),
    superviseSshSessionAsync: jest.fn(),
  },
}));

const mocked = jest.mocked(TurtleSshSession);

function createLogger(): any {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return logger;
}

function createContext({ logger }: { logger: any }): any {
  return {
    env: { __WORKFLOW_JOB_ID: 'wj-1' },
    job: { ssh: { idleTimeoutSeconds: 0, relayServerUrl: 'wss://relay.expo.dev' } },
    logger,
    markBuildPhaseHasWarnings: jest.fn(),
    // The real implementation runs the phase body and honors doNotMarkEnd; for these tests we only
    // need the body to run.
    runBuildPhase: jest.fn(async (_phase: BuildPhase, body: () => Promise<void>) => {
      await body();
    }),
  };
}

function endPhaseCalls(logger: any): any[] {
  return logger.info.mock.calls.filter(
    ([meta]: any[]) =>
      meta != null && typeof meta === 'object' && meta.marker === LogMarker.END_PHASE
  );
}

describe(startSshSessionPhaseAsync, () => {
  let handle: {
    getConnectedClientCountAsync: jest.Mock;
    ensureConnectedAsync: jest.Mock;
    stopAsync: jest.Mock;
  };

  beforeEach(() => {
    handle = {
      getConnectedClientCountAsync: jest.fn(async () => 0),
      ensureConnectedAsync: jest.fn(async () => {}),
      stopAsync: jest.fn(async () => {}),
    };
    mocked.startSshSessionAsync.mockResolvedValue({ handle, idleTimeoutSeconds: 0 } as any);
    mocked.superviseSshSessionAsync.mockResolvedValue(undefined as any);
  });

  it('opens the session inside SSH_SESSION and leaves the phase open', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => false,
    });

    expect(ctx.runBuildPhase).toHaveBeenCalledWith(BuildPhase.SSH_SESSION, expect.any(Function), {
      doNotMarkEnd: true,
    });
    expect(mocked.startSshSessionAsync).toHaveBeenCalledWith(ctx, {
      target: { turtleJobRunId: 'jr-1' },
      relayServerUrl: 'wss://relay.expo.dev',
      idleTimeoutSeconds: 0,
    });
    expect(logger.info).toHaveBeenCalledWith(
      'SSH session ready. Connect with: eas workflow:ssh wj-1'
    );
    expect(done).toBeInstanceOf(Promise);
    await done;
  });

  it('mentions the idle timeout when it is non-zero', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });
    mocked.getSshIdleTimeoutSeconds.mockReturnValue(900);
    mocked.startSshSessionAsync.mockResolvedValue({ handle, idleTimeoutSeconds: 900 } as any);

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => true,
    });
    await done;

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('then closes after 15 minutes with no client connected')
    );
  });

  it('returns before the session ends so the job is not blocked', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });
    let releaseSupervision = (): void => {};
    mocked.superviseSshSessionAsync.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          releaseSupervision = resolve;
        })
    );

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => false,
    });

    expect(done).toBeDefined();
    expect(handle.stopAsync).not.toHaveBeenCalled();
    releaseSupervision();
    await done;
    expect(handle.stopAsync).toHaveBeenCalled();
  });

  it('tears the tunnel down and closes the phase once supervision returns', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => true,
    });
    await done;

    expect(handle.stopAsync).toHaveBeenCalled();
    expect(endPhaseCalls(logger)).toEqual([
      [expect.objectContaining({ result: BuildPhaseResult.SUCCESS }), expect.any(String)],
    ]);
  });

  it('passes the job-finished signal through to the supervisor', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });
    let jobFinished = false;

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => jobFinished,
    });
    await done;

    const { hasJobFinished, getConnectedClientCount, ensureConnected } =
      mocked.superviseSshSessionAsync.mock.calls[0][0];
    expect(hasJobFinished()).toBe(false);
    jobFinished = true;
    expect(hasJobFinished()).toBe(true);
    await getConnectedClientCount();
    await ensureConnected();
    expect(handle.getConnectedClientCountAsync).toHaveBeenCalled();
    expect(handle.ensureConnectedAsync).toHaveBeenCalled();
  });

  it('closes the phase with a warning when supervision throws', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });
    mocked.superviseSshSessionAsync.mockRejectedValue(new Error('relay went away'));

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => true,
    });
    await done;

    expect(handle.stopAsync).toHaveBeenCalled();
    expect(endPhaseCalls(logger)).toEqual([
      [expect.objectContaining({ result: BuildPhaseResult.WARNING }), expect.any(String)],
    ]);
  });

  it('warns when tearing down the tunnel fails after supervision', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });
    handle.stopAsync.mockRejectedValue(new Error('already gone'));

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => true,
    });
    await done;

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'Failed to tear down the SSH tunnel.'
    );
    expect(endPhaseCalls(logger)).toEqual([
      [expect.objectContaining({ result: BuildPhaseResult.SUCCESS }), expect.any(String)],
    ]);
  });

  it('lets the job continue and closes the phase when the session cannot be opened', async () => {
    const logger = createLogger();
    const ctx = createContext({ logger });
    mocked.startSshSessionAsync.mockRejectedValue(new Error('no relay'));

    const { done } = await startSshSessionPhaseAsync({
      ctx,
      buildId: 'jr-1',
      logger,
      hasJobFinished: () => false,
    });

    expect(done).toBeUndefined();
    expect(ctx.markBuildPhaseHasWarnings).toHaveBeenCalled();
    expect(mocked.superviseSshSessionAsync).not.toHaveBeenCalled();
    expect(endPhaseCalls(logger)).toEqual([
      [expect.objectContaining({ result: BuildPhaseResult.WARNING }), expect.any(String)],
    ]);
  });
});
