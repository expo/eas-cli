import { IOSConfig } from '@expo/config-plugins';
import { Ios, Job, Metadata, Platform, Workflow } from '@expo/eas-build-job';
import type { XCBuildConfiguration } from 'xcode';

import { IosCredentials, Target } from '../../credentials/ios/types';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import { ensureBundleIdentifierIsDefinedForManagedProjectAsync } from '../../project/ios/bundleIdentifier';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { findApplicationTarget, resolveTargetsAsync } from '../../project/ios/target';
import { BuildRequestSender, JobData, prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext, CommonContext, IosBuildContext } from '../context';
import { transformMetadata } from '../graphql';
import { checkGoogleServicesFileAsync, checkNodeEnvVariable } from '../validate';
import { ensureIosCredentialsAsync } from './credentials';
import { transformJob } from './graphql';
import { prepareJobAsync } from './prepareJob';
import { syncProjectConfigurationAsync } from './syncProjectConfiguration';

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
    env: buildProfile.env ?? {},
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
      metadata: Metadata
    ): Promise<BuildResult> => {
      const graphqlMetadata = transformMetadata(metadata);
      const graphqlJob = transformJob(job);
      return await BuildMutation.createIosBuildAsync({
        appId,
        job: graphqlJob,
        metadata: graphqlMetadata,
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
