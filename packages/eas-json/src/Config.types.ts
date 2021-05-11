import { Android, Cache, Ios, Workflow } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export type AndroidDistributionType = 'store' | 'internal';
export type IosDistributionType = 'store' | 'internal' | 'simulator';
export type DistributionType = AndroidDistributionType | IosDistributionType;

export type IosEnterpriseProvisioning = 'adhoc' | 'universal';

export type VersionAutoIncrement = boolean | 'version' | 'buildNumber';

interface CommonBuildProfile {
  credentialsSource: CredentialsSource;
  releaseChannel?: string;
  cache: Cache;
  updatesRequestHeaders?: { [key: string]: string };
}

export interface AndroidManagedBuildProfile extends Android.BuilderEnvironment, CommonBuildProfile {
  workflow: Workflow.MANAGED;
  buildType?: Android.ManagedBuildType;
  distribution?: AndroidDistributionType;
}

export interface AndroidGenericBuildProfile extends Android.BuilderEnvironment, CommonBuildProfile {
  workflow: Workflow.GENERIC;
  gradleCommand?: string;
  artifactPath?: string;
  withoutCredentials?: boolean;
  distribution?: AndroidDistributionType;
}

export interface IosManagedBuildProfile extends Ios.BuilderEnvironment, CommonBuildProfile {
  workflow: Workflow.MANAGED;
  buildType?: Ios.ManagedBuildType;
  distribution?: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement: VersionAutoIncrement;
}

export interface IosGenericBuildProfile extends Ios.BuilderEnvironment, CommonBuildProfile {
  workflow: Workflow.GENERIC;
  scheme?: string;
  schemeBuildConfiguration?: Ios.SchemeBuildConfiguration | 'Auto';
  artifactPath?: string;
  distribution?: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement: VersionAutoIncrement;
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
