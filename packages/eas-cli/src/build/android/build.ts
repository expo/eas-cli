import { Workflow } from '@expo/eas-build-job';
import { EasConfig } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import AndroidCredentialsProvider, {
  AndroidCredentials,
} from '../../credentials/android/AndroidCredentialsProvider';
import { createCredentialsContextAsync } from '../../credentials/context';
import Log from '../../log';
import { toggleConfirmAsync } from '../../prompts';
import { CredentialsResult, prepareBuildRequestForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContext } from '../context';
import { ensureCredentialsAsync } from '../credentials';
import { Platform } from '../types';
import { ensureApplicationIdIsValidAsync } from './applicationId';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { prepareJobAsync } from './prepareJob';

export async function prepareAndroidBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig
): Promise<() => Promise<string>> {
  const buildCtx = createBuildContext<Platform.ANDROID>({
    commandCtx,
    platform: Platform.ANDROID,
    easConfig,
  });
  const { buildProfile } = buildCtx;

  if (
    buildProfile.workflow === Workflow.GENERIC &&
    !(await fs.pathExists(path.join(commandCtx.projectDir, 'android')))
  ) {
    throw new Error(
      `"android" directory not found. If you're trying to build a managed project, set ${chalk.bold(
        `builds.android.${commandCtx.profile}.workflow`
      )} in "eas.json" to "managed".`
    );
  }

  if (
    buildProfile.workflow === Workflow.GENERIC &&
    buildProfile.distribution === 'internal' &&
    buildProfile.gradleCommand?.match(/bundle/)
  ) {
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

  await ensureApplicationIdIsValidAsync(commandCtx.projectDir, commandCtx.exp);

  return await prepareBuildRequestForPlatformAsync({
    ctx: buildCtx,
    projectConfiguration: {},
    ensureCredentialsAsync: ensureAndroidCredentialsAsync,
    ensureProjectConfiguredAsync: async () => {
      if (buildCtx.buildProfile.workflow === Workflow.GENERIC) {
        await validateAndSyncProjectConfigurationAsync(commandCtx.projectDir, commandCtx.exp);
      }
    },
    prepareJobAsync,
  });
}

function shouldProvideCredentials(ctx: BuildContext<Platform.ANDROID>): boolean {
  return (
    ctx.buildProfile.workflow === Workflow.MANAGED ||
    (ctx.buildProfile.workflow === Workflow.GENERIC && !ctx.buildProfile.withoutCredentials)
  );
}

async function ensureAndroidCredentialsAsync(
  ctx: BuildContext<Platform.ANDROID>
): Promise<CredentialsResult<AndroidCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  const provider = new AndroidCredentialsProvider(
    await createCredentialsContextAsync(ctx.commandCtx.projectDir, {
      nonInteractive: ctx.commandCtx.nonInteractive,
    }),
    {
      app: {
        projectName: ctx.commandCtx.projectName,
        accountName: ctx.commandCtx.accountName,
      },
      skipCredentialsCheck: ctx.commandCtx.skipCredentialsCheck,
    }
  );
  const credentialsSource = await ensureCredentialsAsync(
    provider,
    ctx.buildProfile.workflow,
    ctx.buildProfile.credentialsSource,
    ctx.commandCtx.nonInteractive
  );
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}
