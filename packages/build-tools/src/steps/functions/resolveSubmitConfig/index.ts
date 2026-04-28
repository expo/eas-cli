import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import path from 'node:path';
import { z } from 'zod';

import { resolveAndroidSubmitConfigAsync } from './android';
import {
  ResolvedSubmitConfig,
  appPlatformToPlatform,
  getBuildInfoAsync,
  getSubmitProfileAsync,
  resolveArtifactPathAsync,
} from './common';
import { resolveIosSubmitConfigAsync } from './ios';
import { CustomBuildContext } from '../../../customBuildContext';

export function createResolveSubmitConfigBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'resolve_submit_config',
    name: 'Resolve submit config',
    __metricsId: 'eas/resolve_submit_config',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'build_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'profile',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'config',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'platform',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'app_identifier',
        required: false,
      }),
    ],
    fn: async (stepsCtx, { env, inputs, outputs }) => {
      const buildId = z.string().uuid().parse(inputs.build_id.value);
      const profileName = inputs.profile.value ? z.string().parse(inputs.profile.value) : undefined;
      const artifactPath = inputs.artifact_path.value
        ? path.resolve(stepsCtx.workingDirectory, z.string().parse(inputs.artifact_path.value))
        : undefined;

      const { config, platform, appIdentifier } = await resolveSubmitConfigAsync({
        artifactPath,
        buildId,
        ctx,
        env,
        logger: stepsCtx.logger,
        profileName,
        workingDirectory: stepsCtx.workingDirectory,
      });

      outputs.config.set(JSON.stringify(config));
      outputs.platform.set(platform);
      if (appIdentifier) {
        outputs.app_identifier.set(appIdentifier);
      }
    },
  });
}

export async function resolveSubmitConfigAsync({
  artifactPath,
  buildId,
  ctx,
  env,
  logger,
  profileName,
  workingDirectory,
}: {
  artifactPath?: string;
  buildId: string;
  ctx: CustomBuildContext;
  env: BuildStepEnv;
  logger: bunyan;
  profileName?: string;
  workingDirectory: string;
}): Promise<ResolvedSubmitConfig> {
  logger.info('Resolving submit config...');
  const build = await getBuildInfoAsync(ctx, buildId);
  const platform = appPlatformToPlatform(build.appPlatform);
  const submitProfileName = profileName ?? build.buildProfile ?? undefined;
  const resolvedArtifactPath = await resolveArtifactPathAsync({
    artifactPath,
    build,
    ctx,
    logger,
    platform,
  });

  if (platform === Platform.ANDROID) {
    const profile = await getSubmitProfileAsync({
      env,
      platform,
      profileName: submitProfileName,
      workingDirectory,
    });
    return await resolveAndroidSubmitConfigAsync({
      artifactPath: resolvedArtifactPath,
      build,
      ctx,
      env,
      logger,
      profile,
      workingDirectory,
    });
  }

  const profile = await getSubmitProfileAsync({
    env,
    platform,
    profileName: submitProfileName,
    workingDirectory,
  });
  return await resolveIosSubmitConfigAsync({
    artifactPath: resolvedArtifactPath,
    build,
    ctx,
    env,
    profile,
    workingDirectory,
  });
}
