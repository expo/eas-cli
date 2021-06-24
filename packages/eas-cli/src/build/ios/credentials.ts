import { CredentialsSource } from '@expo/eas-json';

import { createCredentialsContextAsync } from '../../credentials/context';
import IosCredentialsProvider from '../../credentials/ios/IosCredentialsProvider';
import { getAppFromContext } from '../../credentials/ios/actions/BuildCredentialsUtils';
import { SetupPushKey } from '../../credentials/ios/actions/SetupPushKey';
import { resolveEntitlementsJsonAsync } from '../../credentials/ios/appstore/entitlements';
import { IosCredentials, Target } from '../../credentials/ios/types';
import { CommonIosAppCredentialsFragment } from '../../graphql/generated';
import Log from '../../log';
import { findApplicationTarget } from '../../project/ios/target';
import { confirmAsync } from '../../prompts';
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
   * - user has specified credentials should only be retrieved from credentials.json: they can manually upload to www later
   */
  const { credentialsSource } = buildCtx.buildProfile;
  const shouldAbortSetup =
    !shouldProvideCredentials(buildCtx) ||
    buildCtx.commandCtx.nonInteractive ||
    credentialsSource === CredentialsSource.LOCAL;
  if (shouldAbortSetup) {
    return null;
  }

  const { projectDir } = buildCtx.commandCtx;

  const ctx = await createCredentialsContextAsync(projectDir, {
    nonInteractive: buildCtx.commandCtx.nonInteractive,
  });

  const applicationTarget = findApplicationTarget(targets);
  const app = getAppFromContext(ctx);
  const appLookupParams = {
    ...app,
    bundleIdentifier: applicationTarget.bundleIdentifier,
    parentBundleIdentifier: applicationTarget.parentBundleIdentifier,
  };

  const setupPushKeyAction = await new SetupPushKey(appLookupParams);
  const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(ctx);
  if (isPushKeySetup) {
    Log.succeed(
      `Push Notifications setup for ${app.projectName}:${applicationTarget.bundleIdentifier}`
    );
    return null;
  }

  const confirmSetup = await confirmAsync({
    message: `Would you like to setup Push Notifications for your project?`,
  });
  if (!confirmSetup) {
    return null;
  }
  return await new SetupPushKey(appLookupParams).runAsync(ctx);
}

function shouldProvideCredentials(buildCtx: BuildContext<Platform.IOS>): boolean {
  return buildCtx.buildProfile.distribution !== 'simulator';
}
