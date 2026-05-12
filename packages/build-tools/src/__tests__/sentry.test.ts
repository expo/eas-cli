import * as sentryNode from '@sentry/node';

import { Sentry } from '../sentry';

jest.mock('@sentry/node');

describe('Sentry singleton', () => {
  beforeEach(() => {
    Sentry._resetForTest();
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

  describe('captureMessage', () => {
    it('sets per-call tags + extras on scope, attaches err as extra, and calls captureMessage with msg', () => {
      Sentry.setup({
        dsn: 'https://example@sentry.io/1',
        environment: 'production',
        tags: { service: 'worker:darwin' },
      });

      const scope = mockWithScope();
      const err = new Error('boom');
      Sentry.captureMessage('something went wrong', err, {
        tags: { phase: 'running-xclogparser' },
        extras: { buildId: 'abc' },
      });

      expect(scope.setTags).toHaveBeenCalledWith({ phase: 'running-xclogparser' });
      expect(scope.setExtras).toHaveBeenCalledWith({ buildId: 'abc' });
      expect(scope.setExtra).toHaveBeenCalledWith('err', err);
      expect(sentryNode.captureMessage).toHaveBeenCalledWith('something went wrong');
      expect(sentryNode.captureException).not.toHaveBeenCalled();
    });

    it('does not set the err extra when err is omitted', () => {
      Sentry.setup({ dsn: 'https://e@sentry.io/1', environment: 'production' });
      const scope = mockWithScope();

      Sentry.captureMessage('plain message');

      expect(sentryNode.captureMessage).toHaveBeenCalledWith('plain message');
      expect(scope.setExtra).not.toHaveBeenCalledWith('err', expect.anything());
    });

    it('forwards the level option to the scope', () => {
      Sentry.setup({ dsn: 'https://e@sentry.io/1', environment: 'production' });
      const scope = mockWithScope();

      Sentry.captureMessage('warning thing', undefined, { level: 'warning' });

      expect(scope.setLevel).toHaveBeenCalledWith('warning');
    });

    it('is a no-op before setup is called', () => {
      Sentry.captureMessage('msg', new Error('boom'));
      expect(sentryNode.captureMessage).not.toHaveBeenCalled();
      expect(sentryNode.withScope).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('forwards the timeout to the SDK and resolves with its result', async () => {
      Sentry.setup({ dsn: 'https://e@sentry.io/1', environment: 'production' });
      jest.mocked(sentryNode.flush).mockResolvedValue(true);

      const result = await Sentry.flush(3000);

      expect(sentryNode.flush).toHaveBeenCalledWith(3000);
      expect(result).toBe(true);
    });

    it('resolves true without calling the SDK before setup', async () => {
      const result = await Sentry.flush(1000);
      expect(sentryNode.flush).not.toHaveBeenCalled();
      expect(result).toBe(true);
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
