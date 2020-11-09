import { CredentialsSource, Workflow } from '@eas/config';
import assert from 'assert';

import { createCredentialsContextAsync } from '../../credentials/context';
import IosCredentialsProvider, {
  IosCredentials,
} from '../../credentials/ios/IosCredentialsProvider';
import { AppLookupParams } from '../../credentials/ios/credentials';
import { CredentialsResult } from '../build';
import { BuildContext } from '../context';
import { ensureCredentialsAsync } from '../credentials';
import { Platform } from '../types';

export async function ensureIosCredentialsAsync(
  ctx: BuildContext<Platform.iOS>
): Promise<CredentialsResult<IosCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  assert(ctx.commandCtx.exp?.ios?.bundleIdentifier, 'ios.bundleIdentifier is required');
  return await resolveIosCredentialsAsync(
    ctx.commandCtx.projectDir,
    {
      app: {
        accountName: ctx.commandCtx.accountName,
        projectName: ctx.commandCtx.projectName,
        bundleIdentifier: ctx.commandCtx.exp.ios.bundleIdentifier,
      },
      workflow: ctx.buildProfile.workflow,
      credentialsSource: ctx.buildProfile.credentialsSource,
    },
    {
      nonInteractive: ctx.commandCtx.nonInteractive,
    }
  );
}

interface ResolveCredentialsParams {
  app: AppLookupParams;
  workflow: Workflow;
  credentialsSource: CredentialsSource;
}

export async function resolveIosCredentialsAsync(
  projectDir: string,
  params: ResolveCredentialsParams,
  options: { nonInteractive: boolean }
): Promise<CredentialsResult<IosCredentials>> {
  const provider = new IosCredentialsProvider(
    await createCredentialsContextAsync(projectDir, {}),
    params.app,
    { nonInteractive: options.nonInteractive }
  );
  const credentialsSource = await ensureCredentialsAsync(
    provider,
    params.workflow,
    params.credentialsSource,
    options.nonInteractive
  );
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}

function shouldProvideCredentials(ctx: BuildContext<Platform.iOS>): boolean {
  return (
    (ctx.buildProfile.workflow === Workflow.Managed &&
      ctx.buildProfile.buildType !== 'simulator') ||
    ctx.buildProfile.workflow === Workflow.Generic
  );
}
