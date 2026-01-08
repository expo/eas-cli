import { Ios, BuildPhase, Env, ManagedArtifactType } from '@expo/eas-build-job';
import { Builders, BuildContext, Artifacts } from '@expo/build-tools';
import omit from 'lodash/omit';

import { logBuffer } from './logger';
import { BuildParams } from './types';
import { prepareArtifacts } from './artifacts';
import config from './config';

export async function buildIosAsync(
  job: Ios.Job,
  { workingdir, env: baseEnv, metadata, logger }: BuildParams
): Promise<Artifacts> {
  const buildNumber = job.version?.buildNumber;
  const appVersion = job.version?.appVersion;
  const env: Env = {
    ...baseEnv,
    ...(buildNumber && { EAS_BUILD_IOS_BUILD_NUMBER: buildNumber }),
    ...(appVersion && { EAS_BUILD_IOS_APP_VERSION: appVersion }),
  };
  const ctx = new BuildContext<Ios.Job>(job, {
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

  return await Builders.iosBuilder(ctx);
}
