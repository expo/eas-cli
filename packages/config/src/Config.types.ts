// Workflow is representing different value than BuildType from @expo/eas-build-job
// Each workflow has a set of BuildTypes available
// - Generic workflow allows to build 'generic' and 'generic-client'
// - Managed workflow allows to build 'managed' and 'managed-client'
export enum Workflow {
  Generic = 'generic',
  Managed = 'managed',
}

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
  AUTO = 'auto',
}

export interface AndroidManagedBuildProfile {
  workflow: Workflow.Managed;
  credentialsSource: CredentialsSource;
  buildType?: 'apk' | 'app-bundle';
  releaseChannel?: undefined;
}

export interface AndroidGenericBuildProfile {
  workflow: Workflow.Generic;
  credentialsSource: CredentialsSource;
  gradleCommand?: string;
  releaseChannel?: string;
  artifactPath?: string;
  withoutCredentials?: boolean;
}

export interface iOSManagedBuildProfile {
  workflow: Workflow.Managed;
  credentialsSource: CredentialsSource;
  buildType?: 'archive' | 'simulator';
  releaseChannel?: undefined;
}

export interface iOSGenericBuildProfile {
  workflow: Workflow.Generic;
  credentialsSource: CredentialsSource;
  scheme?: string;
  releaseChannel?: string;
  artifactPath?: string;
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
