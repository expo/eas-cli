import { App, Session } from '@expo/apple-utils';
import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { IosSubmitProfile } from '@expo/eas-json/build/submit/types';
import assert from 'assert';

import { CredentialsContext } from '../credentials/context';
import { getRequestContext } from '../credentials/ios/appstore/authenticate';
import { getExpoConfig } from '../project/expoConfig';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { getProfilesAsync } from '../utils/profiles';

export type MetadataContext = {
  /** Submission profile platform to use */
  platform: Platform.IOS;
  /** Submission profile name to use */
  profile: IosSubmitProfile;
  /** Configured store configuration file name (defaults to store.config.json) */
  metadataFile: string;
  /** Authenticated Expo account */
  user: Actor;
  /** The store credentials manager */
  credentialsCtx: CredentialsContext;
  /** The app bundle identifier to use for the stores */
  bundleIdentifier: string;
  /** Root of the Expo project directory */
  projectDir: string;
  /** Resolved Expo app configuration */
  exp: ExpoConfig;

  /**
   * If we should run in non-interactive mode, as much as we can.
   * The store authentication requires a fully configured ASC environment, or interactive mode.
   */
  nonInteractive: boolean;
};

export type MetadataAppStoreAuthentication = {
  /** The root entity of the App store  */
  app: App;
  /** The authentication state we used to fetch the root entity */
  auth: Partial<Session.AuthState>;
};

/**
 * Metadata uses the submission profile to find the configured metadata filename.
 * Note, only iOS is supported for metadata right now.
 */
export async function createMetadataContextAsync(params: {
  projectDir: string;
  exp: ExpoConfig;
  profileName?: string;
  nonInteractive?: boolean;
}): Promise<MetadataContext> {
  const submissionProfiles = await getProfilesAsync({
    type: 'submit',
    platforms: [Platform.IOS],
    projectDir: params.projectDir,
    profileName: params.profileName,
  });

  const submissionProfile = submissionProfiles.find(profile => profile.platform === Platform.IOS);
  assert(
    submissionProfile,
    'Could not resolve the iOS submission profile, only iOS is supported for metadata'
  );
  const iosSubmissionProfile = submissionProfile.profile as IosSubmitProfile;

  const exp = params.exp ?? getExpoConfig(params.projectDir);
  const user = await ensureLoggedInAsync({ nonInteractive: params.nonInteractive });
  const bundleIdentifier = await getBundleIdentifierAsync(params.projectDir, exp);

  const credentialsCtx = new CredentialsContext({
    user,
    exp: params.exp,
    nonInteractive: params.nonInteractive,
    projectDir: params.projectDir,
  });

  return {
    platform: Platform.IOS,
    profile: iosSubmissionProfile,
    metadataFile: iosSubmissionProfile.meta ?? 'store.config.json',
    user,
    credentialsCtx,
    bundleIdentifier,
    projectDir: params.projectDir,
    exp: params.exp,
    nonInteractive: params.nonInteractive ?? false,
  };
}

/**
 * To start syncing ASC entities, we need access to the apple utils App instance.
 * This ensures we are authenticated and have the app instance ready to use.
 */
export async function ensureMetadataAppStoreAuthenticatedAsync({
  credentialsCtx,
  bundleIdentifier,
}: MetadataContext): Promise<MetadataAppStoreAuthentication> {
  const authCtx = await credentialsCtx.appStore.ensureAuthenticatedAsync();
  assert(authCtx.authState, 'Failed to authenticate with App Store Connect');

  // TODO: improve error handling by mentioning possible configuration errors
  const app = await App.findAsync(getRequestContext(authCtx), { bundleId: bundleIdentifier });
  assert(app, `Failed to load app "${bundleIdentifier}" from App Store Connect`);

  return { app, auth: authCtx.authState };
}
