import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import os from 'os';
import path from 'path';

import { createMockLogger } from '../../__tests__/utils/logger';
import {
  XCODE_COMPILATION_CACHE_ENV,
  XCODE_COMPILATION_CACHE_RELATIVE_PATH,
  compressXcodeCompilationCacheAsync,
  decompressXcodeCompilationCacheAsync,
  prepareXcodeCompilationCacheEnvAsync,
} from '../compilationCache';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const DEVELOPER_DIRECTORY = '/Applications/Xcode.app/Contents/Developer';
const APPLE_PLUGIN_PATH = path.join(DEVELOPER_DIRECTORY, 'usr/lib/libToolchainCASPlugin.dylib');
const BUNDLED_SHIM_PATH = path.resolve(
  __dirname,
  '../../../bin/libeas_xcode_local_cas_plugin.dylib'
);

describe(prepareXcodeCompilationCacheEnvAsync, () => {
  test('does nothing without the explicit opt-in', async () => {
    const result = await prepareXcodeCompilationCacheEnvAsync({
      derivedDataPath: '/project/ios/build',
      env: {},
      logger: createMockLogger(),
    });

    expect(result).toEqual({});
    expect(spawn).not.toHaveBeenCalled();
  });

  test('enables compilation caching after validating the bundled arm64 shim', async () => {
    vol.fromJSON({
      [BUNDLED_SHIM_PATH]: 'bundled shim',
      [APPLE_PLUGIN_PATH]: 'Apple plugin',
    });
    vol.mkdirSync(os.tmpdir(), { recursive: true });
    jest.mocked(spawn).mockResolvedValue({} as any);

    const result = await prepareXcodeCompilationCacheEnvAsync({
      derivedDataPath: '/project/ios/build',
      env: {
        [XCODE_COMPILATION_CACHE_ENV]: '1',
        DEVELOPER_DIR: DEVELOPER_DIRECTORY,
      },
      logger: createMockLogger(),
    });

    expect(spawn).toHaveBeenCalledWith(
      'xcrun',
      expect.arrayContaining([
        'llvm-cas',
        `--fcas-plugin-path=${BUNDLED_SHIM_PATH}`,
        '--fcas-plugin-option=remote-service-path=/dev/null',
        '--ingest',
        BUNDLED_SHIM_PATH,
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          EAS_XCODE_LOCAL_CAS_APPLE_PLUGIN: APPLE_PLUGIN_PATH,
        }),
      })
    );
    expect(result).toEqual({
      EAS_XCODE_LOCAL_CAS_APPLE_PLUGIN: APPLE_PLUGIN_PATH,
      GYM_XCARGS: `COMPILATION_CACHE_ENABLE_CACHING=YES COMPILATION_CACHE_ENABLE_DIAGNOSTIC_REMARKS=YES COMPILATION_CACHE_ENABLE_PLUGIN=YES COMPILATION_CACHE_PLUGIN_PATH=${BUNDLED_SHIM_PATH} COMPILATION_CACHE_REMOTE_SERVICE_PATH=/dev/null`,
      GYM_DERIVED_DATA_PATH: '/project/ios/build',
    });
  });

  test('does not enable compilation caching when the bundled shim is missing', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      [APPLE_PLUGIN_PATH]: 'Apple plugin',
    });

    const result = await prepareXcodeCompilationCacheEnvAsync({
      derivedDataPath: '/project/ios/build',
      env: {
        [XCODE_COMPILATION_CACHE_ENV]: '1',
        DEVELOPER_DIR: DEVELOPER_DIRECTORY,
      },
      logger,
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(result).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('compilation caching is disabled')
    );
  });

  test('does not enable compilation caching when the bundled shim is incompatible', async () => {
    const logger = createMockLogger();
    vol.fromJSON({
      [BUNDLED_SHIM_PATH]: 'bundled shim',
      [APPLE_PLUGIN_PATH]: 'Apple plugin',
    });
    vol.mkdirSync(os.tmpdir(), { recursive: true });
    jest.mocked(spawn).mockRejectedValue(new Error('incompatible plugin'));

    const result = await prepareXcodeCompilationCacheEnvAsync({
      derivedDataPath: '/project/ios/build',
      env: {
        [XCODE_COMPILATION_CACHE_ENV]: '1',
        DEVELOPER_DIR: DEVELOPER_DIRECTORY,
      },
      logger,
    });

    expect(result).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('compilation caching is disabled')
    );
  });
});

describe('Xcode compilation cache archives', () => {
  test('uses system tar to preserve sparse files', async () => {
    const workingDirectory = '/working-directory';
    vol.fromJSON({
      [path.join(workingDirectory, XCODE_COMPILATION_CACHE_RELATIVE_PATH, 'cache.db')]: 'cache',
    });
    vol.mkdirSync(os.tmpdir(), { recursive: true });
    jest.mocked(spawn).mockResolvedValue({} as any);

    const { archivePath } = await compressXcodeCompilationCacheAsync({
      workingDirectory,
      env: {},
      logger: createMockLogger(),
    });

    expect(spawn).toHaveBeenCalledWith(
      'tar',
      ['-czf', archivePath, '-C', workingDirectory, XCODE_COMPILATION_CACHE_RELATIVE_PATH],
      expect.any(Object)
    );

    await decompressXcodeCompilationCacheAsync({
      archivePath,
      workingDirectory,
      env: {},
      logger: createMockLogger(),
    });

    expect(spawn).toHaveBeenCalledWith(
      'tar',
      ['-xzSf', archivePath, '-C', workingDirectory],
      expect.any(Object)
    );
  });
});
