import { Workflow } from '@expo/eas-build-job';
import { EasConfig } from '@expo/eas-json';
import chalk from 'chalk';

import AndroidCredentialsProvider, {
  AndroidCredentials,
} from '../../credentials/android/AndroidCredentialsProvider';
import { createCredentialsContextAsync } from '../../credentials/context';
import log from '../../log';
import { ensureAppIdentifierIsDefinedAsync } from '../../project/projectUtils';
import { toggleConfirmAsync } from '../../prompts';
import { CredentialsResult, startBuildForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContext } from '../context';
import { ensureCredentialsAsync } from '../credentials';
import { Platform } from '../types';
import { validateAndSyncProjectConfigurationAsync } from './configure';
import { prepareJobAsync } from './prepareJob';

export async function startAndroidBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig
): Promise<string> {
  const buildCtx = createBuildContext<Platform.Android>({
    commandCtx,
    platform: Platform.Android,
    easConfig,
  });

  const { buildProfile } = buildCtx;
  if (
    buildProfile.workflow === Workflow.Generic &&
    buildProfile.distribution === 'internal' &&
    buildProfile.gradleCommand?.match(/bundle/)
  ) {
    log.addNewLineIfNone();
    log.warn(
      `You're building your Android app for internal distribution. However, we've detected that the Gradle command you defined (${chalk.underline(
        buildProfile.gradleCommand
      )}) includes string 'bundle'.
This means that it will most likely produce an AAB and you will not be able to install it on your Android devices straight from the Expo website.`
    );
    log.newLine();
    const confirmed = await toggleConfirmAsync({ message: 'Would you like to proceed?' });
    if (!confirmed) {
      log.error('Please update eas.json and come back again.');
      process.exit(1);
    }
  }

  return await startBuildForPlatformAsync({
    ctx: buildCtx,
    projectConfiguration: {},
    ensureCredentialsAsync: ensureAndroidCredentialsAsync,
    ensureProjectConfiguredAsync: async () => {
      if (buildCtx.buildProfile.workflow === Workflow.Generic) {
        await validateAndSyncProjectConfigurationAsync(commandCtx.projectDir, commandCtx.exp);
      }
      await ensureAppIdentifierIsDefinedAsync(commandCtx.projectDir, Platform.Android);
    },
    prepareJobAsync,
  });
}

function shouldProvideCredentials(ctx: BuildContext<Platform.Android>): boolean {
  return (
    ctx.buildProfile.workflow === Workflow.Managed ||
    (ctx.buildProfile.workflow === Workflow.Generic && !ctx.buildProfile.withoutCredentials)
  );
}

async function ensureAndroidCredentialsAsync(
  ctx: BuildContext<Platform.Android>
): Promise<CredentialsResult<AndroidCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  const provider = new AndroidCredentialsProvider(
    await createCredentialsContextAsync(ctx.commandCtx.projectDir, {
      nonInteractive: ctx.commandCtx.nonInteractive,
    }),
    {
      projectName: ctx.commandCtx.projectName,
      accountName: ctx.commandCtx.accountName,
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
