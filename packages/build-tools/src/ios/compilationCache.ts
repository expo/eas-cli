import { Env, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { createHash } from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { CACHE_KEY_PREFIX_BY_PLATFORM, generateDefaultBuildCacheKeyAsync } from '../utils/cacheKey';

export const XCODE_COMPILATION_CACHE_ENV = 'EAS_BUILD_XCODE_COMPILATION_CACHE';
export const XCODE_COMPILATION_CACHE_RELATIVE_PATH = 'ios/build/CompilationCache.noindex';

export function getXcodeCompilationCachePath(derivedDataPath: string): string {
  return path.join(derivedDataPath, 'CompilationCache.noindex');
}

async function prepareXcodeLocalCompilationCachePluginAsync({
  env,
  logger,
}: {
  env: Env;
  logger: bunyan;
}): Promise<{ pluginPath: string; applePluginPath: string }> {
  const bundledPluginPath = path.resolve(
    __dirname,
    '../../bin/libeas_xcode_local_cas_plugin.dylib'
  );
  const developerDirectory =
    env.DEVELOPER_DIR ??
    (
      await spawn('xcode-select', ['--print-path'], {
        env,
        logger,
      })
    ).stdout.trim();
  const applePluginPath = path.join(
    developerDirectory,
    'usr',
    'lib',
    'libToolchainCASPlugin.dylib'
  );

  if (!(await fs.pathExists(applePluginPath))) {
    throw new Error(`The Xcode CAS plugin is missing at ${applePluginPath}.`);
  }
  if (!(await fs.pathExists(bundledPluginPath))) {
    throw new Error(`The EAS local CAS plugin is missing at ${bundledPluginPath}.`);
  }

  const validationDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'eas-xcode-local-cache-validation-')
  );
  try {
    await spawn(
      'xcrun',
      [
        'llvm-cas',
        `--fcas-plugin-path=${bundledPluginPath}`,
        '--fcas-plugin-option=remote-service-path=/dev/null',
        `--cas=${path.join(validationDirectory, 'cas')}`,
        '--ingest',
        bundledPluginPath,
      ],
      {
        env: { ...env, EAS_XCODE_LOCAL_CAS_APPLE_PLUGIN: applePluginPath },
        logger,
      }
    );
  } finally {
    await fs.remove(validationDirectory);
  }

  return { pluginPath: bundledPluginPath, applePluginPath };
}

export async function compressXcodeCompilationCacheAsync({
  workingDirectory,
  env,
  logger,
}: {
  workingDirectory: string;
  env: Env;
  logger: bunyan;
}): Promise<{ archivePath: string }> {
  const cachePath = path.join(workingDirectory, XCODE_COMPILATION_CACHE_RELATIVE_PATH);
  if (!(await fs.pathExists(cachePath))) {
    throw new Error(`The Xcode compilation cache does not exist at ${cachePath}.`);
  }

  const archiveDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'xcode-compilation-cache-'));
  const archivePath = path.join(archiveDirectory, 'cache.tar.gz');
  await spawn(
    'tar',
    ['-czf', archivePath, '-C', workingDirectory, XCODE_COMPILATION_CACHE_RELATIVE_PATH],
    { env, logger }
  );
  return { archivePath };
}

export async function decompressXcodeCompilationCacheAsync({
  archivePath,
  workingDirectory,
  env,
  logger,
}: {
  archivePath: string;
  workingDirectory: string;
  env: Env;
  logger: bunyan;
}): Promise<void> {
  await fs.ensureDir(workingDirectory);
  await spawn('tar', ['-xzSf', archivePath, '-C', workingDirectory], { env, logger });
}

export async function generateXcodeCompilationCacheKeyAsync({
  workingDirectory,
  env,
  logger,
}: {
  workingDirectory: string;
  env: Env;
  logger: bunyan;
}): Promise<{ key: string; keyPrefix: string; xcodeVersion: string }> {
  const xcodeVersion = (
    await spawn('xcodebuild', ['-version'], {
      env,
      logger,
    })
  ).stdout.trim();
  const xcodeVersionHash = createHash('sha256').update(xcodeVersion).digest('hex').slice(0, 16);
  const ccacheKey = await generateDefaultBuildCacheKeyAsync(workingDirectory, Platform.IOS);
  const dependencyHash = ccacheKey.slice(CACHE_KEY_PREFIX_BY_PLATFORM[Platform.IOS].length);
  const keyPrefix = `ios-xcode-compilation-cache-${xcodeVersionHash}-`;

  return {
    key: `${keyPrefix}${dependencyHash}`,
    keyPrefix,
    xcodeVersion: xcodeVersion.replace(/\s+/g, ' '),
  };
}

export async function prepareXcodeCompilationCacheEnvAsync({
  derivedDataPath,
  env,
  logger,
}: {
  derivedDataPath: string;
  env: Env;
  logger: bunyan;
}): Promise<Env> {
  if (env[XCODE_COMPILATION_CACHE_ENV] !== '1') {
    return {};
  }

  let plugin: { pluginPath: string; applePluginPath: string };
  try {
    plugin = await prepareXcodeLocalCompilationCachePluginAsync({
      env,
      logger,
    });
    logger.info(`The EAS local Xcode CAS plugin is ready at ${plugin.pluginPath}.`);
  } catch (error: any) {
    logger.warn(
      { err: error },
      'The EAS local Xcode CAS plugin is missing or incompatible. Xcode compilation caching is disabled.'
    );
    return {};
  }
  logger.info(
    `Xcode compilation caching is enabled. The cache directory is ${getXcodeCompilationCachePath(derivedDataPath)}.`
  );

  const pluginXcargs = [
    'COMPILATION_CACHE_ENABLE_PLUGIN=YES',
    `COMPILATION_CACHE_PLUGIN_PATH=${plugin.pluginPath}`,
    // A non-empty remote service path makes Xcode schedule C, Objective-C,
    // precompiled-module, and precompiled-header cache tasks. The EAS plugin
    // consumes this option and never opens the path or performs remote I/O.
    'COMPILATION_CACHE_REMOTE_SERVICE_PATH=/dev/null',
  ].join(' ');

  return {
    GYM_XCARGS: [
      env.GYM_XCARGS,
      'COMPILATION_CACHE_ENABLE_CACHING=YES COMPILATION_CACHE_ENABLE_DIAGNOSTIC_REMARKS=YES',
      pluginXcargs,
    ]
      .filter(Boolean)
      .join(' '),
    GYM_DERIVED_DATA_PATH: derivedDataPath,
    EAS_XCODE_LOCAL_CAS_APPLE_PLUGIN: plugin.applePluginPath,
  };
}
