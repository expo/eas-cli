import ConfigPlugins from '@expo/config-plugins';
import { Ios, Job, Metadata, Platform, Workflow } from '@expo/eas-build-job';
import type { XCBuildConfiguration } from 'xcode';

import { IosCredentials, Target } from '../../credentials/ios/types.js';
import { BuildParamsInput } from '../../graphql/generated.js';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation.js';
import { ensureBundleIdentifierIsDefinedForManagedProjectAsync } from '../../project/ios/bundleIdentifier.js';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme.js';
import { findApplicationTarget, resolveTargetsAsync } from '../../project/ios/target.js';
import { BuildRequestSender, JobData, prepareBuildRequestForPlatformAsync } from '../build.js';
import { BuildContext, CommonContext, IosBuildContext } from '../context.js';
import { transformMetadata } from '../graphql.js';
import { checkGoogleServicesFileAsync, checkNodeEnvVariable } from '../validate.js';
import { ensureIosCredentialsAsync } from './credentials.js';
import { transformJob } from './graphql.js';
import { prepareJobAsync } from './prepareJob.js';
import { syncProjectConfigurationAsync } from './syncProjectConfiguration.js';

const { IOSConfig } = ConfigPlugins;

export async function createIosContextAsync(
  ctx: CommonContext<Platform.IOS>
): Promise<IosBuildContext> {
  const { buildProfile } = ctx;

  if (ctx.workflow === Workflow.MANAGED) {
    await ensureBundleIdentifierIsDefinedForManagedProjectAsync(ctx.projectDir, ctx.exp);
  }

  checkNodeEnvVariable(ctx);
  await checkGoogleServicesFileAsync(ctx);

  const xcodeBuildContext = await resolveXcodeBuildContextAsync(
    {
      projectDir: ctx.projectDir,
      nonInteractive: ctx.nonInteractive,
      exp: ctx.exp,
    },
    buildProfile
  );
  const targets = await resolveTargetsAsync({
    projectDir: ctx.projectDir,
    exp: ctx.exp,
    xcodeBuildContext,
    env: buildProfile.env,
  });
  const applicationTarget = findApplicationTarget(targets);
  const applicationTargetBuildSettings = resolveBuildSettings(ctx, applicationTarget);

  return {
    bundleIdentifier: applicationTarget.bundleIdentifier,
    applicationTarget,
    applicationTargetBuildSettings,
    targets,
    xcodeBuildContext,
  };
}

export async function prepareIosBuildAsync(
  ctx: BuildContext<Platform.IOS>
): Promise<BuildRequestSender> {
  return await prepareBuildRequestForPlatformAsync({
    ctx,
    ensureCredentialsAsync: async (ctx: BuildContext<Platform.IOS>) => {
      return ensureIosCredentialsAsync(ctx, ctx.ios.targets);
    },
    syncProjectConfigurationAsync: async () => {
      await syncProjectConfigurationAsync({
        projectDir: ctx.projectDir,
        exp: ctx.exp,
        buildProfile: ctx.buildProfile,
        buildSettings: ctx.ios.applicationTargetBuildSettings,
      });
    },
    prepareJobAsync: async (
      ctx: BuildContext<Platform.IOS>,
      jobData: JobData<IosCredentials>
    ): Promise<Job> => {
      return await prepareJobAsync(ctx, {
        ...jobData,
        buildScheme: ctx.ios.xcodeBuildContext.buildScheme,
      });
    },
    sendBuildRequestAsync: async (
      appId: string,
      job: Ios.Job,
      metadata: Metadata,
      buildParams: BuildParamsInput
    ): Promise<BuildResult> => {
      const graphqlMetadata = transformMetadata(metadata);
      const graphqlJob = transformJob(job);
      return await BuildMutation.createIosBuildAsync({
        appId,
        job: graphqlJob,
        metadata: graphqlMetadata,
        buildParams,
      });
    },
  });
}

function resolveBuildSettings(
  ctx: CommonContext<Platform.IOS>,
  applicationTarget: Target
): XCBuildConfiguration['buildSettings'] {
  if (ctx.workflow === Workflow.MANAGED) {
    return {};
  }
  const project = IOSConfig.XcodeUtils.getPbxproj(ctx.projectDir);
  const xcBuildConfiguration = IOSConfig.Target.getXCBuildConfigurationFromPbxproj(project, {
    targetName: applicationTarget.targetName,
    buildConfiguration: applicationTarget.buildConfiguration,
  });
  return xcBuildConfiguration?.buildSettings ?? {};
}
