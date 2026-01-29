import { BuildJob } from '@expo/eas-build-job';
import { SpawnOptions } from '@expo/turtle-spawn';
import { bunyan } from '@expo/logger';

import { BuildContext } from '../context';
import { runExpoCliCommand } from '../utils/project';

import { installDependenciesAsync, resolvePackagerDir } from './installDependencies';

export interface PrebuildOptions {
  extraEnvs?: Record<string, string>;
}

export async function prebuildAsync<TJob extends BuildJob>(
  ctx: BuildContext<TJob>,
  { logger, workingDir, options }: { logger: bunyan; workingDir: string; options?: PrebuildOptions }
): Promise<void> {
  const spawnOptions: SpawnOptions = {
    cwd: workingDir,
    logger,
    env: {
      EXPO_IMAGE_UTILS_NO_SHARP: '1',
      ...options?.extraEnvs,
      ...ctx.env,
    },
  };

  const prebuildCommandArgs = getPrebuildCommandArgs(ctx);
  await runExpoCliCommand({
    args: prebuildCommandArgs,
    options: spawnOptions,
    packageManager: ctx.packageManager,
  });
  const installDependenciesSpawnPromise = (
    await installDependenciesAsync({
      packageManager: ctx.packageManager,
      env: ctx.env,
      logger,
      cwd: resolvePackagerDir(ctx),
      // prebuild sometimes modifies package.json, so we don't want to use frozen lockfile
      useFrozenLockfile: false,
    })
  ).spawnPromise;
  await installDependenciesSpawnPromise;
}

function getPrebuildCommandArgs<TJob extends BuildJob>(ctx: BuildContext<TJob>): string[] {
  let prebuildCommand =
    ctx.job.experimental?.prebuildCommand ?? `prebuild --no-install --platform ${ctx.job.platform}`;
  if (!prebuildCommand.match(/(?:--platform| -p)/)) {
    prebuildCommand = `${prebuildCommand} --platform ${ctx.job.platform}`;
  }
  const npxCommandPrefix = 'npx ';
  const expoCommandPrefix = 'expo ';
  const expoCliCommandPrefix = 'expo-cli ';
  if (prebuildCommand.startsWith(npxCommandPrefix)) {
    prebuildCommand = prebuildCommand.substring(npxCommandPrefix.length).trim();
  }
  if (prebuildCommand.startsWith(expoCommandPrefix)) {
    prebuildCommand = prebuildCommand.substring(expoCommandPrefix.length).trim();
  }
  if (prebuildCommand.startsWith(expoCliCommandPrefix)) {
    prebuildCommand = prebuildCommand.substring(expoCliCommandPrefix.length).trim();
  }

  return prebuildCommand.split(' ');
}
