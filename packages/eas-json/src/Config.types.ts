import { Android, Workflow, iOS } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
  AUTO = 'auto',
}

export type AndroidDistributionType = 'store' | 'internal';
export type iOSDistributionType = 'store' | 'internal' | 'simulator';
export type DistributionType = AndroidDistributionType | iOSDistributionType;

export type VersionAutoIncrement = boolean | 'version' | 'buildNumber';

export interface AndroidManagedBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.Managed;
  credentialsSource: CredentialsSource;
  buildType?: Android.ManagedBuildType;
  releaseChannel?: string;
  distribution?: AndroidDistributionType;
}

export interface AndroidGenericBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.Generic;
  credentialsSource: CredentialsSource;
  gradleCommand?: string;
  releaseChannel?: string;
  artifactPath?: string;
  withoutCredentials?: boolean;
  distribution?: AndroidDistributionType;
}

export interface iOSManagedBuildProfile extends iOS.BuilderEnvironment {
  workflow: Workflow.Managed;
  credentialsSource: CredentialsSource;
  buildType?: iOS.ManagedBuildType;
  releaseChannel?: string;
  distribution?: iOSDistributionType;
  autoIncrement: VersionAutoIncrement;
}

export interface iOSGenericBuildProfile extends iOS.BuilderEnvironment {
  workflow: Workflow.Generic;
  credentialsSource: CredentialsSource;
  scheme?: string;
  schemeBuildConfiguration?: iOS.SchemeBuildConfiguration;
  releaseChannel?: string;
  artifactPath?: string;
  distribution?: iOSDistributionType;
  autoIncrement: VersionAutoIncrement;
}

export type AndroidBuildProfile = AndroidManagedBuildProfile | AndroidGenericBuildProfile;
export type iOSBuildProfile = iOSManagedBuildProfile | iOSGenericBuildProfile;
export type BuildProfile = AndroidBuildProfile | iOSBuildProfile;

// EasConfig represents eas.json with one specific profile
export interface EasConfig {
  builds: {
    android?: AndroidManagedBuildProfile | AndroidGenericBuildProfile;
    ios?: iOSManagedBuildProfile | iOSGenericBuildProfile;
  };
}
