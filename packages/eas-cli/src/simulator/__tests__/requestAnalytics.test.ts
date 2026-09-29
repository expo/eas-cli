import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { SimulatorEvent } from '../../analytics/AnalyticsManager';
import Log from '../../log';
import { Ora } from '../../ora';
import {
  simulatorRequestFailureReason,
  simulatorRequestProperties,
  withSimulatorRequestAnalyticsAsync,
} from '../requestAnalytics';

jest.mock('../../log');

const properties = simulatorRequestProperties({
  projectId: 'project-123',
  type: 'serve-sim',
  platform: 'IOS',
  hasBuildId: false,
  hasArchiveUrl: false,
  expoGo: false,
  nonInteractive: true,
});

function networkError(fields: { code?: string; name?: string; causeCode?: string } = {}): Error {
  const error = new Error('fetch failed') as Error & { code?: string; cause?: { code?: string } };
  if (fields.name) {
    error.name = fields.name;
  }
  if (fields.code) {
    error.code = fields.code;
  }
  if (fields.causeCode) {
    error.cause = { code: fields.causeCode };
  }
  return error;
}

describe(simulatorRequestProperties, () => {
  it('names the funnel reference properties and leaves out an unset package version', () => {
    expect(properties).toEqual({
      project_id: 'project-123',
      origin: 'eas-cli',
      type: 'serve-sim',
      platform: 'ios',
      has_build_id: false,
      has_archive_url: false,
      expo_go: false,
      non_interactive: true,
    });
    expect(
      simulatorRequestProperties({
        projectId: 'p',
        type: 'argent',
        platform: 'ANDROID',
        hasBuildId: true,
        hasArchiveUrl: true,
        expoGo: true,
        packageVersion: '0.22.1',
        nonInteractive: false,
      })
    ).toMatchObject({ platform: 'android', requested_package_version: '0.22.1' });
  });
});

describe(simulatorRequestFailureReason, () => {
  it('reports a timeout from the error code, its cause, or the error name', () => {
    for (const error of [
      networkError({ code: 'ETIMEDOUT' }),
      networkError({ causeCode: 'UND_ERR_CONNECT_TIMEOUT' }),
      networkError({ name: 'AbortError' }),
      networkError({ name: 'TimeoutError' }),
    ]) {
      expect(simulatorRequestFailureReason(new CombinedError({ networkError: error }))).toBe(
        'timeout'
      );
    }
  });

  it('reports any other missing answer as a network error', () => {
    expect(
      simulatorRequestFailureReason(
        new CombinedError({ networkError: networkError({ code: 'ECONNRESET' }) })
      )
    ).toBe('network_error');
  });

  it('is null when the server answered, since www reports refusals', () => {
    expect(
      simulatorRequestFailureReason(
        new CombinedError({
          graphQLErrors: [new GraphQLError('Simulator sessions are not enabled')],
        })
      )
    ).toBeNull();
    expect(
      simulatorRequestFailureReason(new Error('Returned query result data is null!'))
    ).toBeNull();
  });
});

