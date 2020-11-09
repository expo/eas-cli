import { EasConfig, Workflow } from '@eas/config';

import AndroidCredentialsProvider, {
  AndroidCredentials,
} from '../../credentials/android/AndroidCredentialsProvider';
import { createCredentialsContextAsync } from '../../credentials/context';
import { CredentialsResult, startBuildForPlatformAsync } from '../build';
import { BuildContext, CommandContext, createBuildContext } from '../context';
import { ensureCredentialsAsync } from '../credentials';
import { Platform } from '../types';
import { prepareJobAsync } from './prepareJob';

export async function startAndroidBuildAsync(
  commandCtx: CommandContext,
  easConfig: EasConfig,
  projectId: string
): Promise<string> {
  const buildCtx = createBuildContext<Platform.Android>({
    commandCtx,
    platform: Platform.Android,
    easConfig,
    projectId,
  });

  return await startBuildForPlatformAsync({
    ctx: buildCtx,
    projectConfiguration: {},
    ensureCredentialsAsync: ensureAndroidCredentialsAsync,
    ensureProjectConfiguredAsync: async () => {},
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
    await createCredentialsContextAsync(ctx.commandCtx.projectDir, {}),
    {
      projectName: ctx.commandCtx.projectName,
      accountName: ctx.commandCtx.accountName,
    },
    { nonInteractive: ctx.commandCtx.nonInteractive }
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
