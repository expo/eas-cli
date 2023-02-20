import { Android, Cache, Ios, Platform } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export enum ResourceClass {
  DEFAULT = 'default',
  LARGE = 'large',
  /**
   * @deprecated use M1_MEDIUM instead
   * @experimental
   * This resource class is not yet ready to be used in production. For testing purposes only. Might be deprecated / deleted at any time.
   */
  M1_EXPERIMENTAL = 'm1-experimental',
  M1_MEDIUM = 'm1-medium',
  M1_LARGE = 'm1-large',
  INTEL_MEDIUM = 'intel-medium',
  MEDIUM = 'medium',
}

export type DistributionType = 'store' | 'internal';

export type IosEnterpriseProvisioning = 'adhoc' | 'universal';

export type VersionAutoIncrement = boolean | 'version';
export type IosVersionAutoIncrement = VersionAutoIncrement | 'buildNumber';
export type AndroidVersionAutoIncrement = VersionAutoIncrement | 'versionCode';

export interface CommonBuildProfile {
  credentialsSource: CredentialsSource;
  distribution: DistributionType;
  cache?: Omit<Cache, 'clear'>;
  releaseChannel?: string;
  channel?: string;
  developmentClient?: boolean;
  prebuildCommand?: string;
  autoIncrement?: boolean;
  resourceClass?: ResourceClass;
  buildArtifactPaths?: string[];
  config?: string;

  node?: string;
  yarn?: string;
  expoCli?: string;
  env?: Record<string, string>;
}

export interface AndroidBuildProfile extends Omit<CommonBuildProfile, 'autoIncrement'> {
  withoutCredentials?: boolean;
  image?: Android.BuilderEnvironment['image'];
  ndk?: string;
  autoIncrement?: AndroidVersionAutoIncrement;

  buildType?: Android.BuildType.APK | Android.BuildType.APP_BUNDLE;

  gradleCommand?: string;
  /**
   * @deprecated use applicationArchivePath
   */
  artifactPath?: string;
  applicationArchivePath?: string;
}

export interface IosBuildProfile extends Omit<CommonBuildProfile, 'autoIncrement'> {
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement?: IosVersionAutoIncrement;
  simulator?: boolean;
  image?: Ios.BuilderEnvironment['image'];
  bundler?: string;
  fastlane?: string;
  cocoapods?: string;

  /**
   * @deprecated use applicationArchivePath
   */
  artifactPath?: string;
  applicationArchivePath?: string;
  scheme?: string;
  buildConfiguration?: string;
}

export type BuildProfile<TPlatform extends Platform = Platform> = TPlatform extends Platform.ANDROID
  ? AndroidBuildProfile
  : IosBuildProfile;

export interface EasJsonBuildProfile extends Partial<CommonBuildProfile> {
  extends?: string;
  [Platform.ANDROID]?: Partial<AndroidBuildProfile>;
  [Platform.IOS]?: Partial<IosBuildProfile>;
}
