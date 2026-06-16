import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';

import { createMockLogger } from '../../__tests__/utils/logger';
import { Sentry } from '../../sentry';
import { PackageManager } from '../../utils/packageManager';
import { installDependenciesWithNpmCacheFallbackAsync } from '../installDependencies';

jest.mock('@expo/turtle-spawn', () => jest.fn());
jest.mock('../../sentry', () => ({
  Sentry: {
    capture: jest.fn(),
  },
}));

describe(installDependenciesWithNpmCacheFallbackAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retries without NPM_CONFIG_REGISTRY when npm cache install fails', async () => {
    const logger = createMockLogger();
    const npmCacheUrl = 'http://npm.staging.caches.eas-build.internal';
    const error = Object.assign(
      new Error('npm install --include=dev exited with non-zero code: 1'),
      {
        status: 1,
        signal: null,
        stdout: '',
        stderr: `npm error request to ${npmCacheUrl}/left-pad failed, reason: getaddrinfo ENOTFOUND npm.staging.caches.eas-build.internal`,
      }
    );

    jest
      .mocked(spawn)
      .mockReturnValueOnce(createSpawnPromise(Promise.reject(error)))
      .mockReturnValueOnce(createSpawnPromise(Promise.resolve(createSpawnResult())));

    await installDependenciesWithNpmCacheFallbackAsync({
      packageManager: PackageManager.NPM,
      env: {
        EAS_VERBOSE: '1',
        EAS_USE_NPM_CACHE: '1',
        NPM_CONFIG_REGISTRY: npmCacheUrl,
      },
      logger,
      cwd: '/tmp/build',
      useFrozenLockfile: false,
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(1, 'npm', ['install', '--include=dev', '--verbose'], {
      cwd: '/tmp/build',
      logger,
      infoCallbackFn: undefined,
      lineTransformer: expect.any(Function),
      env: {
        EAS_VERBOSE: '1',
        EAS_USE_NPM_CACHE: '1',
        NPM_CONFIG_REGISTRY: npmCacheUrl,
      },
    });
    expect(spawn).toHaveBeenNthCalledWith(2, 'npm', ['install', '--include=dev', '--verbose'], {
      cwd: '/tmp/build',
      logger,
      infoCallbackFn: undefined,
      env: {
        EAS_VERBOSE: '1',
        EAS_USE_NPM_CACHE: '1',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      `Failed to install dependencies using the npm cache registry (${npmCacheUrl}). Retrying without the npm cache registry.`
    );
    expect(Sentry.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to install dependencies using npm cache registry',
        name: 'NpmCacheRegistryInstallError',
      }),
      {
        level: 'warning',
        tags: {
          packageManager: 'npm',
        },
        extras: {
          cwd: '/tmp/build',
          npmCacheUrl,
          useFrozenLockfile: false,
          originalErrorMessage: 'npm install --include=dev exited with non-zero code: 1',
          status: 1,
          signal: null,
        },
      }
    );
  });

  it('reports non-fatal npm cache registry errors from successful installs', async () => {
    const logger = createMockLogger();
    const npmCacheUrl = 'http://npm.staging.caches.eas-build.internal';
    const auditErrorLine = `npm verbose audit error FetchError: request to ${npmCacheUrl}/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo ENOTFOUND npm.staging.caches.eas-build.internal`;

    jest.mocked(spawn).mockImplementationOnce((_command, _args, options: any) => {
      options.lineTransformer(auditErrorLine);
      options.lineTransformer(
        `npm http cache left-pad@${npmCacheUrl}/left-pad/-/left-pad-1.3.0.tgz 0ms (cache hit)`
      );
      return createSpawnPromise(Promise.resolve(createSpawnResult()));
    });

    await installDependenciesWithNpmCacheFallbackAsync({
      packageManager: PackageManager.NPM,
      env: {
        EAS_USE_NPM_CACHE: '1',
        NPM_CONFIG_REGISTRY: npmCacheUrl,
      },
      logger,
      cwd: '/tmp/build',
      useFrozenLockfile: false,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Non-fatal npm cache registry error during dependency install',
        name: 'NpmCacheRegistryNonFatalError',
      }),
      {
        level: 'warning',
        tags: {
          packageManager: 'npm',
        },
        extras: {
          cwd: '/tmp/build',
          npmCacheUrl,
          useFrozenLockfile: false,
          firstErrorLine: auditErrorLine,
          errorLineCount: 1,
        },
      }
    );
  });

  it('does not retry when install failure does not reference npm cache registry', async () => {
    const logger = createMockLogger();
    const error = Object.assign(
      new Error('npm install --include=dev exited with non-zero code: 1'),
      {
        status: 1,
        signal: null,
        stdout: '',
        stderr: 'npm error command sh -c node postinstall.js',
      }
    );

    jest.mocked(spawn).mockReturnValueOnce(createSpawnPromise(Promise.reject(error)));

    await expect(
      installDependenciesWithNpmCacheFallbackAsync({
        packageManager: PackageManager.NPM,
        env: {
          EAS_USE_NPM_CACHE: '1',
          NPM_CONFIG_REGISTRY: 'http://npm.staging.caches.eas-build.internal',
        },
        logger,
        cwd: '/tmp/build',
        useFrozenLockfile: false,
      })
    ).rejects.toThrow(error);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('does not retry when EAS_USE_NPM_CACHE is not enabled', async () => {
    const logger = createMockLogger();
    const npmCacheUrl = 'http://npm.staging.caches.eas-build.internal';
    const error = Object.assign(
      new Error('npm install --include=dev exited with non-zero code: 1'),
      {
        status: 1,
        signal: null,
        stdout: '',
        stderr: `npm error request to ${npmCacheUrl}/left-pad failed, reason: getaddrinfo ENOTFOUND npm.staging.caches.eas-build.internal`,
      }
    );

    jest.mocked(spawn).mockReturnValueOnce(createSpawnPromise(Promise.reject(error)));

    await expect(
      installDependenciesWithNpmCacheFallbackAsync({
        packageManager: PackageManager.NPM,
        env: {
          NPM_CONFIG_REGISTRY: npmCacheUrl,
        },
        logger,
        cwd: '/tmp/build',
        useFrozenLockfile: false,
      })
    ).rejects.toThrow(error);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).not.toHaveBeenCalled();
  });
});

function createSpawnPromise(result: Promise<SpawnResult>): SpawnPromise<SpawnResult> {
  return Object.assign(result, {
    child: {
      pid: 123,
    },
  }) as SpawnPromise<SpawnResult>;
}

function createSpawnResult(): SpawnResult {
  return {
    pid: 123,
    output: ['', ''],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
  };
}
