import { Android, Cache, Ios } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export type AndroidDistributionType = 'store' | 'internal';
export type IosDistributionType = 'store' | 'internal' | 'simulator';
export type DistributionType = AndroidDistributionType | IosDistributionType;

export type IosEnterpriseProvisioning = 'adhoc' | 'universal';

export type VersionAutoIncrement = boolean | 'version' | 'buildNumber';

interface IosBuilderEnvironment extends Omit<Ios.BuilderEnvironment, 'image'> {
  image?: Ios.BuilderEnvironment['image'];
}

export interface AndroidBuildProfile extends Android.BuilderEnvironment {
  credentialsSource: CredentialsSource;
  releaseChannel?: string;
  channel?: string;
  distribution: AndroidDistributionType;
  cache: Cache;
  withoutCredentials?: boolean;

  buildType?: Android.BuildType;

  gradleCommand?: string;
  artifactPath?: string;
}

export interface IosBuildProfile extends IosBuilderEnvironment {
  credentialsSource: CredentialsSource;
  releaseChannel?: string;
  channel?: string;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement: VersionAutoIncrement;
  cache: Cache;

  artifactPath?: string;
  scheme?: string;
  schemeBuildConfiguration?: string;

  buildType?: Ios.BuildType;
}

export type BuildProfile = AndroidBuildProfile | IosBuildProfile;

// EasConfig represents eas.json with one specific profile
export interface EasConfig {
  builds: {
    android?: AndroidBuildProfile;
    ios?: IosBuildProfile;
  };
}
