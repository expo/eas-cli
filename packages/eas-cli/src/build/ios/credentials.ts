import { createCredentialsContextAsync } from '../../credentials/context';
import IosCredentialsProvider from '../../credentials/ios/IosCredentialsProvider';
import { getAppFromContext } from '../../credentials/ios/actions/BuildCredentialsUtils';
import { resolveEntitlementsJsonAsync } from '../../credentials/ios/appstore/entitlements';
import { IosCredentials, Target } from '../../credentials/ios/types';
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
    app: getAppFromContext(ctx),
    targets,
    iosCapabilitiesOptions: {
      entitlements: await resolveEntitlementsJsonAsync(
        buildCtx.commandCtx.projectDir,
        buildCtx.workflow
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
