describe('config', () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  afterEach(() => {
    if (originalEnvironment === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnvironment;
    }
    jest.resetModules();
  });

  it('uses staging HTTP logs URL in staging', () => {
    process.env.ENVIRONMENT = 'staging';
    jest.resetModules();

    let config: typeof import('../config').default;
    jest.isolateModules(() => {
      config = require('../config').default;
    });

    expect(config!.loggers.http.baseUrl).toBe('https://staging-logs.expo.dev/logs/');
  });
});
