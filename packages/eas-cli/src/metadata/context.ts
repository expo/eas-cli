import { App, Session } from '@expo/apple-utils';
import { ExpoConfig } from '@expo/config';
import { SubmitProfile } from '@expo/eas-json';
import assert from 'assert';

import { CredentialsContext } from '../credentials/context';
import { getRequestContext } from '../credentials/ios/appstore/authenticate';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';

export type MetadataAppStoreAuthentication = {
  /** The root entity of the App store */
  app: App;
  /** The authentication state we used to fetch the root entity */
  auth: Partial<Session.AuthState>;
};

/**
 * Resolve the metadata config file from the selected submit profile.
 * When `metadataPath` is not configured, it falls back to `store.config.json`.
 */
export function getMetadataFilePath(profile: SubmitProfile): string {
  if ('metadataPath' in profile) {
    return profile.metadataPath ?? 'store.config.json';
  }

  return 'store.config.json';
}

/**
 * Resolve the bundle identifier from the selected submit profile.
 * This bundle identifier is used as target for the metadata submission.
 */
export async function getMetadataBundleIdentifierAsync(
  projectDir: string,
  profile: SubmitProfile,
  exp: ExpoConfig
): Promise<string> {
  if ('bundleIdentifier' in profile) {
    return profile.bundleIdentifier ?? (await getBundleIdentifierAsync(projectDir, exp));
  }

  return await getBundleIdentifierAsync(projectDir, exp);
}

/**
 * To start syncing ASC entities, we need access to the apple utils App instance.
 * This resolves both the authentication and that App instance.
 */
export async function getMetadataAppStoreAsync(
  credentialsCtx: CredentialsContext,
  bundleIdentifier: string
): Promise<MetadataAppStoreAuthentication> {
  const authCtx = await credentialsCtx.appStore.ensureAuthenticatedAsync();
  assert(authCtx.authState, 'Failed to authenticate with App Store Connect');

  // TODO: improve error handling by mentioning possible configuration errors
  const app = await App.findAsync(getRequestContext(authCtx), { bundleId: bundleIdentifier });
  assert(app, `Failed to load app "${bundleIdentifier}" from App Store Connect`);

  return { app, auth: authCtx.authState };
}
