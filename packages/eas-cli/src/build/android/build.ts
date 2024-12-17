import { Android, Metadata, Platform, Workflow } from '@expo/eas-build-job';
import { AppVersionSource } from '@expo/eas-json';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { transformJob } from './graphql';
import { prepareJobAsync } from './prepareJob';
import { syncProjectConfigurationAsync } from './syncProjectConfiguration';
import { resolveRemoteVersionCodeAsync } from './version';
import AndroidCredentialsProvider, {
  AndroidCredentials,
} from '../../credentials/android/AndroidCredentialsProvider';
import { BuildParamsInput } from '../../graphql/generated';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import Log from '../../log';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationIdAsync,
} from '../../project/android/applicationId';
import { resolveGradleBuildContextAsync } from '../../project/android/gradle';
import { toggleConfirmAsync } from '../../prompts';
import {
  BuildRequestSender,
  CredentialsResult,
  JobData,
  prepareBuildRequestForPlatformAsync,
} from '../build';
import { AndroidBuildContext, BuildContext, CommonContext } from '../context';
import { transformMetadata } from '../graphql';
import { logCredentialsSource } from '../utils/credentials';
import {
  checkGoogleServicesFileAsync,
  checkNodeEnvVariable,
  validatePNGsForManagedProjectAsync,
} from '../validate';

export async function createAndroidContextAsync(
  ctx: CommonContext<Platform.ANDROID>
): Promise<AndroidBuildContext> {
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
      Log.error('Update eas.json and come back again.');
      process.exit(1);
    }
  }

  checkNodeEnvVariable(ctx);
  await checkGoogleServicesFileAsync(ctx);
  await validatePNGsForManagedProjectAsync(ctx);

  const gradleContext = await resolveGradleBuildContextAsync(
    ctx.projectDir,
    buildProfile,
    ctx.vcsClient
  );

  if (ctx.workflow === Workflow.MANAGED) {
    await ensureApplicationIdIsDefinedForManagedProjectAsync(ctx);
  }

  const applicationId = await getApplicationIdAsync(
    ctx.projectDir,
    ctx.exp,
    ctx.vcsClient,
    gradleContext
  );
  const versionCodeOverride =
    ctx.easJsonCliConfig?.appVersionSource === AppVersionSource.REMOTE
      ? await resolveRemoteVersionCodeAsync(ctx.graphqlClient, {
          projectDir: ctx.projectDir,
          projectId: ctx.projectId,
          exp: ctx.exp,
          applicationId,
          buildProfile,
          vcsClient: ctx.vcsClient,
        })
      : undefined;

  return { applicationId, gradleContext, versionCodeOverride };
}

export async function prepareAndroidBuildAsync(
  ctx: BuildContext<Platform.ANDROID>
): Promise<BuildRequestSender> {
  return await prepareBuildRequestForPlatformAsync({
    ctx,
    ensureCredentialsAsync: async (ctx: BuildContext<Platform.ANDROID>) => {
      return await ensureAndroidCredentialsAsync(ctx);
    },
    syncProjectConfigurationAsync: async () => {
      await syncProjectConfigurationAsync({
        projectDir: ctx.projectDir,
        exp: ctx.exp,
        localAutoIncrement:
          ctx.easJsonCliConfig?.appVersionSource === AppVersionSource.REMOTE
            ? false
            : ctx.buildProfile.autoIncrement,
        vcsClient: ctx.vcsClient,
        env: ctx.env,
      });
    },
    prepareJobAsync: async (
      ctx: BuildContext<Platform.ANDROID>,
      jobData: JobData<AndroidCredentials>
    ): Promise<Android.Job> => {
      return await prepareJobAsync(ctx, jobData);
    },
    sendBuildRequestAsync: async (
      appId: string,
      job: Android.Job,
      metadata: Metadata,
      buildParams: BuildParamsInput
    ): Promise<BuildResult> => {
      const graphqlMetadata = transformMetadata(metadata);
      const graphqlJob = transformJob(job);
      return await BuildMutation.createAndroidBuildAsync(ctx.graphqlClient, {
        appId,
        job: graphqlJob,
        metadata: graphqlMetadata,
        buildParams,
      });
    },
  });
}

function shouldProvideCredentials(ctx: BuildContext<Platform.ANDROID>): boolean {
  return !ctx.buildProfile.withoutCredentials;
}

async function ensureAndroidCredentialsAsync(
  ctx: BuildContext<Platform.ANDROID>
): Promise<CredentialsResult<AndroidCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  const androidApplicationIdentifier = await getApplicationIdAsync(
    ctx.projectDir,
    ctx.exp,
    ctx.vcsClient,
    ctx.android.gradleContext
  );
  const provider = new AndroidCredentialsProvider(ctx.credentialsCtx, {
    name: ctx.buildProfile.keystoreName,
    app: {
      account: nullthrows(
        ctx.user.accounts.find(a => a.name === ctx.accountName),
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
