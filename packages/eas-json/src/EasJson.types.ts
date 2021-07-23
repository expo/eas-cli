import { Android, Cache, Ios } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export type DistributionType = 'store' | 'internal';

export type IosEnterpriseProvisioning = 'adhoc' | 'universal';

export type VersionAutoIncrement = boolean | 'version' | 'buildNumber';

export interface CommonBuildProfile {
  credentialsSource: CredentialsSource;
  distribution: DistributionType;
  cache?: Omit<Cache, 'clear'>;
  releaseChannel?: string;
  channel?: string;
  developmentClient?: boolean;

  node?: string;
  yarn?: string;
  expoCli?: string;
  env?: Record<string, string>;
}

export interface AndroidBuildProfile extends CommonBuildProfile {
  withoutCredentials?: boolean;
  image?: Android.BuilderEnvironment['image'];
  ndk?: string;

  buildType?: Android.BuildType.APK | Android.BuildType.APP_BUNDLE;

  gradleCommand?: string;
  artifactPath?: string;
}

export interface IosBuildProfile extends CommonBuildProfile {
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement?: VersionAutoIncrement;
  simulator?: boolean;
  image?: Ios.BuilderEnvironment['image'];
  bundler?: string;
  fastlane?: string;
  cocoapods?: string;

  artifactPath?: string;
  scheme?: string;
  buildConfiguration?: string;
}

export type BuildProfile = AndroidBuildProfile | IosBuildProfile;

export interface RawBuildProfile extends Partial<CommonBuildProfile> {
  extends?: string;
  android?: Partial<AndroidBuildProfile>;
  ios?: Partial<IosBuildProfile>;
}

export interface EasJson {
  build: {
    [profile: string]: RawBuildProfile;
  };
}
