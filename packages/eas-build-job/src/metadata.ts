import Joi from 'joi';

import { Workflow } from './common';

export type Metadata = {
  /**
   * Tracking context
   * It's used to track build process across different Expo services and tools.
   */
  trackingContext?: Record<string, string | number | boolean>;

  /**
   * Application version:
   * - managed projects: expo.version in app.json/app.config.js
   * - generic projects:
   *   * iOS: CFBundleShortVersionString in Info.plist
   *   * Android: versionName in build.gradle
   */
  appVersion?: string;

  /**
   * Application build version:
   * - Android: version code
   * - iOS: build number
   */
  appBuildVersion?: string;

  /**
   * EAS CLI version
   */
  cliVersion?: string;

  /**
   * Build workflow
   * It's either 'generic' or 'managed'
   */
  workflow?: Workflow;

  /**
   * Credentials source
   * Credentials could be obtained either from credential.json or EAS servers.
   */
  credentialsSource?: 'local' | 'remote';

  /**
   * Expo SDK version
   * It's determined by the expo package version in package.json.
   * It's undefined if the expo package is not installed for the project.
   */
  sdkVersion?: string;

  /**
   * Runtime version (for Expo Updates)
   */
  runtimeVersion?: string;

  /**
   * Fingerprint hash of a project's native dependencies
   */
  fingerprintHash?: string;

  /**
   * Version of the react-native package used in the project.
   */
  reactNativeVersion?: string;

  /**
   * Channel (for Expo Updates when it is configured for for use with EAS)
   * It's undefined if the expo-updates package is not configured for use with EAS.
   */
  channel?: string;

  /**
   * Distribution type
   * Indicates whether this is a build for store, internal distribution, or simulator (iOS).
   * simulator is deprecated, use simulator flag instead
   */
  distribution?: 'store' | 'internal' | 'simulator';

  /**
   * App name (expo.name in app.json/app.config.js)
   */
  appName?: string;

  /**
   * App identifier:
   * - iOS builds: the bundle identifier (expo.ios.bundleIdentifier in app.json/app.config.js)
   * - Android builds: the application id (expo.android.package in app.json/app.config.js)
   */
  appIdentifier?: string;

  /**
   * Build profile name (e.g. release)
   */
  buildProfile?: string;

  /**
   * Git commit hash (e.g. aab03fbdabb6e536ea78b28df91575ad488f5f21)
   */
  gitCommitHash?: string;

  /**
   * Git commit message
   */
  gitCommitMessage?: string;

  /**
   * State of the git working tree
   */
  isGitWorkingTreeDirty?: boolean;

  /**
   * Username of the initiating user
   */
  username?: string;

  /**
   * Indicates what type of an enterprise provisioning profile was used to build the app.
   * It's either adhoc or universal
   */
  iosEnterpriseProvisioning?: 'adhoc' | 'universal';

  /**
   * Message attached to the build.
   */
  message?: string;

  /**
   * Indicates whether the build was run from CI.
   */
  runFromCI?: boolean;

  /**
   * Indicates whether the build was run with --no-wait flag.
   */
  runWithNoWaitFlag?: boolean;

  /**
   * Workflow name available for custom builds.
   */
  customWorkflowName?: string;

  /**
   * Indicates whether this is (likely, we can't be 100% sure) development client build.
   */
  developmentClient?: boolean;

  /**
   * Which package manager will be used for the build. Determined based on lockfiles in the project directory.
   */
  requiredPackageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';

  /**
   * Indicates if this is an iOS build for a simulator
   */
  simulator?: boolean;

  /**
   * Image selected by user for the build. If user didn't select any image and wants to use default for the given RN and SDK version it will undefined.
   */
  selectedImage?: string;

  /**
   * Custom node version selected by user for the build. If user didn't select any node version and wants to use default it will be undefined.
   */
  customNodeVersion?: string;

  /**
   * EAS env vars environment chosen for the job
   */
  environment?: string;
};

export const MetadataSchema = Joi.object({
  trackingContext: Joi.object().pattern(Joi.string(), [Joi.string(), Joi.number(), Joi.boolean()]),
  appVersion: Joi.string(),
  appBuildVersion: Joi.string(),
  cliVersion: Joi.string(),
  workflow: Joi.string().valid('generic', 'managed'),
  distribution: Joi.string().valid('store', 'internal', 'simulator'),
  credentialsSource: Joi.string().valid('local', 'remote'),
  sdkVersion: Joi.string(),
  runtimeVersion: Joi.string(),
  fingerprintHash: Joi.string(),
  reactNativeVersion: Joi.string(),
  channel: Joi.string(),
  appName: Joi.string(),
  appIdentifier: Joi.string(),
  buildProfile: Joi.string(),
  gitCommitHash: Joi.string().length(40).hex(),
  gitCommitMessage: Joi.string().max(4096),
  isGitWorkingTreeDirty: Joi.boolean(),
  username: Joi.string(),
  iosEnterpriseProvisioning: Joi.string().valid('adhoc', 'universal'),
  message: Joi.string().max(1024),
  runFromCI: Joi.boolean(),
  runWithNoWaitFlag: Joi.boolean(),
  customWorkflowName: Joi.string(),
  developmentClient: Joi.boolean(),
  requiredPackageManager: Joi.string().valid('npm', 'pnpm', 'yarn', 'bun'),
  simulator: Joi.boolean(),
  selectedImage: Joi.string(),
  customNodeVersion: Joi.string(),
  environment: Joi.string(),
});

export function sanitizeMetadata(metadata: object): Metadata {
  const { value, error } = MetadataSchema.validate(metadata, {
    stripUnknown: true,
    convert: true,
    abortEarly: false,
  });
  if (error) {
    throw error;
  } else {
    return value;
  }
}
