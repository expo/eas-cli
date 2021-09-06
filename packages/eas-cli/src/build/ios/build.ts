import { IOSConfig } from '@expo/config-plugins';
import { Ios, Job, Metadata, Platform, Workflow } from '@expo/eas-build-job';

import { IosCredentials } from '../../credentials/ios/types';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import { ensureBundleIdentifierIsDefinedForManagedProjectAsync } from '../../project/ios/bundleIdentifier';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { findApplicationTarget, resolveTargetsAsync } from '../../project/ios/target';
import { BuildRequestSender, JobData, prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext } from '../context';
import { transformMetadata } from '../graphql';
import { IosMetadataContext } from '../metadata';
import { checkGoogleServicesFileAsync, checkNodeEnvVariable } from '../validate';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { ensureIosCredentialsAsync } from './credentials';
import { transformJob } from './graphql';
import { prepareJobAsync } from './prepareJob';

export async function prepareIosBuildAsync(
  ctx: BuildContext<Platform.IOS>
): Promise<BuildRequestSender> {
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
  const targets = await resolveTargetsAsync(
    {
      projectDir: ctx.projectDir,
      exp: ctx.exp,
    },
    xcodeBuildContext
  );

  return await prepareBuildRequestForPlatformAsync({
    ctx,
    ensureCredentialsAsync: async (ctx: BuildContext<Platform.IOS>) => {
      return ensureIosCredentialsAsync(ctx, targets);
    },
    ensureProjectConfiguredAsync: async () => {
      await validateAndSyncProjectConfigurationAsync({
        projectDir: ctx.projectDir,
        exp: ctx.exp,
        buildProfile,
      });
    },
    getMetadataContext: (): IosMetadataContext => {
      if (ctx.workflow === Workflow.MANAGED) {
        return { buildSettings: {} };
      }
      const applicationTarget = findApplicationTarget(targets);
      const project = IOSConfig.XcodeUtils.getPbxproj(ctx.projectDir);
      const xcBuildConfiguration = IOSConfig.Target.getXCBuildConfigurationFromPbxproj(project, {
        targetName: applicationTarget.targetName,
        buildConfiguration: applicationTarget.buildConfiguration,
      });
      const buildSettings = xcBuildConfiguration?.buildSettings ?? {};
      return { buildSettings };
    },
    prepareJobAsync: async (
      ctx: BuildContext<Platform.IOS>,
      jobData: JobData<IosCredentials>
    ): Promise<Job> => {
      return await prepareJobAsync(ctx, { ...jobData, buildScheme: xcodeBuildContext.buildScheme });
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
