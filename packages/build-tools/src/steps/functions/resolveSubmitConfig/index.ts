import { Platform, SystemError } from '@expo/eas-build-job';
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
import { ResolvedSubmitConfig, getBuildInfoAsync, getSubmitProfileAsync } from './common';
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
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'config_json',
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
      const profileName = z.string().parse(inputs.profile.value);
      const artifactPath = path.resolve(
        stepsCtx.workingDirectory,
        z.string().parse(inputs.artifact_path.value)
      );

      const { config, platform, appIdentifier } = await resolveSubmitConfigAsync({
        artifactPath,
        buildId,
        ctx,
        env,
        logger: stepsCtx.logger,
        profileName,
        workingDirectory: stepsCtx.workingDirectory,
      });

      outputs.config_json.set(JSON.stringify(config));
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
  artifactPath: string;
  buildId: string;
  ctx: CustomBuildContext;
  env: BuildStepEnv;
  logger: bunyan;
  profileName: string;
  workingDirectory: string;
}): Promise<ResolvedSubmitConfig> {
  logger.info('Resolving submit config...');
  const build = await getBuildInfoAsync(ctx, buildId);

  switch (build.platform) {
    case Platform.ANDROID: {
      const profile = await getSubmitProfileAsync({
        platform: build.platform,
        profileName,
        workingDirectory,
      });
      return await resolveAndroidSubmitConfigAsync({
        artifactPath,
        build,
        ctx,
        env,
        logger,
        profile,
        workingDirectory,
      });
    }
    case Platform.IOS: {
      const profile = await getSubmitProfileAsync({
        platform: build.platform,
        profileName,
        workingDirectory,
      });
      return await resolveIosSubmitConfigAsync({
        artifactPath,
        appId: build.appId,
        buildAppIdentifier: build.appIdentifier,
        ctx,
        env,
        profile,
        projectOwnerAccountId: build.projectOwnerAccountId,
        workingDirectory,
      });
    }
    default:
      throw new SystemError(`Unsupported platform: ${build.platform}`);
  }
}
