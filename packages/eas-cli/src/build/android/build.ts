import { Android, Job, Metadata, Platform, Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import AndroidCredentialsProvider, {
  AndroidCredentials,
} from '../../credentials/android/AndroidCredentialsProvider';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import Log from '../../log';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationIdAsync,
} from '../../project/android/applicationId';
import { GradleBuildContext, resolveGradleBuildContextAsync } from '../../project/android/gradle';
import { toggleConfirmAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import {
  BuildRequestSender,
  CredentialsResult,
  JobData,
  prepareBuildRequestForPlatformAsync,
} from '../build';
import { BuildContext } from '../context';
import { transformMetadata } from '../graphql';
import { logCredentialsSource } from '../utils/credentials';
import { checkGoogleServicesFileAsync, checkNodeEnvVariable } from '../validate';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { transformJob } from './graphql';
import { prepareJobAsync } from './prepareJob';

export async function prepareAndroidBuildAsync(
  ctx: BuildContext<Platform.ANDROID>
): Promise<BuildRequestSender> {
  const { buildProfile } = ctx;

  if (buildProfile.distribution === 'internal' && buildProfile.gradleCommand?.match(/bundle/)) {
    Log.addNewLineIfNone();
    Log.warn(
      `You're building your Android app for internal distribution. However, we've detected that the Gradle command you defined (${chalk.underline(
        buildProfile.gradleCommand
      )}) includes string 'bundle'.
This means that it will most likely produce an AAB and you will not be able to install it on your Android devices straight from the Expo website.`
    );
    Log.newLine();
    const confirmed = await toggleConfirmAsync({ message: 'Would you like to proceed?' });
    if (!confirmed) {
      Log.error('Please update eas.json and come back again.');
      process.exit(1);
    }
  }

  checkNodeEnvVariable(ctx);
  await checkGoogleServicesFileAsync(ctx);

  const gradleContext = await resolveGradleBuildContextAsync(ctx.projectDir, buildProfile);

  if (ctx.workflow === Workflow.MANAGED) {
    await ensureApplicationIdIsDefinedForManagedProjectAsync(ctx.projectDir, ctx.exp);
  }

  return await prepareBuildRequestForPlatformAsync({
    ctx,
    ensureCredentialsAsync: async (ctx: BuildContext<Platform.ANDROID>) => {
      return await ensureAndroidCredentialsAsync(ctx, gradleContext);
    },
    ensureProjectConfiguredAsync: async () => {
      if (ctx.workflow === Workflow.GENERIC) {
        await validateAndSyncProjectConfigurationAsync(ctx.projectDir, ctx.exp);
      }
    },
    getMetadataContext: () => ({
      gradleContext,
    }),
    prepareJobAsync: async (
      ctx: BuildContext<Platform.ANDROID>,
      jobData: JobData<AndroidCredentials>
    ): Promise<Job> => {
      return await prepareJobAsync(ctx, jobData);
    },
    sendBuildRequestAsync: async (
      appId: string,
      job: Android.Job,
      metadata: Metadata
    ): Promise<BuildResult> => {
      const graphqlMetadata = transformMetadata(metadata);
      const graphqlJob = transformJob(job);
      return await BuildMutation.createAndroidBuildAsync({
        appId,
        job: graphqlJob,
        metadata: graphqlMetadata,
      });
    },
  });
}

function shouldProvideCredentials(ctx: BuildContext<Platform.ANDROID>): boolean {
  return !ctx.buildProfile.withoutCredentials;
}

async function ensureAndroidCredentialsAsync(
  ctx: BuildContext<Platform.ANDROID>,
  gradleContext?: GradleBuildContext
): Promise<CredentialsResult<AndroidCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  const androidApplicationIdentifier = await getApplicationIdAsync(
    ctx.projectDir,
    ctx.exp,
    gradleContext
  );
  const provider = new AndroidCredentialsProvider(ctx.credentialsCtx, {
    app: {
      account: nullthrows(
        findAccountByName(ctx.user.accounts, ctx.accountName),
        `You do not have access to account: ${ctx.accountName}`
      ),
      projectName: ctx.projectName,
      androidApplicationIdentifier,
    },
  });
  const { credentialsSource } = ctx.buildProfile;
  logCredentialsSource(credentialsSource, Platform.ANDROID);
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}
