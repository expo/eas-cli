import { App } from '@expo/apple-utils';
import { Platform } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { AppleTeamType } from '../../credentials/ios/appstore/authenticateTypes';
import { getRequestContext } from '../../credentials/ios/appstore/authenticate';
import { ensureTestFlightGroupExistsAsync } from '../../credentials/ios/appstore/ensureTestFlightGroup';
import { resolveAppleTeamTypeFromEnvironment } from '../../credentials/ios/appstore/resolveCredentials';
import { tryAuthenticateAppStoreWithEasAscApiKeyAsync } from '../../credentials/ios/actions/AscApiKeyUtils';
import Log from '../../log';
import { getBundleIdentifierAsync } from '../../project/ios/bundleIdentifier';
import { SubmissionContext } from '../context';

/**
 * Best-effort TestFlight internal group setup for an App Store Connect app
 * that already exists (`ascAppId` provided in the submit profile). Without
 * this, the automatic group creation only ever runs on the interactive path
 * that creates the ASC app, so apps created in the App Store Connect website
 * are never set up and builds sit in TestFlight with no one able to install
 * them.
 *
 * Authentication is strictly non-interactive: an ASC API key from the
 * environment or the EAS credentials service. When neither is available the
 * setup is skipped silently — it must never add prompts or failures to
 * `eas submit`.
 */
export async function ensureTestFlightSetupForExistingAppAsync(
  ctx: SubmissionContext<Platform.IOS>,
  ascAppIdentifier: string
): Promise<void> {
  if (process.env.EAS_NO_AUTO_TESTFLIGHT_SETUP) {
    Log.debug('EAS_NO_AUTO_TESTFLIGHT_SETUP is set, skipping TestFlight setup');
    return;
  }

  try {
    const bundleIdentifier =
      ctx.applicationIdentifierOverride ??
      ctx.profile.bundleIdentifier ??
      (await getBundleIdentifierAsync(ctx.projectDir, ctx.exp, ctx.vcsClient));

    const appLookupParams = {
      account: nullthrows(
        ctx.user.accounts.find(a => a.name === ctx.accountName),
        `You do not have access to account: ${ctx.accountName}`
      ),
      projectName: ctx.projectName,
      bundleIdentifier,
    };

    const authenticated = await tryAuthenticateAppStoreWithEasAscApiKeyAsync(
      ctx.credentialsCtx,
      appLookupParams,
      resolveAppleTeamTypeFromEnvironment() ?? AppleTeamType.COMPANY_OR_ORGANIZATION
    );
    const authCtx = ctx.credentialsCtx.appStore.authCtx;
    if (!authenticated || !authCtx) {
      Log.debug('No App Store Connect API key available, skipping TestFlight setup');
      return;
    }

    const app = await App.infoAsync(getRequestContext(authCtx), { id: ascAppIdentifier });
    await ensureTestFlightGroupExistsAsync(app, { nonInteractive: ctx.nonInteractive });
  } catch (error: any) {
    // Group setup is a convenience on top of the submission and must never
    // block it.
    Log.debug('Skipping TestFlight group setup:', error);
  }
}
