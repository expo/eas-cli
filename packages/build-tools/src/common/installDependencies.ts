import { Job, SystemError } from '@expo/eas-build-job';
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
  const npmCacheUrl = env.EAS_USE_NPM_CACHE === '1' ? env.EAS_BUILD_NPM_CACHE_URL : undefined;

  if (!npmCacheUrl) {
    await (
      await installDependenciesAsync({
        packageManager,
        env,
        logger,
        infoCallbackFn,
        cwd,
        useFrozenLockfile,
      })
    ).spawnPromise;
    return;
  }

  let firstErrorLine: string | undefined;
  let errorLineCount = 0;

  try {
    await (
      await installDependenciesAsync({
        packageManager,
        env: { ...env, NPM_CONFIG_REGISTRY: npmCacheUrl },
        logger,
        infoCallbackFn,
        lineTransformer: (line: string) => {
          if (isNpmCacheRegistryErrorLine(line, npmCacheUrl)) {
            firstErrorLine ??= line;
            errorLineCount += 1;
          }
          return line;
        },
        cwd,
        useFrozenLockfile,
      })
    ).spawnPromise;

    if (firstErrorLine) {
      Sentry.capture(new NpmCacheRegistryNonFatalError(), {
        level: 'warning',
        tags: { packageManager },
        extras: { cwd, npmCacheUrl, useFrozenLockfile, firstErrorLine, errorLineCount },
      });
    }
  } catch (err: unknown) {
    if (!isNpmCacheInstallFailure(err, npmCacheUrl)) {
      throw err;
    }

    logger.warn(
      `Failed to install dependencies using the npm cache registry (${npmCacheUrl}). Retrying without the npm cache registry.`
    );
    Sentry.capture(new NpmCacheRegistryInstallError(err), {
      level: 'warning',
      tags: { packageManager },
      extras: {
        cwd,
        npmCacheUrl,
        useFrozenLockfile,
        originalErrorMessage: err instanceof Error ? err.message : String(err),
        status: err instanceof Error ? (err as any).status : undefined,
        signal: err instanceof Error ? (err as any).signal : undefined,
      },
    });

    await (
      await installDependenciesAsync({
        packageManager,
        env,
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

function isNpmCacheInstallFailure(err: unknown, npmCacheUrl: string): boolean {
  return getErrorOutput(err).includes(npmCacheUrl);
}

function isNpmCacheRegistryErrorLine(line: string, npmCacheUrl: string): boolean {
  return (
    line.includes(npmCacheUrl) &&
    /(?:error|failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|FetchError)/i.test(line)
  );
}

function getErrorOutput(err: unknown): string {
  if (!(err instanceof Error)) {
    return '';
  }
  const { stdout, stderr } = err as Error & { stdout?: string; stderr?: string };
  return [stdout, stderr].filter(Boolean).join('\n');
}

class NpmCacheRegistryNonFatalError extends SystemError {
  override name = 'NpmCacheRegistryNonFatalError';
  constructor() {
    super('Non-fatal npm cache registry error during dependency install');
  }
}

class NpmCacheRegistryInstallError extends SystemError {
  override name = 'NpmCacheRegistryInstallError';
  constructor(cause: unknown) {
    super('Failed to install dependencies using npm cache registry', { cause });
  }
}
