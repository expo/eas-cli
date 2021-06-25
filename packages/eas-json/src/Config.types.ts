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

export interface AndroidManagedBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.MANAGED;
  credentialsSource: CredentialsSource;
  buildType?: Android.ManagedBuildType;
  releaseChannel?: string;
  channel?: string;
  distribution: AndroidDistributionType;
  cache: Cache;
}

export interface AndroidGenericBuildProfile extends Android.BuilderEnvironment {
  workflow: Workflow.GENERIC;
  credentialsSource: CredentialsSource;
  gradleCommand?: string;
  releaseChannel?: string;
  channel?: string;
  artifactPath?: string;
  withoutCredentials?: boolean;
  distribution: AndroidDistributionType;
  cache: Cache;
}

export interface IosManagedBuildProfile extends Omit<Ios.BuilderEnvironment, 'image'> {
  workflow: Workflow.MANAGED;
  credentialsSource: CredentialsSource;
  buildType?: Ios.ManagedBuildType;
  releaseChannel?: string;
  channel?: string;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement: VersionAutoIncrement;
  cache: Cache;
  image?: Ios.BuilderEnvironment['image'];
}

export interface IosGenericBuildProfile extends Omit<Ios.BuilderEnvironment, 'image'> {
  workflow: Workflow.GENERIC;
  credentialsSource: CredentialsSource;
  scheme?: string;
  schemeBuildConfiguration?: string;
  releaseChannel?: string;
  channel?: string;
  artifactPath?: string;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement: VersionAutoIncrement;
  cache: Cache;
  image?: Ios.BuilderEnvironment['image'];
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
