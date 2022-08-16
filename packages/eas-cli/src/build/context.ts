import { ExpoConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile, EasJson } from '@expo/eas-json';

import { TrackingContext } from '../analytics/common';
import { CredentialsContext } from '../credentials/context';
import { Target } from '../credentials/ios/types';
import { BuildResourceClass } from '../graphql/generated';
import { GradleBuildContext } from '../project/android/gradle';
import { XcodeBuildContext } from '../project/ios/scheme';
import { Actor } from '../user/User';
import { LocalBuildOptions } from './local';

export type CommonContext<T extends Platform> = Omit<BuildContext<T>, 'android' | 'ios'>;

export interface AndroidBuildContext {
  applicationId: string;
  gradleContext?: GradleBuildContext;
  versionCodeOverride?: string;
}

export interface IosBuildContext {
  bundleIdentifier: string;
  applicationTarget: Target;
  targets: Target[];
  xcodeBuildContext: XcodeBuildContext;
  buildNumberOverride?: string;
}

export interface BuildContext<T extends Platform> {
  accountName: string;
  easJsonCliConfig: EasJson['cli'];
  buildProfile: BuildProfile<T>;
  buildProfileName: string;
  resourceClass: BuildResourceClass;
  clearCache: boolean;
  credentialsCtx: CredentialsContext;
  exp: ExpoConfig;
  localBuildOptions: LocalBuildOptions;
  nonInteractive: boolean;
  noWait: boolean;
  runFromCI: boolean;
  platform: T;
  projectDir: string;
  projectId: string;
  projectName: string;
  message?: string;
  trackingCtx: TrackingContext;
  user: Actor;
  workflow: Workflow;
  android: T extends Platform.ANDROID ? AndroidBuildContext : undefined;
  ios: T extends Platform.IOS ? IosBuildContext : undefined;
}
