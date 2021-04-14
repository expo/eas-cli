import { Workflow } from '@expo/eas-build-job';
import { CredentialsSource, iOSDistributionType } from '@expo/eas-json';
import assert from 'assert';

import { createCredentialsContextAsync } from '../../credentials/context';
import IosCredentialsProvider, {
  IosCredentials,
} from '../../credentials/ios/IosCredentialsProvider';
import { getAppLookupParamsFromContext } from '../../credentials/ios/actions/new/BuildCredentialsUtils';

import { AppLookupParams } from '../../credentials/ios/credentials';
import { CredentialsResult } from '../build';
import { BuildContext } from '../context';
import { ensureCredentialsAsync } from '../credentials';
import { Platform } from '../types';

export async function ensureIosCredentialsAsync(
  ctx: BuildContext<Platform.IOS>
): Promise<CredentialsResult<IosCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  assert(ctx.commandCtx.exp?.ios?.bundleIdentifier, 'ios.bundleIdentifier is required');
  return await resolveIosCredentialsAsync(ctx.commandCtx.projectDir, {
    app: {
      accountName: ctx.commandCtx.accountName,
      projectName: ctx.commandCtx.projectName,
      bundleIdentifier: ctx.commandCtx.exp.ios.bundleIdentifier,
    },
    workflow: ctx.buildProfile.workflow,
    credentialsSource: ctx.buildProfile.credentialsSource,
    distribution: ctx.buildProfile.distribution ?? 'store',
    nonInteractive: ctx.commandCtx.nonInteractive,
    skipCredentialsCheck: ctx.commandCtx.skipCredentialsCheck,
  });
}

interface ResolveCredentialsParams {
  app: AppLookupParams;
  workflow: Workflow;
  credentialsSource: CredentialsSource;
  distribution: iOSDistributionType;
  nonInteractive: boolean;
  skipCredentialsCheck: boolean;
}

export async function resolveIosCredentialsAsync(
  projectDir: string,
  params: ResolveCredentialsParams
): Promise<CredentialsResult<IosCredentials>> {
  const ctx = await createCredentialsContextAsync(projectDir, {
    nonInteractive: params.nonInteractive,
  });
  const app = getAppLookupParamsFromContext(ctx);
  const provider = new IosCredentialsProvider(ctx, {
    app,
    distribution: params.distribution,
    skipCredentialsCheck: params.skipCredentialsCheck,
  });
  const credentialsSource = await ensureCredentialsAsync(
    provider,
    params.workflow,
    params.credentialsSource,
    params.nonInteractive
  );
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}

function shouldProvideCredentials(ctx: BuildContext<Platform.IOS>): boolean {
  return ctx.buildProfile.distribution !== 'simulator';
}
