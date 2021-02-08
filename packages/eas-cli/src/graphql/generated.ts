/**
 * This file was generated using GraphQL Codegen
 * Command: yarn generate-graphql-code
 * Run this during development for automatic type generation when editing GraphQL documents
 * For more info and docs, visit https://graphql-code-generator.com/
 */

export type Maybe<T> = T | null;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  /** Date custom scalar type */
  DateTime: any;
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: any;
  /** The `JSONObject` scalar type represents JSON objects as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSONObject: any;
  /** The `Upload` scalar type represents a file upload. */
  Upload: any;
};

export type RootQuery = {
  __typename?: 'RootQuery';
  /**
   * This is a placeholder field
   * @deprecated Not used.
   */
  _doNotUse?: Maybe<Scalars['String']>;
  /** Top-level query object for querying Accounts. */
  account: AccountQuery;
  /** Top-level query object for querying Actors. */
  actor: ActorQuery;
  /** Top-level query object for querying Apple Device registration requests. */
  appleDeviceRegistrationRequest: AppleDeviceRegistrationRequestQuery;
  /** Top-level query object for querying Apple Teams. */
  appleTeam: AppleTeamQuery;
  app?: Maybe<AppQuery>;
  /**
   * Look up app by app id
   * @deprecated Use 'byId' field under 'app'.
   */
  appByAppId?: Maybe<App>;
  /**
   * Public apps in the app directory
   * @deprecated Use 'all' field under 'app'.
   */
  allPublicApps?: Maybe<Array<Maybe<App>>>;
  asset: AssetQuery;
  /** Top-level query object for querying BuildPublicData publicly. */
  buildPublicData: BuildPublicDataQuery;
  buildJobs: BuildJobQuery;
  builds: BuildQuery;
  clientBuilds: ClientBuildQuery;
  project: ProjectQuery;
  /** Search for Snacks */
  search: Array<SearchResult>;
  /** @deprecated Use 'search' root field. */
  searchUsersAndApps: Array<Maybe<SearchResult>>;
  snack: SnackQuery;
  /** Top-level query object for querying UserInvitationPublicData publicly. */
  userInvitationPublicData: UserInvitationPublicDataQuery;
  /** Top-level query object for querying Users. */
  user: UserQuery;
  /** @deprecated Use 'byId' field under 'user'. */
  userByUserId?: Maybe<User>;
  /** @deprecated Use 'byUsername' field under 'user'. */
  userByUsername?: Maybe<User>;
  /**
   * If authenticated as a typical end user, this is the appropriate top-level
   * query object
   */
  me?: Maybe<User>;
  /**
   * If authenticated as a typical end user, this is the appropriate top-level
   * query object
   */
  viewer?: Maybe<User>;
  /**
   * If authenticated as a any type of Actor, this is the appropriate top-level
   * query object
   */
  meActor?: Maybe<Actor>;
};


export type RootQueryAppByAppIdArgs = {
  appId: Scalars['String'];
};


export type RootQueryAllPublicAppsArgs = {
  filter: AppsFilter;
  sort: AppSort;
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
};


