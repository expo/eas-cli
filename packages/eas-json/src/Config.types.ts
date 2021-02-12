import { Android, Workflow, iOS } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
  AUTO = 'auto',
}

export enum DistributionType {
  STORE = 'store',
  INTERNAL = 'internal',
}

export type VersionAutoIncrement = boolean | 'version' | 'buildNumber';

export enum BuildConfiguration {
  RELEASE = 'Release',
  DEBUG = 'Debug',
}

export interface AndroidManagedBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.Managed;
  credentialsSource: CredentialsSource;
  buildType?: Android.ManagedBuildType;
  releaseChannel?: string;
  distribution?: DistributionType;
}

export interface AndroidGenericBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.Generic;
  credentialsSource: CredentialsSource;
  gradleCommand?: string;
  releaseChannel?: string;
  artifactPath?: string;
  withoutCredentials?: boolean;
  distribution?: DistributionType;
}

export interface iOSManagedBuildProfile extends iOS.BuilderEnvironment {
  workflow: Workflow.Managed;
  credentialsSource: CredentialsSource;
  releaseChannel?: string;
  distribution?: DistributionType;
  autoIncrement: VersionAutoIncrement;
  buildConfiguration?: BuildConfiguration;
}

export interface iOSGenericBuildProfile extends iOS.BuilderEnvironment {
  workflow: Workflow.Generic;
  credentialsSource: CredentialsSource;
  scheme?: string;
  releaseChannel?: string;
  artifactPath?: string;
  distribution?: DistributionType;
  autoIncrement: VersionAutoIncrement;
  buildConfiguration?: BuildConfiguration;
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
