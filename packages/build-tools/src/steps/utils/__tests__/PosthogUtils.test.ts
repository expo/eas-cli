import { UserError } from '@expo/eas-build-job';
import { bunyan, createLogger } from '@expo/logger';
import { Response } from 'node-fetch';

import { PosthogUtils } from '../PosthogUtils';

jest.mock('@expo/logger');

const logger = createLogger({ name: 'test' }) as bunyan;

function errorResponse({ status, text }: { status: number; text?: string }): Response {
  return { status, text: async () => text ?? '' } as unknown as Response;
}

describe(PosthogUtils.readErrorAsync, () => {
  it('surfaces a JSON detail followed by the raw body', async () => {
    await expect(
      PosthogUtils.readErrorAsync(errorResponse({ status: 400, text: '{"detail":"boom"}' }))
    ).resolves.toBe('status 400: boom ({"detail":"boom"})');
  });

  it('falls back to the raw body for detail-less JSON', async () => {
    await expect(
      PosthogUtils.readErrorAsync(errorResponse({ status: 400, text: '{"other":1}' }))
    ).resolves.toBe('status 400: {"other":1}');
  });

  it('ignores an empty-string detail', async () => {
    await expect(
      PosthogUtils.readErrorAsync(errorResponse({ status: 400, text: '{"detail":""}' }))
    ).resolves.toBe('status 400: {"detail":""}');
  });

  it('falls back to the raw text for a non-JSON body', async () => {
    await expect(
      PosthogUtils.readErrorAsync(errorResponse({ status: 502, text: 'Bad Gateway' }))
    ).resolves.toBe('status 502: Bad Gateway');
  });

  it('uses just the status when the body is empty', async () => {
    await expect(
      PosthogUtils.readErrorAsync(errorResponse({ status: 500, text: '' }))
    ).resolves.toBe('status 500');
  });

  it('uses just the status when reading the body throws', async () => {
    const response = {
      status: 500,
      text: async () => {
        throw new Error('read fail');
      },
    } as unknown as Response;
    await expect(PosthogUtils.readErrorAsync(response)).resolves.toBe('status 500');
  });
});

describe(PosthogUtils.assertPollBoundsPositive, () => {
  it('throws with the given error code when a bound is not positive', () => {
    expect(() =>
      PosthogUtils.assertPollBoundsPositive({
        timeoutSeconds: 0,
        intervalSeconds: 30,
        errorCode: 'EAS_POSTHOG_TEST_INTERVAL',
      })
    ).toThrow(/greater than 0/);
    expect(() =>
      PosthogUtils.assertPollBoundsPositive({
        timeoutSeconds: 600,
        intervalSeconds: -1,
        errorCode: 'EAS_POSTHOG_TEST_INTERVAL',
      })
    ).toThrow(/greater than 0/);
  });

  it('does nothing when both bounds are positive', () => {
    expect(() =>
      PosthogUtils.assertPollBoundsPositive({
        timeoutSeconds: 600,
        intervalSeconds: 30,
        errorCode: 'EAS_POSTHOG_TEST_INTERVAL',
      })
    ).not.toThrow();
  });
});

describe(PosthogUtils.waitForNextPollAsync, () => {
  it('returns false without sleeping when the deadline has passed', async () => {
    await expect(
      PosthogUtils.waitForNextPollAsync({
        intervalSeconds: 30,
        deadline: Date.now() - 1,
        signal: undefined,
      })
    ).resolves.toBe(false);
  });

  it('sleeps for the clamped interval and returns true when time remains', async () => {
    await expect(
      PosthogUtils.waitForNextPollAsync({
        intervalSeconds: 0.01,
        deadline: Date.now() + 1000,
        signal: undefined,
      })
    ).resolves.toBe(true);
  });

  it('rejects when the signal aborts during the sleep', async () => {
    const controller = new AbortController();
    const promise = PosthogUtils.waitForNextPollAsync({
      intervalSeconds: 30,
      deadline: Date.now() + 60_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toThrow();
  });
});

describe(PosthogUtils.failOrLogError, () => {
  it('throws the error when ignoreError is false', () => {
    const error = new Error('boom');
    expect(() => PosthogUtils.failOrLogError({ logger, ignoreError: false, error })).toThrow(
      'boom'
    );
  });

  it('warns and swallows the error when ignoreError is true', () => {
    const warnMock = jest.spyOn(logger, 'warn');
    const error = new Error('boom');

    PosthogUtils.failOrLogError({ logger, ignoreError: true, error });

    expect(warnMock).toHaveBeenCalledWith({ err: error }, 'boom Ignoring error.');
  });

  it('rethrows a forbidden error even when ignoreError is true', () => {
    const error = new UserError('EAS_POSTHOG_FORBIDDEN', 'no scope');
    expect(() => PosthogUtils.failOrLogError({ logger, ignoreError: true, error })).toThrow(
      'no scope'
    );
  });

  it('stringifies a non-Error value when swallowing', () => {
    const warnMock = jest.spyOn(logger, 'warn');

    PosthogUtils.failOrLogError({ logger, ignoreError: true, error: 'plain string' });

    expect(warnMock).toHaveBeenCalledWith({ err: 'plain string' }, 'plain string Ignoring error.');
  });
});
