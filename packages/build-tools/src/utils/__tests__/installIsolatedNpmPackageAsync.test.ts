import spawn from '@expo/turtle-spawn';

import { createMockLogger } from '../../__tests__/utils/logger';
import { Sentry } from '../../sentry';
import { installIsolatedNpmPackageAsync } from '../installIsolatedNpmPackageAsync';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../sentry', () => ({ Sentry: { capture: jest.fn() } }));

const spawnMock = jest.mocked(spawn);
const npmCacheUrl = 'https://npm-cache.expo.test';

describe(installIsolatedNpmPackageAsync, () => {
  it('retries without the npm cache registry when the install fails against it', async () => {
    const logger = createMockLogger();
    const cacheFailure = Object.assign(new Error('npm install exited with non-zero code: 1'), {
      stderr: `npm error request to ${npmCacheUrl}/@scope%2ffork failed, reason: ECONNREFUSED`,
    });
    spawnMock.mockRejectedValueOnce(cacheFailure).mockResolvedValueOnce({} as never);

    await installIsolatedNpmPackageAsync({
      packageSpec: '@scope/fork@next',
      directory: '/tmp/sandbox',
      npmCacheUrl,
      pathEnv: '/usr/bin',
      logger,
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][1]).toEqual(expect.arrayContaining(['--registry', npmCacheUrl]));
    expect(spawnMock.mock.calls[1][1]).not.toContain('--registry');
    expect(spawnMock.mock.calls[1][2]).toEqual({
      env: { PATH: '/usr/bin', HOME: '/tmp/sandbox' },
      logger,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      `Failed to install @scope/fork@next using the npm cache registry (${npmCacheUrl}). Retrying without the npm cache registry.`
    );
    expect(Sentry.capture).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'NpmCacheRegistryInstallError', cause: cacheFailure }),
      { level: 'warning', extras: { packageSpec: '@scope/fork@next', npmCacheUrl } }
    );
  });

  it('rethrows an install failure that does not mention the npm cache registry', async () => {
    const error = Object.assign(new Error('npm install exited with non-zero code: 1'), {
      stderr: 'npm error notarget No matching version found for @scope/fork@next.',
    });
    spawnMock.mockRejectedValueOnce(error);

    await expect(
      installIsolatedNpmPackageAsync({
        packageSpec: '@scope/fork@next',
        directory: '/tmp/sandbox',
        npmCacheUrl,
        pathEnv: '/usr/bin',
      })
    ).rejects.toBe(error);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('rethrows the cancellation of an install without retrying', async () => {
    const controller = new AbortController();
    const cancellation = new Error('cancelled');
    spawnMock.mockImplementationOnce((() => {
      controller.abort(cancellation);
      return Promise.reject(
        Object.assign(new Error('npm install was killed with SIGTERM'), {
          stderr: `npm error request to ${npmCacheUrl}/@scope%2ffork failed`,
        })
      );
    }) as unknown as typeof spawn);

    await expect(
      installIsolatedNpmPackageAsync({
        packageSpec: '@scope/fork@next',
        directory: '/tmp/sandbox',
        npmCacheUrl,
        pathEnv: '/usr/bin',
        signal: controller.signal,
      })
    ).rejects.toBe(cancellation);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).not.toHaveBeenCalled();
  });
});
