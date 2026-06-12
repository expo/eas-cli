import { Job } from '@expo/eas-build-job';
import spawn, { SpawnOptions, SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import path from 'path';

import { BuildContext } from '../context';
import { Sentry } from '../sentry';
import { PackageManager, findPackagerRootDir } from '../utils/packageManager';
import { isUsingModernYarnVersion } from '../utils/project';

export async function installDependenciesAsync({
  packageManager,
  env,
  logger,
  infoCallbackFn,
  lineTransformer,
  cwd,
  useFrozenLockfile,
}: {
  packageManager: PackageManager;
  env: Record<string, string | undefined>;
  cwd: string;
  logger: Exclude<SpawnOptions['logger'], undefined>;
  infoCallbackFn?: SpawnOptions['infoCallbackFn'];
  lineTransformer?: SpawnOptions['lineTransformer'];
  useFrozenLockfile: boolean;
}): Promise<{ spawnPromise: SpawnPromise<SpawnResult> }> {
  let args: string[];
  switch (packageManager) {
    case PackageManager.NPM: {
      args = useFrozenLockfile ? ['ci'] : ['install'];
      args.push('--include=dev');
      break;
    }
    case PackageManager.PNPM: {
      args = ['install', useFrozenLockfile ? '--frozen-lockfile' : '--no-frozen-lockfile'];
      break;
    }
    case PackageManager.YARN: {
      const isModernYarnVersion = await isUsingModernYarnVersion(cwd);
      if (isModernYarnVersion) {
        if (env['EAS_YARN_FOCUS_WORKSPACE']) {
          args = ['workspaces', 'focus', env['EAS_YARN_FOCUS_WORKSPACE']];
        } else {
          args = [
            'install',
            '--inline-builds',
            useFrozenLockfile ? '--immutable' : '--no-immutable',
          ];
        }
      } else {
        args = [
          'install',
          ...(useFrozenLockfile ? ['--frozen-lockfile'] : []),
          '--production',
          'false',
        ];
      }
      break;
    }
    case PackageManager.BUN:
      args = ['install', ...(useFrozenLockfile ? ['--frozen-lockfile'] : [])];
      break;
    default:
      throw new Error(`Unsupported package manager: ${packageManager}`);
  }
  if (env['EAS_VERBOSE'] === '1') {
    args = [...args, '--verbose'];
  }
  logger.info(`Running "${packageManager} ${args.join(' ')}" in ${cwd} directory`);
  return {
    spawnPromise: spawn(packageManager, args, {
      cwd,
      logger,
      infoCallbackFn,
      lineTransformer,
      env,
    }),
  };
}

export async function installDependenciesWithNpmCacheFallbackAsync({
  packageManager,
  env,
  logger,
  infoCallbackFn,
  cwd,
  useFrozenLockfile,
}: {
  packageManager: PackageManager;
  env: Record<string, string | undefined>;
  cwd: string;
  logger: Exclude<SpawnOptions['logger'], undefined>;
  infoCallbackFn?: SpawnOptions['infoCallbackFn'];
  useFrozenLockfile: boolean;
}): Promise<void> {
  const npmCacheUrl = env.NPM_CONFIG_REGISTRY;
  const npmCacheErrorTracker = createNpmCacheRegistryErrorTracker({ env, npmCacheUrl });
  try {
    await (
      await installDependenciesAsync({
        packageManager,
        env,
        logger,
        infoCallbackFn,
        lineTransformer: npmCacheErrorTracker.inspectLine,
        cwd,
        useFrozenLockfile,
      })
    ).spawnPromise;
    npmCacheErrorTracker.reportNonFatalError({ packageManager, cwd, useFrozenLockfile });
  } catch (err: unknown) {
    if (!isNpmCacheInstallFailure(err, { env, npmCacheUrl })) {
      throw err;
    }

    logger.warn(
      `Failed to install dependencies using the npm cache registry (${npmCacheUrl}). Retrying without the npm cache registry.`
    );
    const sentryError = createNpmCacheRegistryInstallError(err);
    Sentry.capture(sentryError, {
      level: 'warning',
      tags: {
        packageManager,
      },
      extras: {
        cwd,
        npmCacheUrl,
        useFrozenLockfile,
        originalErrorMessage: getErrorMessage(err),
        status: getErrorField(err, 'status'),
        signal: getErrorField(err, 'signal'),
      },
    });

    const fallbackEnv = { ...env };
    delete fallbackEnv.NPM_CONFIG_REGISTRY;
    await (
      await installDependenciesAsync({
        packageManager,
        env: fallbackEnv,
        logger,
        infoCallbackFn,
        cwd,
        useFrozenLockfile,
      })
    ).spawnPromise;
  }
}

export function resolvePackagerDir(ctx: BuildContext<Job>): string {
  const packagerRunDir = findPackagerRootDir(ctx.getReactNativeProjectDirectory());
  if (packagerRunDir !== ctx.getReactNativeProjectDirectory()) {
    const relativeReactNativeProjectDirectory = path.relative(
      ctx.buildDirectory,
      ctx.getReactNativeProjectDirectory()
    );
    ctx.logger.info(
      `We detected that '${relativeReactNativeProjectDirectory}' is a ${ctx.packageManager} workspace`
    );
  }
  return packagerRunDir;
}

function isNpmCacheInstallFailure(
  err: unknown,
  { env, npmCacheUrl }: { env: Record<string, string | undefined>; npmCacheUrl: string | undefined }
): boolean {
  if (!isNpmCacheRegistryEnabled(env, npmCacheUrl)) {
    return false;
  }
  const errorOutput = getErrorOutput(err);
  return errorOutput.includes(npmCacheUrl);
}

function createNpmCacheRegistryErrorTracker({
  env,
  npmCacheUrl,
}: {
  env: Record<string, string | undefined>;
  npmCacheUrl: string | undefined;
}): {
  inspectLine: NonNullable<SpawnOptions['lineTransformer']>;
  reportNonFatalError({
    packageManager,
    cwd,
    useFrozenLockfile,
  }: {
    packageManager: PackageManager;
    cwd: string;
    useFrozenLockfile: boolean;
  }): void;
} {
  let firstErrorLine: string | undefined;
  let errorLineCount = 0;

  return {
    inspectLine(line: string): string {
      if (isNpmCacheRegistryErrorLine(line, { env, npmCacheUrl })) {
        firstErrorLine ??= line;
        errorLineCount += 1;
      }
      return line;
    },
    reportNonFatalError({
      packageManager,
      cwd,
      useFrozenLockfile,
    }: {
      packageManager: PackageManager;
      cwd: string;
      useFrozenLockfile: boolean;
    }): void {
      if (!firstErrorLine) {
        return;
      }
      const sentryError = new Error('Non-fatal npm cache registry error during dependency install');
      sentryError.name = 'NpmCacheRegistryNonFatalError';
      Sentry.capture(sentryError, {
        level: 'warning',
        tags: {
          packageManager,
        },
        extras: {
          cwd,
          npmCacheUrl,
          useFrozenLockfile,
          firstErrorLine,
          errorLineCount,
        },
      });
    },
  };
}

function isNpmCacheRegistryErrorLine(
  line: string,
  { env, npmCacheUrl }: { env: Record<string, string | undefined>; npmCacheUrl: string | undefined }
): boolean {
  return (
    isNpmCacheRegistryEnabled(env, npmCacheUrl) &&
    line.includes(npmCacheUrl) &&
    /(?:error|failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|FetchError)/i.test(line)
  );
}

function isNpmCacheRegistryEnabled(
  env: Record<string, string | undefined>,
  npmCacheUrl: string | undefined
): npmCacheUrl is string {
  return env.EAS_USE_NPM_CACHE === '1' && !!npmCacheUrl;
}

function getErrorOutput(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return '';
  }
  const { stdout, stderr } = err as { stdout?: unknown; stderr?: unknown };
  return [stdout, stderr]
    .filter((output): output is string => typeof output === 'string')
    .join('\n');
}

function getErrorField(err: unknown, field: 'status' | 'signal'): unknown {
  return err && typeof err === 'object' ? (err as Record<string, unknown>)[field] : undefined;
}

function createNpmCacheRegistryInstallError(err: unknown): Error {
  const error = new Error('Failed to install dependencies using npm cache registry');
  error.name = 'NpmCacheRegistryInstallError';
  if (err instanceof Error) {
    error.stack = err.stack;
  }
  return error;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
