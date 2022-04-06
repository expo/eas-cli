import { Android, Cache, Ios, Platform } from '@expo/eas-build-job';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export type DistributionType = 'store' | 'internal';

export type IosEnterpriseProvisioning = 'adhoc' | 'universal';

export type VersionAutoIncrement = boolean | 'version';
export type IosVersionAutoIncrement = VersionAutoIncrement | 'buildNumber';
export type AndroidVersionAutoIncrement = VersionAutoIncrement | 'versionCode';
export type AppleTeamType = 'inHouse' | 'companyOrOrganization' | 'individual';

export interface CommonBuildProfile {
  credentialsSource: CredentialsSource;
  distribution: DistributionType;
  cache?: Omit<Cache, 'clear'>;
  releaseChannel?: string;
  channel?: string;
  developmentClient?: boolean;
  prebuildCommand?: string;

  node?: string;
  yarn?: string;
  expoCli?: string;
  env?: Record<string, string>;
}

export interface AndroidBuildProfile extends CommonBuildProfile {
  withoutCredentials?: boolean;
  image?: Android.BuilderEnvironment['image'];
  ndk?: string;
  autoIncrement?: AndroidVersionAutoIncrement;

  buildType?: Android.BuildType.APK | Android.BuildType.APP_BUNDLE;

  gradleCommand?: string;
  artifactPath?: string;
}

export interface IosBuildProfile extends CommonBuildProfile {
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  autoIncrement?: IosVersionAutoIncrement;
  simulator?: boolean;
  image?: Ios.BuilderEnvironment['image'];
  bundler?: string;
  fastlane?: string;
  cocoapods?: string;

  artifactPath?: string;
  scheme?: string;
  buildConfiguration?: string;

  /** File path to the App Store Connect API key. */
  ascApiKeyPath?: string;
  /** App Store Connect API issuer ID. This is a UUID v4 string (reserved variant). Example: `00x0xx00-0000-47e3-e053-0x0x0x00x0x0` */
  ascApiKeyIssuerId?: string;
  /** Opaque identifier for the App Store Connect API key. Example: `ZJZAAA11AA`*/
  ascApiKeyId?: string;
  appleTeamId?: string;
  appleTeamType?: AppleTeamType;
}

export type BuildProfile<TPlatform extends Platform = Platform> = TPlatform extends Platform.ANDROID
  ? AndroidBuildProfile
  : IosBuildProfile;

export interface EasJsonBuildProfile extends Partial<CommonBuildProfile> {
  extends?: string;
  [Platform.ANDROID]?: Partial<AndroidBuildProfile>;
  [Platform.IOS]?: Partial<IosBuildProfile>;
}
