import { Ios, Job, Metadata, Platform, Workflow } from '@expo/eas-build-job';
import { AppVersionSource } from '@expo/eas-json';

import { IosCredentials } from '../../credentials/ios/types';
import { BuildParamsInput } from '../../graphql/generated';
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
import { resolveRemoteBuildNumberAsync } from './version';

export async function createIosContextAsync(
  ctx: CommonContext<Platform.IOS>
): Promise<IosBuildContext> {
  const { buildProfile } = ctx;

  if (ctx.workflow === Workflow.MANAGED) {
    await ensureBundleIdentifierIsDefinedForManagedProjectAsync(ctx.projectDir, ctx.exp, ctx.user);
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
  const buildNumberOverride =
    ctx.easJsonCliConfig?.appVersionSource === AppVersionSource.REMOTE
      ? await resolveRemoteBuildNumberAsync({
          projectDir: ctx.projectDir,
          projectId: ctx.projectId,
          exp: ctx.exp,
          applicationTarget,
          buildProfile,
        })
      : undefined;
  return {
    bundleIdentifier: applicationTarget.bundleIdentifier,
    applicationTarget,
    targets,
    xcodeBuildContext,
    buildNumberOverride,
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
        targets: ctx.ios.targets,
        localAutoIncrement:
          ctx.easJsonCliConfig?.appVersionSource === AppVersionSource.REMOTE
            ? false
            : ctx.buildProfile.autoIncrement,
        nonInteractive: ctx.nonInteractive,
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
