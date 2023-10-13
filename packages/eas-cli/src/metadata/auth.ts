import { App, Session } from '@expo/apple-utils';
import { ExpoConfig } from '@expo/config';
import { SubmitProfile } from '@expo/eas-json';
import assert from 'assert';

import { CredentialsContext } from '../credentials/context';
import { getRequestContext } from '../credentials/ios/appstore/authenticate';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
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

/**
 * To start syncing ASC entities, we need access to the apple utils App instance.
 * This resolves both the authentication and that App instance.
 */
export async function getAppStoreAuthAsync({
  projectDir,
  profile,
  exp,
  credentialsCtx,
}: {
  projectDir: string;
  profile: SubmitProfile;
  exp: ExpoConfig;
  credentialsCtx: CredentialsContext;
}): Promise<MetadataAppStoreAuthentication> {
  const bundleId = await resolveAppStoreBundleIdentifierAsync(
    projectDir,
    profile,
    exp,
    credentialsCtx.vcsClient
  );

  const authCtx = await credentialsCtx.appStore.ensureAuthenticatedAsync();
  assert(authCtx.authState, 'Failed to authenticate with App Store Connect');

  // TODO: improve error handling by mentioning possible configuration errors
  const app = await App.findAsync(getRequestContext(authCtx), { bundleId });
  assert(app, `Failed to load app "${bundleId}" from App Store Connect`);

  return { app, auth: authCtx.authState };
}
