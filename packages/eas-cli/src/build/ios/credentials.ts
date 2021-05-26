import nullthrows from 'nullthrows';

import { createCredentialsContextAsync } from '../../credentials/context';
import IosCredentialsProvider from '../../credentials/ios/IosCredentialsProvider';
import { resolveEntitlementsJsonAsync } from '../../credentials/ios/appstore/entitlements';
import { IosCredentials, Target } from '../../credentials/ios/types';
import { findAccountByName } from '../../user/Account';
import { CredentialsResult } from '../build';
import { BuildContext } from '../context';
import { Platform } from '../types';
import { logCredentialsSource } from '../utils/credentials';

export async function ensureIosCredentialsAsync(
  buildCtx: BuildContext<Platform.IOS>,
  targets: Target[]
): Promise<CredentialsResult<IosCredentials> | undefined> {
  if (!shouldProvideCredentials(buildCtx)) {
    return;
  }

  const { projectDir } = buildCtx.commandCtx;

  const ctx = await createCredentialsContextAsync(projectDir, {
    nonInteractive: buildCtx.commandCtx.nonInteractive,
  });

  const provider = new IosCredentialsProvider(ctx, {
    app: {
      account: nullthrows(
        findAccountByName(ctx.user.accounts, buildCtx.commandCtx.accountName),
        `You do not have access to account: ${buildCtx.commandCtx.accountName}`
      ),
      projectName: buildCtx.commandCtx.projectName,
    },
    targets,
    iosCapabilitiesOptions: {
      entitlements: await resolveEntitlementsJsonAsync(
        buildCtx.commandCtx.projectDir,
        buildCtx.buildProfile.workflow
      ),
    },
    distribution: buildCtx.buildProfile.distribution ?? 'store',
    enterpriseProvisioning: buildCtx.buildProfile.enterpriseProvisioning,
  });

  const { credentialsSource } = buildCtx.buildProfile;

  logCredentialsSource(credentialsSource, Platform.IOS);
  return {
    credentials: await provider.getCredentialsAsync(credentialsSource),
    source: credentialsSource,
  };
}

function shouldProvideCredentials(buildCtx: BuildContext<Platform.IOS>): boolean {
  return buildCtx.buildProfile.distribution !== 'simulator';
}
