import { Workflow } from '@expo/eas-build-job';
import { CredentialsSource, IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import { createCredentialsContextAsync } from '../../credentials/context';
import IosCredentialsProvider, {
  IosCredentials,
} from '../../credentials/ios/IosCredentialsProvider';
import { getAppLookupParamsFromContext } from '../../credentials/ios/actions/BuildCredentialsUtils';
import { AppLookupParams } from '../../credentials/ios/credentials';
import { CredentialsResult } from '../build';
import { BuildContext } from '../context';
import { Platform } from '../types';
import { logCredentialsSource } from '../utils/credentials';
import { getBundleIdentifier } from './bundleIdentifier';

export async function ensureIosCredentialsAsync(
  ctx: BuildContext<Platform.IOS>
): Promise<CredentialsResult<IosCredentials> | undefined> {
  if (!shouldProvideCredentials(ctx)) {
    return;
  }
  const bundleIdentifier = getBundleIdentifier({
    projectDir: ctx.commandCtx.projectDir,
    exp: ctx.commandCtx.exp,
    workflow: ctx.buildProfile.workflow,
  });
  return await resolveIosCredentialsAsync(ctx.commandCtx.projectDir, {
    app: {
      accountName: ctx.commandCtx.accountName,
      projectName: ctx.commandCtx.projectName,
      bundleIdentifier,
    },
    workflow: ctx.buildProfile.workflow,
    credentialsSource: ctx.buildProfile.credentialsSource,
    distribution: ctx.buildProfile.distribution ?? 'store',
    enterpriseProvisioning: ctx.buildProfile.enterpriseProvisioning,
    nonInteractive: ctx.commandCtx.nonInteractive,
    skipCredentialsCheck: ctx.commandCtx.skipCredentialsCheck,
  });
}

interface ResolveCredentialsParams {
  app: AppLookupParams;
  workflow: Workflow;
  credentialsSource: CredentialsSource;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
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
    enterpriseProvisioning: params.enterpriseProvisioning,
    skipCredentialsCheck: params.skipCredentialsCheck,
  });
  const { credentialsSource } = params;
  logCredentialsSource(credentialsSource, Platform.IOS);
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}

function shouldProvideCredentials(ctx: BuildContext<Platform.IOS>): boolean {
  return ctx.buildProfile.distribution !== 'simulator';
}
