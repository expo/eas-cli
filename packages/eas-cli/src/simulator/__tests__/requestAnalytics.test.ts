import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { SimulatorEvent } from '../../analytics/AnalyticsManager';
import { Ora } from '../../ora';
import {
  simulatorRequestFailureReason,
  simulatorRequestProperties,
  withSimulatorRequestAnalyticsAsync,
} from '../requestAnalytics';

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

  beforeEach(() => {
    logEvent.mockReset();
    flushAsync.mockClear();
    spinnerFail.mockClear();
  });

  it('logs "request sent" before the request and nothing else on success', async () => {
    const createAsync = jest.fn(async () => {
      expect(logEvent).toHaveBeenCalledWith(SimulatorEvent.REQUEST_SENT, properties);
      return 'session';
    });
    await expect(
      withSimulatorRequestAnalyticsAsync(analytics, properties, spinner, createAsync)
    ).resolves.toBe('session');
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('logs "request failed" with the reason when no answer arrives, and rethrows', async () => {
    const error = new CombinedError({ networkError: networkError({ code: 'ECONNRESET' }) });
    await expect(
      withSimulatorRequestAnalyticsAsync(analytics, properties, spinner, async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(logEvent).toHaveBeenLastCalledWith(SimulatorEvent.REQUEST_FAILED, {
      ...properties,
      reason: 'network_error',
    });
  });

  it('logs nothing more when the server refuses', async () => {
    const error = new CombinedError({ graphQLErrors: [new GraphQLError('denied')] });
    await expect(
      withSimulatorRequestAnalyticsAsync(analytics, properties, spinner, async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('logs "request cancelled" on Ctrl+C before an answer, stops the spinner, and exits with 130 only after the flush', async () => {
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
      const exited = expect(
        withSimulatorRequestAnalyticsAsync(
          analytics,
          properties,
          spinner,
          () => new Promise(() => {})
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await flushStarted;
      const exitCallsDuringFlush = [...exitSpy.mock.calls];
      finishFlush();
      await exited;

      expect(exitCallsDuringFlush).toEqual([]);
      expect(logEvent).toHaveBeenLastCalledWith(SimulatorEvent.REQUEST_CANCELLED, {
        ...properties,
        reason: 'user_abort',
      });
      expect(spinnerFail).toHaveBeenCalledWith('Simulator session request canceled');
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('removes its listener on the first Ctrl+C, so a second Ctrl+C is not swallowed during the flush', async () => {
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
          () => new Promise(() => {})
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      const listenersAfterFirstCtrlC = process.listeners('SIGINT');
      await exited;

      expect(listenersAfterFirstCtrlC).toEqual(existing);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('exits with 130 after 1 second when the flush hangs', async () => {
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
          () => new Promise(() => {})
        )
      ).rejects.toThrow('process.exit(130)');

      process.emit('SIGINT');
      await jest.advanceTimersByTimeAsync(999);
      const exitCallsBeforeOneSecond = [...exitSpy.mock.calls];
      await jest.advanceTimersByTimeAsync(1);
      await exited;

      expect(exitCallsBeforeOneSecond).toEqual([]);
    } finally {
      exitSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('removes its Ctrl+C listener after success and after failure', async () => {
    const existing = [...process.listeners('SIGINT')];
    await withSimulatorRequestAnalyticsAsync(analytics, properties, spinner, async () => 'session');
    expect(process.listeners('SIGINT')).toEqual(existing);
    await expect(
      withSimulatorRequestAnalyticsAsync(analytics, properties, spinner, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(process.listeners('SIGINT')).toEqual(existing);
  });
});
