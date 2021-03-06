import { Ios, Job, Metadata, Workflow } from '@expo/eas-build-job';
import { EasConfig } from '@expo/eas-json';

import { IosCredentials } from '../../credentials/ios/types';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import { ensureBundleIdentifierIsDefinedForManagedProjectAsync } from '../../project/ios/bundleIdentifier';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { resolveTargetsAsync } from '../../project/ios/target';
import { JobData, prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContextAsync } from '../context';
import { transformMetadata } from '../graphql';
import { Platform } from '../types';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { ensureIosCredentialsAsync } from './credentials';
import { transformJob } from './graphql';
import { prepareJobAsync } from './prepareJob';

export async function prepareIosBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig
): Promise<() => Promise<string | undefined>> {
  const buildCtx = await createBuildContextAsync<Platform.IOS>({
    commandCtx,
    platform: Platform.IOS,
    easConfig,
  });
  const { buildProfile } = buildCtx;

  if (buildCtx.workflow === Workflow.MANAGED) {
    await ensureBundleIdentifierIsDefinedForManagedProjectAsync(
      commandCtx.projectDir,
      commandCtx.exp
    );
  }

  const xcodeBuildContext = await resolveXcodeBuildContextAsync(
    {
      projectDir: commandCtx.projectDir,
      nonInteractive: commandCtx.nonInteractive,
      exp: commandCtx.exp,
    },
    buildProfile
  );
  const targets = await resolveTargetsAsync(
    {
      projectDir: commandCtx.projectDir,
      exp: commandCtx.exp,
    },
    xcodeBuildContext
  );

  return await prepareBuildRequestForPlatformAsync({
    ctx: buildCtx,
    ensureCredentialsAsync: async (ctx: BuildContext<Platform.IOS>) => {
      return ensureIosCredentialsAsync(ctx, targets);
    },
    ensureProjectConfiguredAsync: async () => {
      await validateAndSyncProjectConfigurationAsync({
        projectDir: commandCtx.projectDir,
        exp: commandCtx.exp,
        buildProfile,
      });
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
