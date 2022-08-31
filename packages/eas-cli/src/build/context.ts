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

export type AndroidCommonContext = Omit<BuildContextAndroid, 'android'>;
export type IosCommonContext = Omit<BuildContextIos, 'ios'>;
export type CommonContext = AndroidCommonContext | IosCommonContext;

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

interface BuildContextBase {
  accountName: string;
  easJsonCliConfig: EasJson['cli'];
  buildProfileName: string;
  resourceClass: BuildResourceClass;
  clearCache: boolean;
  credentialsCtx: CredentialsContext;
  exp: ExpoConfig;
  localBuildOptions: LocalBuildOptions;
  nonInteractive: boolean;
  noWait: boolean;
  runFromCI: boolean;
  projectDir: string;
  projectId: string;
  projectName: string;
  message?: string;
  trackingCtx: TrackingContext;
  user: Actor;
  workflow: Workflow;
}

export interface BuildContextAndroid extends BuildContextBase {
  buildProfile: BuildProfile<Platform.ANDROID>;
  platform: Platform.ANDROID;
  android: AndroidBuildContext;
}

export interface BuildContextIos extends BuildContextBase {
  buildProfile: BuildProfile<Platform.IOS>;
  platform: Platform.IOS;
  ios: IosBuildContext;
}

export type BuildContext = BuildContextAndroid | BuildContextIos;
