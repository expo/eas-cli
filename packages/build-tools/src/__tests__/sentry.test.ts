import * as sentryNode from '@sentry/node';

import { Sentry } from '../sentry';

jest.mock('@sentry/node');

describe('Sentry singleton', () => {
  beforeEach(() => {
    jest.mocked(sentryNode.init).mockReset();
    jest.mocked(sentryNode.flush).mockReset();
    jest.mocked(sentryNode.captureException).mockReset();
    jest.mocked(sentryNode.captureMessage).mockReset();
    jest.mocked(sentryNode.withScope).mockReset();
  });

  describe('setup', () => {
    it('initializes the SDK with dsn + environment when dsn is non-null', () => {
      Sentry.setup({ dsn: 'https://example@sentry.io/1', environment: 'production' });
      expect(sentryNode.init).toHaveBeenCalledWith({
        dsn: 'https://example@sentry.io/1',
        environment: 'production',
      });
    });

    it('passes default tags into the SDK init as initialScope', () => {
      Sentry.setup({
        dsn: 'https://example@sentry.io/1',
        environment: 'production',
        tags: { service: 'worker:darwin' },
      });
      expect(sentryNode.init).toHaveBeenCalledWith({
        dsn: 'https://example@sentry.io/1',
        environment: 'production',
        initialScope: { tags: { service: 'worker:darwin' } },
      });
    });

    it('skips SDK init when dsn is null', () => {
      Sentry.setup({ dsn: null, environment: 'development' });
      expect(sentryNode.init).not.toHaveBeenCalled();
    });

    it('passes the latest initialScope tags when setup is called more than once', () => {
      Sentry.setup({
        dsn: 'https://e@sentry.io/1',
        environment: 'test',
        tags: { service: 'first' },
      });
      Sentry.setup({
        dsn: 'https://e@sentry.io/1',
        environment: 'test',
        tags: { service: 'second' },
      });

      expect(sentryNode.init).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ initialScope: { tags: { service: 'second' } } })
      );
    });
  });

  describe('capture', () => {
    it('routes (msg) to captureMessage with msg only', () => {
      const scope = mockWithScope();

      Sentry.capture('plain message');

      expect(sentryNode.captureMessage).toHaveBeenCalledWith('plain message');
      expect(sentryNode.captureException).not.toHaveBeenCalled();
      expect(scope.setExtra).not.toHaveBeenCalled();
    });

    it('routes (msg, options) and sets per-call tags/extras/level on the scope', () => {
      const scope = mockWithScope();

      Sentry.capture('something happened', {
        tags: { phase: 'running-xclogparser' },
        extras: { buildId: 'abc' },
        level: 'warning',
      });

      expect(scope.setTags).toHaveBeenCalledWith({ phase: 'running-xclogparser' });
      expect(scope.setExtras).toHaveBeenCalledWith({ buildId: 'abc' });
      expect(scope.setLevel).toHaveBeenCalledWith('warning');
      expect(sentryNode.captureMessage).toHaveBeenCalledWith('something happened');
      expect(sentryNode.captureException).not.toHaveBeenCalled();
    });

    it('routes (msg, err) to captureException and sets msg as `message` extra when distinct from err.message', () => {
      const scope = mockWithScope();
      const err = new Error('boom');

      Sentry.capture('something went wrong', err);

      expect(scope.setExtra).toHaveBeenCalledWith('message', 'something went wrong');
      expect(sentryNode.captureException).toHaveBeenCalledWith(err);
      expect(sentryNode.captureMessage).not.toHaveBeenCalled();
    });

    it('routes (msg, err, options) to captureException with per-call tags/extras', () => {
      const scope = mockWithScope();
      const err = new Error('spawn ENOENT');

      Sentry.capture('xclogparser failed', err, {
        tags: { phase: 'running-xclogparser' },
        extras: { buildId: 'abc' },
      });

      expect(scope.setTags).toHaveBeenCalledWith({ phase: 'running-xclogparser' });
      expect(scope.setExtras).toHaveBeenCalledWith({ buildId: 'abc' });
      expect(scope.setExtra).toHaveBeenCalledWith('message', 'xclogparser failed');
      expect(sentryNode.captureException).toHaveBeenCalledWith(err);
    });

    it('does not set the `message` extra when msg equals err.message', () => {
      const scope = mockWithScope();
      const err = new Error('build failed');

      Sentry.capture('build failed', err);

      expect(scope.setExtra).not.toHaveBeenCalledWith('message', expect.anything());
      expect(sentryNode.captureException).toHaveBeenCalledWith(err);
    });

    it('routes (err) alone to captureException with no scope mutations', () => {
      const scope = mockWithScope();
      const err = new Error('boom');

      Sentry.capture(err);

      expect(scope.setTags).not.toHaveBeenCalled();
      expect(scope.setExtras).not.toHaveBeenCalled();
      expect(scope.setLevel).not.toHaveBeenCalled();
      expect(scope.setExtra).not.toHaveBeenCalled();
      expect(sentryNode.captureException).toHaveBeenCalledWith(err);
      expect(sentryNode.captureMessage).not.toHaveBeenCalled();
    });

    it('treats (msg, null) as a no-err call (parity with 3-arg null behavior)', () => {
      const scope = mockWithScope();

      Sentry.capture('forwarded null', null as unknown as Error);

      expect(scope.setExtra).not.toHaveBeenCalled();
      expect(sentryNode.captureMessage).toHaveBeenCalledWith('forwarded null');
      expect(sentryNode.captureException).not.toHaveBeenCalled();
    });

    it('treats (msg, null, options) as a no-err call', () => {
      const scope = mockWithScope();

      Sentry.capture('forwarded null with opts', null as unknown as Error, {
        tags: { phase: 'cleanup' },
      });

      expect(scope.setTags).toHaveBeenCalledWith({ phase: 'cleanup' });
      expect(scope.setExtra).not.toHaveBeenCalled();
      expect(sentryNode.captureMessage).toHaveBeenCalledWith('forwarded null with opts');
      expect(sentryNode.captureException).not.toHaveBeenCalled();
    });

    it('treats (msg, undefined, options) as a no-err call (forwarding `Error | undefined` typed vars)', () => {
      const scope = mockWithScope();

      Sentry.capture('forwarded with no err', undefined, {
        tags: { phase: 'install-dependencies' },
        extras: { buildId: 'abc' },
      });

      expect(scope.setTags).toHaveBeenCalledWith({ phase: 'install-dependencies' });
      expect(scope.setExtras).toHaveBeenCalledWith({ buildId: 'abc' });
      expect(scope.setExtra).not.toHaveBeenCalled();
      expect(sentryNode.captureMessage).toHaveBeenCalledWith('forwarded with no err');
      expect(sentryNode.captureException).not.toHaveBeenCalled();
    });

    it('coerces 2-arg primitive thrown value to Error (e.g. `throw "boom"`)', () => {
      mockWithScope();

      Sentry.capture('caught a string', 'boom' as unknown as Error);

      expect(sentryNode.captureException).toHaveBeenCalledWith(expect.any(Error));
      const coerced = jest.mocked(sentryNode.captureException).mock.calls[0][0] as Error;
      expect(coerced.message).toBe('boom');
      expect(sentryNode.captureMessage).not.toHaveBeenCalled();
    });

    it('coerces non-Error middle arg to Error when caller passes 3 args (e.g. `catch (err: any)`)', () => {
      const scope = mockWithScope();

      Sentry.capture('something failed', 'raw string thrown' as unknown as Error, {
        tags: { phase: 'install-dependencies' },
        extras: { buildId: 'abc' },
      });

      expect(scope.setTags).toHaveBeenCalledWith({ phase: 'install-dependencies' });
      expect(scope.setExtras).toHaveBeenCalledWith({ buildId: 'abc' });
      expect(scope.setExtra).toHaveBeenCalledWith('message', 'something failed');
      expect(sentryNode.captureException).toHaveBeenCalledWith(expect.any(Error));
      const coerced = jest.mocked(sentryNode.captureException).mock.calls[0][0] as Error;
      expect(coerced.message).toBe('raw string thrown');
      expect(sentryNode.captureMessage).not.toHaveBeenCalled();
    });

    it('routes (err, options) to captureException with no message extra', () => {
      const scope = mockWithScope();
      const err = new Error('boom');

      Sentry.capture(err, { tags: { phase: 'install-dependencies' }, level: 'warning' });

      expect(scope.setTags).toHaveBeenCalledWith({ phase: 'install-dependencies' });
      expect(scope.setLevel).toHaveBeenCalledWith('warning');
      expect(scope.setExtra).not.toHaveBeenCalled();
      expect(sentryNode.captureException).toHaveBeenCalledWith(err);
      expect(sentryNode.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('forwards the timeout to the SDK and resolves with its result', async () => {
      jest.mocked(sentryNode.flush).mockResolvedValue(true);

      const result = await Sentry.flush(3000);

      expect(sentryNode.flush).toHaveBeenCalledWith(3000);
      expect(result).toBe(true);
    });

    it('defaults the timeout to 2000ms when not specified', async () => {
      jest.mocked(sentryNode.flush).mockResolvedValue(true);

      await Sentry.flush();

      expect(sentryNode.flush).toHaveBeenCalledWith(2000);
    });
  });
});

function mockWithScope(): {
  setTags: jest.Mock;
  setExtras: jest.Mock;
  setExtra: jest.Mock;
  setLevel: jest.Mock;
} {
  const scope = {
    setTags: jest.fn(),
    setExtras: jest.fn(),
    setExtra: jest.fn(),
    setLevel: jest.fn(),
  };
  jest.mocked(sentryNode.withScope).mockImplementation((cb: any) => {
    cb(scope as unknown as sentryNode.Scope);
    return undefined as any;
  });
  return scope;
}
