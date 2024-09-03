import { ExpoConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile, EasJson } from '@expo/eas-json';
import { LoggerLevel } from '@expo/logger';
import { NodePackageManager } from '@expo/package-manager';

import { LocalBuildOptions } from './local';
import { Analytics, AnalyticsEventProperties } from '../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CredentialsContext } from '../credentials/context';
import { Target } from '../credentials/ios/types';
import { BuildResourceClass } from '../graphql/generated';
import { GradleBuildContext } from '../project/android/gradle';
import { CustomBuildConfigMetadata } from '../project/customBuildConfig';
import { XcodeBuildContext } from '../project/ios/scheme';
import { Actor } from '../user/User';
import { Client } from '../vcs/vcs';

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
  analyticsEventProperties: AnalyticsEventProperties;
  user: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  workflow: Workflow;
  customBuildConfigMetadata?: CustomBuildConfigMetadata;
  android: T extends Platform.ANDROID ? AndroidBuildContext : undefined;
  ios: T extends Platform.IOS ? IosBuildContext : undefined;
  developmentClient: boolean;
  requiredPackageManager: NodePackageManager['name'] | null;
  vcsClient: Client;
  loggerLevel?: LoggerLevel;
  repack: boolean;
  env: Record<string, string>;
}
