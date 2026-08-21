import { App, RequestContext, Token } from '@expo/apple-utils';
import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils, SubmitProfile } from '@expo/eas-json';
import { MissingEasJsonError } from '@expo/eas-json/build/errors';
import assert from 'assert';

import { Analytics } from '../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CredentialsContext } from '../credentials/context';
import { AppStoreConnectApiKeyQuery as AccountAppStoreConnectApiKeyQuery } from '../credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery';
import { getRequestContext } from '../credentials/ios/appstore/authenticate';
import { AppStoreConnectApiKeyQuery } from '../graphql/queries/AppStoreConnectApiKeyQuery';
import Log from '../log';
import { getAppStoreAuthAsync } from '../metadata/auth';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { Actor } from '../user/User';
import { Client } from '../vcs/vcs';

/** How long the ASC JWTs we mint stay valid, matching the credentials service default. */
const ASC_TOKEN_DURATION_SECONDS = 1200;

/**
 * TestFlight data lives in App Store Connect, so we resolve the bundle identifier and the ASC API
 * key from the submit profile the same way `eas metadata` does. When the project has no eas.json
 * we fall back to an empty profile, which resolves the bundle identifier from the app config and
 * the API key from env vars or the EAS credentials service.
 */
async function resolveSubmitProfileAsync({
  projectDir,
  profileName,
}: {
  projectDir: string;
  profileName?: string;
}): Promise<SubmitProfile<Platform.IOS>> {
  try {
    return await EasJsonUtils.getSubmitProfileAsync(
      EasJsonAccessor.fromProjectPath(projectDir),
      Platform.IOS,
      profileName
    );
  } catch (error: any) {
    if (error instanceof MissingEasJsonError && !profileName) {
      return {} as SubmitProfile<Platform.IOS>;
    }
    throw error;
  }
}

/**
 * Look for the app in every ASC API key registered on the account that owns the project. This is
 * the resolution the Expo MCP server uses for its TestFlight tools, and it covers projects that
 * have no ASC API key assigned to their iOS submission credentials.
 */
async function findAppWithAccountAscApiKeysAsync({
  bundleId,
  graphqlClient,
  projectId,
}: {
  bundleId: string;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<App | null> {
  const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
  const keys = await AccountAppStoreConnectApiKeyQuery.getAllForAccountAsync(
    graphqlClient,
    account.name
  );

  for (const key of keys) {
    try {
      const { keyP8, keyIdentifier, issuerIdentifier } =
        await AppStoreConnectApiKeyQuery.getByIdAsync(graphqlClient, key.id);
      const context: RequestContext = {
        token: new Token({
          key: keyP8,
          keyId: keyIdentifier,
          // TODO(ENG-21475): drop the cast once @expo/apple-utils accepts an
          // optional issuerId and signs issuer-less tokens with sub: "user".
          issuerId: issuerIdentifier as string,
          duration: ASC_TOKEN_DURATION_SECONDS,
        }),
      };
      const app = await App.findAsync(context, { bundleId });
      if (app) {
        Log.log(
          `Using App Store Connect API Key ${key.name ?? key.keyIdentifier} from your Expo account.`
        );
        return app;
      }
    } catch (error: unknown) {
      // Never read `.message` off an unknown rejection: a non-Error value (a string, or
      // null from a wrapped fetch) would make this handler throw a TypeError, hiding the
      // real failure and aborting the loop instead of falling through to the next key.
      Log.debug(
        `ASC API Key ${key.keyIdentifier} cannot access ${bundleId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return null;
}

/** Resolve the App Store Connect app that TestFlight feedback and crashes should be read from. */
export async function resolveTestFlightAppAsync({
  actor,
  analytics,
  exp,
  graphqlClient,
  nonInteractive,
  profileName,
  projectDir,
  projectId,
  vcsClient,
}: {
  actor: Actor;
  analytics: Analytics;
  exp: ExpoConfig;
  graphqlClient: ExpoGraphqlClient;
  nonInteractive: boolean;
  profileName?: string;
  projectDir: string;
  projectId: string;
  vcsClient: Client;
}): Promise<App> {
  const profile = await resolveSubmitProfileAsync({ projectDir, profileName });

  const createCredentialsContext = (contextNonInteractive: boolean): CredentialsContext =>
    new CredentialsContext({
      projectInfo: { exp, projectId },
      projectDir,
      user: actor,
      graphqlClient,
      analytics,
      nonInteractive: contextNonInteractive,
      vcsClient,
    });

  // Prefer the key configured for this project: ASC env vars, the submit profile, or the key
  // assigned to its iOS submission credentials. Forced non-interactive so that a project without
  // any of those falls through to the account-wide lookup instead of prompting for an Apple login.
  try {
    const { app } = await getAppStoreAuthAsync({
      exp,
      credentialsCtx: createCredentialsContext(true),
      graphqlClient,
      nonInteractive: true,
      profile,
      projectDir,
      projectId,
    });
    return app;
  } catch (error: unknown) {
    Log.debug(
      `Could not resolve an App Store Connect API Key for this project: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const bundleId =
    ('bundleIdentifier' in profile ? profile.bundleIdentifier : undefined) ??
    (await getBundleIdentifierAsync(projectDir, exp, vcsClient));

  const appFromAccountKeys = await findAppWithAccountAscApiKeysAsync({
    bundleId,
    graphqlClient,
    projectId,
  });
  if (appFromAccountKeys) {
    return appFromAccountKeys;
  }

  if (nonInteractive) {
    throw new Error(
      `Could not find "${bundleId}" in App Store Connect with any App Store Connect API Key available to this project.\n` +
        'Provide a key with access to the app via:\n' +
        '  - Environment variables: EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID\n' +
        '  - eas.json submit profile: ascApiKeyPath, ascApiKeyId, ascApiKeyIssuerId\n' +
        '  - EAS credentials service: run `eas credentials` to set up an API key'
    );
  }

  // Last resort: an interactive Apple ID login.
  const credentialsCtx = createCredentialsContext(false);
  const authCtx = await credentialsCtx.appStore.ensureUserAuthenticatedAsync();
  const app = await App.findAsync(getRequestContext(authCtx), { bundleId });
  assert(app, `Failed to load app "${bundleId}" from App Store Connect`);
  return app;
}
