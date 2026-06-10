describe('config', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalWorkerRuntimeConfigBase64 = process.env.WORKER_RUNTIME_CONFIG_BASE64;

  afterEach(() => {
    restoreEnv('ENVIRONMENT', originalEnvironment);
    restoreEnv('WORKER_RUNTIME_CONFIG_BASE64', originalWorkerRuntimeConfigBase64);
    jest.resetModules();
  });

  it('parses cache URL fallbacks from worker runtime config', () => {
    process.env.ENVIRONMENT = 'staging';
    process.env.WORKER_RUNTIME_CONFIG_BASE64 = Buffer.from(
      JSON.stringify({
        buildId: 'build-id',
        npmCacheUrl: 'https://npm-cache.example',
        nodeJsCacheUrl: 'https://node-cache.example',
        mavenCacheUrl: 'https://maven-cache.example',
        cocoapodsCacheUrl: 'https://cocoapods-cache.example',
      })
    ).toString('base64');

    jest.isolateModules(() => {
      const config = require('../config').default;

      expect(config.npmCacheUrl).toBe('https://npm-cache.example');
      expect(config.nodeJsCacheUrl).toBe('https://node-cache.example');
      expect(config.mavenCacheUrl).toBe('https://maven-cache.example');
      expect(config.cocoapodsCacheUrl).toBe('https://cocoapods-cache.example');
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
