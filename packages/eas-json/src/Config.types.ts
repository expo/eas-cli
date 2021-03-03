import { Android, Cache, Ios, Workflow } from '@expo/eas-build-job';

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
  workflow: Workflow.MANAGED;
  credentialsSource: CredentialsSource;
  buildType?: Android.ManagedBuildType;
  releaseChannel?: string;
  distribution?: AndroidDistributionType;
  cache: Cache | null;
}

export interface AndroidGenericBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.GENERIC;
  credentialsSource: CredentialsSource;
  gradleCommand?: string;
  releaseChannel?: string;
  artifactPath?: string;
  withoutCredentials?: boolean;
  distribution?: AndroidDistributionType;
  cache: Cache | null;
}

export interface iOSManagedBuildProfile extends Ios.BuilderEnvironment {
  workflow: Workflow.MANAGED;
  credentialsSource: CredentialsSource;
  buildType?: Ios.ManagedBuildType;
  releaseChannel?: string;
  distribution?: iOSDistributionType;
  autoIncrement: VersionAutoIncrement;
  cache: Cache | null;
}

export interface iOSGenericBuildProfile extends Ios.BuilderEnvironment {
  workflow: Workflow.GENERIC;
  credentialsSource: CredentialsSource;
  scheme?: string;
  schemeBuildConfiguration?: Ios.SchemeBuildConfiguration;
  releaseChannel?: string;
  artifactPath?: string;
  distribution?: iOSDistributionType;
  autoIncrement: VersionAutoIncrement;
  cache: Cache | null;
  disableIosBundleIdentifierValidation?: boolean;
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
