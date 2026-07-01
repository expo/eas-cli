import { BuildStepContext, BuildStepEnv } from '@expo/steps';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';

import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  PackageManager,
  findPackagerRootDir,
  resolvePackageManager,
  shouldUseFrozenLockfile,
} from '../../../utils/packageManager';
import { readPackageJson } from '../../../utils/project';
import { installNodeModules } from '../installNodeModules';

jest.mock('@expo/turtle-spawn', () => jest.fn());
jest.mock('../../../sentry', () => ({
  Sentry: {
    capture: jest.fn(),
  },
}));
jest.mock('../../../utils/packageManager', () => ({
  ...jest.requireActual('../../../utils/packageManager'),
  resolvePackageManager: jest.fn(),
  findPackagerRootDir: jest.fn(),
  shouldUseFrozenLockfile: jest.fn(),
}));
jest.mock('../../../utils/project', () => ({
  ...jest.requireActual('../../../utils/project'),
  readPackageJson: jest.fn(),
}));

describe(installNodeModules, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(resolvePackageManager).mockReturnValue(PackageManager.NPM);
    jest.mocked(findPackagerRootDir).mockReturnValue('/tmp/build');
    jest.mocked(shouldUseFrozenLockfile).mockReturnValue(false);
    jest.mocked(readPackageJson).mockReturnValue({});
  });

  function createStepCtx(logger: ReturnType<typeof createMockLogger>): BuildStepContext {
    return {
      logger,
      workingDirectory: '/tmp/build',
      global: {
        projectTargetDirectory: '/tmp/build',
        staticContext: { metadata: {} },
      },
    } as unknown as BuildStepContext;
  }

  it('retries the install without the npm cache registry when the cache install fails', async () => {
    const logger = createMockLogger();
    const npmCacheUrl = 'http://npm.caches.eas-build.internal';
    const env: BuildStepEnv = {
      EAS_USE_NPM_CACHE: '1',
      EAS_BUILD_NPM_CACHE_URL: npmCacheUrl,
    };
    const error = Object.assign(new Error('npm install exited with non-zero code: 1'), {
      status: 1,
      signal: null,
      stdout: '',
      stderr: `npm error request to ${npmCacheUrl}/left-pad failed, reason: getaddrinfo ENOTFOUND`,
    });

    jest
      .mocked(spawn)
      .mockReturnValueOnce(createSpawnPromise(Promise.reject(error)))
      .mockReturnValueOnce(createSpawnPromise(Promise.resolve(createSpawnResult())));

    await installNodeModules(createStepCtx(logger), env);

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'npm',
      ['install', '--include=dev'],
      expect.objectContaining({
        env: {
          EAS_USE_NPM_CACHE: '1',
          EAS_BUILD_NPM_CACHE_URL: npmCacheUrl,
          NPM_CONFIG_REGISTRY: npmCacheUrl,
        },
      })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'npm',
      ['install', '--include=dev'],
      expect.objectContaining({
        env: { EAS_USE_NPM_CACHE: '1', EAS_BUILD_NPM_CACHE_URL: npmCacheUrl },
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      `Failed to install dependencies using the npm cache registry (${npmCacheUrl}). Retrying without the npm cache registry.`
    );
  });

  it('does not retry when the npm cache is not enabled', async () => {
    const logger = createMockLogger();
    const error = Object.assign(new Error('npm install exited with non-zero code: 1'), {
      status: 1,
      signal: null,
      stdout: '',
      stderr: 'npm error some unrelated failure',
    });

    jest.mocked(spawn).mockReturnValueOnce(createSpawnPromise(Promise.reject(error)));

    await expect(installNodeModules(createStepCtx(logger), {})).rejects.toThrow(error);

    expect(spawn).toHaveBeenCalledTimes(1);
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
