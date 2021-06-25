import { createCredentialsContextAsync } from '../../credentials/context';
import IosCredentialsProvider from '../../credentials/ios/IosCredentialsProvider';
import { getAppFromContext } from '../../credentials/ios/actions/BuildCredentialsUtils';
import { SetupPushKeyForMultitarget } from '../../credentials/ios/actions/SetupPushKeyForMultitarget';
import { resolveEntitlementsJsonAsync } from '../../credentials/ios/appstore/entitlements';
import { IosCredentials, Target } from '../../credentials/ios/types';
import { CommonIosAppCredentialsFragment } from '../../graphql/generated';
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

export async function setupPushKeyAsync(
  buildCtx: BuildContext<Platform.IOS>,
  targets: Target[]
): Promise<CommonIosAppCredentialsFragment | null> {
  /**
   * Abort push key setup if:
   * - build doesn't require credentials (ie) simulator
   * - build is triggered programmatically: a human should be aware push notifications are being setup
   */
  const shouldAbortSetup =
    !shouldProvideCredentials(buildCtx) || buildCtx.commandCtx.nonInteractive;
  if (shouldAbortSetup) {
    return null;
  }

  const { projectDir } = buildCtx.commandCtx;

  const ctx = await createCredentialsContextAsync(projectDir, {
    nonInteractive: buildCtx.commandCtx.nonInteractive,
  });
  return await new SetupPushKeyForMultitarget().runAsync(ctx, targets);
}

function shouldProvideCredentials(buildCtx: BuildContext<Platform.IOS>): boolean {
  return buildCtx.buildProfile.distribution !== 'simulator';
}
