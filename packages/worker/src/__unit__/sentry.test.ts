import { Sentry } from '@expo/build-tools';

jest.mock('@expo/build-tools', () => ({
  ...jest.requireActual('@expo/build-tools'),
  Sentry: {
    setup: jest.fn(),
    captureMessage: jest.fn(),
    flush: jest.fn(),
    _resetForTest: jest.fn(),
  },
}));

describe('worker sentry bootstrap', () => {
  it('calls Sentry.setup at module import with worker DSN/environment/tags', () => {
    jest.isolateModules(() => {
      require('../sentry');
    });

    expect(Sentry.setup).toHaveBeenCalledWith({
      // Empty SENTRY_DSN in the test env gets coerced to null by `worker/src/sentry.ts`.
      dsn: null,
      environment: expect.any(String),
      tags: { service: `worker:${process.platform}` },
    });
  });
});
