import { App, Session } from '@expo/apple-utils';
import { ExpoConfig } from '@expo/config';
import { SubmitProfile } from '@expo/eas-json';
import assert from 'assert';
import fs from 'fs';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CredentialsContext } from '../credentials/context';
import { AppLookupParams } from '../credentials/ios/api/graphql/types/AppLookupParams';
import {
  Options as AuthOptions,
  getRequestContext,
} from '../credentials/ios/appstore/authenticate';
import { AppleTeamType, AuthenticationMode } from '../credentials/ios/appstore/authenticateTypes';
import { hasAscEnvVars } from '../credentials/ios/appstore/resolveCredentials';
import { MinimalAscApiKey } from '../credentials/ios/credentials';
import { AppStoreConnectApiKeyQuery } from '../graphql/queries/AppStoreConnectApiKeyQuery';
import Log from '../log';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { Client } from '../vcs/vcs';

export type MetadataAppStoreAuthentication = {
  /** The root entity of the App store */
  app: App;
  /** The authentication state we used to fetch the root entity */
  auth: Partial<Session.AuthState>;
};

/**
 * Resolve the bundle identifier from the selected submit profile.
 * This bundle identifier is used as target for the metadata submission.
 */
async function resolveAppStoreBundleIdentifierAsync(
  projectDir: string,
  profile: SubmitProfile,
  exp: ExpoConfig,
  vcsClient: Client
): Promise<string> {
  if ('bundleIdentifier' in profile) {
    return profile.bundleIdentifier ?? (await getBundleIdentifierAsync(projectDir, exp, vcsClient));
  }

  return await getBundleIdentifierAsync(projectDir, exp, vcsClient);
}

type ResolvedAscApiKey = {
  ascApiKey: MinimalAscApiKey;
  teamId?: string;
  teamName?: string;
};

/**
 * Try to resolve an ASC API key from the submit profile or EAS credentials service.
 * Returns null if no key is available from these sources.
 */
async function tryResolveAscApiKeyAsync({
  profile,
  graphqlClient,
  projectId,
  exp,
  bundleId,
}: {
  profile: SubmitProfile;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  exp: ExpoConfig;
  bundleId: string;
}): Promise<ResolvedAscApiKey | null> {
  // 1. Check submit profile for ASC API key fields
  if ('ascApiKeyPath' in profile && 'ascApiKeyIssuerId' in profile && 'ascApiKeyId' in profile) {
    const { ascApiKeyPath, ascApiKeyIssuerId, ascApiKeyId } = profile;
    if (ascApiKeyPath && ascApiKeyIssuerId && ascApiKeyId) {
      const keyP8 = await fs.promises.readFile(ascApiKeyPath, 'utf-8');
      // Also try to get teamId from the profile if available
      const teamId = 'appleTeamId' in profile ? (profile as any).appleTeamId : undefined;
      return {
        ascApiKey: { keyP8, keyId: ascApiKeyId, issuerId: ascApiKeyIssuerId },
        teamId,
      };
    }
  }

  // 2. Look up stored credentials via EAS credentials service
  try {
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    const appLookupParams: AppLookupParams = {
      account,
      projectName: exp.slug,
      bundleIdentifier: bundleId,
    };

    // Import dynamically to avoid circular dependency issues
    const { getAscApiKeyForAppSubmissionsAsync } =
      await import('../credentials/ios/api/GraphqlClient');
    const ascKeyFragment = await getAscApiKeyForAppSubmissionsAsync(graphqlClient, appLookupParams);

    if (ascKeyFragment) {
      Log.log('Using App Store Connect API Key from EAS credentials service.');
      const fullKey = await AppStoreConnectApiKeyQuery.getByIdAsync(
        graphqlClient,
        ascKeyFragment.id
      );
      return {
        ascApiKey: {
          keyP8: fullKey.keyP8,
          keyId: fullKey.keyIdentifier,
          issuerId: fullKey.issuerIdentifier,
        },
        teamId: ascKeyFragment.appleTeam?.appleTeamIdentifier,
        teamName: ascKeyFragment.appleTeam?.appleTeamName ?? undefined,
      };
    }
  } catch (error: any) {
    // If we can't look up credentials, that's fine — we'll fall back
    Log.warn(`Could not look up stored ASC API key: ${error.message}`);
  }

  return null;
}

/**
 * To start syncing ASC entities, we need access to the apple utils App instance.
 * This resolves both the authentication and that App instance.
 *
 * Resolution order for authentication:
 * 1. ASC API key from environment variables (EXPO_ASC_API_KEY_PATH, etc.)
 * 2. ASC API key from submit profile (ascApiKeyPath, etc. in eas.json)
 * 3. ASC API key from EAS credentials service
 * 4. Interactive cookie auth (only when not in non-interactive mode)
 */
export async function getAppStoreAuthAsync({
  projectDir,
  profile,
  exp,
  credentialsCtx,
  nonInteractive,
  graphqlClient,
  projectId,
}: {
  projectDir: string;
  profile: SubmitProfile;
  exp: ExpoConfig;
  credentialsCtx: CredentialsContext;
  nonInteractive: boolean;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<MetadataAppStoreAuthentication> {
  const bundleId = await resolveAppStoreBundleIdentifierAsync(
    projectDir,
    profile,
    exp,
    credentialsCtx.vcsClient
  );

  // Try to resolve an ASC API key from profile or credentials service
  const resolvedKey = await tryResolveAscApiKeyAsync({
    profile,
    graphqlClient,
    projectId,
    exp,
    bundleId,
  });

  if (resolvedKey || hasAscEnvVars()) {
    const authOptions: AuthOptions = {
      mode: AuthenticationMode.API_KEY,
      ...(resolvedKey
        ? {
            ascApiKey: resolvedKey.ascApiKey,
            teamId: resolvedKey.teamId,
            teamName: resolvedKey.teamName,
            // Default to COMPANY_OR_ORGANIZATION to avoid prompting for team type
            teamType: AppleTeamType.COMPANY_OR_ORGANIZATION,
          }
        : {}),
    };
    const authCtx = await credentialsCtx.appStore.ensureAuthenticatedAsync(authOptions);
    assert(authCtx.authState, 'Failed to authenticate with App Store Connect');

    const app = await App.findAsync(getRequestContext(authCtx), { bundleId });
    assert(app, `Failed to load app "${bundleId}" from App Store Connect`);
    return { app, auth: authCtx.authState };
  }

  if (nonInteractive) {
    throw new Error(
      'No App Store Connect API Key found. In non-interactive mode, provide one via:\n' +
        '  - Environment variables: EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID\n' +
        '  - eas.json submit profile: ascApiKeyPath, ascApiKeyId, ascApiKeyIssuerId\n' +
        '  - EAS credentials service: run `eas credentials` to set up an API key'
    );
  }

  // Fall back to interactive cookie auth
  const authCtx = await credentialsCtx.appStore.ensureAuthenticatedAsync();
  assert(authCtx.authState, 'Failed to authenticate with App Store Connect');

  const app = await App.findAsync(getRequestContext(authCtx), { bundleId });
  assert(app, `Failed to load app "${bundleId}" from App Store Connect`);

  return { app, auth: authCtx.authState };
}