export type RootQuerySearchArgs = {
  type: SearchType;
  query: Scalars['String'];
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


export type RootQuerySearchUsersAndAppsArgs = {
  type: SearchType;
  query: Scalars['String'];
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


export type RootQueryUserByUserIdArgs = {
  userId: Scalars['String'];
};


export type RootQueryUserByUsernameArgs = {
  username: Scalars['String'];
};

export type AccountQuery = {
  __typename?: 'AccountQuery';
  /** Query an Account by ID */
  byId: Account;
  /** Query an Account by name */
  byName: Account;
};


export type AccountQueryByIdArgs = {
  accountId: Scalars['String'];
};


export type AccountQueryByNameArgs = {
  accountName: Scalars['String'];
};

/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type Account = {
  __typename?: 'Account';
  id: Scalars['ID'];
  name: Scalars['String'];
  isCurrent?: Maybe<Scalars['Boolean']>;
  /** @deprecated Build packs are no longer supported */
  availableBuilds?: Maybe<Scalars['Int']>;
  unlimitedBuilds?: Maybe<Scalars['Boolean']>;
  /** @deprecated No longer needed */
  subscriptionChangesPending?: Maybe<Scalars['Boolean']>;
  /** @deprecated Build packs are no longer supported */
  willAutoRenewBuilds?: Maybe<Scalars['Boolean']>;
  pushSecurityEnabled?: Maybe<Scalars['Boolean']>;
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
  /** short lived property for test */
  offers?: Maybe<Array<Maybe<Offer>>>;
  /** Snacks associated with this account */
  snacks: Array<Snack>;
  /** Apps associated with this account */
  apps: Array<App>;
  /** Build Jobs associated with this account */
  buildJobs: Array<BuildJob>;
  /** (EAS Build) Builds associated with this account */
  builds: Array<Build>;
  /** Owning User of this account if personal account */
  owner?: Maybe<User>;
  /** Actors associated with this account and permissions they hold */
  users: Array<UserPermission>;
  /** Pending user invitations for this account */
  userInvitations: Array<UserInvitation>;
  /** Billing information */
  billing?: Maybe<Billing>;
  /**
   * Api tokens made for project
   * @deprecated Legacy access tokens are deprecated
   */
  accessTokens: Array<Maybe<AccessToken>>;
  /** @deprecated Legacy access tokens are deprecated */
  requiresAccessTokenForPushSecurity: Scalars['Boolean'];
  /** iOS credentials for account */
  appleTeams: Array<AppleTeam>;
  appleAppIdentifiers: Array<AppleAppIdentifier>;
  appleDistributionCertificates: Array<AppleDistributionCertificate>;
  applePushKeys: Array<ApplePushKey>;
  appleProvisioningProfiles: Array<AppleProvisioningProfile>;
  appleDevices: Array<AppleDevice>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountSnacksArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppsArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountBuildJobsArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
  status?: Maybe<BuildJobStatus>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountBuildsArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
  status?: Maybe<BuildStatus>;
  platform?: Maybe<AppPlatform>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleTeamsArgs = {
  appleTeamIdentifier?: Maybe<Scalars['String']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleAppIdentifiersArgs = {
  bundleIdentifier?: Maybe<Scalars['String']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleProvisioningProfilesArgs = {
  appleAppIdentifierId?: Maybe<Scalars['ID']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleDevicesArgs = {
  identifier?: Maybe<Scalars['String']>;
};


export type Offer = {
  __typename?: 'Offer';
  id: Scalars['ID'];
  price: Scalars['Int'];
  quantity?: Maybe<Scalars['Int']>;
  trialLength?: Maybe<Scalars['Int']>;
  type: OfferType;
  features?: Maybe<Array<Maybe<Feature>>>;
};

export enum OfferType {
  /** Term subscription */
  Subscription = 'SUBSCRIPTION',
  /** Advanced Purchase of Paid Resource */
  Prepaid = 'PREPAID'
}

export enum Feature {
  /** Top Tier Support */
  Support = 'SUPPORT',
  /** Share access to projects */
  Teams = 'TEAMS',
  /** Priority Builds */
  Builds = 'BUILDS',
  /** Funds support for open source development */
  OpenSource = 'OPEN_SOURCE'
}

export type Snack = Project & {
  __typename?: 'Snack';
  id: Scalars['ID'];
  hashId: Scalars['String'];
  /** Name of the Snack, e.g. "My Snack" */
  name: Scalars['String'];
  /** Full name of the Snack, e.g. "@john/mysnack", "@snack/245631" */
  fullName: Scalars['String'];
  /** Description of the Snack */
  description: Scalars['String'];
  /** @deprecated Field no longer supported */
  iconUrl?: Maybe<Scalars['String']>;
  /** Slug name, e.g. "mysnack", "245631" */
  slug: Scalars['String'];
  /** Name of the user that created the Snack, or "snack" when the Snack was saved anonymously */
  username: Scalars['String'];
  /** Date and time the Snack was last updated */
  updated: Scalars['DateTime'];
  published: Scalars['Boolean'];
  /** Draft status, which is true when the Snack was not saved explicitly, but auto-saved */
  isDraft: Scalars['Boolean'];
};

export type Project = {
  id: Scalars['ID'];
  name: Scalars['String'];
  fullName: Scalars['String'];
  description: Scalars['String'];
  /** @deprecated Field no longer supported */
  iconUrl?: Maybe<Scalars['String']>;
  slug: Scalars['String'];
  username: Scalars['String'];
  updated: Scalars['DateTime'];
  published: Scalars['Boolean'];
};

/** Represents an Exponent App (or Experience in legacy terms) */
export type App = Project & {
  __typename?: 'App';
  id: Scalars['ID'];
  name: Scalars['String'];
  fullName: Scalars['String'];
  description: Scalars['String'];
  githubUrl?: Maybe<Scalars['String']>;
  playStoreUrl?: Maybe<Scalars['String']>;
  appStoreUrl?: Maybe<Scalars['String']>;
  /** @deprecated Field no longer supported */
  iconUrl?: Maybe<Scalars['String']>;
  icon?: Maybe<AppIcon>;
  slug: Scalars['String'];
  sdkVersion: Scalars['String'];
  isDeprecated?: Maybe<Scalars['Boolean']>;
  username: Scalars['String'];
  updated: Scalars['DateTime'];
  pushSecurityEnabled?: Maybe<Scalars['Boolean']>;
  privacy: Scalars['String'];
  latestReleaseId: Scalars['ID'];
  /** @deprecated 'likes' have been deprecated. */
  isLikedByMe: Scalars['Boolean'];
  published: Scalars['Boolean'];
  /** @deprecated 'likes' have been deprecated. */
  likeCount: Scalars['Int'];
  /** @deprecated 'likes' have been deprecated. */
  trendScore: Scalars['Float'];
  /** @deprecated 'likes' have been deprecated. */
  likedBy: Array<Maybe<User>>;
  /** @deprecated Field no longer supported */
  releases: Array<Maybe<AppRelease>>;
  builds: Array<Build>;
  buildJobs: Array<BuildJob>;
  /** @deprecated Field no longer supported */
  users?: Maybe<Array<Maybe<User>>>;
  /** @deprecated Field no longer supported */
  lastPublishedTime: Scalars['DateTime'];
  /** @deprecated Field no longer supported */
  packageUsername: Scalars['String'];
  /** @deprecated Field no longer supported */
  packageName: Scalars['String'];
  /**
   * Api tokens made for project
   * @deprecated Legacy access tokens are deprecated
   */
  accessTokens: Array<Maybe<AccessToken>>;
  /** @deprecated Legacy access tokens are deprecated */
  requiresAccessTokenForPushSecurity: Scalars['Boolean'];
  /** iOS app credentials for the project */
  iosAppCredentials: Array<IosAppCredentials>;
  /** Android app credentials for the project */
  androidAppCredentials: Array<AndroidAppCredentials>;
  /** EAS channels owned by an app */
  updateChannels: Array<UpdateChannel>;
  /** get an EAS channel owned by the app by channelName */
  updateChannelByChannelName: UpdateChannel;
  /** EAS releases owned by an app */
  updateReleases: Array<UpdateRelease>;
  /** get an EAS release owned by the app by releaseName */
  updateReleaseByReleaseName: UpdateRelease;
  /** Coalesced project activity for an app. Use "createdBefore" to offset a query. */
  activityTimelineProjectActivities: Array<ActivityTimelineProjectActivity>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppLikedByArgs = {
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppReleasesArgs = {
  platform: AppPlatform;
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppBuildsArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
  status?: Maybe<BuildStatus>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppBuildJobsArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
  status?: Maybe<BuildStatus>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppIosAppCredentialsArgs = {
  filter?: Maybe<IosAppCredentialsFilter>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppAndroidAppCredentialsArgs = {
  filter?: Maybe<AndroidAppCredentialsFilter>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateChannelsArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateChannelByChannelNameArgs = {
  channelName: Scalars['String'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateReleasesArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateReleaseByReleaseNameArgs = {
  releaseName: Scalars['String'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppActivityTimelineProjectActivitiesArgs = {
  limit: Scalars['Int'];
  createdBefore?: Maybe<Scalars['DateTime']>;
};

export type AppIcon = {
  __typename?: 'AppIcon';
  url: Scalars['String'];
  primaryColor?: Maybe<Scalars['String']>;
  originalUrl: Scalars['String'];
  /** Nullable color palette of the app icon. If null, color palette couldn't be retrieved from external service (imgix) */
  colorPalette?: Maybe<Scalars['JSON']>;
};


/** Represents a human (not robot) actor. */
export type User = Actor & {
  __typename?: 'User';
  id: Scalars['ID'];
  username: Scalars['String'];
  email?: Maybe<Scalars['String']>;
  firstName?: Maybe<Scalars['String']>;
  lastName?: Maybe<Scalars['String']>;
  fullName?: Maybe<Scalars['String']>;
  profilePhoto?: Maybe<Scalars['String']>;
  created?: Maybe<Scalars['DateTime']>;
  lastLogin?: Maybe<Scalars['DateTime']>;
  lastPasswordReset?: Maybe<Scalars['DateTime']>;
  industry?: Maybe<Scalars['String']>;
  location?: Maybe<Scalars['String']>;
  appCount?: Maybe<Scalars['Int']>;
  githubUsername?: Maybe<Scalars['String']>;
  twitterUsername?: Maybe<Scalars['String']>;
  appetizeCode?: Maybe<Scalars['String']>;
  emailVerified?: Maybe<Scalars['Boolean']>;
  isOnboarded?: Maybe<Scalars['Boolean']>;
  isLegacy?: Maybe<Scalars['Boolean']>;
  wasLegacy?: Maybe<Scalars['Boolean']>;
  isEmailUnsubscribed?: Maybe<Scalars['Boolean']>;
  isExpoAdmin?: Maybe<Scalars['Boolean']>;
  isSecondFactorAuthenticationEnabled: Scalars['Boolean'];
  /** Get all certified second factor authentication methods */
  secondFactorDevices: Array<UserSecondFactorDevice>;
  /** Associated accounts */
  accounts: Array<Account>;
  /** Access Tokens belonging to this actor */
  accessTokens: Array<AccessToken>;
  /** Snacks associated with this account */
  snacks: Array<Snack>;
  /** Apps this user has published */
  apps: Array<App>;
  /**
   * Likes this user has made
   * @deprecated 'likes' have been deprecated.
   */
  likes?: Maybe<Array<Maybe<App>>>;
  /** Whether this user has any pending user invitations. Only resolves for the viewer. */
  hasPendingUserInvitations: Scalars['Boolean'];
  /** Pending UserInvitations for this user. Only resolves for the viewer. */
  pendingUserInvitations: Array<UserInvitation>;
  /**
   * Server feature gate values for this actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject'];
};


/** Represents a human (not robot) actor. */
export type UserSnacksArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


/** Represents a human (not robot) actor. */
export type UserAppsArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


/** Represents a human (not robot) actor. */
export type UserLikesArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};


/** Represents a human (not robot) actor. */
export type UserFeatureGatesArgs = {
  filter?: Maybe<Array<Scalars['String']>>;
};

/** A user or robot that can authenticate with Expo services and be a member of accounts. */
export type Actor = {
  id: Scalars['ID'];
  firstName?: Maybe<Scalars['String']>;
  created?: Maybe<Scalars['DateTime']>;
  isExpoAdmin?: Maybe<Scalars['Boolean']>;
  /** Associated accounts */
  accounts: Array<Account>;
  /** Access Tokens belonging to this actor */
  accessTokens: Array<AccessToken>;
  /**
   * Server feature gate values for this actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject'];
};


/** A user or robot that can authenticate with Expo services and be a member of accounts. */
export type ActorFeatureGatesArgs = {
  filter?: Maybe<Array<Scalars['String']>>;
};

/** A method of authentication for an Actor */
export type AccessToken = {
  __typename?: 'AccessToken';
  id: Scalars['ID'];
  visibleTokenPrefix: Scalars['String'];
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
  revokedAt?: Maybe<Scalars['DateTime']>;
  lastUsedAt?: Maybe<Scalars['DateTime']>;
  owner: Actor;
  note?: Maybe<Scalars['String']>;
};


/** A second factor device belonging to a User */
export type UserSecondFactorDevice = {
  __typename?: 'UserSecondFactorDevice';
  id: Scalars['ID'];
  user: User;
  name: Scalars['String'];
  isCertified: Scalars['Boolean'];
  isPrimary: Scalars['Boolean'];
  smsPhoneNumber?: Maybe<Scalars['String']>;
  method: SecondFactorMethod;
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
};

export enum SecondFactorMethod {
  /** Google Authenticator (TOTP) */
  Authenticator = 'AUTHENTICATOR',
  /** SMS */
  Sms = 'SMS'
}

/** An pending invitation sent to an email granting membership on an Account. */
export type UserInvitation = {
  __typename?: 'UserInvitation';
  id: Scalars['ID'];
  /** Email to which this invitation was sent */
  email: Scalars['String'];
  created: Scalars['DateTime'];
  accountName: Scalars['String'];
  /** Account permissions to be granted upon acceptance of this invitation */
  permissions: Array<Permission>;
  /** Role to be granted upon acceptance of this invitation */
  role: Role;
};

export enum Permission {
  Own = 'OWN',
  Admin = 'ADMIN',
  Publish = 'PUBLISH',
  View = 'VIEW'
}

export enum Role {
  Owner = 'OWNER',
  Admin = 'ADMIN',
  Developer = 'DEVELOPER',
  ViewOnly = 'VIEW_ONLY',
  Custom = 'CUSTOM',
  HasAdmin = 'HAS_ADMIN',
  NotAdmin = 'NOT_ADMIN'
}

export enum AppPlatform {
  Ios = 'IOS',
  Android = 'ANDROID'
}

export type AppRelease = {
  __typename?: 'AppRelease';
  id: Scalars['ID'];
  hash?: Maybe<Scalars['String']>;
  publishedTime?: Maybe<Scalars['DateTime']>;
  publishingUsername?: Maybe<Scalars['String']>;
  sdkVersion?: Maybe<Scalars['String']>;
  version?: Maybe<Scalars['String']>;
  s3Key?: Maybe<Scalars['String']>;
  s3Url?: Maybe<Scalars['String']>;
  manifest?: Maybe<Scalars['JSON']>;
};

export enum BuildStatus {
  InQueue = 'IN_QUEUE',
  InProgress = 'IN_PROGRESS',
  Errored = 'ERRORED',
  Finished = 'FINISHED',
  Canceled = 'CANCELED'
}

/** Represents an EAS Build */
export type Build = ActivityTimelineProjectActivity & {
  __typename?: 'Build';
  id: Scalars['ID'];
  actor?: Maybe<Actor>;
  activityTimestamp: Scalars['DateTime'];
  project: Project;
  /** @deprecated User type is deprecated */
  initiatingUser?: Maybe<User>;
  initiatingActor?: Maybe<Actor>;
  artifacts?: Maybe<BuildArtifacts>;
  logFiles: Array<Scalars['String']>;
  updatedAt?: Maybe<Scalars['DateTime']>;
  createdAt?: Maybe<Scalars['DateTime']>;
  status: BuildStatus;
  expirationDate?: Maybe<Scalars['DateTime']>;
  platform: AppPlatform;
  appVersion?: Maybe<Scalars['String']>;
  sdkVersion?: Maybe<Scalars['String']>;
  releaseChannel?: Maybe<Scalars['String']>;
  metrics?: Maybe<BuildMetrics>;
  distribution?: Maybe<DistributionType>;
};

export type ActivityTimelineProjectActivity = {
  id: Scalars['ID'];
  actor?: Maybe<Actor>;
  activityTimestamp: Scalars['DateTime'];
};

export type BuildArtifacts = {
  __typename?: 'BuildArtifacts';
  buildUrl?: Maybe<Scalars['String']>;
  xcodeBuildLogsUrl?: Maybe<Scalars['String']>;
};

export type BuildMetrics = {
  __typename?: 'BuildMetrics';
  buildQueueTime?: Maybe<Scalars['Int']>;
  buildDuration?: Maybe<Scalars['Int']>;
};

export enum DistributionType {
  Store = 'STORE',
  Internal = 'INTERNAL'
}

/** Represents an Standalone App build job */
export type BuildJob = ActivityTimelineProjectActivity & {
  __typename?: 'BuildJob';
  id: Scalars['ID'];
  actor?: Maybe<Actor>;
  activityTimestamp: Scalars['DateTime'];
  app?: Maybe<App>;
  user?: Maybe<User>;
  release?: Maybe<AppRelease>;
  config?: Maybe<Scalars['JSON']>;
  artifacts?: Maybe<BuildArtifact>;
  logs?: Maybe<BuildLogs>;
  created?: Maybe<Scalars['DateTime']>;
  updated?: Maybe<Scalars['DateTime']>;
  fullExperienceName?: Maybe<Scalars['String']>;
  status?: Maybe<BuildJobStatus>;
  expirationDate?: Maybe<Scalars['DateTime']>;
  platform: AppPlatform;
  sdkVersion?: Maybe<Scalars['String']>;
  releaseChannel?: Maybe<Scalars['String']>;
};

export type BuildArtifact = {
  __typename?: 'BuildArtifact';
  url: Scalars['String'];
  manifestPlistUrl?: Maybe<Scalars['String']>;
};

export type BuildLogs = {
  __typename?: 'BuildLogs';
  url?: Maybe<Scalars['String']>;
  format?: Maybe<BuildJobLogsFormat>;
};

export enum BuildJobLogsFormat {
  Raw = 'RAW',
  Json = 'JSON'
}

export enum BuildJobStatus {
  Pending = 'PENDING',
  Started = 'STARTED',
  InProgress = 'IN_PROGRESS',
  Errored = 'ERRORED',
  Finished = 'FINISHED',
  SentToQueue = 'SENT_TO_QUEUE'
}

export type IosAppCredentialsFilter = {
  appleAppIdentifierId?: Maybe<Scalars['String']>;
};

export type IosAppCredentials = {
  __typename?: 'IosAppCredentials';
  id: Scalars['ID'];
  app: App;
  appleTeam?: Maybe<AppleTeam>;
  appleAppIdentifier: AppleAppIdentifier;
  iosAppBuildCredentialsList: Array<IosAppBuildCredentials>;
  pushKey?: Maybe<ApplePushKey>;
  /** @deprecated use iosAppBuildCredentialsList instead */
  iosAppBuildCredentialsArray: Array<IosAppBuildCredentials>;
};


export type IosAppCredentialsIosAppBuildCredentialsListArgs = {
  filter?: Maybe<IosAppBuildCredentialsFilter>;
};


export type IosAppCredentialsIosAppBuildCredentialsArrayArgs = {
  filter?: Maybe<IosAppBuildCredentialsFilter>;
};

export type AppleTeam = {
  __typename?: 'AppleTeam';
  id: Scalars['ID'];
  account: Account;
  appleTeamIdentifier: Scalars['String'];
  appleTeamName?: Maybe<Scalars['String']>;
  appleAppIdentifiers: Array<AppleAppIdentifier>;
  appleDistributionCertificates: Array<AppleDistributionCertificate>;
  applePushKeys: Array<ApplePushKey>;
  appleProvisioningProfiles: Array<AppleProvisioningProfile>;
  appleDevices: Array<AppleDevice>;
};


export type AppleTeamAppleAppIdentifiersArgs = {
  bundleIdentifier?: Maybe<Scalars['String']>;
};


export type AppleTeamAppleProvisioningProfilesArgs = {
  appleAppIdentifierId?: Maybe<Scalars['ID']>;
};

export type AppleAppIdentifier = {
  __typename?: 'AppleAppIdentifier';
  id: Scalars['ID'];
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  bundleIdentifier: Scalars['String'];
};

export type AppleDistributionCertificate = {
  __typename?: 'AppleDistributionCertificate';
  id: Scalars['ID'];
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  serialNumber: Scalars['String'];
  validityNotBefore: Scalars['DateTime'];
  validityNotAfter: Scalars['DateTime'];
  developerPortalIdentifier?: Maybe<Scalars['String']>;
  certificateP12?: Maybe<Scalars['String']>;
  certificatePassword?: Maybe<Scalars['String']>;
  certificatePrivateSigningKey?: Maybe<Scalars['String']>;
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
  iosAppBuildCredentialsList: Array<IosAppBuildCredentials>;
};

export type IosAppBuildCredentials = {
  __typename?: 'IosAppBuildCredentials';
  id: Scalars['ID'];
  distributionCertificate?: Maybe<AppleDistributionCertificate>;
  provisioningProfile?: Maybe<AppleProvisioningProfile>;
  iosDistributionType: IosDistributionType;
  iosAppCredentials: IosAppCredentials;
  /** @deprecated Get Apple Devices from AppleProvisioningProfile instead */
  appleDevices?: Maybe<Array<Maybe<AppleDevice>>>;
};

export type AppleProvisioningProfile = {
  __typename?: 'AppleProvisioningProfile';
  id: Scalars['ID'];
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  expiration: Scalars['DateTime'];
  appleAppIdentifier: AppleAppIdentifier;
  developerPortalIdentifier?: Maybe<Scalars['String']>;
  provisioningProfile?: Maybe<Scalars['String']>;
  appleUUID: Scalars['String'];
  status: Scalars['String'];
  appleDevices: Array<AppleDevice>;
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
};

export type AppleDevice = {
  __typename?: 'AppleDevice';
  id: Scalars['ID'];
  account: Account;
  appleTeam: AppleTeam;
  identifier: Scalars['String'];
  name?: Maybe<Scalars['String']>;
  model?: Maybe<Scalars['String']>;
  deviceClass?: Maybe<AppleDeviceClass>;
  softwareVersion?: Maybe<Scalars['String']>;
  enabled?: Maybe<Scalars['Boolean']>;
};

export enum AppleDeviceClass {
  Ipad = 'IPAD',
  Iphone = 'IPHONE'
}

export enum IosDistributionType {
  AppStore = 'APP_STORE',
  Enterprise = 'ENTERPRISE',
  AdHoc = 'AD_HOC',
  Development = 'DEVELOPMENT'
}

export type ApplePushKey = {
  __typename?: 'ApplePushKey';
  id: Scalars['ID'];
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  keyIdentifier: Scalars['String'];
  keyP8: Scalars['String'];
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
};

export type IosAppBuildCredentialsFilter = {
  iosDistributionType?: Maybe<IosDistributionType>;
};

export type AndroidAppCredentialsFilter = {
  legacyOnly?: Maybe<Scalars['Boolean']>;
  applicationIdentifier?: Maybe<Scalars['String']>;
};

export type AndroidAppCredentials = {
  __typename?: 'AndroidAppCredentials';
  id: Scalars['ID'];
  app: App;
  applicationIdentifier?: Maybe<Scalars['String']>;
  androidFcm?: Maybe<AndroidFcm>;
  androidAppBuildCredentialsList: Array<AndroidAppBuildCredentials>;
  isLegacy: Scalars['Boolean'];
  /** @deprecated use androidAppBuildCredentialsList instead */
  androidAppBuildCredentialsArray: Array<AndroidAppBuildCredentials>;
};

export type AndroidFcm = {
  __typename?: 'AndroidFcm';
  id: Scalars['ID'];
  account: Account;
  snippet: FcmSnippet;
  /**
   * Legacy FCM: returns the Cloud Messaging token, parses to a String
   * FCM v1: returns the Service Account Key file, parses to an Object
   */
  credential: Scalars['JSON'];
  version: AndroidFcmVersion;
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
};

export type FcmSnippet = FcmSnippetLegacy | FcmSnippetV1;

export type FcmSnippetLegacy = {
  __typename?: 'FcmSnippetLegacy';
  firstFourCharacters: Scalars['String'];
  lastFourCharacters: Scalars['String'];
};

export type FcmSnippetV1 = {
  __typename?: 'FcmSnippetV1';
  projectId: Scalars['String'];
  keyId: Scalars['String'];
  serviceAccountEmail: Scalars['String'];
  clientId?: Maybe<Scalars['String']>;
};

export enum AndroidFcmVersion {
  Legacy = 'LEGACY',
  V1 = 'V1'
}

export type AndroidAppBuildCredentials = {
  __typename?: 'AndroidAppBuildCredentials';
  id: Scalars['ID'];
  name?: Maybe<Scalars['String']>;
  androidKeystore?: Maybe<AndroidKeystore>;
  isDefault: Scalars['Boolean'];
  isLegacy: Scalars['Boolean'];
};

export type AndroidKeystore = {
  __typename?: 'AndroidKeystore';
  id: Scalars['ID'];
  account: Account;
  type: AndroidKeystoreType;
  keystore: Scalars['String'];
  keystorePassword: Scalars['String'];
  keyAlias: Scalars['String'];
  keyPassword?: Maybe<Scalars['String']>;
  md5CertificateFingerprint?: Maybe<Scalars['String']>;
  sha1CertificateFingerprint?: Maybe<Scalars['String']>;
  sha256CertificateFingerprint?: Maybe<Scalars['String']>;
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
};

export enum AndroidKeystoreType {
  Jks = 'JKS',
  Pkcs12 = 'PKCS12',
  Unknown = 'UNKNOWN'
}

export type UpdateChannel = {
  __typename?: 'UpdateChannel';
  id: Scalars['ID'];
  appId: Scalars['ID'];
  channelName: Scalars['String'];
  releaseMapping: Scalars['String'];
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
  updateReleases: Array<UpdateRelease>;
};


export type UpdateChannelUpdateReleasesArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};

export type UpdateRelease = {
  __typename?: 'UpdateRelease';
  id: Scalars['ID'];
  appId: Scalars['ID'];
  releaseName: Scalars['String'];
  createdAt: Scalars['DateTime'];
  updatedAt: Scalars['DateTime'];
  updates: Array<Update>;
};


export type UpdateReleaseUpdatesArgs = {
  offset: Scalars['Int'];
  limit: Scalars['Int'];
};

export type Update = ActivityTimelineProjectActivity & {
  __typename?: 'Update';
  id: Scalars['ID'];
  actor?: Maybe<Actor>;
  activityTimestamp: Scalars['DateTime'];
  releaseId: Scalars['ID'];
  platform: Scalars['String'];
  manifestFragment: Scalars['String'];
  runtimeVersion: Scalars['String'];
  updateGroup: Scalars['String'];
  updatedAt: Scalars['DateTime'];
  createdAt: Scalars['DateTime'];
  updateMessage?: Maybe<Scalars['String']>;
  releaseName: Scalars['String'];
};

export type UserPermission = {
  __typename?: 'UserPermission';
  permissions: Array<Permission>;
  role?: Maybe<Role>;
  /** @deprecated User type is deprecated */
  user?: Maybe<User>;
  actor: Actor;
};

export type Billing = {
  __typename?: 'Billing';
  payment?: Maybe<PaymentDetails>;
  subscription?: Maybe<SubscriptionDetails>;
  /** History of invoices */
  charges?: Maybe<Array<Maybe<Charge>>>;
};

export type PaymentDetails = {
  __typename?: 'PaymentDetails';
  id: Scalars['ID'];
  card?: Maybe<Card>;
  address?: Maybe<Address>;
};

export type Card = {
  __typename?: 'Card';
  cardHolder?: Maybe<Scalars['String']>;
  brand?: Maybe<Scalars['String']>;
  last4?: Maybe<Scalars['String']>;
  expYear?: Maybe<Scalars['Int']>;
  expMonth?: Maybe<Scalars['Int']>;
};

export type Address = {
  __typename?: 'Address';
  line1?: Maybe<Scalars['String']>;
  city?: Maybe<Scalars['String']>;
  state?: Maybe<Scalars['String']>;
  zip?: Maybe<Scalars['String']>;
  country?: Maybe<Scalars['String']>;
};

export type SubscriptionDetails = {
  __typename?: 'SubscriptionDetails';
  id: Scalars['ID'];
  name?: Maybe<Scalars['String']>;
  nextInvoice?: Maybe<Scalars['DateTime']>;
  cancelledAt?: Maybe<Scalars['DateTime']>;
  willCancel?: Maybe<Scalars['Boolean']>;
  endedAt?: Maybe<Scalars['DateTime']>;
  trialEnd?: Maybe<Scalars['DateTime']>;
  status?: Maybe<Scalars['String']>;
};

export type Charge = {
  __typename?: 'Charge';
  id: Scalars['ID'];
  paid?: Maybe<Scalars['Boolean']>;
  invoiceId?: Maybe<Scalars['String']>;
  createdAt?: Maybe<Scalars['DateTime']>;
  amount?: Maybe<Scalars['Int']>;
  wasRefunded?: Maybe<Scalars['Boolean']>;
  receiptUrl?: Maybe<Scalars['String']>;
};

export type ActorQuery = {
  __typename?: 'ActorQuery';
  /** Query an Actor by ID */
  byId: Actor;
};


export type ActorQueryByIdArgs = {
  id: Scalars['ID'];
};

export type AppleDeviceRegistrationRequestQuery = {
  __typename?: 'AppleDeviceRegistrationRequestQuery';
  byId: AppleDeviceRegistrationRequest;
};


export type AppleDeviceRegistrationRequestQueryByIdArgs = {
  id: Scalars['ID'];
};

export type AppleDeviceRegistrationRequest = {
  __typename?: 'AppleDeviceRegistrationRequest';
  id: Scalars['ID'];
  account: Account;
  appleTeam: AppleTeam;
};

export type AppleTeamQuery = {
  __typename?: 'AppleTeamQuery';
  byAppleTeamIdentifier?: Maybe<AppleTeam>;
};


export type AppleTeamQueryByAppleTeamIdentifierArgs = {
  accountId: Scalars['ID'];
  identifier: Scalars['String'];
};

export type AppQuery = {
  __typename?: 'AppQuery';
  /** Look up app by app id */
  byId: App;
  byFullName: App;
  /** Public apps in the app directory */
  all: Array<App>;
};


export type AppQueryByIdArgs = {
  appId: Scalars['String'];
};


export type AppQueryByFullNameArgs = {
  fullName: Scalars['String'];
};


export type AppQueryAllArgs = {
  filter: AppsFilter;
  sort: AppSort;
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
};

export enum AppsFilter {
  /** Featured Projects */
  Featured = 'FEATURED',
  /** New Projects */
  New = 'NEW'
}

export enum AppSort {
  /** Sort by recently published */
  RecentlyPublished = 'RECENTLY_PUBLISHED',
  /** Sort by highest trendScore */
  Viewed = 'VIEWED'
}

/** Check to see if assets with given storageKeys exist */
export type AssetQuery = {
  __typename?: 'AssetQuery';
  metadata: Array<AssetMetadataResult>;
};


/** Check to see if assets with given storageKeys exist */
export type AssetQueryMetadataArgs = {
  storageKeys: Array<Scalars['String']>;
};

export type AssetMetadataResult = {
  __typename?: 'AssetMetadataResult';
  status: AssetMetadataStatus;
  storageKey: Scalars['String'];
};

export enum AssetMetadataStatus {
  Exists = 'EXISTS',
  DoesNotExist = 'DOES_NOT_EXIST'
}

export type BuildPublicDataQuery = {
  __typename?: 'BuildPublicDataQuery';
  /** Get BuildPublicData by ID */
  byId?: Maybe<BuildPublicData>;
};


export type BuildPublicDataQueryByIdArgs = {
  id: Scalars['ID'];
};

/** Publicly visible data for a Build. */
export type BuildPublicData = {
  __typename?: 'BuildPublicData';
  id: Scalars['ID'];
  status: BuildStatus;
  artifacts: PublicArtifacts;
  project: ProjectPublicData;
  platform: AppPlatform;
  distribution?: Maybe<DistributionType>;
};

export type PublicArtifacts = {
  __typename?: 'PublicArtifacts';
  buildUrl?: Maybe<Scalars['String']>;
};

export type ProjectPublicData = {
  __typename?: 'ProjectPublicData';
  id: Scalars['ID'];
  fullName: Scalars['String'];
};

export type BuildJobQuery = {
  __typename?: 'BuildJobQuery';
  /**
   * get all build jobs by an optional filter
   * @deprecated Prefer Account.buildJobs or App.buildJobs
   */
  all: Array<Maybe<BuildJob>>;
  byId: BuildJob;
};


export type BuildJobQueryAllArgs = {
  status?: Maybe<BuildJobStatus>;
  username?: Maybe<Scalars['String']>;
  experienceSlug?: Maybe<Scalars['String']>;
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
  showAdminView?: Maybe<Scalars['Boolean']>;
};


export type BuildJobQueryByIdArgs = {
  buildId: Scalars['ID'];
};

export type BuildQuery = {
  __typename?: 'BuildQuery';
  /** Look up EAS Build by build ID */
  byId: Build;
  /**
   * Get all builds for a specific app.
   * They are sorted from latest to oldest.
   */
  allForApp: Array<Maybe<Build>>;
};


export type BuildQueryByIdArgs = {
  buildId: Scalars['ID'];
};


export type BuildQueryAllForAppArgs = {
  appId: Scalars['String'];
  status?: Maybe<BuildStatus>;
  platform?: Maybe<AppPlatform>;
  offset?: Maybe<Scalars['Int']>;
  limit?: Maybe<Scalars['Int']>;
};

export type ClientBuildQuery = {
  __typename?: 'ClientBuildQuery';
  byId: ClientBuild;
};


export type ClientBuildQueryByIdArgs = {
  requestId: Scalars['ID'];
};

/** Represents a client build request */
export type ClientBuild = {
  __typename?: 'ClientBuild';
  id: Scalars['ID'];
  status?: Maybe<Scalars['String']>;
  userFacingErrorMessage?: Maybe<Scalars['String']>;
  buildJobId?: Maybe<Scalars['String']>;
  manifestPlistUrl?: Maybe<Scalars['String']>;
  userId?: Maybe<Scalars['String']>;
};

export type ProjectQuery = {
  __typename?: 'ProjectQuery';
  byUsernameAndSlug: Project;
  byPaths: Array<Maybe<Project>>;
};


export type ProjectQueryByUsernameAndSlugArgs = {
  username: Scalars['String'];
  slug: Scalars['String'];
  platform?: Maybe<Scalars['String']>;
  sdkVersions?: Maybe<Array<Maybe<Scalars['String']>>>;
};


export type ProjectQueryByPathsArgs = {
  paths?: Maybe<Array<Maybe<Scalars['String']>>>;
};

export enum SearchType {
  All = 'ALL',
  Users = 'USERS',
  Apps = 'APPS',
  Snacks = 'SNACKS'
}

/** Represents a search result for an app */
export type SearchResult = {
  id: Scalars['ID'];
  rank?: Maybe<Scalars['Int']>;
};

export type SnackQuery = {
  __typename?: 'SnackQuery';
  /**
   * Get snack by hashId
   * @deprecated Use byHashId
   */
  byId: Snack;
  /** Get snack by hashId */
  byHashId: Snack;
};


export type SnackQueryByIdArgs = {
  id: Scalars['ID'];
};


export type SnackQueryByHashIdArgs = {
  hashId: Scalars['ID'];
};

export type UserInvitationPublicDataQuery = {
  __typename?: 'UserInvitationPublicDataQuery';
  /** Get UserInvitationPublicData by token */
  byToken: UserInvitationPublicData;
};


export type UserInvitationPublicDataQueryByTokenArgs = {
  token: Scalars['ID'];
};

/** Publicly visible data for a UserInvitation. */
export type UserInvitationPublicData = {
  __typename?: 'UserInvitationPublicData';
  /** Email to which this invitation was sent */
  id: Scalars['ID'];
  email: Scalars['String'];
  created: Scalars['DateTime'];
  accountName: Scalars['String'];
};

export type UserQuery = {
  __typename?: 'UserQuery';
  /** Query a User by ID */
  byId: User;
  /** Query a User by username */
  byUsername: User;
};


export type UserQueryByIdArgs = {
  userId: Scalars['String'];
};


export type UserQueryByUsernameArgs = {
  username: Scalars['String'];
};

export type RootMutation = {
  __typename?: 'RootMutation';
  /**
   * This is a placeholder field
   * @deprecated Not used.
   */
  _doNotUse?: Maybe<Scalars['String']>;
  /** Mutations that create, read, update, and delete AccessTokens for Actors */
  accessToken: AccessTokenMutation;
  /** Mutations that modify an Account */
  account?: Maybe<AccountMutation>;
  /** Mutations that modify the build credentials for an Android app */
  androidAppBuildCredentials: AndroidAppBuildCredentialsMutation;
  /** Mutations that modify the credentials for an Android app */
  androidAppCredentials: AndroidAppCredentialsMutation;
  /** Mutations that modify an FCM credential */
  androidFcm: AndroidFcmMutation;
  /** Mutations that modify a Keystore */
  androidKeystore: AndroidKeystoreMutation;
  /** Mutations that modify an Identifier for an iOS App */
  appleAppIdentifier: AppleAppIdentifierMutation;
  /** Mutations that modify an Apple Device */
  appleDevice: AppleDeviceMutation;
  /** Mutations that modify an Apple Device registration request */
  appleDeviceRegistrationRequest: AppleDeviceRegistrationRequestMutation;
  /** Mutations that modify a Distribution Certificate */
  appleDistributionCertificate: AppleDistributionCertificateMutation;
  /** Mutations that modify a Provisioning Profile */
  appleProvisioningProfile: AppleProvisioningProfileMutation;
  /** Mutations that modify an Apple Push Notification key */
  applePushKey: ApplePushKeyMutation;
  /** Mutations that modify an Apple Team */
  appleTeam: AppleTeamMutation;
  /** Mutations that modify an App */
  app?: Maybe<AppMutation>;
  asset: AssetMutation;
  /** Mutations that modify an BuildJob */
  buildJob?: Maybe<BuildJobMutation>;
  /** Mutations that modify an EAS Build */
  build?: Maybe<BuildMutation>;
  /** Mutations that modify the build credentials for an iOS app */
  iosAppBuildCredentials: IosAppBuildCredentialsMutation;
  /** Mutations that modify the credentials for an iOS app */
  iosAppCredentials: IosAppCredentialsMutation;
  /** Mutations that create, update, and delete Robots */
  robot: RobotMutation;
  updateChannel: UpdateChannelMutation;
  update: UpdateMutation;
  updateRelease: UpdateReleaseMutation;
  /** Mutations that create, delete, and accept UserInvitations */
  userInvitation: UserInvitationMutation;
  /** Mutations that modify the currently authenticated User */
  me?: Maybe<MeMutation>;
  /** Mutations that modify an EmailSubscription */
  emailSubscription: EmailSubscriptionMutation;
};


export type RootMutationAccountArgs = {
  accountName: Scalars['ID'];
};


export type RootMutationAppArgs = {
  appId: Scalars['ID'];
};


export type RootMutationBuildJobArgs = {
  buildId: Scalars['ID'];
};


export type RootMutationBuildArgs = {
  buildId: Scalars['ID'];
};

export type AccessTokenMutation = {
  __typename?: 'AccessTokenMutation';
  /** Create an AccessToken for an Actor */
  createAccessToken: CreateAccessTokenResponse;
  /** Revoke an AccessToken */
  setAccessTokenRevoked: AccessToken;
  /** Delete an AccessToken */
  deleteAccessToken: DeleteAccessTokenResult;
};


export type AccessTokenMutationCreateAccessTokenArgs = {
  createAccessTokenData: CreateAccessTokenInput;
};


export type AccessTokenMutationSetAccessTokenRevokedArgs = {
  id: Scalars['ID'];
  revoked?: Maybe<Scalars['Boolean']>;
};


export type AccessTokenMutationDeleteAccessTokenArgs = {
  id: Scalars['ID'];
};

export type CreateAccessTokenInput = {
  actorID: Scalars['ID'];
  note?: Maybe<Scalars['String']>;
};

export type CreateAccessTokenResponse = {
  __typename?: 'CreateAccessTokenResponse';
  /** AccessToken created */
  accessToken?: Maybe<AccessToken>;
  /** Full token string to be used for authentication */
  token?: Maybe<Scalars['String']>;
};

export type DeleteAccessTokenResult = {
  __typename?: 'DeleteAccessTokenResult';
  id: Scalars['ID'];
};

export type AccountMutation = {
  __typename?: 'AccountMutation';
  /**
   * Add user to an account
   * @deprecated Use 'grantActorPermissions' mutation.
   */
  grantAccess?: Maybe<Account>;
  /**
   * Revoke permissions for a given user
   * @deprecated Use 'revokeActorPermissions' mutation.
   */
  revokeAccess?: Maybe<Account>;
  /** Add specified account Permissions for Actor */
  grantActorPermissions?: Maybe<Account>;
  /** Revoke specified Permissions for Actor */
  revokeActorPermissions?: Maybe<Account>;
  /** Add a subscription */
  subscribeToProduct?: Maybe<Account>;
  /** Cancels the active subscription */
  cancelSubscription?: Maybe<Account>;
  /**
   * Makes a one time purchase
   * @deprecated Build packs are no longer supported
   */
  buyProduct?: Maybe<Account>;
  /**
   * Update setting to purchase new build packs when the current one is consumed
   * @deprecated Build packs are no longer supported
   */
  setBuildAutoRenew?: Maybe<Account>;
  /** Set payment details */
  setPaymentSource?: Maybe<Account>;
  /** Extend offer to account */
  extendOffer?: Maybe<Account>;
  /** Send an email to primary account email */
  sendEmail?: Maybe<Account>;
  /** Require authorization to send push notifications for experiences owned by this account */
  setPushSecurityEnabled?: Maybe<Account>;
};


export type AccountMutationGrantAccessArgs = {
  accountName: Scalars['ID'];
  toUser: Scalars['ID'];
  accessLevels?: Maybe<Array<Maybe<Permission>>>;
};


export type AccountMutationRevokeAccessArgs = {
  accountName: Scalars['ID'];
  fromUser: Scalars['ID'];
  accessLevels?: Maybe<Array<Maybe<Permission>>>;
};


export type AccountMutationGrantActorPermissionsArgs = {
  accountID: Scalars['ID'];
  actorID: Scalars['ID'];
  permissions?: Maybe<Array<Maybe<Permission>>>;
};


export type AccountMutationRevokeActorPermissionsArgs = {
  accountID: Scalars['ID'];
  actorID: Scalars['ID'];
  permissions?: Maybe<Array<Maybe<Permission>>>;
};


export type AccountMutationSubscribeToProductArgs = {
  accountName: Scalars['ID'];
  productId: Scalars['ID'];
  paymentSource: Scalars['ID'];
};


export type AccountMutationCancelSubscriptionArgs = {
  accountName: Scalars['ID'];
};


export type AccountMutationBuyProductArgs = {
  accountName: Scalars['ID'];
  productId: Scalars['ID'];
  paymentSource?: Maybe<Scalars['ID']>;
  autoRenew?: Maybe<Scalars['Boolean']>;
};


export type AccountMutationSetBuildAutoRenewArgs = {
  accountName: Scalars['ID'];
  autoRenew?: Maybe<Scalars['Boolean']>;
};


export type AccountMutationSetPaymentSourceArgs = {
  accountName: Scalars['ID'];
  paymentSource: Scalars['ID'];
};


export type AccountMutationExtendOfferArgs = {
  accountName: Scalars['ID'];
  offer: StandardOffer;
  suppressMessage?: Maybe<Scalars['Boolean']>;
};


export type AccountMutationSendEmailArgs = {
  accountName: Scalars['ID'];
  emailTemplate: EmailTemplate;
};


export type AccountMutationSetPushSecurityEnabledArgs = {
  accountID: Scalars['ID'];
  pushSecurityEnabled: Scalars['Boolean'];
};

export enum StandardOffer {
  /** $29 USD per month, 30 day trial */
  Default = 'DEFAULT',
  /** $29 USD per month, 1 year trial */
  YcDeals = 'YC_DEALS',
  /** $800 USD per month */
  Support = 'SUPPORT'
}

export enum EmailTemplate {
  /** Able to purchase Developer Services */
  DevServicesOfferExtended = 'DEV_SERVICES_OFFER_EXTENDED',
  /** Developer Services Signup */
  DevServicesOnboarding = 'DEV_SERVICES_ONBOARDING'
}

export type AndroidAppBuildCredentialsMutation = {
  __typename?: 'AndroidAppBuildCredentialsMutation';
  /** Create a set of build credentials for an Android app */
  createAndroidAppBuildCredentials?: Maybe<AndroidAppBuildCredentials>;
  /** delete a set of build credentials for an Android app */
  deleteAndroidAppBuildCredentials?: Maybe<DeleteAndroidAppBuildCredentialsResult>;
  /** Set the name of a set of build credentials to be used for an Android app */
  setName?: Maybe<AndroidAppBuildCredentials>;
  /** Set the keystore to be used for an Android app */
  setKeystore?: Maybe<AndroidAppBuildCredentials>;
  /** Set the build credentials to be the default for the Android app */
  setDefault?: Maybe<AndroidAppBuildCredentials>;
};


export type AndroidAppBuildCredentialsMutationCreateAndroidAppBuildCredentialsArgs = {
  androidAppBuildCredentialsInput: AndroidAppBuildCredentialsInput;
  androidAppCredentialsId: Scalars['ID'];
};


export type AndroidAppBuildCredentialsMutationDeleteAndroidAppBuildCredentialsArgs = {
  id: Scalars['ID'];
};


export type AndroidAppBuildCredentialsMutationSetNameArgs = {
  id: Scalars['ID'];
  name: Scalars['String'];
};


export type AndroidAppBuildCredentialsMutationSetKeystoreArgs = {
  id: Scalars['ID'];
  keystoreId: Scalars['ID'];
};


export type AndroidAppBuildCredentialsMutationSetDefaultArgs = {
  id: Scalars['ID'];
  isDefault: Scalars['Boolean'];
};

/** @isDefault: if set, these build credentials will become the default for the Android app. All other build credentials will have their default status set to false. */
export type AndroidAppBuildCredentialsInput = {
  isDefault: Scalars['Boolean'];
  name: Scalars['String'];
  keystoreId: Scalars['ID'];
};

export type DeleteAndroidAppBuildCredentialsResult = {
  __typename?: 'deleteAndroidAppBuildCredentialsResult';
  id: Scalars['ID'];
};

export type AndroidAppCredentialsMutation = {
  __typename?: 'AndroidAppCredentialsMutation';
  /** Create a set of credentials for an Android app */
  createAndroidAppCredentials?: Maybe<AndroidAppCredentials>;
  /** Set the FCM push key to be used in an Android app */
  setFcm?: Maybe<AndroidAppCredentials>;
};


export type AndroidAppCredentialsMutationCreateAndroidAppCredentialsArgs = {
  androidAppCredentialsInput: AndroidAppCredentialsInput;
  appId: Scalars['ID'];
  applicationIdentifier: Scalars['String'];
};


export type AndroidAppCredentialsMutationSetFcmArgs = {
  id: Scalars['ID'];
  fcmId: Scalars['ID'];
};

export type AndroidAppCredentialsInput = {
  fcmId: Scalars['ID'];
};

export type AndroidFcmMutation = {
  __typename?: 'AndroidFcmMutation';
  /** Create an FCM credential */
  createAndroidFcm: AndroidFcm;
  /** Delete an FCM credential */
  deleteAndroidFcm: DeleteAndroidFcmResult;
};


export type AndroidFcmMutationCreateAndroidFcmArgs = {
  androidFcmInput: AndroidFcmInput;
  accountId: Scalars['ID'];
};


export type AndroidFcmMutationDeleteAndroidFcmArgs = {
  id: Scalars['ID'];
};

export type AndroidFcmInput = {
  credential: Scalars['String'];
  version: AndroidFcmVersion;
};

export type DeleteAndroidFcmResult = {
  __typename?: 'deleteAndroidFcmResult';
  id: Scalars['ID'];
};

export type AndroidKeystoreMutation = {
  __typename?: 'AndroidKeystoreMutation';
  /** Create a Keystore */
  createAndroidKeystore?: Maybe<AndroidKeystore>;
  /** Delete a Keystore */
  deleteAndroidKeystore: DeleteAndroidKeystoreResult;
};


export type AndroidKeystoreMutationCreateAndroidKeystoreArgs = {
  androidKeystoreInput: AndroidKeystoreInput;
  accountId: Scalars['ID'];
};


export type AndroidKeystoreMutationDeleteAndroidKeystoreArgs = {
  id: Scalars['ID'];
};

export type AndroidKeystoreInput = {
  base64EncodedKeystore: Scalars['String'];
  keystorePassword: Scalars['String'];
  keyAlias: Scalars['String'];
  keyPassword?: Maybe<Scalars['String']>;
  type: AndroidKeystoreType;
};

export type DeleteAndroidKeystoreResult = {
  __typename?: 'DeleteAndroidKeystoreResult';
  id: Scalars['ID'];
};

export type AppleAppIdentifierMutation = {
  __typename?: 'AppleAppIdentifierMutation';
  /** Create an Identifier for an iOS App */
  createAppleAppIdentifier?: Maybe<AppleAppIdentifier>;
};


export type AppleAppIdentifierMutationCreateAppleAppIdentifierArgs = {
  appleAppIdentifierInput: AppleAppIdentifierInput;
  accountId: Scalars['ID'];
};

export type AppleAppIdentifierInput = {
  bundleIdentifier: Scalars['String'];
  appleTeamId?: Maybe<Scalars['ID']>;
};

export type AppleDeviceMutation = {
  __typename?: 'AppleDeviceMutation';
  /** Create an Apple Device */
  createAppleDevice: AppleDevice;
  /** Delete an Apple Device */
  deleteAppleDevice: DeleteAppleDeviceResult;
};


export type AppleDeviceMutationCreateAppleDeviceArgs = {
  appleDeviceInput: AppleDeviceInput;
  accountId: Scalars['ID'];
};


export type AppleDeviceMutationDeleteAppleDeviceArgs = {
  id: Scalars['ID'];
};

export type AppleDeviceInput = {
  appleTeamId: Scalars['ID'];
  identifier: Scalars['String'];
  name?: Maybe<Scalars['String']>;
  model?: Maybe<Scalars['String']>;
  deviceClass?: Maybe<AppleDeviceClass>;
  softwareVersion?: Maybe<Scalars['String']>;
  enabled?: Maybe<Scalars['Boolean']>;
};

export type DeleteAppleDeviceResult = {
  __typename?: 'DeleteAppleDeviceResult';
  id: Scalars['ID'];
};

export type AppleDeviceRegistrationRequestMutation = {
  __typename?: 'AppleDeviceRegistrationRequestMutation';
  /** Create an Apple Device registration request */
  createAppleDeviceRegistrationRequest: AppleDeviceRegistrationRequest;
};


export type AppleDeviceRegistrationRequestMutationCreateAppleDeviceRegistrationRequestArgs = {
  appleTeamId: Scalars['ID'];
  accountId: Scalars['ID'];
};

export type AppleDistributionCertificateMutation = {
  __typename?: 'AppleDistributionCertificateMutation';
  /** Create a Distribution Certificate */
  createAppleDistributionCertificate?: Maybe<AppleDistributionCertificate>;
  /** Delete a Distribution Certificate */
  deleteAppleDistributionCertificate: DeleteAppleDistributionCertificateResult;
};


export type AppleDistributionCertificateMutationCreateAppleDistributionCertificateArgs = {
  appleDistributionCertificateInput: AppleDistributionCertificateInput;
  accountId: Scalars['ID'];
};


export type AppleDistributionCertificateMutationDeleteAppleDistributionCertificateArgs = {
  id: Scalars['ID'];
};

export type AppleDistributionCertificateInput = {
  certP12: Scalars['String'];
  certPassword: Scalars['String'];
  certPrivateSigningKey?: Maybe<Scalars['String']>;
  developerPortalIdentifier?: Maybe<Scalars['String']>;
  appleTeamId?: Maybe<Scalars['ID']>;
};

export type DeleteAppleDistributionCertificateResult = {
  __typename?: 'DeleteAppleDistributionCertificateResult';
  id: Scalars['ID'];
};

export type AppleProvisioningProfileMutation = {
  __typename?: 'AppleProvisioningProfileMutation';
  /** Create a Provisioning Profile */
  createAppleProvisioningProfile: AppleProvisioningProfile;
  /** Update a Provisioning Profile */
  updateAppleProvisioningProfile: AppleProvisioningProfile;
  /** Delete a Provisioning Profile */
  deleteAppleProvisioningProfile: DeleteAppleProvisioningProfileResult;
  /** Delete Provisioning Profiles */
  deleteAppleProvisioningProfiles: Array<DeleteAppleProvisioningProfileResult>;
};


export type AppleProvisioningProfileMutationCreateAppleProvisioningProfileArgs = {
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
  accountId: Scalars['ID'];
  appleAppIdentifierId: Scalars['ID'];
};


export type AppleProvisioningProfileMutationUpdateAppleProvisioningProfileArgs = {
  id: Scalars['ID'];
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
};


export type AppleProvisioningProfileMutationDeleteAppleProvisioningProfileArgs = {
  id: Scalars['ID'];
};


export type AppleProvisioningProfileMutationDeleteAppleProvisioningProfilesArgs = {
  ids: Array<Scalars['ID']>;
};

export type AppleProvisioningProfileInput = {
  appleProvisioningProfile: Scalars['String'];
  developerPortalIdentifier?: Maybe<Scalars['String']>;
};

export type DeleteAppleProvisioningProfileResult = {
  __typename?: 'DeleteAppleProvisioningProfileResult';
  id: Scalars['ID'];
};

export type ApplePushKeyMutation = {
  __typename?: 'ApplePushKeyMutation';
  /** Create an Apple Push Notification key */
  createApplePushKey: ApplePushKey;
  /** Delete an Apple Push Notification key */
  deleteApplePushKey: DeleteApplePushKeyResult;
};


export type ApplePushKeyMutationCreateApplePushKeyArgs = {
  applePushKeyInput: ApplePushKeyInput;
  accountId: Scalars['ID'];
};


export type ApplePushKeyMutationDeleteApplePushKeyArgs = {
  id: Scalars['ID'];
};

export type ApplePushKeyInput = {
  keyP8: Scalars['String'];
  keyIdentifier: Scalars['String'];
  appleTeamId?: Maybe<Scalars['ID']>;
};

export type DeleteApplePushKeyResult = {
  __typename?: 'deleteApplePushKeyResult';
  id: Scalars['ID'];
};

export type AppleTeamMutation = {
  __typename?: 'AppleTeamMutation';
  /** Create an Apple Team */
  createAppleTeam: AppleTeam;
};


export type AppleTeamMutationCreateAppleTeamArgs = {
  appleTeamInput: AppleTeamInput;
  accountId: Scalars['ID'];
};

export type AppleTeamInput = {
  appleTeamIdentifier: Scalars['String'];
  appleTeamName: Scalars['String'];
};

export type AppMutation = {
  __typename?: 'AppMutation';
  /** @deprecated Field no longer supported */
  grantAccess?: Maybe<App>;
  /** Require api token to send push notifs for experience */
  setPushSecurityEnabled?: Maybe<App>;
};


export type AppMutationGrantAccessArgs = {
  toUser: Scalars['ID'];
  accessLevel?: Maybe<Scalars['String']>;
};


export type AppMutationSetPushSecurityEnabledArgs = {
  appId: Scalars['ID'];
  pushSecurityEnabled: Scalars['Boolean'];
};

export type AssetMutation = {
  __typename?: 'AssetMutation';
  /**
   * Returns an array of specifications for upload. Each URL is valid for an hour.
   * The content type of the asset you wish to upload must be specified.
   */
  getSignedAssetUploadSpecifications?: Maybe<GetSignedAssetUploadSpecificationsResult>;
};


export type AssetMutationGetSignedAssetUploadSpecificationsArgs = {
  assetContentTypes: Array<Maybe<Scalars['String']>>;
};

export type GetSignedAssetUploadSpecificationsResult = {
  __typename?: 'GetSignedAssetUploadSpecificationsResult';
  specifications: Array<Maybe<Scalars['String']>>;
};

export type BuildJobMutation = {
  __typename?: 'BuildJobMutation';
  cancel?: Maybe<BuildJob>;
  del?: Maybe<BuildJob>;
  restart?: Maybe<BuildJob>;
};

export type BuildMutation = {
  __typename?: 'BuildMutation';
  /** Cancel an EAS Build" */
  cancel: Build;
};

export type IosAppBuildCredentialsMutation = {
  __typename?: 'IosAppBuildCredentialsMutation';
  /** Create a set of build credentials for an iOS app */
  createIosAppBuildCredentials?: Maybe<IosAppBuildCredentials>;
  /** Set the distribution certificate to be used for an iOS app */
  setDistributionCertificate?: Maybe<IosAppBuildCredentials>;
  /** Set the provisioning profile to be used for an iOS app */
  setProvisioningProfile?: Maybe<IosAppBuildCredentials>;
};


export type IosAppBuildCredentialsMutationCreateIosAppBuildCredentialsArgs = {
  iosAppBuildCredentialsInput: IosAppBuildCredentialsInput;
  iosAppCredentialsId: Scalars['ID'];
};


export type IosAppBuildCredentialsMutationSetDistributionCertificateArgs = {
  id: Scalars['ID'];
  distributionCertificateId: Scalars['ID'];
};


export type IosAppBuildCredentialsMutationSetProvisioningProfileArgs = {
  id: Scalars['ID'];
  provisioningProfileId: Scalars['ID'];
};

export type IosAppBuildCredentialsInput = {
  iosDistributionType: IosDistributionType;
  distributionCertificateId: Scalars['ID'];
  provisioningProfileId: Scalars['ID'];
};

export type IosAppCredentialsMutation = {
  __typename?: 'IosAppCredentialsMutation';
  /** Create a set of credentials for an iOS app */
  createIosAppCredentials?: Maybe<IosAppCredentials>;
  /** Set the push key to be used in an iOS app */
  setPushKey?: Maybe<IosAppCredentials>;
};


export type IosAppCredentialsMutationCreateIosAppCredentialsArgs = {
  iosAppCredentialsInput: IosAppCredentialsInput;
  appId: Scalars['ID'];
  appleAppIdentifierId: Scalars['ID'];
};


export type IosAppCredentialsMutationSetPushKeyArgs = {
  id: Scalars['ID'];
  pushKeyId: Scalars['ID'];
};

export type IosAppCredentialsInput = {
  appleTeamId: Scalars['ID'];
  pushKeyId?: Maybe<Scalars['ID']>;
};

export type RobotMutation = {
  __typename?: 'RobotMutation';
  /** Create a Robot and grant it Permissions on an Account */
  createRobotForAccount: Robot;
  /** Update a Robot */
  updateRobot: Robot;
  /** Delete a Robot */
  deleteRobot: DeleteRobotResult;
};


export type RobotMutationCreateRobotForAccountArgs = {
  robotData?: Maybe<RobotDataInput>;
  accountID: Scalars['String'];
  permissions: Array<Maybe<Permission>>;
};


export type RobotMutationUpdateRobotArgs = {
  id: Scalars['String'];
  robotData: RobotDataInput;
};


export type RobotMutationDeleteRobotArgs = {
  id: Scalars['String'];
};

export type RobotDataInput = {
  name?: Maybe<Scalars['String']>;
};

/** Represents a robot (not human) actor. */
export type Robot = Actor & {
  __typename?: 'Robot';
  id: Scalars['ID'];
  firstName?: Maybe<Scalars['String']>;
  created?: Maybe<Scalars['DateTime']>;
  isExpoAdmin?: Maybe<Scalars['Boolean']>;
  /** Associated accounts */
  accounts: Array<Account>;
  /** Access Tokens belonging to this actor */
  accessTokens: Array<AccessToken>;
  /**
   * Server feature gate values for this actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject'];
};


/** Represents a robot (not human) actor. */
export type RobotFeatureGatesArgs = {
  filter?: Maybe<Array<Scalars['String']>>;
};

export type DeleteRobotResult = {
  __typename?: 'DeleteRobotResult';
  id: Scalars['ID'];
};

export type UpdateChannelMutation = {
  __typename?: 'UpdateChannelMutation';
  /**
   * Create an EAS channel for an app.
   * 
   * In order to work with GraphQL formatting, the releaseMapping should be a
   * stringified JSON supplied to the mutation as a variable.
   */
  createUpdateChannelForApp?: Maybe<UpdateChannel>;
  /**
   * Edit an EAS channel.
   * 
   * In order to work with GraphQL formatting, the releaseMapping should be a
   * stringified JSON supplied to the mutation as a variable.
   */
  editUpdateChannel?: Maybe<UpdateChannel>;
  /** delete an EAS channel that doesn't point to any releases */
  deleteUpdateChannel: DeleteUpdateChannelResult;
};


export type UpdateChannelMutationCreateUpdateChannelForAppArgs = {
  appId: Scalars['ID'];
  channelName: Scalars['String'];
  releaseMapping?: Maybe<Scalars['String']>;
};


export type UpdateChannelMutationEditUpdateChannelArgs = {
  channelId: Scalars['ID'];
  releaseMapping: Scalars['String'];
};


export type UpdateChannelMutationDeleteUpdateChannelArgs = {
  channelId: Scalars['ID'];
};

export type DeleteUpdateChannelResult = {
  __typename?: 'DeleteUpdateChannelResult';
  id: Scalars['ID'];
};

export type UpdateMutation = {
  __typename?: 'UpdateMutation';
  /** Delete an EAS update */
  deleteUpdate: DeleteUpdateResult;
};


export type UpdateMutationDeleteUpdateArgs = {
  updateId: Scalars['ID'];
};

export type DeleteUpdateResult = {
  __typename?: 'DeleteUpdateResult';
  id: Scalars['ID'];
};

export type UpdateReleaseMutation = {
  __typename?: 'UpdateReleaseMutation';
  /** Create an EAS release for an app */
  createUpdateReleaseForApp?: Maybe<UpdateRelease>;
  /**
   * Edit an EAS release. The release can be specified either by its ID or
   * with the combination of (appId, releaseName).
   */
  editUpdateRelease: UpdateRelease;
  /** Delete an EAS release and all of its updates as long as the release is not being used by any channels */
  deleteUpdateRelease: DeleteUpdateReleaseResult;
  /** Publish an update group to a release */
  publishUpdateGroup: Array<Maybe<Update>>;
};


export type UpdateReleaseMutationCreateUpdateReleaseForAppArgs = {
  appId: Scalars['ID'];
  releaseName: Scalars['String'];
};


export type UpdateReleaseMutationEditUpdateReleaseArgs = {
  input: EditUpdateReleaseInput;
};


export type UpdateReleaseMutationDeleteUpdateReleaseArgs = {
  releaseId: Scalars['ID'];
};


export type UpdateReleaseMutationPublishUpdateGroupArgs = {
  publishUpdateGroupInput?: Maybe<PublishUpdateGroupInput>;
};

export type EditUpdateReleaseInput = {
  id?: Maybe<Scalars['ID']>;
  appId?: Maybe<Scalars['ID']>;
  releaseName?: Maybe<Scalars['String']>;
  newReleaseName: Scalars['String'];
};

export type DeleteUpdateReleaseResult = {
  __typename?: 'DeleteUpdateReleaseResult';
  id: Scalars['ID'];
};

export type PublishUpdateGroupInput = {
  releaseId: Scalars['String'];
  updateInfoGroup: UpdateInfoGroup;
  runtimeVersion: Scalars['String'];
  updateMessage?: Maybe<Scalars['String']>;
};

export type UpdateInfoGroup = {
  android?: Maybe<PartialManifest>;
  ios?: Maybe<PartialManifest>;
  web?: Maybe<PartialManifest>;
};

export type PartialManifest = {
  launchAsset: PartialManifestAsset;
  assets: Array<Maybe<PartialManifestAsset>>;
};

export type PartialManifestAsset = {
  fileHash: Scalars['String'];
  bundleKey: Scalars['String'];
  contentType: Scalars['String'];
  storageBucket: Scalars['String'];
  storageKey: Scalars['String'];
};

export type UserInvitationMutation = {
  __typename?: 'UserInvitationMutation';
  /**
   * Create a UserInvitation for an email that when accepted grants
   * the specified permissions on an Account
   */
  createUserInvitationForAccount: UserInvitation;
  /** Re-send UserInivitation by ID */
  resendUserInvitation: UserInvitation;
  /** Rescind UserInvitation by ID */
  deleteUserInvitation: RescindUserInvitationResult;
  /** Accept UserInvitation by ID. Viewer must have matching email and email must be verified. */
  acceptUserInvitationAsViewer: AcceptUserInvitationResult;
  /**
   * Accept UserInvitation by token. Note that the viewer's email is not required to match
   * the email on the invitation. If viewer's email does match that of the invitation,
   * their email will also be verified.
   */
  acceptUserInvitationByTokenAsViewer: AcceptUserInvitationResult;
};


export type UserInvitationMutationCreateUserInvitationForAccountArgs = {
  accountID: Scalars['ID'];
  email: Scalars['String'];
  permissions: Array<Maybe<Permission>>;
};


export type UserInvitationMutationResendUserInvitationArgs = {
  id: Scalars['ID'];
};


export type UserInvitationMutationDeleteUserInvitationArgs = {
  id: Scalars['ID'];
};


export type UserInvitationMutationAcceptUserInvitationAsViewerArgs = {
  id: Scalars['ID'];
};


export type UserInvitationMutationAcceptUserInvitationByTokenAsViewerArgs = {
  token: Scalars['ID'];
};

export type RescindUserInvitationResult = {
  __typename?: 'RescindUserInvitationResult';
  id: Scalars['ID'];
};

export type AcceptUserInvitationResult = {
  __typename?: 'AcceptUserInvitationResult';
  success?: Maybe<Scalars['Boolean']>;
};

export type MeMutation = {
  __typename?: 'MeMutation';
  /** Update the current user's data */
  updateProfile?: Maybe<User>;
  /** Update an App that the current user owns */
  updateApp?: Maybe<App>;
  /** Unpublish an App that the current user owns */
  unpublishApp?: Maybe<App>;
  /** Transfer project to a different Account */
  transferApp: App;
  /** Delete a Snack that the current user owns */
  deleteSnack?: Maybe<Snack>;
  /** Create a new Account and grant this User the owner Role */
  createAccount?: Maybe<Account>;
  /** Delete an Account created via createAccount */
  deleteAccount: DeleteAccountResult;
  /** Leave an Account (revoke own permissions on Account) */
  leaveAccount: LeaveAccountResult;
  /** Initiate setup of two-factor authentication for the current user */
  initiateSecondFactorAuthentication: SecondFactorInitiationResult;
  /** Purge unfinished two-factor authentication setup for the current user if not fully-set-up */
  purgeUnfinishedSecondFactorAuthentication: SecondFactorBooleanResult;
  /** Regenerate backup codes for the current user */
  regenerateSecondFactorBackupCodes: SecondFactorRegenerateBackupCodesResult;
  /** Send SMS OTP to a second factor device for use during device setup or during change confirmation */
  sendSMSOTPToSecondFactorDevice: SecondFactorBooleanResult;
  /** Certify an initiated second factor authentication method for the current user */
  certifySecondFactorDevice: SecondFactorBooleanResult;
  /** Set the user's primary second factor device */
  setPrimarySecondFactorDevice: SecondFactorBooleanResult;
  /** Add an additional second factor device */
  addSecondFactorDevice: SecondFactorDeviceConfigurationResult;
  /** Delete a second factor device */
  deleteSecondFactorDevice: SecondFactorBooleanResult;
  /** Disable all second factor authentication for the current user */
  disableSecondFactorAuthentication: SecondFactorBooleanResult;
};


export type MeMutationUpdateProfileArgs = {
  userData: UserDataInput;
};


export type MeMutationUpdateAppArgs = {
  appData: AppDataInput;
};


export type MeMutationUnpublishAppArgs = {
  appId: Scalars['ID'];
};


export type MeMutationTransferAppArgs = {
  appId: Scalars['ID'];
  destinationAccountId: Scalars['ID'];
};


export type MeMutationDeleteSnackArgs = {
  snackId: Scalars['ID'];
};


export type MeMutationCreateAccountArgs = {
  accountData: AccountDataInput;
};


export type MeMutationDeleteAccountArgs = {
  accountId: Scalars['ID'];
};


export type MeMutationLeaveAccountArgs = {
  accountId: Scalars['ID'];
};


export type MeMutationInitiateSecondFactorAuthenticationArgs = {
  deviceConfigurations: Array<Maybe<SecondFactorDeviceConfiguration>>;
};


export type MeMutationRegenerateSecondFactorBackupCodesArgs = {
  otp: Scalars['String'];
};


export type MeMutationSendSmsotpToSecondFactorDeviceArgs = {
  userSecondFactorDeviceId: Scalars['ID'];
};


export type MeMutationCertifySecondFactorDeviceArgs = {
  otp: Scalars['String'];
};


export type MeMutationSetPrimarySecondFactorDeviceArgs = {
  userSecondFactorDeviceId: Scalars['ID'];
};


export type MeMutationAddSecondFactorDeviceArgs = {
  deviceConfiguration: SecondFactorDeviceConfiguration;
  otp: Scalars['String'];
};


export type MeMutationDeleteSecondFactorDeviceArgs = {
  userSecondFactorDeviceId: Scalars['ID'];
  otp: Scalars['String'];
};


export type MeMutationDisableSecondFactorAuthenticationArgs = {
  otp: Scalars['String'];
};

export type UserDataInput = {
  id?: Maybe<Scalars['ID']>;
  username?: Maybe<Scalars['String']>;
  industry?: Maybe<Scalars['String']>;
  location?: Maybe<Scalars['String']>;
  githubUsername?: Maybe<Scalars['String']>;
  twitterUsername?: Maybe<Scalars['String']>;
  email?: Maybe<Scalars['String']>;
  firstName?: Maybe<Scalars['String']>;
  lastName?: Maybe<Scalars['String']>;
  fullName?: Maybe<Scalars['String']>;
  profilePhoto?: Maybe<Scalars['String']>;
  isOnboarded?: Maybe<Scalars['Boolean']>;
  isLegacy?: Maybe<Scalars['Boolean']>;
  isEmailUnsubscribed?: Maybe<Scalars['Boolean']>;
  wasLegacy?: Maybe<Scalars['Boolean']>;
  appetizeCode?: Maybe<Scalars['String']>;
};

export type AppDataInput = {
  id: Scalars['ID'];
  privacy?: Maybe<Scalars['String']>;
};

export type AccountDataInput = {
  name: Scalars['String'];
};

export type DeleteAccountResult = {
  __typename?: 'DeleteAccountResult';
  id: Scalars['ID'];
};

export type LeaveAccountResult = {
  __typename?: 'LeaveAccountResult';
  success: Scalars['Boolean'];
};

export type SecondFactorDeviceConfiguration = {
  method: SecondFactorMethod;
  smsPhoneNumber?: Maybe<Scalars['String']>;
  name: Scalars['String'];
  isPrimary: Scalars['Boolean'];
};

export type SecondFactorInitiationResult = {
  __typename?: 'SecondFactorInitiationResult';
  configurationResults: Array<Maybe<SecondFactorDeviceConfigurationResult>>;
  plaintextBackupCodes: Array<Maybe<Scalars['String']>>;
};

export type SecondFactorDeviceConfigurationResult = {
  __typename?: 'SecondFactorDeviceConfigurationResult';
  secondFactorDevice: UserSecondFactorDevice;
  secret: Scalars['String'];
  keyURI: Scalars['String'];
};

export type SecondFactorBooleanResult = {
  __typename?: 'SecondFactorBooleanResult';
  success: Scalars['Boolean'];
};

export type SecondFactorRegenerateBackupCodesResult = {
  __typename?: 'SecondFactorRegenerateBackupCodesResult';
  plaintextBackupCodes: Array<Maybe<Scalars['String']>>;
};

export type EmailSubscriptionMutation = {
  __typename?: 'EmailSubscriptionMutation';
  addUser?: Maybe<AddUserPayload>;
};


export type EmailSubscriptionMutationAddUserArgs = {
  addUserInput: AddUserInput;
};

export type AddUserInput = {
  email: Scalars['String'];
  tags?: Maybe<Array<MailchimpTag>>;
  audience?: Maybe<MailchimpAudience>;
};

export enum MailchimpTag {
  EasMasterList = 'EAS_MASTER_LIST'
}

export enum MailchimpAudience {
  ExpoDevelopers = 'EXPO_DEVELOPERS'
}

export type AddUserPayload = {
  __typename?: 'AddUserPayload';
  id?: Maybe<Scalars['String']>;
  email_address?: Maybe<Scalars['String']>;
  status?: Maybe<Scalars['String']>;
  timestamp_signup?: Maybe<Scalars['String']>;
  tags?: Maybe<Array<MailchimpTagPayload>>;
  list_id?: Maybe<Scalars['String']>;
};

export type MailchimpTagPayload = {
  __typename?: 'MailchimpTagPayload';
  id?: Maybe<Scalars['Int']>;
  name?: Maybe<Scalars['String']>;
};

export type BaseSearchResult = SearchResult & {
  __typename?: 'BaseSearchResult';
  /** @deprecated Use SearchResult instead */
  id: Scalars['ID'];
  /** @deprecated Use SearchResult instead */
  rank?: Maybe<Scalars['Int']>;
};

/** Represents a search result for an app */
export type AppSearchResult = SearchResult & {
  __typename?: 'AppSearchResult';
  /** @deprecated Field no longer supported */
  id: Scalars['ID'];
  /** @deprecated Field no longer supported */
  rank?: Maybe<Scalars['Int']>;
  /** @deprecated Field no longer supported */
  app: App;
};

/** Represents a search result for a user */
export type UserSearchResult = SearchResult & {
  __typename?: 'UserSearchResult';
  /** @deprecated Field no longer supported */
  id: Scalars['ID'];
  /** @deprecated Field no longer supported */
  rank?: Maybe<Scalars['Int']>;
  /** @deprecated Field no longer supported */
  user: User;
};

/** Represents a search result for a snack */
export type SnackSearchResult = SearchResult & {
  __typename?: 'SnackSearchResult';
  id: Scalars['ID'];
  rank?: Maybe<Scalars['Int']>;
  snack: Snack;
};

export enum CacheControlScope {
  Public = 'PUBLIC',
  Private = 'PRIVATE'
}


export type CreateAppleAppIdentifierMutationVariables = Exact<{
  appleAppIdentifierInput: AppleAppIdentifierInput;
  accountId: Scalars['ID'];
}>;


export type CreateAppleAppIdentifierMutation = (
  { __typename?: 'RootMutation' }
  & { appleAppIdentifier: (
    { __typename?: 'AppleAppIdentifierMutation' }
    & { createAppleAppIdentifier?: Maybe<(
      { __typename?: 'AppleAppIdentifier' }
      & Pick<AppleAppIdentifier, 'id'>
      & AppleAppIdentifierFragment
    )> }
  ) }
);

export type CreateAppleDeviceMutationVariables = Exact<{
  appleDeviceInput: AppleDeviceInput;
  accountId: Scalars['ID'];
}>;


export type CreateAppleDeviceMutation = (
  { __typename?: 'RootMutation' }
  & { appleDevice: (
    { __typename?: 'AppleDeviceMutation' }
    & { createAppleDevice: (
      { __typename?: 'AppleDevice' }
      & Pick<AppleDevice, 'id'>
      & AppleDeviceFragment
    ) }
  ) }
);

export type CreateAppleDeviceRegistrationRequestMutationVariables = Exact<{
  appleTeamId: Scalars['ID'];
  accountId: Scalars['ID'];
}>;


export type CreateAppleDeviceRegistrationRequestMutation = (
  { __typename?: 'RootMutation' }
  & { appleDeviceRegistrationRequest: (
    { __typename?: 'AppleDeviceRegistrationRequestMutation' }
    & { createAppleDeviceRegistrationRequest: (
      { __typename?: 'AppleDeviceRegistrationRequest' }
      & Pick<AppleDeviceRegistrationRequest, 'id'>
      & AppleDeviceRegistrationRequestFragment
    ) }
  ) }
);

export type CreateAppleDistributionCertificateMutationVariables = Exact<{
  appleDistributionCertificateInput: AppleDistributionCertificateInput;
  accountId: Scalars['ID'];
}>;


export type CreateAppleDistributionCertificateMutation = (
  { __typename?: 'RootMutation' }
  & { appleDistributionCertificate: (
    { __typename?: 'AppleDistributionCertificateMutation' }
    & { createAppleDistributionCertificate?: Maybe<(
      { __typename?: 'AppleDistributionCertificate' }
      & Pick<AppleDistributionCertificate, 'id'>
      & { appleTeam?: Maybe<(
        { __typename?: 'AppleTeam' }
        & Pick<AppleTeam, 'id'>
        & AppleTeamFragment
      )> }
      & AppleDistributionCertificateFragment
    )> }
  ) }
);

export type CreateAppleProvisioningProfileMutationVariables = Exact<{
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
  accountId: Scalars['ID'];
  appleAppIdentifierId: Scalars['ID'];
}>;


export type CreateAppleProvisioningProfileMutation = (
  { __typename?: 'RootMutation' }
  & { appleProvisioningProfile: (
    { __typename?: 'AppleProvisioningProfileMutation' }
    & { createAppleProvisioningProfile: (
      { __typename?: 'AppleProvisioningProfile' }
      & Pick<AppleProvisioningProfile, 'id'>
      & { appleTeam?: Maybe<(
        { __typename?: 'AppleTeam' }
        & Pick<AppleTeam, 'id'>
        & AppleTeamFragment
      )> }
      & AppleProvisioningProfileFragment
    ) }
  ) }
);

export type UpdateAppleProvisioningProfileMutationVariables = Exact<{
  appleProvisioningProfileId: Scalars['ID'];
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
}>;


export type UpdateAppleProvisioningProfileMutation = (
  { __typename?: 'RootMutation' }
  & { appleProvisioningProfile: (
    { __typename?: 'AppleProvisioningProfileMutation' }
    & { updateAppleProvisioningProfile: (
      { __typename?: 'AppleProvisioningProfile' }
      & Pick<AppleProvisioningProfile, 'id'>
      & { appleTeam?: Maybe<(
        { __typename?: 'AppleTeam' }
        & Pick<AppleTeam, 'id'>
        & AppleTeamFragment
      )> }
      & AppleProvisioningProfileFragment
    ) }
  ) }
);

export type CreateAppleTeamMutationVariables = Exact<{
  appleTeamInput: AppleTeamInput;
  accountId: Scalars['ID'];
}>;


export type CreateAppleTeamMutation = (
  { __typename?: 'RootMutation' }
  & { appleTeam: (
    { __typename?: 'AppleTeamMutation' }
    & { createAppleTeam: (
      { __typename?: 'AppleTeam' }
      & Pick<AppleTeam, 'id'>
      & { account: (
        { __typename?: 'Account' }
        & Pick<Account, 'id' | 'name'>
      ) }
      & AppleTeamFragment
    ) }
  ) }
);

export type CreateIosAppBuildCredentialsMutationVariables = Exact<{
  iosAppBuildCredentialsInput: IosAppBuildCredentialsInput;
  iosAppCredentialsId: Scalars['ID'];
}>;


export type CreateIosAppBuildCredentialsMutation = (
  { __typename?: 'RootMutation' }
  & { iosAppBuildCredentials: (
    { __typename?: 'IosAppBuildCredentialsMutation' }
    & { createIosAppBuildCredentials?: Maybe<(
      { __typename?: 'IosAppBuildCredentials' }
      & Pick<IosAppBuildCredentials, 'id'>
      & IosAppBuildCredentialsFragment
    )> }
  ) }
);

export type SetDistributionCertificateMutationVariables = Exact<{
  iosAppBuildCredentialsId: Scalars['ID'];
  distributionCertificateId: Scalars['ID'];
}>;


export type SetDistributionCertificateMutation = (
  { __typename?: 'RootMutation' }
  & { iosAppBuildCredentials: (
    { __typename?: 'IosAppBuildCredentialsMutation' }
    & { setDistributionCertificate?: Maybe<(
      { __typename?: 'IosAppBuildCredentials' }
      & Pick<IosAppBuildCredentials, 'id'>
      & IosAppBuildCredentialsFragment
    )> }
  ) }
);

export type SetProvisioningProfileMutationVariables = Exact<{
  iosAppBuildCredentialsId: Scalars['ID'];
  provisioningProfileId: Scalars['ID'];
}>;


export type SetProvisioningProfileMutation = (
  { __typename?: 'RootMutation' }
  & { iosAppBuildCredentials: (
    { __typename?: 'IosAppBuildCredentialsMutation' }
    & { setProvisioningProfile?: Maybe<(
      { __typename?: 'IosAppBuildCredentials' }
      & Pick<IosAppBuildCredentials, 'id'>
      & IosAppBuildCredentialsFragment
    )> }
  ) }
);

export type CreateIosAppCredentialsMutationVariables = Exact<{
  iosAppCredentialsInput: IosAppCredentialsInput;
  appId: Scalars['ID'];
  appleAppIdentifierId: Scalars['ID'];
}>;


export type CreateIosAppCredentialsMutation = (
  { __typename?: 'RootMutation' }
  & { iosAppCredentials: (
    { __typename?: 'IosAppCredentialsMutation' }
    & { createIosAppCredentials?: Maybe<(
      { __typename?: 'IosAppCredentials' }
      & Pick<IosAppCredentials, 'id'>
      & IosAppCredentialsFragment
    )> }
  ) }
);

export type AppByFullNameQueryVariables = Exact<{
  fullName: Scalars['String'];
}>;


export type AppByFullNameQuery = (
  { __typename?: 'RootQuery' }
  & { app?: Maybe<(
    { __typename?: 'AppQuery' }
    & { byFullName: (
      { __typename?: 'App' }
      & Pick<App, 'id'>
      & AppFragment
    ) }
  )> }
);

export type AppleAppIdentifierByBundleIdQueryVariables = Exact<{
  accountName: Scalars['String'];
  bundleIdentifier: Scalars['String'];
}>;


export type AppleAppIdentifierByBundleIdQuery = (
  { __typename?: 'RootQuery' }
  & { account: (
    { __typename?: 'AccountQuery' }
    & { byName: (
      { __typename?: 'Account' }
      & Pick<Account, 'id'>
      & { appleAppIdentifiers: Array<(
        { __typename?: 'AppleAppIdentifier' }
        & Pick<AppleAppIdentifier, 'id'>
        & AppleAppIdentifierFragment
      )> }
    ) }
  ) }
);

export type AppleDevicesByAppleTeamQueryVariables = Exact<{
  accountId: Scalars['ID'];
  appleTeamIdentifier: Scalars['String'];
}>;


export type AppleDevicesByAppleTeamQuery = (
  { __typename?: 'RootQuery' }
  & { appleTeam: (
    { __typename?: 'AppleTeamQuery' }
    & { byAppleTeamIdentifier?: Maybe<(
      { __typename?: 'AppleTeam' }
      & Pick<AppleTeam, 'id'>
      & { appleDevices: Array<(
        { __typename?: 'AppleDevice' }
        & Pick<AppleDevice, 'id'>
        & { appleTeam: (
          { __typename?: 'AppleTeam' }
          & Pick<AppleTeam, 'id'>
          & AppleTeamFragment
        ) }
        & AppleDeviceFragment
      )> }
      & AppleTeamFragment
    )> }
  ) }
);

export type AppleDevicesByTeamIdentifierQueryVariables = Exact<{
  accountName: Scalars['String'];
  appleTeamIdentifier: Scalars['String'];
}>;


export type AppleDevicesByTeamIdentifierQuery = (
  { __typename?: 'RootQuery' }
  & { account: (
    { __typename?: 'AccountQuery' }
    & { byName: (
      { __typename?: 'Account' }
      & Pick<Account, 'id'>
      & { appleTeams: Array<(
        { __typename?: 'AppleTeam' }
        & Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>
        & { appleDevices: Array<(
          { __typename?: 'AppleDevice' }
          & Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'deviceClass' | 'enabled'>
        )> }
      )> }
    ) }
  ) }
);

export type AppleDevicesByIdentifierQueryVariables = Exact<{
  accountName: Scalars['String'];
  identifier: Scalars['String'];
}>;


export type AppleDevicesByIdentifierQuery = (
  { __typename?: 'RootQuery' }
  & { account: (
    { __typename?: 'AccountQuery' }
    & { byName: (
      { __typename?: 'Account' }
      & Pick<Account, 'id'>
      & { appleDevices: Array<(
        { __typename?: 'AppleDevice' }
        & Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'deviceClass' | 'enabled'>
        & { appleTeam: (
          { __typename?: 'AppleTeam' }
          & Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>
        ) }
      )> }
    ) }
  ) }
);

export type AppleDistributionCertificateByAppQueryVariables = Exact<{
  projectFullName: Scalars['String'];
  appleAppIdentifierId: Scalars['String'];
  iosDistributionType: IosDistributionType;
}>;


export type AppleDistributionCertificateByAppQuery = (
  { __typename?: 'RootQuery' }
  & { app?: Maybe<(
    { __typename?: 'AppQuery' }
    & { byFullName: (
      { __typename?: 'App' }
      & Pick<App, 'id'>
      & { iosAppCredentials: Array<(
        { __typename?: 'IosAppCredentials' }
        & Pick<IosAppCredentials, 'id'>
        & { iosAppBuildCredentialsArray: Array<(
          { __typename?: 'IosAppBuildCredentials' }
          & Pick<IosAppBuildCredentials, 'id'>
          & { distributionCertificate?: Maybe<(
            { __typename?: 'AppleDistributionCertificate' }
            & Pick<AppleDistributionCertificate, 'id'>
            & { appleTeam?: Maybe<(
              { __typename?: 'AppleTeam' }
              & Pick<AppleTeam, 'id'>
              & AppleTeamFragment
            )> }
            & AppleDistributionCertificateFragment
          )> }
        )> }
      )> }
    ) }
  )> }
);

export type AppleDistributionCertificateByAccountQueryVariables = Exact<{
  accountName: Scalars['String'];
}>;


export type AppleDistributionCertificateByAccountQuery = (
  { __typename?: 'RootQuery' }
  & { account: (
    { __typename?: 'AccountQuery' }
    & { byName: (
      { __typename?: 'Account' }
      & Pick<Account, 'id'>
      & { appleDistributionCertificates: Array<(
        { __typename?: 'AppleDistributionCertificate' }
        & Pick<AppleDistributionCertificate, 'id'>
        & { appleTeam?: Maybe<(
          { __typename?: 'AppleTeam' }
          & Pick<AppleTeam, 'id'>
          & AppleTeamFragment
        )> }
        & AppleDistributionCertificateFragment
      )> }
    ) }
  ) }
);

export type AppleProvisioningProfilesByAppQueryVariables = Exact<{
  projectFullName: Scalars['String'];
  appleAppIdentifierId: Scalars['String'];
  iosDistributionType: IosDistributionType;
}>;


export type AppleProvisioningProfilesByAppQuery = (
  { __typename?: 'RootQuery' }
  & { app?: Maybe<(
    { __typename?: 'AppQuery' }
    & { byFullName: (
      { __typename?: 'App' }
      & Pick<App, 'id'>
      & { iosAppCredentials: Array<(
        { __typename?: 'IosAppCredentials' }
        & Pick<IosAppCredentials, 'id'>
        & { iosAppBuildCredentialsArray: Array<(
          { __typename?: 'IosAppBuildCredentials' }
          & Pick<IosAppBuildCredentials, 'id'>
          & { provisioningProfile?: Maybe<(
            { __typename?: 'AppleProvisioningProfile' }
            & Pick<AppleProvisioningProfile, 'id'>
            & { appleTeam?: Maybe<(
              { __typename?: 'AppleTeam' }
              & Pick<AppleTeam, 'id'>
              & AppleTeamFragment
            )>, appleDevices: Array<(
              { __typename?: 'AppleDevice' }
              & Pick<AppleDevice, 'id'>
              & AppleDeviceFragment
            )>, appleAppIdentifier: (
              { __typename?: 'AppleAppIdentifier' }
              & Pick<AppleAppIdentifier, 'id'>
              & AppleAppIdentifierFragment
            ) }
            & AppleProvisioningProfileFragment
          )> }
        )> }
      )> }
    ) }
  )> }
);

export type AppleTeamsByAccountNameQueryVariables = Exact<{
  accountName: Scalars['String'];
}>;


export type AppleTeamsByAccountNameQuery = (
  { __typename?: 'RootQuery' }
  & { account: (
    { __typename?: 'AccountQuery' }
    & { byName: (
      { __typename?: 'Account' }
      & Pick<Account, 'id'>
      & { appleTeams: Array<(
        { __typename?: 'AppleTeam' }
        & Pick<AppleTeam, 'id' | 'appleTeamName' | 'appleTeamIdentifier'>
      )> }
    ) }
  ) }
);

export type AppleTeamByIdentifierQueryVariables = Exact<{
  accountId: Scalars['ID'];
  appleTeamIdentifier: Scalars['String'];
}>;


export type AppleTeamByIdentifierQuery = (
  { __typename?: 'RootQuery' }
  & { appleTeam: (
    { __typename?: 'AppleTeamQuery' }
    & { byAppleTeamIdentifier?: Maybe<(
      { __typename?: 'AppleTeam' }
      & Pick<AppleTeam, 'id'>
      & AppleTeamFragment
    )> }
  ) }
);

export type IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQueryVariables = Exact<{
  projectFullName: Scalars['String'];
  appleAppIdentifierId: Scalars['String'];
  iosDistributionType: IosDistributionType;
}>;


export type IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQuery = (
  { __typename?: 'RootQuery' }
  & { app?: Maybe<(
    { __typename?: 'AppQuery' }
    & { byFullName: (
      { __typename?: 'App' }
      & Pick<App, 'id'>
      & { iosAppCredentials: Array<(
        { __typename?: 'IosAppCredentials' }
        & Pick<IosAppCredentials, 'id'>
        & { iosAppBuildCredentialsArray: Array<(
          { __typename?: 'IosAppBuildCredentials' }
          & Pick<IosAppBuildCredentials, 'id'>
          & IosAppBuildCredentialsFragment
        )> }
      )> }
    ) }
  )> }
);

export type IosAppCredentialsByAppIdentifierIdQueryVariables = Exact<{
  projectFullName: Scalars['String'];
  appleAppIdentifierId: Scalars['String'];
}>;


export type IosAppCredentialsByAppIdentifierIdQuery = (
  { __typename?: 'RootQuery' }
  & { app?: Maybe<(
    { __typename?: 'AppQuery' }
    & { byFullName: (
      { __typename?: 'App' }
      & Pick<App, 'id'>
      & { iosAppCredentials: Array<(
        { __typename?: 'IosAppCredentials' }
        & Pick<IosAppCredentials, 'id'>
        & IosAppCredentialsFragment
      )> }
    ) }
  )> }
);

export type IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQueryVariables = Exact<{
  projectFullName: Scalars['String'];
  appleAppIdentifierId: Scalars['String'];
  iosDistributionType: IosDistributionType;
}>;


export type IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery = (
  { __typename?: 'RootQuery' }
  & { app?: Maybe<(
    { __typename?: 'AppQuery' }
    & { byFullName: (
      { __typename?: 'App' }
      & Pick<App, 'id'>
      & { iosAppCredentials: Array<(
        { __typename?: 'IosAppCredentials' }
        & Pick<IosAppCredentials, 'id'>
        & { iosAppBuildCredentialsArray: Array<(
          { __typename?: 'IosAppBuildCredentials' }
          & Pick<IosAppBuildCredentials, 'id'>
          & IosAppBuildCredentialsFragment
        )> }
        & IosAppCredentialsFragment
      )> }
    ) }
  )> }
);

export type CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQueryVariables = Exact<{
  projectFullName: Scalars['String'];
  appleAppIdentifierId: Scalars['String'];
}>;


export type CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery = (
  { __typename?: 'RootQuery' }
  & { app?: Maybe<(
    { __typename?: 'AppQuery' }
    & { byFullName: (
      { __typename?: 'App' }
      & Pick<App, 'id'>
      & { iosAppCredentials: Array<(
        { __typename?: 'IosAppCredentials' }
        & Pick<IosAppCredentials, 'id'>
        & CommonIosAppCredentialsFragment
      )> }
    ) }
  )> }
);

export type GetSignedUploadMutationVariables = Exact<{
  contentTypes: Array<Scalars['String']>;
}>;


export type GetSignedUploadMutation = (
  { __typename?: 'RootMutation' }
  & { asset: (
    { __typename?: 'AssetMutation' }
    & { getSignedAssetUploadSpecifications?: Maybe<(
      { __typename?: 'GetSignedAssetUploadSpecificationsResult' }
      & Pick<GetSignedAssetUploadSpecificationsResult, 'specifications'>
    )> }
  ) }
);

export type UpdatePublishMutationVariables = Exact<{
  publishUpdateGroupInput?: Maybe<PublishUpdateGroupInput>;
}>;


export type UpdatePublishMutation = (
  { __typename?: 'RootMutation' }
  & { updateRelease: (
    { __typename?: 'UpdateReleaseMutation' }
    & { publishUpdateGroup: Array<Maybe<(
      { __typename?: 'Update' }
      & Pick<Update, 'id' | 'updateGroup'>
    )>> }
  ) }
);

export type BuildsByIdQueryVariables = Exact<{
  buildId: Scalars['ID'];
}>;


export type BuildsByIdQuery = (
  { __typename?: 'RootQuery' }
  & { builds: (
    { __typename?: 'BuildQuery' }
    & { byId: (
      { __typename?: 'Build' }
      & Pick<Build, 'id' | 'platform' | 'status' | 'createdAt'>
      & { artifacts?: Maybe<(
        { __typename?: 'BuildArtifacts' }
        & Pick<BuildArtifacts, 'buildUrl'>
      )> }
    ) }
  ) }
);

export type BuildsForAppQueryVariables = Exact<{
  appId: Scalars['String'];
  limit?: Maybe<Scalars['Int']>;
  offset?: Maybe<Scalars['Int']>;
  platform?: Maybe<AppPlatform>;
  status?: Maybe<BuildStatus>;
}>;


export type BuildsForAppQuery = (
  { __typename?: 'RootQuery' }
  & { builds: (
    { __typename?: 'BuildQuery' }
    & { allForApp: Array<Maybe<(
      { __typename?: 'Build' }
      & Pick<Build, 'id' | 'platform' | 'status' | 'createdAt'>
      & { artifacts?: Maybe<(
        { __typename?: 'BuildArtifacts' }
        & Pick<BuildArtifacts, 'buildUrl'>
      )> }
    )>> }
  ) }
);

export type PendingBuildsForAccountAndPlatformQueryVariables = Exact<{
  accountName: Scalars['String'];
  platform: AppPlatform;
}>;


export type PendingBuildsForAccountAndPlatformQuery = (
  { __typename?: 'RootQuery' }
  & { account: (
    { __typename?: 'AccountQuery' }
    & { byName: (
      { __typename?: 'Account' }
      & Pick<Account, 'id'>
      & { inQueueBuilds: Array<(
        { __typename?: 'Build' }
        & Pick<Build, 'id' | 'platform'>
      )>, inProgressBuilds: Array<(
        { __typename?: 'Build' }
        & Pick<Build, 'id' | 'platform'>
      )> }
    ) }
  ) }
);

export type ProjectByUsernameAndSlugQueryVariables = Exact<{
  username: Scalars['String'];
  slug: Scalars['String'];
}>;


export type ProjectByUsernameAndSlugQuery = (
  { __typename?: 'RootQuery' }
  & { project: (
    { __typename?: 'ProjectQuery' }
    & { byUsernameAndSlug: (
      { __typename?: 'Snack' }
      & Pick<Snack, 'id'>
    ) | (
      { __typename?: 'App' }
      & Pick<App, 'id'>
    ) }
  ) }
);

export type GetAssetMetadataQueryVariables = Exact<{
  storageKeys: Array<Scalars['String']>;
}>;


export type GetAssetMetadataQuery = (
  { __typename?: 'RootQuery' }
  & { asset: (
    { __typename?: 'AssetQuery' }
    & { metadata: Array<(
      { __typename?: 'AssetMetadataResult' }
      & Pick<AssetMetadataResult, 'storageKey' | 'status'>
    )> }
  ) }
);

export type CurrentUserQueryVariables = Exact<{ [key: string]: never; }>;


export type CurrentUserQuery = (
  { __typename?: 'RootQuery' }
  & { meActor?: Maybe<(
    { __typename: 'User' }
    & Pick<User, 'username' | 'id' | 'isExpoAdmin'>
    & { accounts: Array<(
      { __typename?: 'Account' }
      & Pick<Account, 'id' | 'name'>
    )> }
  ) | (
    { __typename: 'Robot' }
    & Pick<Robot, 'firstName' | 'id' | 'isExpoAdmin'>
    & { accounts: Array<(
      { __typename?: 'Account' }
      & Pick<Account, 'id' | 'name'>
    )> }
  )> }
);

export type AppFragment = (
  { __typename?: 'App' }
  & Pick<App, 'id' | 'fullName'>
);

export type AppleAppIdentifierFragment = (
  { __typename?: 'AppleAppIdentifier' }
  & Pick<AppleAppIdentifier, 'id' | 'bundleIdentifier'>
);

export type AppleDeviceFragment = (
  { __typename?: 'AppleDevice' }
  & Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'model' | 'deviceClass'>
);

export type AppleDeviceRegistrationRequestFragment = (
  { __typename?: 'AppleDeviceRegistrationRequest' }
  & Pick<AppleDeviceRegistrationRequest, 'id'>
);

export type AppleDistributionCertificateFragment = (
  { __typename?: 'AppleDistributionCertificate' }
  & Pick<AppleDistributionCertificate, 'id' | 'certificateP12' | 'certificatePassword' | 'serialNumber' | 'developerPortalIdentifier' | 'validityNotBefore' | 'validityNotAfter'>
  & { appleTeam?: Maybe<(
    { __typename?: 'AppleTeam' }
    & Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>
  )> }
);

export type AppleProvisioningProfileFragment = (
  { __typename?: 'AppleProvisioningProfile' }
  & Pick<AppleProvisioningProfile, 'id' | 'expiration' | 'developerPortalIdentifier' | 'provisioningProfile'>
  & { appleTeam?: Maybe<(
    { __typename?: 'AppleTeam' }
    & Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>
  )>, appleDevices: Array<(
    { __typename?: 'AppleDevice' }
    & Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'model' | 'deviceClass'>
  )> }
);

export type AppleTeamFragment = (
  { __typename?: 'AppleTeam' }
  & Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>
);

export type IosAppBuildCredentialsFragment = (
  { __typename?: 'IosAppBuildCredentials' }
  & Pick<IosAppBuildCredentials, 'id' | 'iosDistributionType'>
  & { distributionCertificate?: Maybe<(
    { __typename?: 'AppleDistributionCertificate' }
    & Pick<AppleDistributionCertificate, 'id' | 'certificateP12' | 'certificatePassword' | 'serialNumber' | 'developerPortalIdentifier' | 'validityNotBefore' | 'validityNotAfter' | 'updatedAt'>
    & { appleTeam?: Maybe<(
      { __typename?: 'AppleTeam' }
      & Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>
    )> }
  )>, provisioningProfile?: Maybe<(
    { __typename?: 'AppleProvisioningProfile' }
    & Pick<AppleProvisioningProfile, 'id' | 'expiration' | 'developerPortalIdentifier' | 'provisioningProfile' | 'updatedAt' | 'status'>
    & { appleDevices: Array<(
      { __typename?: 'AppleDevice' }
      & Pick<AppleDevice, 'id' | 'identifier' | 'name' | 'model' | 'deviceClass'>
    )>, appleTeam?: Maybe<(
      { __typename?: 'AppleTeam' }
      & Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>
    )> }
  )> }
);

export type IosAppCredentialsFragment = (
  { __typename?: 'IosAppCredentials' }
  & Pick<IosAppCredentials, 'id'>
);

export type CommonIosAppCredentialsFragment = (
  { __typename?: 'IosAppCredentials' }
  & Pick<IosAppCredentials, 'id'>
  & { app: (
    { __typename?: 'App' }
    & Pick<App, 'id'>
    & AppFragment
  ), appleTeam?: Maybe<(
    { __typename?: 'AppleTeam' }
    & Pick<AppleTeam, 'id'>
    & AppleTeamFragment
  )>, appleAppIdentifier: (
    { __typename?: 'AppleAppIdentifier' }
    & Pick<AppleAppIdentifier, 'id'>
    & AppleAppIdentifierFragment
  ), iosAppBuildCredentialsArray: Array<(
    { __typename?: 'IosAppBuildCredentials' }
    & Pick<IosAppBuildCredentials, 'id'>
    & IosAppBuildCredentialsFragment
  )> }
);