describe(withSimulatorRequestAnalyticsAsync, () => {
  const logEvent = jest.fn();
  const flushAsync = jest.fn(async () => {});
  const analytics = { logEvent, flushAsync, setActor: jest.fn() };
  const spinnerFail = jest.fn();
  const spinner = { fail: spinnerFail } as unknown as Ora;
  const stopCreatedAsync = jest.fn(async () => {});

  beforeEach(() => {
    logEvent.mockReset();
    flushAsync.mockClear();
    spinnerFail.mockClear();
    stopCreatedAsync.mockClear();
    jest.mocked(Log.log).mockClear();
    jest.mocked(Log.warn).mockClear();
  });

  it('logs "request sent" before the request and nothing else on success', async () => {
    const createAsync = jest.fn(async () => {
      expect(logEvent).toHaveBeenCalledWith(SimulatorEvent.REQUEST_SENT, properties);
      return 'session';
    });
    await expect(
      withSimulatorRequestAnalyticsAsync(
        analytics,
        properties,
        spinner,
        createAsync,
        stopCreatedAsync
      )
    ).resolves.toBe('session');
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('logs "request failed" with the reason when no answer arrives, and rethrows', async () => {
    const error = new CombinedError({ networkError: networkError({ code: 'ECONNRESET' }) });
    await expect(
      withSimulatorRequestAnalyticsAsync(
        analytics,
        properties,
        spinner,
        async () => {
          throw error;
        },
        stopCreatedAsync
      )
    ).rejects.toBe(error);
    expect(logEvent).toHaveBeenLastCalledWith(SimulatorEvent.REQUEST_FAILED, {
      ...properties,
      reason: 'network_error',
    });
  });

  it('logs nothing more when the server refuses', async () => {
    const error = new CombinedError({ graphQLErrors: [new GraphQLError('denied')] });
    await expect(
      withSimulatorRequestAnalyticsAsync(
        analytics,
        properties,
        spinner,
        async () => {
          throw error;
        },
        stopCreatedAsync
      )
    ).rejects.toBe(error);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('logs "request cancelled" on Ctrl+C before an answer, stops the spinner, and exits with 130 only after the flush', async () => {
    jest.useFakeTimers();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      let finishFlush!: () => void;
      const flushStarted = new Promise<void>(notifyFlushStarted => {
        flushAsync.mockImplementationOnce(
          () =>
            new Promise<void>(resolve => {
              finishFlush = resolve;
              notifyFlushStarted();
            })
        );
      });
      let resolveCreate!: (session: string) => void;
      const exited = expect(
        withSimulatorRequestAnalyticsAsync(
          analytics,
          properties,
          spinner,
          () =>
            new Promise<string>(resolve => {
              resolveCreate = resolve;
            }),
          stopCreatedAsync
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await flushStarted;
      // The session comes back during the flush; it is stopped only after the flush.
      resolveCreate('session');
      await jest.advanceTimersByTimeAsync(500);
      const stopCallsDuringFlush = [...stopCreatedAsync.mock.calls];
      const exitCallsDuringFlush = [...exitSpy.mock.calls];
      finishFlush();
      await exited;

      expect(stopCallsDuringFlush).toEqual([]);
      expect(exitCallsDuringFlush).toEqual([]);
      expect(stopCreatedAsync).toHaveBeenCalledWith('session');
      expect(logEvent).toHaveBeenLastCalledWith(SimulatorEvent.REQUEST_CANCELLED, {
        ...properties,
        reason: 'user_abort',
      });
      expect(spinnerFail).toHaveBeenCalledWith('Simulator session request canceled');
    } finally {
      exitSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('stops a session that the request returns within 5 seconds of Ctrl+C, and exits with 130 after the stop', async () => {
    jest.useFakeTimers();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      let finishStop!: () => void;
      stopCreatedAsync.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            finishStop = resolve;
          })
      );
      let resolveCreate!: (session: string) => void;
      const exited = expect(
        withSimulatorRequestAnalyticsAsync(
          analytics,
          properties,
          spinner,
          () =>
            new Promise<string>(resolve => {
              resolveCreate = resolve;
            }),
          stopCreatedAsync
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await jest.advanceTimersByTimeAsync(4_999);
      resolveCreate('session');
      await jest.advanceTimersByTimeAsync(0);
      expect(stopCreatedAsync).toHaveBeenCalledWith('session');
      const exitCallsDuringStop = [...exitSpy.mock.calls];
      finishStop();
      await exited;

      expect(exitCallsDuringStop).toEqual([]);
      expect(Log.warn).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('warns to check eas simulator:list and exits with 130 when no session comes back within 5 seconds of Ctrl+C', async () => {
    jest.useFakeTimers();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      const exited = expect(
        withSimulatorRequestAnalyticsAsync(
          analytics,
          properties,
          spinner,
          () => new Promise(() => {}),
          stopCreatedAsync
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await jest.advanceTimersByTimeAsync(4_999);
      const warningsBeforeFiveSeconds = [...jest.mocked(Log.warn).mock.calls];
      const exitCallsBeforeFiveSeconds = [...exitSpy.mock.calls];
      await jest.advanceTimersByTimeAsync(1);
      await exited;

      expect(warningsBeforeFiveSeconds).toEqual([]);
      expect(exitCallsBeforeFiveSeconds).toEqual([]);
      expect(Log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Run `eas simulator:list` to check for a running session')
      );
      expect(stopCreatedAsync).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('warns the same way, and logs no "request failed", when the request fails after Ctrl+C', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      let rejectCreate!: (error: Error) => void;
      const exited = expect(
        withSimulatorRequestAnalyticsAsync(
          analytics,
          properties,
          spinner,
          () =>
            new Promise<string>((_, reject) => {
              rejectCreate = reject;
            }),
          stopCreatedAsync
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await Promise.resolve();
      rejectCreate(new CombinedError({ networkError: networkError({ code: 'ECONNRESET' }) }));
      await exited;

      expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('eas simulator:list'));
      expect(stopCreatedAsync).not.toHaveBeenCalled();
      expect(logEvent).toHaveBeenLastCalledWith(SimulatorEvent.REQUEST_CANCELLED, {
        ...properties,
        reason: 'user_abort',
      });
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('exits with 130 at once on a second Ctrl+C while it waits for the request', async () => {
    jest.useFakeTimers();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      const existing = process.listeners('SIGINT');
      const exited = expect(
        withSimulatorRequestAnalyticsAsync(
          analytics,
          properties,
          spinner,
          () => new Promise(() => {}),
          stopCreatedAsync
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await jest.advanceTimersByTimeAsync(2_000);
      expect(Log.log).toHaveBeenCalledWith(
        expect.stringContaining('Press Ctrl+C again to exit now')
      );
      expect(exitSpy).not.toHaveBeenCalled();

      expect(() => process.emit('SIGINT')).toThrow('process.exit(130)');
      expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('eas simulator:list'));

      // process.exit is mocked, so let the first Ctrl+C finish to clean up its listener.
      await jest.advanceTimersByTimeAsync(3_000);
      await exited;
      expect(stopCreatedAsync).not.toHaveBeenCalled();
      expect(process.listeners('SIGINT')).toEqual(existing);
    } finally {
      exitSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('stops waiting for a hung flush after 1 second', async () => {
    jest.useFakeTimers();
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
    try {
      flushAsync.mockImplementationOnce(() => new Promise<void>(() => {}));
      const exited = expect(
        withSimulatorRequestAnalyticsAsync(
          analytics,
          properties,
          spinner,
          () => new Promise(() => {}),
          stopCreatedAsync
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await jest.advanceTimersByTimeAsync(999);
      const waitMessagesBeforeOneSecond = [...jest.mocked(Log.log).mock.calls];
      await jest.advanceTimersByTimeAsync(1);
      expect(waitMessagesBeforeOneSecond).toEqual([]);
      expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Waiting up to 5 seconds'));

      await jest.advanceTimersByTimeAsync(5_000);
      await exited;
    } finally {
      exitSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('removes its Ctrl+C listener after success and after failure', async () => {
    const existing = [...process.listeners('SIGINT')];
    await withSimulatorRequestAnalyticsAsync(
      analytics,
      properties,
      spinner,
      async () => 'session',
      stopCreatedAsync
    );
    expect(process.listeners('SIGINT')).toEqual(existing);
    await expect(
      withSimulatorRequestAnalyticsAsync(
        analytics,
        properties,
        spinner,
        async () => {
          throw new Error('boom');
        },
        stopCreatedAsync
      )
    ).rejects.toThrow('boom');
    expect(process.listeners('SIGINT')).toEqual(existing);
  });
});
