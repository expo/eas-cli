import { CredentialsSource, Workflow } from '@eas/config';

import { BuildContext } from './context';
import { Platform, TrackingContext } from './types';

/**
 * We use require() to exclude package.json from TypeScript's analysis since it lives outside
 * the src directory and would change the directory structure of the emitted files
 * under the build directory
 */
const packageJSON = require('../../../../package.json');

export type BuildMetadata = {
  /**
   * Application version (the expo.version key in app.json/app.config.js)
   */
  appVersion: string;

  /**
   * EAS CLI version
   */
  cliVersion: string;

  /**
   * Build workflow
   * It's either 'generic' or 'managed'
   */
  workflow: Workflow;

  /**
   * Credentials source
   * Credentials could be obtained either from credential.json or Expo servers.
   */
  credentialsSource?: CredentialsSource.LOCAL | CredentialsSource.REMOTE;

  /**
   * Expo SDK version
   * It's determined by the expo package version in package.json.
   * It's undefined if the expo package is not installed for the project.
   */
  sdkVersion?: string;

  /**
   * Release channel (for expo-updates)
   * It's undefined if the expo-updates package is not installed for the project.
   */
  releaseChannel?: string;

  /**
   * Tracking context
   * It's used to track build process across different Expo services and tools.
   */
  trackingContext: TrackingContext;

  /**
   * Flag indicating whether the build is for internal distribution.
   */
  internalDistribution: boolean;
};

export function collectMetadata<T extends Platform>(
  ctx: BuildContext<T>,
  {
    credentialsSource,
  }: {
    credentialsSource?: CredentialsSource.LOCAL | CredentialsSource.REMOTE;
  }
): BuildMetadata {
  return {
    appVersion: ctx.commandCtx.exp.version!,
    cliVersion: packageJSON.version,
    workflow: ctx.buildProfile.workflow,
    credentialsSource,
    sdkVersion: ctx.commandCtx.exp.sdkVersion,
    trackingContext: ctx.trackingCtx,
    internalDistribution: ctx.buildProfile.internal ?? false,
  };
}
