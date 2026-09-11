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

  it.each([
    [Environment.DEVELOPMENT, 'ws://localhost:8787'],
    [Environment.STAGING, 'wss://staging-mcp.expo.dev'],
    [Environment.PRODUCTION, 'wss://mcp.expo.dev'],
    [Environment.TEST, 'ws://localhost:8787'],
  ])('uses the expected MCP server URL in %s', (environment, expectedMcpServerUrl) => {
    process.env.ENVIRONMENT = environment;

    jest.isolateModules(() => {
      const config = require('../config').default;
      expect(config.mcpServerUrl).toBe(expectedMcpServerUrl);
    });
  });
});
