import { Android, Cache, Ios, Workflow } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
  AUTO = 'auto',
}

export type AndroidDistributionType = 'store' | 'internal';
export type IosDistributionType = 'store' | 'internal' | 'simulator';
export type DistributionType = AndroidDistributionType | IosDistributionType;

export type IosEnterpriseProvisioning = 'adhoc' | 'universal';

export type VersionAutoIncrement = boolean | 'version' | 'buildNumber';

export interface AndroidManagedBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.MANAGED;
  credentialsSource: CredentialsSource;
  buildType?: Android.ManagedBuildType;
  releaseChannel?: string;
  distribution?: AndroidDistributionType;
  cache: Cache;
}

export interface AndroidGenericBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.GENERIC;
  credentialsSource: CredentialsSource;
  gradleCommand?: string;
  releaseChannel?: string;
  artifactPath?: string;
  withoutCredentials?: boolean;
  distribution?: AndroidDistributionType;
  cache: Cache;
}

export interface IosManagedBuildProfile extends Ios.BuilderEnvironment {
  workflow: Workflow.MANAGED;
  credentialsSource: CredentialsSource;
  buildType?: Ios.ManagedBuildType;
  releaseChannel?: string;
  distribution?: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement: VersionAutoIncrement;
  cache: Cache;
}

export interface IosGenericBuildProfile extends Ios.BuilderEnvironment {
  workflow: Workflow.GENERIC;
  credentialsSource: CredentialsSource;
  scheme?: string;
  schemeBuildConfiguration?: Ios.SchemeBuildConfiguration | 'Auto';
  releaseChannel?: string;
  artifactPath?: string;
  distribution?: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement: VersionAutoIncrement;
  cache: Cache;
  disableIosBundleIdentifierValidation?: boolean;
}

export type AndroidBuildProfile = AndroidManagedBuildProfile | AndroidGenericBuildProfile;
export type IosBuildProfile = IosManagedBuildProfile | IosGenericBuildProfile;
export type BuildProfile = AndroidBuildProfile | IosBuildProfile;

// EasConfig represents eas.json with one specific profile
export interface EasConfig {
  builds: {
    android?: AndroidManagedBuildProfile | AndroidGenericBuildProfile;
    ios?: IosManagedBuildProfile | IosGenericBuildProfile;
  };
}
