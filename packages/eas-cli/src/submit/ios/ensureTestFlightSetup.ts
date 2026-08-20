import { App } from '@expo/apple-utils';
import { Platform } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import {
  AppleTeamType,
  AuthenticationMode,
} from '../../credentials/ios/appstore/authenticateTypes';
import { getRequestContext } from '../../credentials/ios/appstore/authenticate';
import { ensureTestFlightGroupExistsAsync } from '../../credentials/ios/appstore/ensureTestFlightGroup';
import {
  hasAscEnvVars,
  resolveAppleTeamTypeFromEnvironment,
} from '../../credentials/ios/appstore/resolveCredentials';
import { resolveAscApiKeyForAppCredentialsAsync } from '../../credentials/ios/actions/AscApiKeyUtils';
import Log from '../../log';
import { getBundleIdentifierAsync } from '../../project/ios/bundleIdentifier';
import { SubmissionContext } from '../context';

/**
 * Best-effort TestFlight internal group setup for an App Store Connect app
 * that already exists with `ascAppId` provided.
 */
export async function ensureTestFlightSetupForExistingAppAsync(
  ctx: SubmissionContext<Platform.IOS>,
  ascAppIdentifier: string
): Promise<void> {
  if (!ctx.autoTestFlightSetup) {
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

    if (!ctx.credentialsCtx.appStore.authCtx) {
      const teamType =
        resolveAppleTeamTypeFromEnvironment() ?? AppleTeamType.COMPANY_OR_ORGANIZATION;
      if (hasAscEnvVars()) {
        const teamId = process.env.EXPO_APPLE_TEAM_ID;
        if (
          !process.env.EXPO_ASC_API_KEY_PATH ||
          !process.env.EXPO_ASC_KEY_ID ||
          !process.env.EXPO_ASC_ISSUER_ID ||
          !teamId
        ) {
          Log.log('App Store Connect credentials are incomplete, skipping TestFlight setup');
          return;
        }
        await ctx.credentialsCtx.appStore.ensureAuthenticatedAsync({
          mode: AuthenticationMode.API_KEY,
          teamId,
          teamType,
        });
      } else {
        const resolvedKey = await resolveAscApiKeyForAppCredentialsAsync({
          graphqlClient: ctx.graphqlClient,
          app: appLookupParams,
        });
        const teamId = resolvedKey?.teamId ?? process.env.EXPO_APPLE_TEAM_ID;
        if (!resolvedKey || !teamId) {
          Log.log('No complete App Store Connect credentials, skipping TestFlight setup');
          return;
        }
        Log.log('Using App Store Connect API Key from EAS credentials service.');
        await ctx.credentialsCtx.appStore.ensureAuthenticatedAsync({
          mode: AuthenticationMode.API_KEY,
          ascApiKey: resolvedKey.ascApiKey,
          teamId,
          teamName: resolvedKey.teamName,
          teamType,
        });
      }
    }

    const authCtx = ctx.credentialsCtx.appStore.authCtx;
    if (!authCtx) {
      Log.debug('No App Store Connect API key available, skipping TestFlight setup');
      return;
    }

    const app = await App.infoAsync(getRequestContext(authCtx), { id: ascAppIdentifier });
    await ensureTestFlightGroupExistsAsync(app, { nonInteractive: ctx.nonInteractive });
  } catch (error: any) {
    // Group setup is a convenience on top of the submission and must never
    // block it.
    Log.warn('Skipping TestFlight group setup:', error);
  }
}
