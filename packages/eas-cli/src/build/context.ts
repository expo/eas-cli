import { ExpoConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import type { XCBuildConfiguration } from 'xcode';

import { TrackingContext } from '../analytics/common';
import { CredentialsContext } from '../credentials/context';
import { Target } from '../credentials/ios/types';
import { RequestedPlatform } from '../platform';
import { GradleBuildContext } from '../project/android/gradle';
import { XcodeBuildContext } from '../project/ios/scheme';
import { Actor } from '../user/User';
import { LocalBuildOptions } from './local';

export interface ConfigureContext {
  user: Actor;
  projectDir: string;
  exp: ExpoConfig;
  requestedPlatform: RequestedPlatform;
  shouldConfigureAndroid: boolean;
  shouldConfigureIos: boolean;
  hasAndroidNativeProject: boolean;
  hasIosNativeProject: boolean;
}

export type CommonContext<T extends Platform> = Omit<BuildContext<T>, 'android' | 'ios'>;

export interface AndroidBuildContext {
  applicationId: string;
  gradleContext?: GradleBuildContext;
}

export interface IosBuildContext {
  bundleIdentifier: string;
  applicationTargetBuildSettings: XCBuildConfiguration['buildSettings'];
  applicationTarget: Target;
  targets: Target[];
  xcodeBuildContext: XcodeBuildContext;
}

export interface BuildContext<T extends Platform> {
  accountName: string;
  buildProfile: BuildProfile<T>;
  buildProfileName: string;
  clearCache: boolean;
  credentialsCtx: CredentialsContext;
  exp: ExpoConfig;
  localBuildOptions: LocalBuildOptions;
  nonInteractive: boolean;
  platform: T;
  projectDir: string;
  projectId: string;
  projectName: string;
  skipProjectConfiguration: boolean;
  trackingCtx: TrackingContext;
  user: Actor;
  workflow: Workflow;
  android: T extends Platform.ANDROID ? AndroidBuildContext : undefined;
  ios: T extends Platform.IOS ? IosBuildContext : undefined;
}
