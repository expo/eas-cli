import { Environment } from '../constants';

describe('config', () => {
  const originalEnvironment = process.env.ENVIRONMENT;

  afterEach(() => {
    process.env.ENVIRONMENT = originalEnvironment;
    jest.resetModules();
  });

  it.each([
    [Environment.DEVELOPMENT, 'http://localhost:4999/logs/'],
    [Environment.STAGING, 'https://staging-logs.expo.dev/logs/'],
    [Environment.PRODUCTION, 'https://logs.expo.dev/logs/'],
    [Environment.TEST, null],
  ])('uses the expected EAS Logs URL in %s', (environment, expectedBaseUrl) => {
    process.env.ENVIRONMENT = environment;

    jest.isolateModules(() => {
      const config = require('../config').default;
      expect(config.loggers.http.baseUrl).toBe(expectedBaseUrl);
    });
  });
});
