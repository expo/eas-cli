import { Ios, Job, Metadata, Workflow } from '@expo/eas-build-job';
import { EasConfig } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { SetupPushKey } from '../../credentials/ios/actions/SetupPushKey';
import { IosCredentials } from '../../credentials/ios/types';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import { ensureBundleIdentifierIsDefinedForManagedProjectAsync } from '../../project/ios/bundleIdentifier';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { resolveTargetsAsync } from '../../project/ios/target';
import { JobData, prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContext } from '../context';
import { transformMetadata } from '../graphql';
import { Platform } from '../types';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { ensureIosCredentialsAsync, setupPushKeyAsync } from './credentials';
import { transformGenericJob, transformManagedJob } from './graphql';
import { prepareJobAsync } from './prepareJob';

export async function prepareIosBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig
): Promise<() => Promise<string | undefined>> {
  const buildCtx = createBuildContext<Platform.IOS>({
    commandCtx,
    platform: Platform.IOS,
    easConfig,
  });
  const { buildProfile } = buildCtx;

  if (
    buildProfile.workflow === Workflow.GENERIC &&
    !(await fs.pathExists(path.join(commandCtx.projectDir, 'ios')))
  ) {
    throw new Error(
      `"ios" directory not found. If you're trying to build a managed project, set ${chalk.bold(
        `builds.ios.${commandCtx.profile}.workflow`
      )} in "eas.json" to "managed".`
    );
  }

  if (buildProfile.workflow === Workflow.MANAGED) {
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
      await setupPushKeyAsync(ctx, targets);
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
      if (job.type === Workflow.GENERIC) {
        const graphqlJob = transformGenericJob(job);
        return await BuildMutation.createIosGenericBuildAsync({
          appId,
          job: graphqlJob,
          metadata: graphqlMetadata,
        });
      } else {
        const graphqlJob = transformManagedJob(job);
        return await BuildMutation.createIosManagedBuildAsync({
          appId,
          job: graphqlJob,
          metadata: graphqlMetadata,
        });
      }
    },
  });
}
