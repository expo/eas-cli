import { Android, Metadata, Workflow } from '@expo/eas-build-job';
import { EasConfig } from '@expo/eas-json';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import AndroidCredentialsProvider, {
  AndroidCredentials,
} from '../../credentials/android/AndroidCredentialsProvider';
import { createCredentialsContextAsync } from '../../credentials/context';
import { BuildMutation, BuildResult } from '../../graphql/mutations/BuildMutation';
import Log from '../../log';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationIdAsync,
} from '../../project/android/applicationId';
import { toggleConfirmAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { CredentialsResult, prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContextAsync } from '../context';
import { transformMetadata } from '../graphql';
import { Platform } from '../types';
import { logCredentialsSource } from '../utils/credentials';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { transformJob } from './graphql';
import { prepareJobAsync } from './prepareJob';

export async function prepareAndroidBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig
): Promise<() => Promise<string | undefined>> {
  const buildCtx = await createBuildContextAsync<Platform.ANDROID>({
    commandCtx,
    platform: Platform.ANDROID,
    easConfig,
  });
  const { buildProfile } = buildCtx;

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

  if (buildCtx.workflow === Workflow.MANAGED) {
    await ensureApplicationIdIsDefinedForManagedProjectAsync(commandCtx.projectDir, commandCtx.exp);
  }

  return await prepareBuildRequestForPlatformAsync({
    ctx: buildCtx,
    ensureCredentialsAsync: ensureAndroidCredentialsAsync,
    ensureProjectConfiguredAsync: async () => {
      if (buildCtx.workflow === Workflow.GENERIC) {
        await validateAndSyncProjectConfigurationAsync(commandCtx.projectDir, commandCtx.exp);
      }
    },
    prepareJobAsync,
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
  ctx: BuildContext<Platform.ANDROID>
): Promise<CredentialsResult<AndroidCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  const androidApplicationIdentifier = await getApplicationIdAsync(
    ctx.commandCtx.projectDir,
    ctx.commandCtx.exp
  );
  const provider = new AndroidCredentialsProvider(
    await createCredentialsContextAsync(ctx.commandCtx.projectDir, {
      nonInteractive: ctx.commandCtx.nonInteractive,
    }),
    {
      app: {
        account: nullthrows(
          findAccountByName(ctx.commandCtx.user.accounts, ctx.commandCtx.accountName),
          `You do not have access to account: ${ctx.commandCtx.accountName}`
        ),
        projectName: ctx.commandCtx.projectName,
        androidApplicationIdentifier,
      },
    }
  );
  const { credentialsSource } = ctx.buildProfile;
  logCredentialsSource(credentialsSource, Platform.ANDROID);
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}
