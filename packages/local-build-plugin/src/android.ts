import { Android, ManagedArtifactType, BuildPhase, Env } from '@expo/eas-build-job';
import { Builders, BuildContext, Artifacts } from '@expo/build-tools';
import omit from 'lodash/omit';

import { logBuffer } from './logger';
import { BuildParams } from './types';
import { prepareArtifacts } from './artifacts';
import config from './config';

export async function buildAndroidAsync(
  job: Android.Job,
  { workingdir, env: baseEnv, metadata, logger }: BuildParams
): Promise<Artifacts> {
  const versionName = job.version?.versionName;
  const versionCode = job.version?.versionCode;
  const env: Env = {
    ...baseEnv,
    ...(versionCode && { EAS_BUILD_ANDROID_VERSION_CODE: versionCode }),
    ...(versionName && { EAS_BUILD_ANDROID_VERSION_NAME: versionName }),
  };
  const ctx = new BuildContext<Android.Job>(job, {
    workingdir,
    logger,
    logBuffer,
    uploadArtifact: async ({ artifact, logger }) => {
      if (artifact.type === ManagedArtifactType.APPLICATION_ARCHIVE) {
        return await prepareArtifacts(artifact.paths, logger);
      } else if (artifact.type === ManagedArtifactType.BUILD_ARTIFACTS) {
        return await prepareArtifacts(artifact.paths, logger);
      } else {
        return { filename: null };
      }
    },
    env,
    metadata,
    skipNativeBuild: config.skipNativeBuild,
  });

  await ctx.runBuildPhase(BuildPhase.START_BUILD, async () => {
    ctx.logger.info({ job: omit(ctx.job, 'secrets') }, 'Starting build');
  });

  return await Builders.androidBuilder(ctx);
}
