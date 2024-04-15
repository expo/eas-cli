/**
 * This file was generated using GraphQL Codegen
 * Command: yarn generate-graphql-code
 * Run this during development for automatic type generation when editing GraphQL documents
 * For more info and docs, visit https://graphql-code-generator.com/
 */

export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: any; output: any; }
  JSON: { input: any; output: any; }
  JSONObject: { input: any; output: any; }
};

export type AcceptUserInvitationResult = {
  __typename?: 'AcceptUserInvitationResult';
  success: Scalars['Boolean']['output'];
};

/** A method of authentication for an Actor */
export type AccessToken = {
  __typename?: 'AccessToken';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  lastUsedAt?: Maybe<Scalars['DateTime']['output']>;
  note?: Maybe<Scalars['String']['output']>;
  owner: Actor;
  revokedAt?: Maybe<Scalars['DateTime']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  visibleTokenPrefix: Scalars['String']['output'];
};

export type AccessTokenMutation = {
  __typename?: 'AccessTokenMutation';
  /** Create an AccessToken for an Actor */
  createAccessToken: CreateAccessTokenResponse;
  /** Delete an AccessToken */
  deleteAccessToken: DeleteAccessTokenResult;
  /** Revoke an AccessToken */
  setAccessTokenRevoked: AccessToken;
};


export type AccessTokenMutationCreateAccessTokenArgs = {
  createAccessTokenData: CreateAccessTokenInput;
};


export type AccessTokenMutationDeleteAccessTokenArgs = {
  id: Scalars['ID']['input'];
};


export type AccessTokenMutationSetAccessTokenRevokedArgs = {
  id: Scalars['ID']['input'];
  revoked?: InputMaybe<Scalars['Boolean']['input']>;
};

/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type Account = {
  __typename?: 'Account';
  /** @deprecated Legacy access tokens are deprecated */
  accessTokens: Array<Maybe<AccessToken>>;
  /** Coalesced project activity for all apps belonging to this account. */
  activityTimelineProjectActivities: Array<ActivityTimelineProjectActivity>;
  appCount: Scalars['Int']['output'];
  /** @deprecated Use appStoreConnectApiKeysPaginated */
  appStoreConnectApiKeys: Array<AppStoreConnectApiKey>;
  appStoreConnectApiKeysPaginated: AccountAppStoreConnectApiKeysConnection;
  appleAppIdentifiers: Array<AppleAppIdentifier>;
  /** @deprecated Use appleDevicesPaginated */
  appleDevices: Array<AppleDevice>;
  appleDevicesPaginated: AccountAppleDevicesConnection;
  /** @deprecated Use appleDistributionCertificatesPaginated */
  appleDistributionCertificates: Array<AppleDistributionCertificate>;
  appleDistributionCertificatesPaginated: AccountAppleDistributionCertificatesConnection;
  /** @deprecated Use appleProvisioningProfilesPaginated */
  appleProvisioningProfiles: Array<AppleProvisioningProfile>;
  appleProvisioningProfilesPaginated: AccountAppleProvisioningProfilesConnection;
  /** @deprecated Use applePushKeysPaginated */
  applePushKeys: Array<ApplePushKey>;
  applePushKeysPaginated: AccountApplePushKeysConnection;
  /** @deprecated Use appleTeamsPaginated */
  appleTeams: Array<AppleTeam>;
  /** iOS credentials for account */
  appleTeamsPaginated: AccountAppleTeamsConnection;
  /**
   * Apps associated with this account
   * @deprecated Use appsPaginated
   */
  apps: Array<App>;
  /** Paginated list of apps associated with this account. By default sorted by name. Use filter to adjust the sorting order. */
  appsPaginated: AccountAppsConnection;
  /** @deprecated Build packs are no longer supported */
  availableBuilds?: Maybe<Scalars['Int']['output']>;
  /** Billing information. Only visible to members with the ADMIN or OWNER role. */
  billing?: Maybe<Billing>;
  billingPeriod: BillingPeriod;
  /** Build Jobs associated with this account */
  buildJobs: Array<BuildJob>;
  /**
   * Coalesced Build (EAS) or BuildJob (Classic) for all apps belonging to this account.
   * @deprecated Use activityTimelineProjectActivities with filterTypes instead
   */
  buildOrBuildJobs: Array<BuildOrBuildJob>;
  /** (EAS Build) Builds associated with this account */
  builds: Array<Build>;
  createdAt: Scalars['DateTime']['output'];
  /** Environment secrets for an account */
  environmentSecrets: Array<EnvironmentSecret>;
  /** GitHub App installations for an account */
  githubAppInstallations: Array<GitHubAppInstallation>;
  /** @deprecated Use googleServiceAccountKeysPaginated */
  googleServiceAccountKeys: Array<GoogleServiceAccountKey>;
  /** Android credentials for account */
  googleServiceAccountKeysPaginated: AccountGoogleServiceAccountKeysConnection;
  id: Scalars['ID']['output'];
  isCurrent: Scalars['Boolean']['output'];
  isDisabled: Scalars['Boolean']['output'];
  /** Whether this account has SSO enabled. Can be queried by all members. */
  isSSOEnabled: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  /** Offers set on this account */
  offers?: Maybe<Array<Offer>>;
  /** Owning User of this account if personal account */
  owner?: Maybe<User>;
  /** Owning UserActor of this account if personal account */
  ownerUserActor?: Maybe<UserActor>;
  pushSecurityEnabled: Scalars['Boolean']['output'];
  /** @deprecated Legacy access tokens are deprecated */
  requiresAccessTokenForPushSecurity: Scalars['Boolean']['output'];
  /** Snacks associated with this account */
  snacks: Array<Snack>;
  /** SSO configuration for this account */
  ssoConfiguration?: Maybe<AccountSsoConfiguration>;
  /** Subscription info visible to members that have VIEWER role */
  subscription?: Maybe<SubscriptionDetails>;
  /** @deprecated No longer needed */
  subscriptionChangesPending?: Maybe<Scalars['Boolean']['output']>;
  /** Coalesced project activity for an app using pagination */
  timelineActivity: TimelineActivityConnection;
  /** @deprecated See isCurrent */
  unlimitedBuilds: Scalars['Boolean']['output'];
  updatedAt: Scalars['DateTime']['output'];
  /** Account query object for querying EAS usage metrics */
  usageMetrics: AccountUsageMetrics;
  /**
   * Owning UserActor of this account if personal account
   * @deprecated Deprecated in favor of ownerUserActor
   */
  userActorOwner?: Maybe<UserActor>;
  /** Pending user invitations for this account */
  userInvitations: Array<UserInvitation>;
  /** Actors associated with this account and permissions they hold */
  users: Array<UserPermission>;
  /** Permission info for the viewer on this account */
  viewerUserPermission: UserPermission;
  /** @deprecated Build packs are no longer supported */
  willAutoRenewBuilds?: Maybe<Scalars['Boolean']['output']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountActivityTimelineProjectActivitiesArgs = {
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  filterTypes?: InputMaybe<Array<ActivityTimelineProjectActivityType>>;
  limit: Scalars['Int']['input'];
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppStoreConnectApiKeysPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleAppIdentifiersArgs = {
  bundleIdentifier?: InputMaybe<Scalars['String']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleDevicesArgs = {
  identifier?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleDevicesPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AppleDeviceFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleDistributionCertificatesPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleProvisioningProfilesArgs = {
  appleAppIdentifierId?: InputMaybe<Scalars['ID']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleProvisioningProfilesPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountApplePushKeysPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleTeamsArgs = {
  appleTeamIdentifier?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppleTeamsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AppleTeamFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppsArgs = {
  includeUnpublished?: InputMaybe<Scalars['Boolean']['input']>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountAppsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<AccountAppsFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountBillingPeriodArgs = {
  date: Scalars['DateTime']['input'];
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountBuildJobsArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  status?: InputMaybe<BuildJobStatus>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountBuildOrBuildJobsArgs = {
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  limit: Scalars['Int']['input'];
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountBuildsArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  platform?: InputMaybe<AppPlatform>;
  status?: InputMaybe<BuildStatus>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountEnvironmentSecretsArgs = {
  filterNames?: InputMaybe<Array<Scalars['String']['input']>>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountGoogleServiceAccountKeysPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountSnacksArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/**
 * An account is a container owning projects, credentials, billing and other organization
 * data and settings. Actors may own and be members of accounts.
 */
export type AccountTimelineActivityArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TimelineActivityFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type AccountAppStoreConnectApiKeysConnection = {
  __typename?: 'AccountAppStoreConnectApiKeysConnection';
  edges: Array<AccountAppStoreConnectApiKeysEdge>;
  pageInfo: PageInfo;
};

export type AccountAppStoreConnectApiKeysEdge = {
  __typename?: 'AccountAppStoreConnectApiKeysEdge';
  cursor: Scalars['String']['output'];
  node: AppStoreConnectApiKey;
};

export type AccountAppleDevicesConnection = {
  __typename?: 'AccountAppleDevicesConnection';
  edges: Array<AccountAppleDevicesEdge>;
  pageInfo: PageInfo;
};

export type AccountAppleDevicesEdge = {
  __typename?: 'AccountAppleDevicesEdge';
  cursor: Scalars['String']['output'];
  node: AppleDevice;
};

export type AccountAppleDistributionCertificatesConnection = {
  __typename?: 'AccountAppleDistributionCertificatesConnection';
  edges: Array<AccountAppleDistributionCertificatesEdge>;
  pageInfo: PageInfo;
};

export type AccountAppleDistributionCertificatesEdge = {
  __typename?: 'AccountAppleDistributionCertificatesEdge';
  cursor: Scalars['String']['output'];
  node: AppleDistributionCertificate;
};

export type AccountAppleProvisioningProfilesConnection = {
  __typename?: 'AccountAppleProvisioningProfilesConnection';
  edges: Array<AccountAppleProvisioningProfilesEdge>;
  pageInfo: PageInfo;
};

export type AccountAppleProvisioningProfilesEdge = {
  __typename?: 'AccountAppleProvisioningProfilesEdge';
  cursor: Scalars['String']['output'];
  node: AppleProvisioningProfile;
};

export type AccountApplePushKeysConnection = {
  __typename?: 'AccountApplePushKeysConnection';
  edges: Array<AccountApplePushKeysEdge>;
  pageInfo: PageInfo;
};

export type AccountApplePushKeysEdge = {
  __typename?: 'AccountApplePushKeysEdge';
  cursor: Scalars['String']['output'];
  node: ApplePushKey;
};

export type AccountAppleTeamsConnection = {
  __typename?: 'AccountAppleTeamsConnection';
  edges: Array<AccountAppleTeamsEdge>;
  pageInfo: PageInfo;
};

export type AccountAppleTeamsEdge = {
  __typename?: 'AccountAppleTeamsEdge';
  cursor: Scalars['String']['output'];
  node: AppleTeam;
};

export type AccountAppsConnection = {
  __typename?: 'AccountAppsConnection';
  edges: Array<AccountAppsEdge>;
  pageInfo: PageInfo;
};

export type AccountAppsEdge = {
  __typename?: 'AccountAppsEdge';
  cursor: Scalars['String']['output'];
  node: App;
};

export type AccountAppsFilterInput = {
  searchTerm?: InputMaybe<Scalars['String']['input']>;
  sortByField: AccountAppsSortByField;
};

export enum AccountAppsSortByField {
  LatestActivityTime = 'LATEST_ACTIVITY_TIME',
  /**
   * Name prefers the display name but falls back to full_name with @account/
   * part stripped.
   */
  Name = 'NAME'
}

export type AccountDataInput = {
  name: Scalars['String']['input'];
};

export type AccountGoogleServiceAccountKeysConnection = {
  __typename?: 'AccountGoogleServiceAccountKeysConnection';
  edges: Array<AccountGoogleServiceAccountKeysEdge>;
  pageInfo: PageInfo;
};

export type AccountGoogleServiceAccountKeysEdge = {
  __typename?: 'AccountGoogleServiceAccountKeysEdge';
  cursor: Scalars['String']['output'];
  node: GoogleServiceAccountKey;
};

export type AccountMutation = {
  __typename?: 'AccountMutation';
  /**
   * Makes a one time purchase
   * @deprecated Build packs are no longer supported
   */
  buyProduct?: Maybe<Account>;
  /** Cancels all subscriptions immediately */
  cancelAllSubscriptionsImmediately: Account;
  /** Cancel scheduled subscription change */
  cancelScheduledSubscriptionChange: Account;
  /** Cancels the active subscription */
  cancelSubscription: Account;
  /** Upgrades or downgrades the active subscription to the newPlanIdentifier, which must be one of the EAS plans (i.e., Production or Enterprise). */
  changePlan: Account;
  /** Add specified account Permissions for Actor. Actor must already have at least one permission on the account. */
  grantActorPermissions: Account;
  /** Rename this account and the primary user's username if this account is a personal account */
  rename: Account;
  /** Requests a refund for the specified charge by requesting a manual refund from support */
  requestRefund?: Maybe<Scalars['Boolean']['output']>;
  /** Revoke specified Permissions for Actor. Actor must already have at least one permission on the account. */
  revokeActorPermissions: Account;
  /**
   * Update setting to purchase new build packs when the current one is consumed
   * @deprecated Build packs are no longer supported
   */
  setBuildAutoRenew?: Maybe<Account>;
  /** Set payment details */
  setPaymentSource: Account;
  /** Require authorization to send push notifications for experiences owned by this account */
  setPushSecurityEnabled: Account;
};


export type AccountMutationBuyProductArgs = {
  accountName: Scalars['ID']['input'];
  autoRenew?: InputMaybe<Scalars['Boolean']['input']>;
  paymentSource?: InputMaybe<Scalars['ID']['input']>;
  productId: Scalars['ID']['input'];
};


export type AccountMutationCancelAllSubscriptionsImmediatelyArgs = {
  accountID: Scalars['ID']['input'];
};


export type AccountMutationCancelScheduledSubscriptionChangeArgs = {
  accountID: Scalars['ID']['input'];
};


export type AccountMutationCancelSubscriptionArgs = {
  accountName: Scalars['ID']['input'];
};


export type AccountMutationChangePlanArgs = {
  accountID: Scalars['ID']['input'];
  couponCode?: InputMaybe<Scalars['String']['input']>;
  newPlanIdentifier: Scalars['String']['input'];
};


export type AccountMutationGrantActorPermissionsArgs = {
  accountID: Scalars['ID']['input'];
  actorID: Scalars['ID']['input'];
  permissions?: InputMaybe<Array<InputMaybe<Permission>>>;
};


export type AccountMutationRenameArgs = {
  accountID: Scalars['ID']['input'];
  newName: Scalars['String']['input'];
};


export type AccountMutationRequestRefundArgs = {
  accountID: Scalars['ID']['input'];
  chargeID: Scalars['ID']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type AccountMutationRevokeActorPermissionsArgs = {
  accountID: Scalars['ID']['input'];
  actorID: Scalars['ID']['input'];
  permissions?: InputMaybe<Array<InputMaybe<Permission>>>;
};


export type AccountMutationSetBuildAutoRenewArgs = {
  accountName: Scalars['ID']['input'];
  autoRenew?: InputMaybe<Scalars['Boolean']['input']>;
};


export type AccountMutationSetPaymentSourceArgs = {
  accountName: Scalars['ID']['input'];
  paymentSource: Scalars['ID']['input'];
};


export type AccountMutationSetPushSecurityEnabledArgs = {
  accountID: Scalars['ID']['input'];
  pushSecurityEnabled: Scalars['Boolean']['input'];
};

export type AccountNotificationSubscriptionInput = {
  accountId: Scalars['ID']['input'];
  event: NotificationEvent;
  type: NotificationType;
  userId: Scalars['ID']['input'];
};

export type AccountQuery = {
  __typename?: 'AccountQuery';
  /** Query an Account by ID */
  byId: Account;
  /** Query an Account by name */
  byName: Account;
};


export type AccountQueryByIdArgs = {
  accountId: Scalars['String']['input'];
};


export type AccountQueryByNameArgs = {
  accountName: Scalars['String']['input'];
};

/** Auth configuration data for an SSO account. */
export type AccountSsoConfiguration = {
  __typename?: 'AccountSSOConfiguration';
  authProtocol: AuthProtocolType;
  authProviderIdentifier: Scalars['String']['output'];
  clientIdentifier: Scalars['String']['output'];
  clientSecret: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  issuer: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type AccountSsoConfigurationData = {
  authProtocol: AuthProtocolType;
  authProviderIdentifier: Scalars['String']['input'];
  clientIdentifier: Scalars['String']['input'];
  clientSecret: Scalars['String']['input'];
  issuer: Scalars['String']['input'];
};

export type AccountSsoConfigurationMutation = {
  __typename?: 'AccountSSOConfigurationMutation';
  /** Create an AccountSSOConfiguration for an Account */
  createAccountSSOConfiguration: AccountSsoConfiguration;
  /** Delete an AccountSSOConfiguration */
  deleteAccountSSOConfiguration: DeleteAccountSsoConfigurationResult;
  /** Update an AccountSSOConfiguration */
  updateAccountSSOConfiguration: AccountSsoConfiguration;
};


export type AccountSsoConfigurationMutationCreateAccountSsoConfigurationArgs = {
  accountId: Scalars['ID']['input'];
  accountSSOConfigurationData: AccountSsoConfigurationData;
};


export type AccountSsoConfigurationMutationDeleteAccountSsoConfigurationArgs = {
  id: Scalars['ID']['input'];
};


export type AccountSsoConfigurationMutationUpdateAccountSsoConfigurationArgs = {
  accountSSOConfigurationData: AccountSsoConfigurationData;
  id: Scalars['ID']['input'];
};

/** Public auth configuration data for an SSO account. */
export type AccountSsoConfigurationPublicData = {
  __typename?: 'AccountSSOConfigurationPublicData';
  authProtocol: AuthProtocolType;
  authProviderIdentifier: Scalars['String']['output'];
  authorizationUrl: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  issuer: Scalars['String']['output'];
};

export type AccountSsoConfigurationPublicDataQuery = {
  __typename?: 'AccountSSOConfigurationPublicDataQuery';
  /** Get AccountSSOConfiguration public data by account name */
  publicDataByAccountName: AccountSsoConfigurationPublicData;
};


export type AccountSsoConfigurationPublicDataQueryPublicDataByAccountNameArgs = {
  accountName: Scalars['String']['input'];
};

export type AccountUsageEasBuildMetadata = {
  __typename?: 'AccountUsageEASBuildMetadata';
  billingResourceClass: EasBuildBillingResourceClass;
  platform: AppPlatform;
};

export type AccountUsageEasJobsMetadata = {
  __typename?: 'AccountUsageEASJobsMetadata';
  resourceClassDisplayName: Scalars['String']['output'];
};

export type AccountUsageMetadata = AccountUsageEasBuildMetadata | AccountUsageEasJobsMetadata;

export type AccountUsageMetric = {
  __typename?: 'AccountUsageMetric';
  id: Scalars['ID']['output'];
  metricType: UsageMetricType;
  serviceMetric: EasServiceMetric;
  timestamp: Scalars['DateTime']['output'];
  value: Scalars['Float']['output'];
};

export type AccountUsageMetrics = {
  __typename?: 'AccountUsageMetrics';
  byBillingPeriod: UsageMetricTotal;
  metricsForServiceMetric: Array<AccountUsageMetric>;
};


export type AccountUsageMetricsByBillingPeriodArgs = {
  date: Scalars['DateTime']['input'];
  service?: InputMaybe<EasService>;
};


export type AccountUsageMetricsMetricsForServiceMetricArgs = {
  filterParams?: InputMaybe<Scalars['JSONObject']['input']>;
  granularity: UsageMetricsGranularity;
  serviceMetric: EasServiceMetric;
  timespan: UsageMetricsTimespan;
};

export type ActivityTimelineProjectActivity = {
  activityTimestamp: Scalars['DateTime']['output'];
  actor?: Maybe<Actor>;
  id: Scalars['ID']['output'];
};

export enum ActivityTimelineProjectActivityType {
  Build = 'BUILD',
  BuildJob = 'BUILD_JOB',
  Submission = 'SUBMISSION',
  Update = 'UPDATE'
}

/** A regular user, SSO user, or robot that can authenticate with Expo services and be a member of accounts. */
export type Actor = {
  /** Access Tokens belonging to this actor */
  accessTokens: Array<AccessToken>;
  /** Associated accounts */
  accounts: Array<Account>;
  created: Scalars['DateTime']['output'];
  /**
   * Best-effort human readable name for this actor for use in user interfaces during action attribution.
   * For example, when displaying a sentence indicating that actor X created a build or published an update.
   */
  displayName: Scalars['String']['output'];
  /** Experiments associated with this actor */
  experiments: Array<ActorExperiment>;
  /**
   * Server feature gate values for this actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject']['output'];
  firstName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isExpoAdmin: Scalars['Boolean']['output'];
};


/** A regular user, SSO user, or robot that can authenticate with Expo services and be a member of accounts. */
export type ActorFeatureGatesArgs = {
  filter?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type ActorExperiment = {
  __typename?: 'ActorExperiment';
  createdAt: Scalars['DateTime']['output'];
  enabled: Scalars['Boolean']['output'];
  experiment: Experiment;
  id: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ActorExperimentMutation = {
  __typename?: 'ActorExperimentMutation';
  /** Create or update the value of a User Experiment */
  createOrUpdateActorExperiment: ActorExperiment;
};


export type ActorExperimentMutationCreateOrUpdateActorExperimentArgs = {
  enabled: Scalars['Boolean']['input'];
  experiment: Experiment;
};

export type ActorQuery = {
  __typename?: 'ActorQuery';
  /**
   * Query an Actor by ID
   * @deprecated Public actor queries are no longer supported
   */
  byId: Actor;
};


export type ActorQueryByIdArgs = {
  id: Scalars['ID']['input'];
};

export type AddUserInput = {
  audience?: InputMaybe<MailchimpAudience>;
  email: Scalars['String']['input'];
  tags?: InputMaybe<Array<MailchimpTag>>;
};

export type AddUserPayload = {
  __typename?: 'AddUserPayload';
  email_address?: Maybe<Scalars['String']['output']>;
  id?: Maybe<Scalars['String']['output']>;
  list_id?: Maybe<Scalars['String']['output']>;
  status?: Maybe<Scalars['String']['output']>;
  tags?: Maybe<Array<MailchimpTagPayload>>;
  timestamp_signup?: Maybe<Scalars['String']['output']>;
};

export type AddonDetails = {
  __typename?: 'AddonDetails';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  nextInvoice?: Maybe<Scalars['DateTime']['output']>;
  planId: Scalars['String']['output'];
  willCancel?: Maybe<Scalars['Boolean']['output']>;
};

export type Address = {
  __typename?: 'Address';
  city?: Maybe<Scalars['String']['output']>;
  country?: Maybe<Scalars['String']['output']>;
  line1?: Maybe<Scalars['String']['output']>;
  state?: Maybe<Scalars['String']['output']>;
  zip?: Maybe<Scalars['String']['output']>;
};

export type AndroidAppBuildCredentials = {
  __typename?: 'AndroidAppBuildCredentials';
  androidKeystore?: Maybe<AndroidKeystore>;
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  isLegacy: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

/** @isDefault: if set, these build credentials will become the default for the Android app. All other build credentials will have their default status set to false. */
export type AndroidAppBuildCredentialsInput = {
  isDefault: Scalars['Boolean']['input'];
  keystoreId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};

export type AndroidAppBuildCredentialsMutation = {
  __typename?: 'AndroidAppBuildCredentialsMutation';
  /** Create a set of build credentials for an Android app */
  createAndroidAppBuildCredentials: AndroidAppBuildCredentials;
  /** delete a set of build credentials for an Android app */
  deleteAndroidAppBuildCredentials: DeleteAndroidAppBuildCredentialsResult;
  /** Set the build credentials to be the default for the Android app */
  setDefault: AndroidAppBuildCredentials;
  /** Set the keystore to be used for an Android app */
  setKeystore: AndroidAppBuildCredentials;
  /** Set the name of a set of build credentials to be used for an Android app */
  setName: AndroidAppBuildCredentials;
};


export type AndroidAppBuildCredentialsMutationCreateAndroidAppBuildCredentialsArgs = {
  androidAppBuildCredentialsInput: AndroidAppBuildCredentialsInput;
  androidAppCredentialsId: Scalars['ID']['input'];
};


export type AndroidAppBuildCredentialsMutationDeleteAndroidAppBuildCredentialsArgs = {
  id: Scalars['ID']['input'];
};


export type AndroidAppBuildCredentialsMutationSetDefaultArgs = {
  id: Scalars['ID']['input'];
  isDefault: Scalars['Boolean']['input'];
};


export type AndroidAppBuildCredentialsMutationSetKeystoreArgs = {
  id: Scalars['ID']['input'];
  keystoreId: Scalars['ID']['input'];
};


export type AndroidAppBuildCredentialsMutationSetNameArgs = {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};

export type AndroidAppCredentials = {
  __typename?: 'AndroidAppCredentials';
  /** @deprecated use androidAppBuildCredentialsList instead */
  androidAppBuildCredentialsArray: Array<AndroidAppBuildCredentials>;
  androidAppBuildCredentialsList: Array<AndroidAppBuildCredentials>;
  androidFcm?: Maybe<AndroidFcm>;
  app: App;
  applicationIdentifier?: Maybe<Scalars['String']['output']>;
  googleServiceAccountKeyForFcmV1?: Maybe<GoogleServiceAccountKey>;
  googleServiceAccountKeyForSubmissions?: Maybe<GoogleServiceAccountKey>;
  id: Scalars['ID']['output'];
  isLegacy: Scalars['Boolean']['output'];
};

export type AndroidAppCredentialsFilter = {
  applicationIdentifier?: InputMaybe<Scalars['String']['input']>;
  legacyOnly?: InputMaybe<Scalars['Boolean']['input']>;
};

export type AndroidAppCredentialsInput = {
  fcmId?: InputMaybe<Scalars['ID']['input']>;
  googleServiceAccountKeyForFcmV1Id?: InputMaybe<Scalars['ID']['input']>;
  googleServiceAccountKeyForSubmissionsId?: InputMaybe<Scalars['ID']['input']>;
};

export type AndroidAppCredentialsMutation = {
  __typename?: 'AndroidAppCredentialsMutation';
  /** Create a set of credentials for an Android app */
  createAndroidAppCredentials: AndroidAppCredentials;
  /**
   * Create a GoogleServiceAccountKeyEntity to store credential and
   * connect it with an edge from AndroidAppCredential
   */
  createFcmV1Credential: AndroidAppCredentials;
  /** Delete a set of credentials for an Android app */
  deleteAndroidAppCredentials: DeleteAndroidAppCredentialsResult;
  /** Set the FCM push key to be used in an Android app */
  setFcm: AndroidAppCredentials;
  /** Set the Google Service Account Key to be used for Firebase Cloud Messaging V1 */
  setGoogleServiceAccountKeyForFcmV1: AndroidAppCredentials;
  /** Set the Google Service Account Key to be used for submitting an Android app */
  setGoogleServiceAccountKeyForSubmissions: AndroidAppCredentials;
};


export type AndroidAppCredentialsMutationCreateAndroidAppCredentialsArgs = {
  androidAppCredentialsInput: AndroidAppCredentialsInput;
  appId: Scalars['ID']['input'];
  applicationIdentifier: Scalars['String']['input'];
};


export type AndroidAppCredentialsMutationCreateFcmV1CredentialArgs = {
  accountId: Scalars['ID']['input'];
  androidAppCredentialsId: Scalars['String']['input'];
  credential: Scalars['String']['input'];
};


export type AndroidAppCredentialsMutationDeleteAndroidAppCredentialsArgs = {
  id: Scalars['ID']['input'];
};


export type AndroidAppCredentialsMutationSetFcmArgs = {
  fcmId: Scalars['ID']['input'];
  id: Scalars['ID']['input'];
};


export type AndroidAppCredentialsMutationSetGoogleServiceAccountKeyForFcmV1Args = {
  googleServiceAccountKeyId: Scalars['ID']['input'];
  id: Scalars['ID']['input'];
};


export type AndroidAppCredentialsMutationSetGoogleServiceAccountKeyForSubmissionsArgs = {
  googleServiceAccountKeyId: Scalars['ID']['input'];
  id: Scalars['ID']['input'];
};

export enum AndroidBuildType {
  Apk = 'APK',
  AppBundle = 'APP_BUNDLE',
  /** @deprecated Use developmentClient option instead. */
  DevelopmentClient = 'DEVELOPMENT_CLIENT'
}

export type AndroidBuilderEnvironmentInput = {
  bun?: InputMaybe<Scalars['String']['input']>;
  env?: InputMaybe<Scalars['JSONObject']['input']>;
  expoCli?: InputMaybe<Scalars['String']['input']>;
  image?: InputMaybe<Scalars['String']['input']>;
  ndk?: InputMaybe<Scalars['String']['input']>;
  node?: InputMaybe<Scalars['String']['input']>;
  pnpm?: InputMaybe<Scalars['String']['input']>;
  yarn?: InputMaybe<Scalars['String']['input']>;
};

export type AndroidFcm = {
  __typename?: 'AndroidFcm';
  account: Account;
  createdAt: Scalars['DateTime']['output'];
  /**
   * Legacy FCM: returns the Cloud Messaging token, parses to a String
   * FCM v1: returns the Service Account Key file, parses to an Object
   */
  credential: Scalars['JSON']['output'];
  id: Scalars['ID']['output'];
  snippet: FcmSnippet;
  updatedAt: Scalars['DateTime']['output'];
  version: AndroidFcmVersion;
};

export type AndroidFcmInput = {
  credential: Scalars['String']['input'];
  version: AndroidFcmVersion;
};

export type AndroidFcmMutation = {
  __typename?: 'AndroidFcmMutation';
  /** Create an FCM credential */
  createAndroidFcm: AndroidFcm;
  /** Delete an FCM credential */
  deleteAndroidFcm: DeleteAndroidFcmResult;
};


export type AndroidFcmMutationCreateAndroidFcmArgs = {
  accountId: Scalars['ID']['input'];
  androidFcmInput: AndroidFcmInput;
};


export type AndroidFcmMutationDeleteAndroidFcmArgs = {
  id: Scalars['ID']['input'];
};

export enum AndroidFcmVersion {
  Legacy = 'LEGACY',
  V1 = 'V1'
}

export type AndroidJobBuildCredentialsInput = {
  keystore: AndroidJobKeystoreInput;
};

export type AndroidJobInput = {
  applicationArchivePath?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated */
  artifactPath?: InputMaybe<Scalars['String']['input']>;
  buildArtifactPaths?: InputMaybe<Array<Scalars['String']['input']>>;
  buildProfile?: InputMaybe<Scalars['String']['input']>;
  buildType?: InputMaybe<AndroidBuildType>;
  builderEnvironment?: InputMaybe<AndroidBuilderEnvironmentInput>;
  cache?: InputMaybe<BuildCacheInput>;
  customBuildConfig?: InputMaybe<CustomBuildConfigInput>;
  developmentClient?: InputMaybe<Scalars['Boolean']['input']>;
  experimental?: InputMaybe<Scalars['JSONObject']['input']>;
  gradleCommand?: InputMaybe<Scalars['String']['input']>;
  loggerLevel?: InputMaybe<WorkerLoggerLevel>;
  mode?: InputMaybe<BuildMode>;
  projectArchive: ProjectArchiveSourceInput;
  projectRootDirectory: Scalars['String']['input'];
  releaseChannel?: InputMaybe<Scalars['String']['input']>;
  secrets?: InputMaybe<AndroidJobSecretsInput>;
  triggeredBy?: InputMaybe<BuildTrigger>;
  type: BuildWorkflow;
  updates?: InputMaybe<BuildUpdatesInput>;
  username?: InputMaybe<Scalars['String']['input']>;
  version?: InputMaybe<AndroidJobVersionInput>;
};

export type AndroidJobKeystoreInput = {
  dataBase64: Scalars['String']['input'];
  keyAlias: Scalars['String']['input'];
  keyPassword?: InputMaybe<Scalars['String']['input']>;
  keystorePassword: Scalars['String']['input'];
};

export type AndroidJobOverridesInput = {
  applicationArchivePath?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated */
  artifactPath?: InputMaybe<Scalars['String']['input']>;
  buildArtifactPaths?: InputMaybe<Array<Scalars['String']['input']>>;
  buildProfile?: InputMaybe<Scalars['String']['input']>;
  buildType?: InputMaybe<AndroidBuildType>;
  builderEnvironment?: InputMaybe<AndroidBuilderEnvironmentInput>;
  cache?: InputMaybe<BuildCacheInput>;
  customBuildConfig?: InputMaybe<CustomBuildConfigInput>;
  developmentClient?: InputMaybe<Scalars['Boolean']['input']>;
  experimental?: InputMaybe<Scalars['JSONObject']['input']>;
  gradleCommand?: InputMaybe<Scalars['String']['input']>;
  loggerLevel?: InputMaybe<WorkerLoggerLevel>;
  mode?: InputMaybe<BuildMode>;
  releaseChannel?: InputMaybe<Scalars['String']['input']>;
  secrets?: InputMaybe<AndroidJobSecretsInput>;
  updates?: InputMaybe<BuildUpdatesInput>;
  username?: InputMaybe<Scalars['String']['input']>;
  version?: InputMaybe<AndroidJobVersionInput>;
};

export type AndroidJobSecretsInput = {
  buildCredentials?: InputMaybe<AndroidJobBuildCredentialsInput>;
  robotAccessToken?: InputMaybe<Scalars['String']['input']>;
};

export type AndroidJobVersionInput = {
  versionCode: Scalars['String']['input'];
};

export type AndroidKeystore = {
  __typename?: 'AndroidKeystore';
  account: Account;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  keyAlias: Scalars['String']['output'];
  keyPassword?: Maybe<Scalars['String']['output']>;
  keystore: Scalars['String']['output'];
  keystorePassword: Scalars['String']['output'];
  md5CertificateFingerprint?: Maybe<Scalars['String']['output']>;
  sha1CertificateFingerprint?: Maybe<Scalars['String']['output']>;
  sha256CertificateFingerprint?: Maybe<Scalars['String']['output']>;
  type: AndroidKeystoreType;
  updatedAt: Scalars['DateTime']['output'];
};

export type AndroidKeystoreInput = {
  base64EncodedKeystore: Scalars['String']['input'];
  keyAlias: Scalars['String']['input'];
  keyPassword?: InputMaybe<Scalars['String']['input']>;
  keystorePassword: Scalars['String']['input'];
};

export type AndroidKeystoreMutation = {
  __typename?: 'AndroidKeystoreMutation';
  /** Create a Keystore */
  createAndroidKeystore?: Maybe<AndroidKeystore>;
  /** Delete a Keystore */
  deleteAndroidKeystore: DeleteAndroidKeystoreResult;
};


export type AndroidKeystoreMutationCreateAndroidKeystoreArgs = {
  accountId: Scalars['ID']['input'];
  androidKeystoreInput: AndroidKeystoreInput;
};


export type AndroidKeystoreMutationDeleteAndroidKeystoreArgs = {
  id: Scalars['ID']['input'];
};

export enum AndroidKeystoreType {
  Jks = 'JKS',
  Pkcs12 = 'PKCS12',
  Unknown = 'UNKNOWN'
}

export type AndroidSubmissionConfig = {
  __typename?: 'AndroidSubmissionConfig';
  /** @deprecated applicationIdentifier is deprecated and will be auto-detected on submit */
  applicationIdentifier?: Maybe<Scalars['String']['output']>;
  /** @deprecated archiveType is deprecated and will be null */
  archiveType?: Maybe<SubmissionAndroidArchiveType>;
  releaseStatus?: Maybe<SubmissionAndroidReleaseStatus>;
  rollout?: Maybe<Scalars['Float']['output']>;
  track: SubmissionAndroidTrack;
};

export type AndroidSubmissionConfigInput = {
  applicationIdentifier?: InputMaybe<Scalars['String']['input']>;
  archiveUrl?: InputMaybe<Scalars['String']['input']>;
  changesNotSentForReview?: InputMaybe<Scalars['Boolean']['input']>;
  googleServiceAccountKeyId?: InputMaybe<Scalars['String']['input']>;
  googleServiceAccountKeyJson?: InputMaybe<Scalars['String']['input']>;
  isVerboseFastlaneEnabled?: InputMaybe<Scalars['Boolean']['input']>;
  releaseStatus?: InputMaybe<SubmissionAndroidReleaseStatus>;
  rollout?: InputMaybe<Scalars['Float']['input']>;
  track: SubmissionAndroidTrack;
};

/** Represents an Exponent App (or Experience in legacy terms) */
export type App = Project & {
  __typename?: 'App';
  /** @deprecated Legacy access tokens are deprecated */
  accessTokens: Array<Maybe<AccessToken>>;
  /** Coalesced project activity for an app */
  activityTimelineProjectActivities: Array<ActivityTimelineProjectActivity>;
  /** Android app credentials for the project */
  androidAppCredentials: Array<AndroidAppCredentials>;
  /**
   * ios.appStoreUrl field from most recent classic update manifest
   * @deprecated Classic updates have been deprecated.
   */
  appStoreUrl?: Maybe<Scalars['String']['output']>;
  assetLimitPerUpdateGroup: Scalars['Int']['output'];
  branchesPaginated: AppBranchesConnection;
  buildJobs: Array<BuildJob>;
  /**
   * Coalesced Build (EAS) or BuildJob (Classic) items for this app.
   * @deprecated Use activityTimelineProjectActivities with filterTypes instead
   */
  buildOrBuildJobs: Array<BuildOrBuildJob>;
  /** (EAS Build) Builds associated with this app */
  builds: Array<Build>;
  buildsPaginated: AppBuildsConnection;
  /**
   * Classic update release channel names that have at least one build
   * @deprecated Classic updates have been deprecated.
   */
  buildsReleaseChannels: Array<Scalars['String']['output']>;
  channelsPaginated: AppChannelsConnection;
  deployment?: Maybe<Deployment>;
  /** Deployments associated with this app */
  deployments: DeploymentsConnection;
  /** @deprecated Classic updates have been deprecated. */
  description: Scalars['String']['output'];
  /** Environment secrets for an app */
  environmentSecrets: Array<EnvironmentSecret>;
  fullName: Scalars['String']['output'];
  githubBuildTriggers: Array<GitHubBuildTrigger>;
  githubRepository?: Maybe<GitHubRepository>;
  githubRepositorySettings?: Maybe<GitHubRepositorySettings>;
  /**
   * githubUrl field from most recent classic update manifest
   * @deprecated Classic updates have been deprecated.
   */
  githubUrl?: Maybe<Scalars['String']['output']>;
  /**
   * Info about the icon specified in the most recent classic update manifest
   * @deprecated Classic updates have been deprecated.
   */
  icon?: Maybe<AppIcon>;
  /** @deprecated No longer supported */
  iconUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** App query field for querying EAS Insights about this app */
  insights: AppInsights;
  internalDistributionBuildPrivacy: AppInternalDistributionBuildPrivacy;
  /** iOS app credentials for the project */
  iosAppCredentials: Array<IosAppCredentials>;
  isDeleting: Scalars['Boolean']['output'];
  /**
   * Whether the latest classic update publish is using a deprecated SDK version
   * @deprecated Classic updates have been deprecated.
   */
  isDeprecated: Scalars['Boolean']['output'];
  /** @deprecated 'likes' have been deprecated. */
  isLikedByMe: Scalars['Boolean']['output'];
  lastDeletionAttemptTime?: Maybe<Scalars['DateTime']['output']>;
  /** @deprecated No longer supported */
  lastPublishedTime: Scalars['DateTime']['output'];
  /** Time of the last user activity (update, branch, submission). */
  latestActivity: Scalars['DateTime']['output'];
  latestAppVersionByPlatformAndApplicationIdentifier?: Maybe<AppVersion>;
  /** @deprecated Classic updates have been deprecated. */
  latestReleaseForReleaseChannel?: Maybe<AppRelease>;
  /**
   * ID of latest classic update release
   * @deprecated Classic updates have been deprecated.
   */
  latestReleaseId: Scalars['ID']['output'];
  /** @deprecated 'likes' have been deprecated. */
  likeCount: Scalars['Int']['output'];
  /** @deprecated 'likes' have been deprecated. */
  likedBy: Array<Maybe<User>>;
  name: Scalars['String']['output'];
  ownerAccount: Account;
  /** @deprecated No longer supported */
  packageName: Scalars['String']['output'];
  /** @deprecated No longer supported */
  packageUsername: Scalars['String']['output'];
  /**
   * android.playStoreUrl field from most recent classic update manifest
   * @deprecated Classic updates have been deprecated.
   */
  playStoreUrl?: Maybe<Scalars['String']['output']>;
  /** @deprecated Use 'privacySetting' instead. */
  privacy: Scalars['String']['output'];
  privacySetting: AppPrivacy;
  /**
   * Whether there have been any classic update publishes
   * @deprecated Classic updates have been deprecated.
   */
  published: Scalars['Boolean']['output'];
  pushSecurityEnabled: Scalars['Boolean']['output'];
  /**
   * Classic update release channel names (to be removed)
   * @deprecated Classic updates have been deprecated.
   */
  releaseChannels: Array<Scalars['String']['output']>;
  /** @deprecated Legacy access tokens are deprecated */
  requiresAccessTokenForPushSecurity: Scalars['Boolean']['output'];
  /** Runtimes associated with this app */
  runtimes: RuntimesConnection;
  scopeKey: Scalars['String']['output'];
  /**
   * SDK version of the latest classic update publish, 0.0.0 otherwise
   * @deprecated Classic updates have been deprecated.
   */
  sdkVersion: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  /** EAS Submissions associated with this app */
  submissions: Array<Submission>;
  submissionsPaginated: AppSubmissionsConnection;
  /** Coalesced project activity for an app using pagination */
  timelineActivity: TimelineActivityConnection;
  /** @deprecated 'likes' have been deprecated. */
  trendScore: Scalars['Float']['output'];
  /** get an EAS branch owned by the app by name */
  updateBranchByName?: Maybe<UpdateBranch>;
  /** EAS branches owned by an app */
  updateBranches: Array<UpdateBranch>;
  /** get an EAS channel owned by the app by name */
  updateChannelByName?: Maybe<UpdateChannel>;
  /** EAS channels owned by an app */
  updateChannels: Array<UpdateChannel>;
  /** EAS updates owned by an app grouped by update group */
  updateGroups: Array<Array<Update>>;
  /**
   * Time of last classic update publish
   * @deprecated Classic updates have been deprecated.
   */
  updated: Scalars['DateTime']['output'];
  /** EAS updates owned by an app */
  updates: Array<Update>;
  updatesPaginated: AppUpdatesConnection;
  /** @deprecated Use ownerAccount.name instead */
  username: Scalars['String']['output'];
  /** @deprecated No longer supported */
  users?: Maybe<Array<Maybe<User>>>;
  /** Webhooks for an app */
  webhooks: Array<Webhook>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppActivityTimelineProjectActivitiesArgs = {
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  filterChannels?: InputMaybe<Array<Scalars['String']['input']>>;
  filterPlatforms?: InputMaybe<Array<AppPlatform>>;
  filterReleaseChannels?: InputMaybe<Array<Scalars['String']['input']>>;
  filterTypes?: InputMaybe<Array<ActivityTimelineProjectActivityType>>;
  limit: Scalars['Int']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppAndroidAppCredentialsArgs = {
  filter?: InputMaybe<AndroidAppCredentialsFilter>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppBranchesPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<BranchFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppBuildJobsArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  status?: InputMaybe<BuildStatus>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppBuildOrBuildJobsArgs = {
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  limit: Scalars['Int']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppBuildsArgs = {
  filter?: InputMaybe<BuildFilter>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  platform?: InputMaybe<AppPlatform>;
  status?: InputMaybe<BuildStatus>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppBuildsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<BuildFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppChannelsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<ChannelFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppDeploymentArgs = {
  channel: Scalars['String']['input'];
  runtimeVersion: Scalars['String']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppDeploymentsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<DeploymentFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppEnvironmentSecretsArgs = {
  filterNames?: InputMaybe<Array<Scalars['String']['input']>>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppIosAppCredentialsArgs = {
  filter?: InputMaybe<IosAppCredentialsFilter>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppLatestAppVersionByPlatformAndApplicationIdentifierArgs = {
  applicationIdentifier: Scalars['String']['input'];
  platform: AppPlatform;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppLatestReleaseForReleaseChannelArgs = {
  platform: AppPlatform;
  releaseChannel: Scalars['String']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppLikedByArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppRuntimesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppSubmissionsArgs = {
  filter: SubmissionFilter;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppSubmissionsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppTimelineActivityArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<TimelineActivityFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateBranchByNameArgs = {
  name: Scalars['String']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateBranchesArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateChannelByNameArgs = {
  name: Scalars['String']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateChannelsArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdateGroupsArgs = {
  filter?: InputMaybe<UpdatesFilter>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdatesArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppUpdatesPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents an Exponent App (or Experience in legacy terms) */
export type AppWebhooksArgs = {
  filter?: InputMaybe<WebhookFilter>;
};

export type AppBranchEdge = {
  __typename?: 'AppBranchEdge';
  cursor: Scalars['String']['output'];
  node: UpdateBranch;
};

export type AppBranchesConnection = {
  __typename?: 'AppBranchesConnection';
  edges: Array<AppBranchEdge>;
  pageInfo: PageInfo;
};

export type AppBuildEdge = {
  __typename?: 'AppBuildEdge';
  cursor: Scalars['String']['output'];
  node: BuildOrBuildJob;
};

export type AppBuildsConnection = {
  __typename?: 'AppBuildsConnection';
  edges: Array<AppBuildEdge>;
  pageInfo: PageInfo;
};

export type AppChannelEdge = {
  __typename?: 'AppChannelEdge';
  cursor: Scalars['String']['output'];
  node: UpdateChannel;
};

export type AppChannelsConnection = {
  __typename?: 'AppChannelsConnection';
  edges: Array<AppChannelEdge>;
  pageInfo: PageInfo;
};

export type AppDataInput = {
  id: Scalars['ID']['input'];
  internalDistributionBuildPrivacy?: InputMaybe<AppInternalDistributionBuildPrivacy>;
  privacy?: InputMaybe<Scalars['String']['input']>;
};

export type AppIcon = {
  __typename?: 'AppIcon';
  /** @deprecated No longer supported */
  colorPalette?: Maybe<Scalars['JSON']['output']>;
  originalUrl: Scalars['String']['output'];
  primaryColor?: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
};

export type AppInfoInput = {
  displayName?: InputMaybe<Scalars['String']['input']>;
};

export type AppInput = {
  accountId: Scalars['ID']['input'];
  appInfo?: InputMaybe<AppInfoInput>;
  privacy: AppPrivacy;
  projectName: Scalars['String']['input'];
};

export type AppInsights = {
  __typename?: 'AppInsights';
  hasEventsFromExpoInsightsClientModule: Scalars['Boolean']['output'];
  totalUniqueUsers?: Maybe<Scalars['Int']['output']>;
  uniqueUsersByAppVersionOverTime: UniqueUsersOverTimeData;
  uniqueUsersByPlatformOverTime: UniqueUsersOverTimeData;
};


export type AppInsightsTotalUniqueUsersArgs = {
  timespan: InsightsTimespan;
};


export type AppInsightsUniqueUsersByAppVersionOverTimeArgs = {
  timespan: InsightsTimespan;
};


export type AppInsightsUniqueUsersByPlatformOverTimeArgs = {
  timespan: InsightsTimespan;
};

export enum AppInternalDistributionBuildPrivacy {
  Private = 'PRIVATE',
  Public = 'PUBLIC'
}

export type AppMutation = {
  __typename?: 'AppMutation';
  /** Create an unpublished app */
  createApp: App;
  /** Create an unpublished app and GitHub repository if user desire to */
  createAppAndGithubRepository: CreateAppAndGithubRepositoryResponse;
  /** @deprecated No longer supported */
  grantAccess?: Maybe<App>;
  /** Set display info for app */
  setAppInfo: App;
  /** Require api token to send push notifs for experience */
  setPushSecurityEnabled: App;
};


export type AppMutationCreateAppArgs = {
  appInput: AppInput;
};


export type AppMutationCreateAppAndGithubRepositoryArgs = {
  appInput: AppWithGithubRepositoryInput;
};


export type AppMutationGrantAccessArgs = {
  accessLevel?: InputMaybe<Scalars['String']['input']>;
  toUser: Scalars['ID']['input'];
};


export type AppMutationSetAppInfoArgs = {
  appId: Scalars['ID']['input'];
  appInfo: AppInfoInput;
};


export type AppMutationSetPushSecurityEnabledArgs = {
  appId: Scalars['ID']['input'];
  pushSecurityEnabled: Scalars['Boolean']['input'];
};

export type AppNotificationSubscriptionInput = {
  appId: Scalars['ID']['input'];
  event: NotificationEvent;
  type: NotificationType;
  userId: Scalars['ID']['input'];
};

export enum AppPlatform {
  Android = 'ANDROID',
  Ios = 'IOS'
}

export enum AppPrivacy {
  Hidden = 'HIDDEN',
  Public = 'PUBLIC',
  Unlisted = 'UNLISTED'
}

export type AppQuery = {
  __typename?: 'AppQuery';
  /**
   * Public apps in the app directory
   * @deprecated App directory no longer supported
   */
  all: Array<App>;
  byFullName: App;
  /** Look up app by app id */
  byId: App;
};


export type AppQueryAllArgs = {
  filter: AppsFilter;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  sort: AppSort;
};


export type AppQueryByFullNameArgs = {
  fullName: Scalars['String']['input'];
};


export type AppQueryByIdArgs = {
  appId: Scalars['String']['input'];
};

export type AppRelease = {
  __typename?: 'AppRelease';
  hash: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  manifest: Scalars['JSON']['output'];
  publishedTime: Scalars['DateTime']['output'];
  publishingUsername: Scalars['String']['output'];
  runtimeVersion?: Maybe<Scalars['String']['output']>;
  s3Key: Scalars['String']['output'];
  s3Url: Scalars['String']['output'];
  sdkVersion: Scalars['String']['output'];
  version: Scalars['String']['output'];
};

export enum AppSort {
  /** Sort by recently published */
  RecentlyPublished = 'RECENTLY_PUBLISHED',
  /** Sort by highest trendScore */
  Viewed = 'VIEWED'
}

export type AppStoreConnectApiKey = {
  __typename?: 'AppStoreConnectApiKey';
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  issuerIdentifier: Scalars['String']['output'];
  keyIdentifier: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  roles?: Maybe<Array<AppStoreConnectUserRole>>;
  updatedAt: Scalars['DateTime']['output'];
};

export type AppStoreConnectApiKeyInput = {
  appleTeamId?: InputMaybe<Scalars['ID']['input']>;
  issuerIdentifier: Scalars['String']['input'];
  keyIdentifier: Scalars['String']['input'];
  keyP8: Scalars['String']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
  roles?: InputMaybe<Array<AppStoreConnectUserRole>>;
};

export type AppStoreConnectApiKeyMutation = {
  __typename?: 'AppStoreConnectApiKeyMutation';
  /** Create an App Store Connect Api Key for an Apple Team */
  createAppStoreConnectApiKey: AppStoreConnectApiKey;
  /** Delete an App Store Connect Api Key */
  deleteAppStoreConnectApiKey: DeleteAppStoreConnectApiKeyResult;
};


export type AppStoreConnectApiKeyMutationCreateAppStoreConnectApiKeyArgs = {
  accountId: Scalars['ID']['input'];
  appStoreConnectApiKeyInput: AppStoreConnectApiKeyInput;
};


export type AppStoreConnectApiKeyMutationDeleteAppStoreConnectApiKeyArgs = {
  id: Scalars['ID']['input'];
};

export enum AppStoreConnectUserRole {
  AccessToReports = 'ACCESS_TO_REPORTS',
  AccountHolder = 'ACCOUNT_HOLDER',
  Admin = 'ADMIN',
  AppManager = 'APP_MANAGER',
  CloudManagedAppDistribution = 'CLOUD_MANAGED_APP_DISTRIBUTION',
  CloudManagedDeveloperId = 'CLOUD_MANAGED_DEVELOPER_ID',
  CreateApps = 'CREATE_APPS',
  CustomerSupport = 'CUSTOMER_SUPPORT',
  Developer = 'DEVELOPER',
  Finance = 'FINANCE',
  ImageManager = 'IMAGE_MANAGER',
  Marketing = 'MARKETING',
  ReadOnly = 'READ_ONLY',
  Sales = 'SALES',
  Technical = 'TECHNICAL',
  Unknown = 'UNKNOWN'
}

export type AppSubmissionEdge = {
  __typename?: 'AppSubmissionEdge';
  cursor: Scalars['String']['output'];
  node: Submission;
};

export type AppSubmissionsConnection = {
  __typename?: 'AppSubmissionsConnection';
  edges: Array<AppSubmissionEdge>;
  pageInfo: PageInfo;
};

export type AppUpdateEdge = {
  __typename?: 'AppUpdateEdge';
  cursor: Scalars['String']['output'];
  node: Update;
};

export type AppUpdatesConnection = {
  __typename?: 'AppUpdatesConnection';
  edges: Array<AppUpdateEdge>;
  pageInfo: PageInfo;
};

/** Represents Play Store/App Store version of an application */
export type AppVersion = {
  __typename?: 'AppVersion';
  /**
   * Store identifier for an application
   *  - Android - applicationId
   *  - iOS - bundle identifier
   */
  applicationIdentifier: Scalars['String']['output'];
  /**
   * Value that identifies build in a store (it's visible to developers, but not to end users)
   * - Android - versionCode in build.gradle ("android.versionCode" field in app.json)
   * - iOS - CFBundleVersion in Info.plist ("ios.buildNumber" field in app.json)
   */
  buildVersion: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  platform: AppPlatform;
  runtimeVersion?: Maybe<Scalars['String']['output']>;
  /**
   * User-facing version in a store
   * - Android - versionName in build.gradle ("version" field in app.json)
   * - iOS - CFBundleShortVersionString in Info.plist ("version" field in app.json)
   */
  storeVersion: Scalars['String']['output'];
};

export type AppVersionInput = {
  appId: Scalars['ID']['input'];
  applicationIdentifier: Scalars['String']['input'];
  buildVersion: Scalars['String']['input'];
  platform: AppPlatform;
  runtimeVersion?: InputMaybe<Scalars['String']['input']>;
  storeVersion: Scalars['String']['input'];
};

export type AppVersionMutation = {
  __typename?: 'AppVersionMutation';
  /** Create an app version */
  createAppVersion: AppVersion;
};


export type AppVersionMutationCreateAppVersionArgs = {
  appVersionInput: AppVersionInput;
};

export type AppWithGithubRepositoryInput = {
  accountId: Scalars['ID']['input'];
  appInfo?: InputMaybe<AppInfoInput>;
  installationIdentifier?: InputMaybe<Scalars['String']['input']>;
  privacy: AppPrivacy;
  projectName: Scalars['String']['input'];
};

export type AppleAppIdentifier = {
  __typename?: 'AppleAppIdentifier';
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  bundleIdentifier: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  parentAppleAppIdentifier?: Maybe<AppleAppIdentifier>;
};

export type AppleAppIdentifierInput = {
  appleTeamId?: InputMaybe<Scalars['ID']['input']>;
  bundleIdentifier: Scalars['String']['input'];
  parentAppleAppId?: InputMaybe<Scalars['ID']['input']>;
};

export type AppleAppIdentifierMutation = {
  __typename?: 'AppleAppIdentifierMutation';
  /** Create an Identifier for an iOS App */
  createAppleAppIdentifier: AppleAppIdentifier;
};


export type AppleAppIdentifierMutationCreateAppleAppIdentifierArgs = {
  accountId: Scalars['ID']['input'];
  appleAppIdentifierInput: AppleAppIdentifierInput;
};

export type AppleDevice = {
  __typename?: 'AppleDevice';
  account: Account;
  appleTeam: AppleTeam;
  createdAt: Scalars['DateTime']['output'];
  deviceClass?: Maybe<AppleDeviceClass>;
  enabled?: Maybe<Scalars['Boolean']['output']>;
  id: Scalars['ID']['output'];
  identifier: Scalars['String']['output'];
  model?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  softwareVersion?: Maybe<Scalars['String']['output']>;
};

export enum AppleDeviceClass {
  Ipad = 'IPAD',
  Iphone = 'IPHONE',
  Mac = 'MAC',
  Unknown = 'UNKNOWN'
}

export type AppleDeviceFilterInput = {
  appleTeamIdentifier?: InputMaybe<Scalars['String']['input']>;
  class?: InputMaybe<AppleDeviceClass>;
  identifier?: InputMaybe<Scalars['String']['input']>;
};

export type AppleDeviceInput = {
  appleTeamId: Scalars['ID']['input'];
  deviceClass?: InputMaybe<AppleDeviceClass>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  identifier: Scalars['String']['input'];
  model?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  softwareVersion?: InputMaybe<Scalars['String']['input']>;
};

export type AppleDeviceMutation = {
  __typename?: 'AppleDeviceMutation';
  /** Create an Apple Device */
  createAppleDevice: AppleDevice;
  /** Delete an Apple Device */
  deleteAppleDevice: DeleteAppleDeviceResult;
  /** Update an Apple Device */
  updateAppleDevice: AppleDevice;
};


export type AppleDeviceMutationCreateAppleDeviceArgs = {
  accountId: Scalars['ID']['input'];
  appleDeviceInput: AppleDeviceInput;
};


export type AppleDeviceMutationDeleteAppleDeviceArgs = {
  id: Scalars['ID']['input'];
};


export type AppleDeviceMutationUpdateAppleDeviceArgs = {
  appleDeviceUpdateInput: AppleDeviceUpdateInput;
  id: Scalars['ID']['input'];
};

export type AppleDeviceRegistrationRequest = {
  __typename?: 'AppleDeviceRegistrationRequest';
  account: Account;
  appleTeam: AppleTeam;
  id: Scalars['ID']['output'];
};

export type AppleDeviceRegistrationRequestMutation = {
  __typename?: 'AppleDeviceRegistrationRequestMutation';
  /** Create an Apple Device registration request */
  createAppleDeviceRegistrationRequest: AppleDeviceRegistrationRequest;
};


export type AppleDeviceRegistrationRequestMutationCreateAppleDeviceRegistrationRequestArgs = {
  accountId: Scalars['ID']['input'];
  appleTeamId: Scalars['ID']['input'];
};

export type AppleDeviceRegistrationRequestQuery = {
  __typename?: 'AppleDeviceRegistrationRequestQuery';
  byId: AppleDeviceRegistrationRequest;
};


export type AppleDeviceRegistrationRequestQueryByIdArgs = {
  id: Scalars['ID']['input'];
};

export type AppleDeviceUpdateInput = {
  name?: InputMaybe<Scalars['String']['input']>;
};

export type AppleDistributionCertificate = {
  __typename?: 'AppleDistributionCertificate';
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  certificateP12?: Maybe<Scalars['String']['output']>;
  certificatePassword?: Maybe<Scalars['String']['output']>;
  certificatePrivateSigningKey?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  developerPortalIdentifier?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  iosAppBuildCredentialsList: Array<IosAppBuildCredentials>;
  serialNumber: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  validityNotAfter: Scalars['DateTime']['output'];
  validityNotBefore: Scalars['DateTime']['output'];
};

export type AppleDistributionCertificateInput = {
  appleTeamId?: InputMaybe<Scalars['ID']['input']>;
  certP12: Scalars['String']['input'];
  certPassword: Scalars['String']['input'];
  certPrivateSigningKey?: InputMaybe<Scalars['String']['input']>;
  developerPortalIdentifier?: InputMaybe<Scalars['String']['input']>;
};

export type AppleDistributionCertificateMutation = {
  __typename?: 'AppleDistributionCertificateMutation';
  /** Create a Distribution Certificate */
  createAppleDistributionCertificate?: Maybe<AppleDistributionCertificate>;
  /** Delete a Distribution Certificate */
  deleteAppleDistributionCertificate: DeleteAppleDistributionCertificateResult;
};


export type AppleDistributionCertificateMutationCreateAppleDistributionCertificateArgs = {
  accountId: Scalars['ID']['input'];
  appleDistributionCertificateInput: AppleDistributionCertificateInput;
};


export type AppleDistributionCertificateMutationDeleteAppleDistributionCertificateArgs = {
  id: Scalars['ID']['input'];
};

export type AppleProvisioningProfile = {
  __typename?: 'AppleProvisioningProfile';
  account: Account;
  appleAppIdentifier: AppleAppIdentifier;
  appleDevices: Array<AppleDevice>;
  appleTeam?: Maybe<AppleTeam>;
  appleUUID: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  developerPortalIdentifier?: Maybe<Scalars['String']['output']>;
  expiration: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  provisioningProfile?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type AppleProvisioningProfileInput = {
  appleProvisioningProfile: Scalars['String']['input'];
  developerPortalIdentifier?: InputMaybe<Scalars['String']['input']>;
};

export type AppleProvisioningProfileMutation = {
  __typename?: 'AppleProvisioningProfileMutation';
  /** Create a Provisioning Profile */
  createAppleProvisioningProfile: AppleProvisioningProfile;
  /** Delete a Provisioning Profile */
  deleteAppleProvisioningProfile: DeleteAppleProvisioningProfileResult;
  /** Delete Provisioning Profiles */
  deleteAppleProvisioningProfiles: Array<DeleteAppleProvisioningProfileResult>;
  /** Update a Provisioning Profile */
  updateAppleProvisioningProfile: AppleProvisioningProfile;
};


export type AppleProvisioningProfileMutationCreateAppleProvisioningProfileArgs = {
  accountId: Scalars['ID']['input'];
  appleAppIdentifierId: Scalars['ID']['input'];
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
};


export type AppleProvisioningProfileMutationDeleteAppleProvisioningProfileArgs = {
  id: Scalars['ID']['input'];
};


export type AppleProvisioningProfileMutationDeleteAppleProvisioningProfilesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type AppleProvisioningProfileMutationUpdateAppleProvisioningProfileArgs = {
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
  id: Scalars['ID']['input'];
};

export type ApplePushKey = {
  __typename?: 'ApplePushKey';
  account: Account;
  appleTeam?: Maybe<AppleTeam>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  iosAppCredentialsList: Array<IosAppCredentials>;
  keyIdentifier: Scalars['String']['output'];
  keyP8: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type ApplePushKeyInput = {
  appleTeamId: Scalars['ID']['input'];
  keyIdentifier: Scalars['String']['input'];
  keyP8: Scalars['String']['input'];
};

export type ApplePushKeyMutation = {
  __typename?: 'ApplePushKeyMutation';
  /** Create an Apple Push Notification key */
  createApplePushKey: ApplePushKey;
  /** Delete an Apple Push Notification key */
  deleteApplePushKey: DeleteApplePushKeyResult;
};


export type ApplePushKeyMutationCreateApplePushKeyArgs = {
  accountId: Scalars['ID']['input'];
  applePushKeyInput: ApplePushKeyInput;
};


export type ApplePushKeyMutationDeleteApplePushKeyArgs = {
  id: Scalars['ID']['input'];
};

export type AppleTeam = {
  __typename?: 'AppleTeam';
  account: Account;
  appleAppIdentifiers: Array<AppleAppIdentifier>;
  appleDevices: Array<AppleDevice>;
  appleDistributionCertificates: Array<AppleDistributionCertificate>;
  appleProvisioningProfiles: Array<AppleProvisioningProfile>;
  applePushKeys: Array<ApplePushKey>;
  appleTeamIdentifier: Scalars['String']['output'];
  appleTeamName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
};


export type AppleTeamAppleAppIdentifiersArgs = {
  bundleIdentifier?: InputMaybe<Scalars['String']['input']>;
};


export type AppleTeamAppleDevicesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type AppleTeamAppleProvisioningProfilesArgs = {
  appleAppIdentifierId?: InputMaybe<Scalars['ID']['input']>;
};

export type AppleTeamFilterInput = {
  appleTeamIdentifier?: InputMaybe<Scalars['String']['input']>;
};

export type AppleTeamInput = {
  appleTeamIdentifier: Scalars['String']['input'];
  appleTeamName?: InputMaybe<Scalars['String']['input']>;
};

export type AppleTeamMutation = {
  __typename?: 'AppleTeamMutation';
  /** Create an Apple Team */
  createAppleTeam: AppleTeam;
};


export type AppleTeamMutationCreateAppleTeamArgs = {
  accountId: Scalars['ID']['input'];
  appleTeamInput: AppleTeamInput;
};

export type AppleTeamQuery = {
  __typename?: 'AppleTeamQuery';
  byAppleTeamIdentifier?: Maybe<AppleTeam>;
};


export type AppleTeamQueryByAppleTeamIdentifierArgs = {
  accountId: Scalars['ID']['input'];
  identifier: Scalars['String']['input'];
};

export enum AppsFilter {
  /** Featured Projects */
  Featured = 'FEATURED',
  /** New Projects */
  New = 'NEW'
}

export type AscApiKeyInput = {
  issuerIdentifier: Scalars['String']['input'];
  keyIdentifier: Scalars['String']['input'];
  keyP8: Scalars['String']['input'];
};

export type AssetMetadataResult = {
  __typename?: 'AssetMetadataResult';
  status: AssetMetadataStatus;
  storageKey: Scalars['String']['output'];
};

export enum AssetMetadataStatus {
  DoesNotExist = 'DOES_NOT_EXIST',
  Exists = 'EXISTS'
}

export type AssetMutation = {
  __typename?: 'AssetMutation';
  /**
   * Returns an array of specifications for upload. Each URL is valid for an hour.
   * The content type of the asset you wish to upload must be specified.
   */
  getSignedAssetUploadSpecifications: GetSignedAssetUploadSpecificationsResult;
};


export type AssetMutationGetSignedAssetUploadSpecificationsArgs = {
  assetContentTypes: Array<InputMaybe<Scalars['String']['input']>>;
};

/** Check to see if assets with given storageKeys exist */
export type AssetQuery = {
  __typename?: 'AssetQuery';
  metadata: Array<AssetMetadataResult>;
};


/** Check to see if assets with given storageKeys exist */
export type AssetQueryMetadataArgs = {
  storageKeys: Array<Scalars['String']['input']>;
};

export type AuditLog = {
  __typename?: 'AuditLog';
  account?: Maybe<Account>;
  actor?: Maybe<Actor>;
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  targetEntityId: Scalars['ID']['output'];
  targetEntityMutationType: TargetEntityMutationType;
  targetEntityTableName: Scalars['String']['output'];
  targetEntityTypeName: Scalars['String']['output'];
  websiteMessage: Scalars['String']['output'];
};

export type AuditLogQuery = {
  __typename?: 'AuditLogQuery';
  /** Query Audit Logs by account ID */
  byAccountId: Array<AuditLog>;
  /** Query an Audit Log by ID */
  byId: AuditLog;
};


export type AuditLogQueryByAccountIdArgs = {
  accountId: Scalars['ID']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


export type AuditLogQueryByIdArgs = {
  auditLogId: Scalars['ID']['input'];
};

export enum AuthProtocolType {
  Oidc = 'OIDC'
}

export type BackgroundJobReceipt = {
  __typename?: 'BackgroundJobReceipt';
  account: Account;
  createdAt: Scalars['DateTime']['output'];
  errorCode?: Maybe<Scalars['String']['output']>;
  errorMessage?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  resultId?: Maybe<Scalars['ID']['output']>;
  resultType: BackgroundJobResultType;
  state: BackgroundJobState;
  tries: Scalars['Int']['output'];
  updatedAt: Scalars['DateTime']['output'];
  willRetry: Scalars['Boolean']['output'];
};

export type BackgroundJobReceiptQuery = {
  __typename?: 'BackgroundJobReceiptQuery';
  /** Look up background job receipt by ID */
  byId: BackgroundJobReceipt;
};


export type BackgroundJobReceiptQueryByIdArgs = {
  id: Scalars['ID']['input'];
};

export enum BackgroundJobResultType {
  GithubBuild = 'GITHUB_BUILD',
  Void = 'VOID'
}

export enum BackgroundJobState {
  Failure = 'FAILURE',
  InProgress = 'IN_PROGRESS',
  Queued = 'QUEUED',
  Success = 'SUCCESS'
}

export type Billing = {
  __typename?: 'Billing';
  /** History of invoices */
  charges?: Maybe<Array<Maybe<Charge>>>;
  id: Scalars['ID']['output'];
  /** @deprecated No longer used */
  payment?: Maybe<PaymentDetails>;
  subscription?: Maybe<SubscriptionDetails>;
};

export type BillingPeriod = {
  __typename?: 'BillingPeriod';
  anchor: Scalars['DateTime']['output'];
  end: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  start: Scalars['DateTime']['output'];
};

export type BranchFilterInput = {
  searchTerm?: InputMaybe<Scalars['String']['input']>;
};

/** Represents an EAS Build */
export type Build = ActivityTimelineProjectActivity & BuildOrBuildJob & {
  __typename?: 'Build';
  activityTimestamp: Scalars['DateTime']['output'];
  actor?: Maybe<Actor>;
  app: App;
  appBuildVersion?: Maybe<Scalars['String']['output']>;
  appIdentifier?: Maybe<Scalars['String']['output']>;
  appVersion?: Maybe<Scalars['String']['output']>;
  artifacts?: Maybe<BuildArtifacts>;
  buildMode?: Maybe<BuildMode>;
  buildProfile?: Maybe<Scalars['String']['output']>;
  canRetry: Scalars['Boolean']['output'];
  cancelingActor?: Maybe<Actor>;
  channel?: Maybe<Scalars['String']['output']>;
  childBuild?: Maybe<Build>;
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  customNodeVersion?: Maybe<Scalars['String']['output']>;
  customWorkflowName?: Maybe<Scalars['String']['output']>;
  developmentClient?: Maybe<Scalars['Boolean']['output']>;
  distribution?: Maybe<DistributionType>;
  enqueuedAt?: Maybe<Scalars['DateTime']['output']>;
  error?: Maybe<BuildError>;
  estimatedWaitTimeLeftSeconds?: Maybe<Scalars['Int']['output']>;
  expirationDate?: Maybe<Scalars['DateTime']['output']>;
  gitCommitHash?: Maybe<Scalars['String']['output']>;
  gitCommitMessage?: Maybe<Scalars['String']['output']>;
  gitRef?: Maybe<Scalars['String']['output']>;
  githubRepositoryOwnerAndName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** Queue position is 1-indexed */
  initialQueuePosition?: Maybe<Scalars['Int']['output']>;
  initiatingActor?: Maybe<Actor>;
  /** @deprecated User type is deprecated */
  initiatingUser?: Maybe<User>;
  iosEnterpriseProvisioning?: Maybe<BuildIosEnterpriseProvisioning>;
  isForIosSimulator: Scalars['Boolean']['output'];
  isGitWorkingTreeDirty?: Maybe<Scalars['Boolean']['output']>;
  isWaived: Scalars['Boolean']['output'];
  logFiles: Array<Scalars['String']['output']>;
  maxBuildTimeSeconds: Scalars['Int']['output'];
  /** Retry time starts after completedAt */
  maxRetryTimeMinutes?: Maybe<Scalars['Int']['output']>;
  message?: Maybe<Scalars['String']['output']>;
  metrics?: Maybe<BuildMetrics>;
  parentBuild?: Maybe<Build>;
  platform: AppPlatform;
  priority: BuildPriority;
  /** @deprecated Use app field instead */
  project: Project;
  projectMetadataFileUrl?: Maybe<Scalars['String']['output']>;
  projectRootDirectory?: Maybe<Scalars['String']['output']>;
  provisioningStartedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Queue position is 1-indexed */
  queuePosition?: Maybe<Scalars['Int']['output']>;
  reactNativeVersion?: Maybe<Scalars['String']['output']>;
  releaseChannel?: Maybe<Scalars['String']['output']>;
  requiredPackageManager?: Maybe<Scalars['String']['output']>;
  /**
   * The builder resource class requested by the developer
   * @deprecated Use resourceClassDisplayName instead
   */
  resourceClass: BuildResourceClass;
  /** String describing the resource class used to run the build */
  resourceClassDisplayName: Scalars['String']['output'];
  retryDisabledReason?: Maybe<BuildRetryDisabledReason>;
  runFromCI?: Maybe<Scalars['Boolean']['output']>;
  runtimeVersion?: Maybe<Scalars['String']['output']>;
  sdkVersion?: Maybe<Scalars['String']['output']>;
  selectedImage?: Maybe<Scalars['String']['output']>;
  status: BuildStatus;
  submissions: Array<Submission>;
  updatedAt: Scalars['DateTime']['output'];
  workerStartedAt?: Maybe<Scalars['DateTime']['output']>;
};


/** Represents an EAS Build */
export type BuildCanRetryArgs = {
  newMode?: InputMaybe<BuildMode>;
};


/** Represents an EAS Build */
export type BuildRetryDisabledReasonArgs = {
  newMode?: InputMaybe<BuildMode>;
};

export type BuildAnnotation = {
  __typename?: 'BuildAnnotation';
  authorUsername?: Maybe<Scalars['String']['output']>;
  buildPhase: Scalars['String']['output'];
  exampleBuildLog?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  internalNotes?: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  regexFlags?: Maybe<Scalars['String']['output']>;
  regexString: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type BuildAnnotationDataInput = {
  buildPhase: Scalars['String']['input'];
  exampleBuildLog?: InputMaybe<Scalars['String']['input']>;
  internalNotes?: InputMaybe<Scalars['String']['input']>;
  message: Scalars['String']['input'];
  regexFlags?: InputMaybe<Scalars['String']['input']>;
  regexString: Scalars['String']['input'];
  title: Scalars['String']['input'];
};

export type BuildAnnotationFiltersInput = {
  buildPhases: Array<Scalars['String']['input']>;
};

export type BuildAnnotationMutation = {
  __typename?: 'BuildAnnotationMutation';
  /** Create a Build Annotation */
  createBuildAnnotation: BuildAnnotation;
  /** Delete a Build Annotation */
  deleteBuildAnnotation: DeleteBuildAnnotationResult;
  /** Update a Build Annotation */
  updateBuildAnnotation: BuildAnnotation;
};


export type BuildAnnotationMutationCreateBuildAnnotationArgs = {
  buildAnnotationData: BuildAnnotationDataInput;
};


export type BuildAnnotationMutationDeleteBuildAnnotationArgs = {
  buildAnnotationId: Scalars['ID']['input'];
};


export type BuildAnnotationMutationUpdateBuildAnnotationArgs = {
  buildAnnotationData: BuildAnnotationDataInput;
  buildAnnotationId: Scalars['ID']['input'];
};

export type BuildAnnotationsQuery = {
  __typename?: 'BuildAnnotationsQuery';
  /** View build annotations */
  all: Array<BuildAnnotation>;
  /** Find a build annotation by ID */
  byId: BuildAnnotation;
};


export type BuildAnnotationsQueryAllArgs = {
  filters?: InputMaybe<BuildAnnotationFiltersInput>;
};


export type BuildAnnotationsQueryByIdArgs = {
  buildAnnotationId: Scalars['ID']['input'];
};

export type BuildArtifact = {
  __typename?: 'BuildArtifact';
  manifestPlistUrl?: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
};

export type BuildArtifacts = {
  __typename?: 'BuildArtifacts';
  applicationArchiveUrl?: Maybe<Scalars['String']['output']>;
  buildArtifactsUrl?: Maybe<Scalars['String']['output']>;
  buildUrl?: Maybe<Scalars['String']['output']>;
  xcodeBuildLogsUrl?: Maybe<Scalars['String']['output']>;
};

export type BuildCacheInput = {
  clear?: InputMaybe<Scalars['Boolean']['input']>;
  disabled?: InputMaybe<Scalars['Boolean']['input']>;
  key?: InputMaybe<Scalars['String']['input']>;
  paths?: InputMaybe<Array<Scalars['String']['input']>>;
};

export enum BuildCredentialsSource {
  Local = 'LOCAL',
  Remote = 'REMOTE'
}

export type BuildError = {
  __typename?: 'BuildError';
  buildPhase?: Maybe<BuildPhase>;
  docsUrl?: Maybe<Scalars['String']['output']>;
  errorCode: Scalars['String']['output'];
  message: Scalars['String']['output'];
};

export type BuildFilter = {
  appBuildVersion?: InputMaybe<Scalars['String']['input']>;
  appIdentifier?: InputMaybe<Scalars['String']['input']>;
  appVersion?: InputMaybe<Scalars['String']['input']>;
  buildProfile?: InputMaybe<Scalars['String']['input']>;
  channel?: InputMaybe<Scalars['String']['input']>;
  distribution?: InputMaybe<DistributionType>;
  gitCommitHash?: InputMaybe<Scalars['String']['input']>;
  platform?: InputMaybe<AppPlatform>;
  runtimeVersion?: InputMaybe<Scalars['String']['input']>;
  sdkVersion?: InputMaybe<Scalars['String']['input']>;
  simulator?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<BuildStatus>;
};

export type BuildFilterInput = {
  channel?: InputMaybe<Scalars['String']['input']>;
  developmentClient?: InputMaybe<Scalars['Boolean']['input']>;
  distributions?: InputMaybe<Array<DistributionType>>;
  platforms?: InputMaybe<Array<AppPlatform>>;
  releaseChannel?: InputMaybe<Scalars['String']['input']>;
  runtimeVersion?: InputMaybe<Scalars['String']['input']>;
  simulator?: InputMaybe<Scalars['Boolean']['input']>;
};

export enum BuildIosEnterpriseProvisioning {
  Adhoc = 'ADHOC',
  Universal = 'UNIVERSAL'
}

/** Represents an Standalone App build job */
export type BuildJob = ActivityTimelineProjectActivity & BuildOrBuildJob & {
  __typename?: 'BuildJob';
  accountUserActor?: Maybe<UserActor>;
  activityTimestamp: Scalars['DateTime']['output'];
  actor?: Maybe<Actor>;
  app?: Maybe<App>;
  artifacts?: Maybe<BuildArtifact>;
  config?: Maybe<Scalars['JSON']['output']>;
  created?: Maybe<Scalars['DateTime']['output']>;
  expirationDate?: Maybe<Scalars['DateTime']['output']>;
  fullExperienceName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  logs?: Maybe<BuildLogs>;
  platform: AppPlatform;
  release?: Maybe<AppRelease>;
  releaseChannel?: Maybe<Scalars['String']['output']>;
  sdkVersion?: Maybe<Scalars['String']['output']>;
  status?: Maybe<BuildJobStatus>;
  updated?: Maybe<Scalars['DateTime']['output']>;
  user?: Maybe<User>;
};

export enum BuildJobLogsFormat {
  Json = 'JSON',
  Raw = 'RAW'
}

export type BuildJobMutation = {
  __typename?: 'BuildJobMutation';
  del?: Maybe<BuildJob>;
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
  experienceSlug?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  showAdminView?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<BuildJobStatus>;
  username?: InputMaybe<Scalars['String']['input']>;
};


export type BuildJobQueryByIdArgs = {
  buildId: Scalars['ID']['input'];
};

export enum BuildJobStatus {
  Errored = 'ERRORED',
  Finished = 'FINISHED',
  InProgress = 'IN_PROGRESS',
  Pending = 'PENDING',
  SentToQueue = 'SENT_TO_QUEUE',
  Started = 'STARTED'
}

export type BuildLimitThresholdExceededMetadata = {
  __typename?: 'BuildLimitThresholdExceededMetadata';
  account: Account;
  thresholdsExceeded: Array<NotificationThresholdExceeded>;
};

export enum BuildLimitThresholdExceededMetadataType {
  Ios = 'IOS',
  Total = 'TOTAL'
}

export type BuildLogs = {
  __typename?: 'BuildLogs';
  format?: Maybe<BuildJobLogsFormat>;
  url?: Maybe<Scalars['String']['output']>;
};

export type BuildMetadataInput = {
  appBuildVersion?: InputMaybe<Scalars['String']['input']>;
  appIdentifier?: InputMaybe<Scalars['String']['input']>;
  appName?: InputMaybe<Scalars['String']['input']>;
  appVersion?: InputMaybe<Scalars['String']['input']>;
  buildProfile?: InputMaybe<Scalars['String']['input']>;
  channel?: InputMaybe<Scalars['String']['input']>;
  cliVersion?: InputMaybe<Scalars['String']['input']>;
  credentialsSource?: InputMaybe<BuildCredentialsSource>;
  customNodeVersion?: InputMaybe<Scalars['String']['input']>;
  customWorkflowName?: InputMaybe<Scalars['String']['input']>;
  developmentClient?: InputMaybe<Scalars['Boolean']['input']>;
  distribution?: InputMaybe<DistributionType>;
  gitCommitHash?: InputMaybe<Scalars['String']['input']>;
  gitCommitMessage?: InputMaybe<Scalars['String']['input']>;
  iosEnterpriseProvisioning?: InputMaybe<BuildIosEnterpriseProvisioning>;
  isGitWorkingTreeDirty?: InputMaybe<Scalars['Boolean']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  reactNativeVersion?: InputMaybe<Scalars['String']['input']>;
  releaseChannel?: InputMaybe<Scalars['String']['input']>;
  requiredPackageManager?: InputMaybe<Scalars['String']['input']>;
  runFromCI?: InputMaybe<Scalars['Boolean']['input']>;
  runWithNoWaitFlag?: InputMaybe<Scalars['Boolean']['input']>;
  runtimeVersion?: InputMaybe<Scalars['String']['input']>;
  sdkVersion?: InputMaybe<Scalars['String']['input']>;
  selectedImage?: InputMaybe<Scalars['String']['input']>;
  simulator?: InputMaybe<Scalars['Boolean']['input']>;
  trackingContext?: InputMaybe<Scalars['JSONObject']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
  workflow?: InputMaybe<BuildWorkflow>;
};

export type BuildMetrics = {
  __typename?: 'BuildMetrics';
  buildDuration?: Maybe<Scalars['Int']['output']>;
  buildQueueTime?: Maybe<Scalars['Int']['output']>;
  buildWaitTime?: Maybe<Scalars['Int']['output']>;
};

export enum BuildMode {
  Build = 'BUILD',
  Custom = 'CUSTOM',
  Resign = 'RESIGN'
}

export type BuildMutation = {
  __typename?: 'BuildMutation';
  /**
   * Cancel an EAS Build build
   * @deprecated Use cancelBuild instead
   */
  cancel: Build;
  /** Cancel an EAS Build build */
  cancelBuild: Build;
  /** Create an Android build */
  createAndroidBuild: CreateBuildResult;
  /** Create an iOS build */
  createIosBuild: CreateBuildResult;
  /** Delete an EAS Build build */
  deleteBuild: Build;
  /** Retry an Android EAS Build */
  retryAndroidBuild: Build;
  /**
   * Retry an EAS Build build
   * @deprecated Use retryAndroidBuild and retryIosBuild instead
   */
  retryBuild: Build;
  /** Retry an iOS EAS Build */
  retryIosBuild: Build;
  /** Update metadata for EAS Build build */
  updateBuildMetadata: Build;
};


export type BuildMutationCancelBuildArgs = {
  buildId: Scalars['ID']['input'];
};


export type BuildMutationCreateAndroidBuildArgs = {
  appId: Scalars['ID']['input'];
  buildParams?: InputMaybe<BuildParamsInput>;
  job: AndroidJobInput;
  metadata?: InputMaybe<BuildMetadataInput>;
};


export type BuildMutationCreateIosBuildArgs = {
  appId: Scalars['ID']['input'];
  buildParams?: InputMaybe<BuildParamsInput>;
  job: IosJobInput;
  metadata?: InputMaybe<BuildMetadataInput>;
};


export type BuildMutationDeleteBuildArgs = {
  buildId: Scalars['ID']['input'];
};


export type BuildMutationRetryAndroidBuildArgs = {
  buildId: Scalars['ID']['input'];
  jobOverrides?: InputMaybe<AndroidJobOverridesInput>;
};


export type BuildMutationRetryBuildArgs = {
  buildId: Scalars['ID']['input'];
};


export type BuildMutationRetryIosBuildArgs = {
  buildId: Scalars['ID']['input'];
  jobOverrides?: InputMaybe<IosJobOverridesInput>;
};


export type BuildMutationUpdateBuildMetadataArgs = {
  buildId: Scalars['ID']['input'];
  metadata: BuildMetadataInput;
};

export type BuildOrBuildJob = {
  id: Scalars['ID']['output'];
};

export type BuildOrBuildJobQuery = {
  __typename?: 'BuildOrBuildJobQuery';
  /** Look up EAS Build or Classic Build Job by ID */
  byId: EasBuildOrClassicBuildJob;
};


export type BuildOrBuildJobQueryByIdArgs = {
  buildOrBuildJobId: Scalars['ID']['input'];
};

export type BuildParamsInput = {
  reactNativeVersion?: InputMaybe<Scalars['String']['input']>;
  resourceClass: BuildResourceClass;
  sdkVersion?: InputMaybe<Scalars['String']['input']>;
};

export enum BuildPhase {
  BuilderInfo = 'BUILDER_INFO',
  CleanUpCredentials = 'CLEAN_UP_CREDENTIALS',
  CompleteBuild = 'COMPLETE_BUILD',
  ConfigureExpoUpdates = 'CONFIGURE_EXPO_UPDATES',
  ConfigureXcodeProject = 'CONFIGURE_XCODE_PROJECT',
  Custom = 'CUSTOM',
  DownloadApplicationArchive = 'DOWNLOAD_APPLICATION_ARCHIVE',
  EasBuildInternal = 'EAS_BUILD_INTERNAL',
  FailBuild = 'FAIL_BUILD',
  FixGradlew = 'FIX_GRADLEW',
  InstallCustomTools = 'INSTALL_CUSTOM_TOOLS',
  InstallDependencies = 'INSTALL_DEPENDENCIES',
  InstallPods = 'INSTALL_PODS',
  OnBuildCancelHook = 'ON_BUILD_CANCEL_HOOK',
  OnBuildCompleteHook = 'ON_BUILD_COMPLETE_HOOK',
  OnBuildErrorHook = 'ON_BUILD_ERROR_HOOK',
  OnBuildSuccessHook = 'ON_BUILD_SUCCESS_HOOK',
  ParseCustomWorkflowConfig = 'PARSE_CUSTOM_WORKFLOW_CONFIG',
  PostInstallHook = 'POST_INSTALL_HOOK',
  Prebuild = 'PREBUILD',
  PrepareArtifacts = 'PREPARE_ARTIFACTS',
  PrepareCredentials = 'PREPARE_CREDENTIALS',
  PrepareProject = 'PREPARE_PROJECT',
  PreInstallHook = 'PRE_INSTALL_HOOK',
  PreUploadArtifactsHook = 'PRE_UPLOAD_ARTIFACTS_HOOK',
  Queue = 'QUEUE',
  ReadAppConfig = 'READ_APP_CONFIG',
  ReadPackageJson = 'READ_PACKAGE_JSON',
  RestoreCache = 'RESTORE_CACHE',
  RunExpoDoctor = 'RUN_EXPO_DOCTOR',
  RunFastlane = 'RUN_FASTLANE',
  RunGradlew = 'RUN_GRADLEW',
  SaveCache = 'SAVE_CACHE',
  SetUpBuildEnvironment = 'SET_UP_BUILD_ENVIRONMENT',
  SpinUpBuilder = 'SPIN_UP_BUILDER',
  StartBuild = 'START_BUILD',
  Unknown = 'UNKNOWN',
  UploadApplicationArchive = 'UPLOAD_APPLICATION_ARCHIVE',
  /** @deprecated No longer supported */
  UploadArtifacts = 'UPLOAD_ARTIFACTS',
  UploadBuildArtifacts = 'UPLOAD_BUILD_ARTIFACTS'
}

export type BuildPlanCreditThresholdExceededMetadata = {
  __typename?: 'BuildPlanCreditThresholdExceededMetadata';
  account: Account;
  buildCreditUsage: Scalars['Int']['output'];
  planLimit: Scalars['Int']['output'];
  threshold: Scalars['Int']['output'];
};

export enum BuildPriority {
  High = 'HIGH',
  Normal = 'NORMAL',
  NormalPlus = 'NORMAL_PLUS'
}

/** Publicly visible data for a Build. */
export type BuildPublicData = {
  __typename?: 'BuildPublicData';
  artifacts: PublicArtifacts;
  distribution?: Maybe<DistributionType>;
  id: Scalars['ID']['output'];
  isForIosSimulator: Scalars['Boolean']['output'];
  platform: AppPlatform;
  project: ProjectPublicData;
  status: BuildStatus;
};

export type BuildPublicDataQuery = {
  __typename?: 'BuildPublicDataQuery';
  /** Get BuildPublicData by ID */
  byId?: Maybe<BuildPublicData>;
};


export type BuildPublicDataQueryByIdArgs = {
  id: Scalars['ID']['input'];
};

export type BuildQuery = {
  __typename?: 'BuildQuery';
  /**
   * Get all builds.
   * By default, they are sorted from latest to oldest.
   * Available only for admin users.
   */
  all: Array<Build>;
  /**
   * Get all builds for a specific app.
   * They are sorted from latest to oldest.
   * @deprecated Use App.builds instead
   */
  allForApp: Array<Maybe<Build>>;
  /** Look up EAS Build by build ID */
  byId: Build;
};


export type BuildQueryAllArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  order?: InputMaybe<Order>;
  statuses?: InputMaybe<Array<BuildStatus>>;
};


export type BuildQueryAllForAppArgs = {
  appId: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  platform?: InputMaybe<AppPlatform>;
  status?: InputMaybe<BuildStatus>;
};


export type BuildQueryByIdArgs = {
  buildId: Scalars['ID']['input'];
};

export type BuildResignInput = {
  applicationArchiveSource?: InputMaybe<ProjectArchiveSourceInput>;
};

export enum BuildResourceClass {
  AndroidDefault = 'ANDROID_DEFAULT',
  AndroidLarge = 'ANDROID_LARGE',
  AndroidMedium = 'ANDROID_MEDIUM',
  IosDefault = 'IOS_DEFAULT',
  /** @deprecated No longer available. Use IOS_M_LARGE instead. */
  IosIntelLarge = 'IOS_INTEL_LARGE',
  /** @deprecated No longer available. Use IOS_M_MEDIUM instead. */
  IosIntelMedium = 'IOS_INTEL_MEDIUM',
  IosLarge = 'IOS_LARGE',
  /** @deprecated Use IOS_M_MEDIUM instead */
  IosM1Large = 'IOS_M1_LARGE',
  /** @deprecated Use IOS_M_MEDIUM instead */
  IosM1Medium = 'IOS_M1_MEDIUM',
  IosMedium = 'IOS_MEDIUM',
  IosMLarge = 'IOS_M_LARGE',
  IosMMedium = 'IOS_M_MEDIUM',
  Legacy = 'LEGACY'
}

export enum BuildRetryDisabledReason {
  AlreadyRetried = 'ALREADY_RETRIED',
  InvalidStatus = 'INVALID_STATUS',
  IsGithubBuild = 'IS_GITHUB_BUILD',
  NotCompletedYet = 'NOT_COMPLETED_YET',
  TooMuchTimeElapsed = 'TOO_MUCH_TIME_ELAPSED'
}

export enum BuildStatus {
  Canceled = 'CANCELED',
  Errored = 'ERRORED',
  Finished = 'FINISHED',
  InProgress = 'IN_PROGRESS',
  InQueue = 'IN_QUEUE',
  New = 'NEW',
  PendingCancel = 'PENDING_CANCEL'
}

export enum BuildTrigger {
  EasCli = 'EAS_CLI',
  GitBasedIntegration = 'GIT_BASED_INTEGRATION'
}

export type BuildUpdatesInput = {
  channel?: InputMaybe<Scalars['String']['input']>;
};

export enum BuildWorkflow {
  Generic = 'GENERIC',
  Managed = 'MANAGED',
  Unknown = 'UNKNOWN'
}

export type Card = {
  __typename?: 'Card';
  brand?: Maybe<Scalars['String']['output']>;
  cardHolder?: Maybe<Scalars['String']['output']>;
  expMonth?: Maybe<Scalars['Int']['output']>;
  expYear?: Maybe<Scalars['Int']['output']>;
  last4?: Maybe<Scalars['String']['output']>;
};

export type ChannelFilterInput = {
  searchTerm?: InputMaybe<Scalars['String']['input']>;
};

export type Charge = {
  __typename?: 'Charge';
  amount: Scalars['Int']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  invoiceId?: Maybe<Scalars['String']['output']>;
  paid: Scalars['Boolean']['output'];
  receiptUrl?: Maybe<Scalars['String']['output']>;
  wasRefunded: Scalars['Boolean']['output'];
};

export type CodeSigningInfo = {
  __typename?: 'CodeSigningInfo';
  alg: Scalars['String']['output'];
  keyid: Scalars['String']['output'];
  sig: Scalars['String']['output'];
};

export type CodeSigningInfoInput = {
  alg: Scalars['String']['input'];
  keyid: Scalars['String']['input'];
  sig: Scalars['String']['input'];
};

export type Concurrencies = {
  __typename?: 'Concurrencies';
  android: Scalars['Int']['output'];
  ios: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type CreateAccessTokenInput = {
  actorID: Scalars['ID']['input'];
  note?: InputMaybe<Scalars['String']['input']>;
};

export type CreateAccessTokenResponse = {
  __typename?: 'CreateAccessTokenResponse';
  /** AccessToken created */
  accessToken: AccessToken;
  /** Full token string to be used for authentication */
  token: Scalars['String']['output'];
};

export type CreateAndroidSubmissionInput = {
  appId: Scalars['ID']['input'];
  archiveSource?: InputMaybe<SubmissionArchiveSourceInput>;
  archiveUrl?: InputMaybe<Scalars['String']['input']>;
  config: AndroidSubmissionConfigInput;
  submittedBuildId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateAppAndGithubRepositoryResponse = {
  __typename?: 'CreateAppAndGithubRepositoryResponse';
  app: App;
  cloneUrl?: Maybe<Scalars['String']['output']>;
};

export type CreateBuildResult = {
  __typename?: 'CreateBuildResult';
  build: Build;
  deprecationInfo?: Maybe<EasBuildDeprecationInfo>;
};

export type CreateEnvironmentSecretInput = {
  name: Scalars['String']['input'];
  type?: InputMaybe<EnvironmentSecretType>;
  value: Scalars['String']['input'];
};

export type CreateGitHubAppInstallationInput = {
  accountId: Scalars['ID']['input'];
  installationIdentifier: Scalars['Int']['input'];
};

export type CreateGitHubBuildTriggerInput = {
  appId: Scalars['ID']['input'];
  autoSubmit: Scalars['Boolean']['input'];
  buildProfile: Scalars['String']['input'];
  isActive: Scalars['Boolean']['input'];
  platform: AppPlatform;
  /** A branch or tag name, or a wildcard pattern where the code change originates from. For example, `main` or `release/*`. */
  sourcePattern: Scalars['String']['input'];
  submitProfile?: InputMaybe<Scalars['String']['input']>;
  /** A branch name or a wildcard pattern that the pull request targets. For example, `main` or `release/*`. */
  targetPattern?: InputMaybe<Scalars['String']['input']>;
  type: GitHubBuildTriggerType;
};

export type CreateGitHubRepositoryInput = {
  appId: Scalars['ID']['input'];
  githubAppInstallationId: Scalars['ID']['input'];
  githubRepositoryIdentifier: Scalars['Int']['input'];
  nodeIdentifier: Scalars['String']['input'];
};

export type CreateGitHubRepositorySettingsInput = {
  appId: Scalars['ID']['input'];
  /** The base directory is the directory to change to before starting a build. This string should be a properly formatted POSIX path starting with '/', './', or the name of the directory relative to the root of the repository. Valid examples include: '/apps/expo-app', './apps/expo-app', and 'apps/expo-app'. This is intended for monorepos or apps that live in a subdirectory of a repository. */
  baseDirectory: Scalars['String']['input'];
};

export type CreateIosSubmissionInput = {
  appId: Scalars['ID']['input'];
  archiveSource?: InputMaybe<SubmissionArchiveSourceInput>;
  archiveUrl?: InputMaybe<Scalars['String']['input']>;
  config: IosSubmissionConfigInput;
  submittedBuildId?: InputMaybe<Scalars['ID']['input']>;
};

export type CreateServerlessFunctionUploadUrlResult = {
  __typename?: 'CreateServerlessFunctionUploadUrlResult';
  formDataFields: Scalars['JSONObject']['output'];
  url: Scalars['String']['output'];
};

export type CreateSubmissionResult = {
  __typename?: 'CreateSubmissionResult';
  /** Created submission */
  submission: Submission;
};

export type CustomBuildConfigInput = {
  path: Scalars['String']['input'];
};

export type DeleteAccessTokenResult = {
  __typename?: 'DeleteAccessTokenResult';
  id: Scalars['ID']['output'];
};

export type DeleteAccountResult = {
  __typename?: 'DeleteAccountResult';
  id: Scalars['ID']['output'];
};

export type DeleteAccountSsoConfigurationResult = {
  __typename?: 'DeleteAccountSSOConfigurationResult';
  id: Scalars['ID']['output'];
};

export type DeleteAndroidAppCredentialsResult = {
  __typename?: 'DeleteAndroidAppCredentialsResult';
  id: Scalars['ID']['output'];
};

export type DeleteAndroidKeystoreResult = {
  __typename?: 'DeleteAndroidKeystoreResult';
  id: Scalars['ID']['output'];
};

export type DeleteAppleDeviceResult = {
  __typename?: 'DeleteAppleDeviceResult';
  id: Scalars['ID']['output'];
};

export type DeleteAppleDistributionCertificateResult = {
  __typename?: 'DeleteAppleDistributionCertificateResult';
  id: Scalars['ID']['output'];
};

export type DeleteAppleProvisioningProfileResult = {
  __typename?: 'DeleteAppleProvisioningProfileResult';
  id: Scalars['ID']['output'];
};

export type DeleteBuildAnnotationResult = {
  __typename?: 'DeleteBuildAnnotationResult';
  buildAnnotationId: Scalars['ID']['output'];
};

export type DeleteDiscordUserResult = {
  __typename?: 'DeleteDiscordUserResult';
  id: Scalars['ID']['output'];
};

export type DeleteEnvironmentSecretResult = {
  __typename?: 'DeleteEnvironmentSecretResult';
  id: Scalars['ID']['output'];
};

export type DeleteGitHubUserResult = {
  __typename?: 'DeleteGitHubUserResult';
  id: Scalars['ID']['output'];
};

export type DeleteGoogleServiceAccountKeyResult = {
  __typename?: 'DeleteGoogleServiceAccountKeyResult';
  id: Scalars['ID']['output'];
};

export type DeleteIosAppBuildCredentialsResult = {
  __typename?: 'DeleteIosAppBuildCredentialsResult';
  id: Scalars['ID']['output'];
};

export type DeleteIosAppCredentialsResult = {
  __typename?: 'DeleteIosAppCredentialsResult';
  id: Scalars['ID']['output'];
};

export type DeleteRobotResult = {
  __typename?: 'DeleteRobotResult';
  id: Scalars['ID']['output'];
};

export type DeleteSsoUserResult = {
  __typename?: 'DeleteSSOUserResult';
  id: Scalars['ID']['output'];
};

export type DeleteUpdateBranchResult = {
  __typename?: 'DeleteUpdateBranchResult';
  id: Scalars['ID']['output'];
};

export type DeleteUpdateChannelResult = {
  __typename?: 'DeleteUpdateChannelResult';
  id: Scalars['ID']['output'];
};

export type DeleteUpdateGroupResult = {
  __typename?: 'DeleteUpdateGroupResult';
  group: Scalars['ID']['output'];
};

export type DeleteWebhookResult = {
  __typename?: 'DeleteWebhookResult';
  id: Scalars['ID']['output'];
};

export type DeployServerlessFunctionResult = {
  __typename?: 'DeployServerlessFunctionResult';
  url: Scalars['String']['output'];
};

/** Represents a Deployment - a set of Builds with the same Runtime Version and Channel */
export type Deployment = {
  __typename?: 'Deployment';
  builds: DeploymentBuildsConnection;
  channel: UpdateChannel;
  id: Scalars['ID']['output'];
  /** Deployment query field */
  insights: DeploymentInsights;
  /** Ordered the same way as 'updateBranches' in UpdateChannel */
  latestUpdatesPerBranch: Array<LatestUpdateOnBranch>;
  runtime: Runtime;
};


/** Represents a Deployment - a set of Builds with the same Runtime Version and Channel */
export type DeploymentBuildsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


/** Represents a Deployment - a set of Builds with the same Runtime Version and Channel */
export type DeploymentLatestUpdatesPerBranchArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};

export type DeploymentBuildEdge = {
  __typename?: 'DeploymentBuildEdge';
  cursor: Scalars['String']['output'];
  node: Build;
};

/** Represents the connection over the builds edge of a Deployment */
export type DeploymentBuildsConnection = {
  __typename?: 'DeploymentBuildsConnection';
  edges: Array<DeploymentBuildEdge>;
  pageInfo: PageInfo;
};

export type DeploymentEdge = {
  __typename?: 'DeploymentEdge';
  cursor: Scalars['String']['output'];
  node: Deployment;
};

export type DeploymentFilterInput = {
  channel?: InputMaybe<Scalars['String']['input']>;
  runtimeVersion?: InputMaybe<Scalars['String']['input']>;
};

export type DeploymentInsights = {
  __typename?: 'DeploymentInsights';
  embeddedUpdateTotalUniqueUsers: Scalars['Int']['output'];
  embeddedUpdateUniqueUsersOverTime: UniqueUsersOverTimeData;
  id: Scalars['ID']['output'];
  mostPopularUpdates: Array<Update>;
  uniqueUsersOverTime: UniqueUsersOverTimeData;
};


export type DeploymentInsightsEmbeddedUpdateTotalUniqueUsersArgs = {
  timespan: InsightsTimespan;
};


export type DeploymentInsightsEmbeddedUpdateUniqueUsersOverTimeArgs = {
  timespan: InsightsTimespan;
};


export type DeploymentInsightsMostPopularUpdatesArgs = {
  timespan: InsightsTimespan;
};


export type DeploymentInsightsUniqueUsersOverTimeArgs = {
  timespan: InsightsTimespan;
};

/** Represents the connection over the deployments edge of an App */
export type DeploymentsConnection = {
  __typename?: 'DeploymentsConnection';
  edges: Array<DeploymentEdge>;
  pageInfo: PageInfo;
};

export type DiscordUser = {
  __typename?: 'DiscordUser';
  discordIdentifier: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  metadata?: Maybe<DiscordUserMetadata>;
  userActor: UserActor;
};

export type DiscordUserMetadata = {
  __typename?: 'DiscordUserMetadata';
  discordAvatarUrl: Scalars['String']['output'];
  discordDiscriminator: Scalars['String']['output'];
  discordUsername: Scalars['String']['output'];
};

export type DiscordUserMutation = {
  __typename?: 'DiscordUserMutation';
  /** Delete a Discord User by ID */
  deleteDiscordUser: DeleteDiscordUserResult;
};


export type DiscordUserMutationDeleteDiscordUserArgs = {
  id: Scalars['ID']['input'];
};

export enum DistributionType {
  Internal = 'INTERNAL',
  Simulator = 'SIMULATOR',
  Store = 'STORE'
}

export enum EasBuildBillingResourceClass {
  Large = 'LARGE',
  Medium = 'MEDIUM'
}

export type EasBuildDeprecationInfo = {
  __typename?: 'EASBuildDeprecationInfo';
  message: Scalars['String']['output'];
  type: EasBuildDeprecationInfoType;
};

export enum EasBuildDeprecationInfoType {
  Internal = 'INTERNAL',
  UserFacing = 'USER_FACING'
}

export type EasBuildOrClassicBuildJob = Build | BuildJob;

export enum EasService {
  Builds = 'BUILDS',
  Jobs = 'JOBS',
  Updates = 'UPDATES'
}

export enum EasServiceMetric {
  AssetsRequests = 'ASSETS_REQUESTS',
  BandwidthUsage = 'BANDWIDTH_USAGE',
  Builds = 'BUILDS',
  ManifestRequests = 'MANIFEST_REQUESTS',
  RunTime = 'RUN_TIME',
  UniqueUpdaters = 'UNIQUE_UPDATERS',
  UniqueUsers = 'UNIQUE_USERS'
}

export type EasTotalPlanEnablement = {
  __typename?: 'EASTotalPlanEnablement';
  total: Scalars['Int']['output'];
  unit?: Maybe<EasTotalPlanEnablementUnit>;
};

export enum EasTotalPlanEnablementUnit {
  Build = 'BUILD',
  Byte = 'BYTE',
  Concurrency = 'CONCURRENCY',
  Request = 'REQUEST',
  Updater = 'UPDATER',
  User = 'USER'
}

export type EditUpdateBranchInput = {
  appId?: InputMaybe<Scalars['ID']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  newName: Scalars['String']['input'];
};

export type EmailSubscriptionMutation = {
  __typename?: 'EmailSubscriptionMutation';
  addUser: AddUserPayload;
};


export type EmailSubscriptionMutationAddUserArgs = {
  addUserInput: AddUserInput;
};

export type EnvironmentSecret = {
  __typename?: 'EnvironmentSecret';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  type: EnvironmentSecretType;
  updatedAt: Scalars['DateTime']['output'];
};

export type EnvironmentSecretMutation = {
  __typename?: 'EnvironmentSecretMutation';
  /** Create an environment secret for an Account */
  createEnvironmentSecretForAccount: EnvironmentSecret;
  /** Create an environment secret for an App */
  createEnvironmentSecretForApp: EnvironmentSecret;
  /** Delete an environment secret */
  deleteEnvironmentSecret: DeleteEnvironmentSecretResult;
};


export type EnvironmentSecretMutationCreateEnvironmentSecretForAccountArgs = {
  accountId: Scalars['String']['input'];
  environmentSecretData: CreateEnvironmentSecretInput;
};


export type EnvironmentSecretMutationCreateEnvironmentSecretForAppArgs = {
  appId: Scalars['String']['input'];
  environmentSecretData: CreateEnvironmentSecretInput;
};


export type EnvironmentSecretMutationDeleteEnvironmentSecretArgs = {
  id: Scalars['String']['input'];
};

export enum EnvironmentSecretType {
  FileBase64 = 'FILE_BASE64',
  String = 'STRING'
}

export type EstimatedOverageAndCost = {
  __typename?: 'EstimatedOverageAndCost';
  id: Scalars['ID']['output'];
  /** The limit, in units, allowed by this plan */
  limit: Scalars['Float']['output'];
  metadata?: Maybe<AccountUsageMetadata>;
  metricType: UsageMetricType;
  service: EasService;
  serviceMetric: EasServiceMetric;
  /** Total cost of this particular metric, in cents */
  totalCost: Scalars['Int']['output'];
  value: Scalars['Float']['output'];
};

export type EstimatedUsage = {
  __typename?: 'EstimatedUsage';
  id: Scalars['ID']['output'];
  limit: Scalars['Float']['output'];
  metricType: UsageMetricType;
  service: EasService;
  serviceMetric: EasServiceMetric;
  value: Scalars['Float']['output'];
};

export enum Experiment {
  Orbit = 'ORBIT'
}

export type ExperimentationQuery = {
  __typename?: 'ExperimentationQuery';
  /** Get device experimentation config */
  deviceConfig: Scalars['JSONObject']['output'];
  /** Get experimentation unit to use for device experiments. In this case, it is the IP address. */
  deviceExperimentationUnit: Scalars['ID']['output'];
  /** Get user experimentation config */
  userConfig: Scalars['JSONObject']['output'];
};

export type FcmSnippet = FcmSnippetLegacy | FcmSnippetV1;

export type FcmSnippetLegacy = {
  __typename?: 'FcmSnippetLegacy';
  firstFourCharacters: Scalars['String']['output'];
  lastFourCharacters: Scalars['String']['output'];
};

export type FcmSnippetV1 = {
  __typename?: 'FcmSnippetV1';
  clientId?: Maybe<Scalars['String']['output']>;
  keyId: Scalars['String']['output'];
  projectId: Scalars['String']['output'];
  serviceAccountEmail: Scalars['String']['output'];
};

export enum Feature {
  /** Priority Builds */
  Builds = 'BUILDS',
  /** Funds support for open source development */
  OpenSource = 'OPEN_SOURCE',
  /** Top Tier Support */
  Support = 'SUPPORT',
  /** Share access to projects */
  Teams = 'TEAMS'
}

export type FutureSubscription = {
  __typename?: 'FutureSubscription';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  meteredBillingStatus: MeteredBillingStatus;
  planId: Scalars['String']['output'];
  startDate: Scalars['DateTime']['output'];
};

export type GetSignedAssetUploadSpecificationsResult = {
  __typename?: 'GetSignedAssetUploadSpecificationsResult';
  specifications: Array<Scalars['String']['output']>;
};

export enum GitHubAppEnvironment {
  Development = 'DEVELOPMENT',
  Production = 'PRODUCTION',
  Staging = 'STAGING'
}

export type GitHubAppInstallation = {
  __typename?: 'GitHubAppInstallation';
  account: Account;
  actor?: Maybe<Actor>;
  id: Scalars['ID']['output'];
  installationIdentifier: Scalars['Int']['output'];
  metadata: GitHubAppInstallationMetadata;
};

export type GitHubAppInstallationAccessibleRepository = {
  __typename?: 'GitHubAppInstallationAccessibleRepository';
  defaultBranch?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  nodeId: Scalars['String']['output'];
  owner: GitHubRepositoryOwner;
  private: Scalars['Boolean']['output'];
  url: Scalars['String']['output'];
};

export type GitHubAppInstallationMetadata = {
  __typename?: 'GitHubAppInstallationMetadata';
  githubAccountAvatarUrl?: Maybe<Scalars['String']['output']>;
  githubAccountName?: Maybe<Scalars['String']['output']>;
  installationStatus: GitHubAppInstallationStatus;
};

export type GitHubAppInstallationMutation = {
  __typename?: 'GitHubAppInstallationMutation';
  /** Create a GitHub App installation for an Account */
  createGitHubAppInstallationForAccount: GitHubAppInstallation;
  /** Delete a GitHub App installation by ID */
  deleteGitHubAppInstallation: GitHubAppInstallation;
};


export type GitHubAppInstallationMutationCreateGitHubAppInstallationForAccountArgs = {
  githubAppInstallationData: CreateGitHubAppInstallationInput;
};


export type GitHubAppInstallationMutationDeleteGitHubAppInstallationArgs = {
  githubAppInstallationId: Scalars['ID']['input'];
};

export enum GitHubAppInstallationStatus {
  Active = 'ACTIVE',
  NotInstalled = 'NOT_INSTALLED',
  Suspended = 'SUSPENDED'
}

export type GitHubAppMutation = {
  __typename?: 'GitHubAppMutation';
  /** Create a GitHub build for an app. Returns the ID of the background job receipt. Use BackgroundJobReceiptQuery to get the status of the job. */
  createGitHubBuild: BackgroundJobReceipt;
};


export type GitHubAppMutationCreateGitHubBuildArgs = {
  buildInput: GitHubBuildInput;
};

export type GitHubAppQuery = {
  __typename?: 'GitHubAppQuery';
  appIdentifier: Scalars['String']['output'];
  clientIdentifier: Scalars['String']['output'];
  environment: GitHubAppEnvironment;
  installation: GitHubAppInstallation;
  name: Scalars['String']['output'];
};


export type GitHubAppQueryInstallationArgs = {
  id: Scalars['ID']['input'];
};

export type GitHubBuildInput = {
  appId: Scalars['ID']['input'];
  autoSubmit?: InputMaybe<Scalars['Boolean']['input']>;
  baseDirectory?: InputMaybe<Scalars['String']['input']>;
  buildProfile: Scalars['String']['input'];
  gitRef: Scalars['String']['input'];
  platform: AppPlatform;
  submitProfile?: InputMaybe<Scalars['String']['input']>;
};

export type GitHubBuildTrigger = {
  __typename?: 'GitHubBuildTrigger';
  app: App;
  autoSubmit: Scalars['Boolean']['output'];
  buildProfile: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  lastRunAt?: Maybe<Scalars['DateTime']['output']>;
  lastRunBuild?: Maybe<Build>;
  lastRunErrorCode?: Maybe<Scalars['String']['output']>;
  lastRunErrorMessage?: Maybe<Scalars['String']['output']>;
  lastRunStatus?: Maybe<GitHubBuildTriggerRunStatus>;
  platform: AppPlatform;
  sourcePattern: Scalars['String']['output'];
  submitProfile?: Maybe<Scalars['String']['output']>;
  targetPattern?: Maybe<Scalars['String']['output']>;
  type: GitHubBuildTriggerType;
  updatedAt: Scalars['DateTime']['output'];
};

export type GitHubBuildTriggerMutation = {
  __typename?: 'GitHubBuildTriggerMutation';
  /** Create GitHub build trigger for an App */
  createGitHubBuildTrigger: GitHubBuildTrigger;
  /** Delete GitHub build trigger by ID */
  deleteGitHubBuildTrigger: GitHubBuildTrigger;
  /** Update a GitHub build trigger by ID */
  updateGitHubBuildTrigger: GitHubBuildTrigger;
};


export type GitHubBuildTriggerMutationCreateGitHubBuildTriggerArgs = {
  githubBuildTriggerData: CreateGitHubBuildTriggerInput;
};


export type GitHubBuildTriggerMutationDeleteGitHubBuildTriggerArgs = {
  githubBuildTriggerId: Scalars['ID']['input'];
};


export type GitHubBuildTriggerMutationUpdateGitHubBuildTriggerArgs = {
  githubBuildTriggerData: UpdateGitHubBuildTriggerInput;
  githubBuildTriggerId: Scalars['ID']['input'];
};

export enum GitHubBuildTriggerRunStatus {
  Errored = 'ERRORED',
  Success = 'SUCCESS'
}

export enum GitHubBuildTriggerType {
  PullRequestUpdated = 'PULL_REQUEST_UPDATED',
  PushToBranch = 'PUSH_TO_BRANCH',
  TagUpdated = 'TAG_UPDATED'
}

export type GitHubRepository = {
  __typename?: 'GitHubRepository';
  app: App;
  createdAt: Scalars['DateTime']['output'];
  githubAppInstallation: GitHubAppInstallation;
  githubRepositoryIdentifier: Scalars['Int']['output'];
  githubRepositoryUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  metadata: GitHubRepositoryMetadata;
  nodeIdentifier: Scalars['String']['output'];
};

export type GitHubRepositoryMetadata = {
  __typename?: 'GitHubRepositoryMetadata';
  defaultBranch?: Maybe<Scalars['String']['output']>;
  githubRepoDescription?: Maybe<Scalars['String']['output']>;
  githubRepoName: Scalars['String']['output'];
  githubRepoOwnerName: Scalars['String']['output'];
  githubRepoUrl: Scalars['String']['output'];
  lastPushed: Scalars['DateTime']['output'];
  lastUpdated: Scalars['DateTime']['output'];
  private: Scalars['Boolean']['output'];
};

export type GitHubRepositoryMutation = {
  __typename?: 'GitHubRepositoryMutation';
  /** Create a GitHub repository for an App */
  createGitHubRepository: GitHubRepository;
  /** Delete a GitHub repository by ID */
  deleteGitHubRepository: GitHubRepository;
};


export type GitHubRepositoryMutationCreateGitHubRepositoryArgs = {
  githubRepositoryData: CreateGitHubRepositoryInput;
};


export type GitHubRepositoryMutationDeleteGitHubRepositoryArgs = {
  githubRepositoryId: Scalars['ID']['input'];
};

export type GitHubRepositoryOwner = {
  __typename?: 'GitHubRepositoryOwner';
  avatarUrl: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  login: Scalars['String']['output'];
  url: Scalars['String']['output'];
};

export type GitHubRepositoryPaginationResult = {
  __typename?: 'GitHubRepositoryPaginationResult';
  repositories: Array<GitHubAppInstallationAccessibleRepository>;
  totalCount: Scalars['Int']['output'];
};

export type GitHubRepositorySettings = {
  __typename?: 'GitHubRepositorySettings';
  app: App;
  baseDirectory: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

export type GitHubRepositorySettingsMutation = {
  __typename?: 'GitHubRepositorySettingsMutation';
  /** Create GitHub repository settings for an App */
  createGitHubRepositorySettings: GitHubRepositorySettings;
  /** Delete GitHub repository settings by ID */
  deleteGitHubRepositorySettings: GitHubRepositorySettings;
  /** Update GitHub repository settings */
  updateGitHubRepositorySettings: GitHubRepositorySettings;
};


export type GitHubRepositorySettingsMutationCreateGitHubRepositorySettingsArgs = {
  githubRepositorySettingsData: CreateGitHubRepositorySettingsInput;
};


export type GitHubRepositorySettingsMutationDeleteGitHubRepositorySettingsArgs = {
  githubRepositorySettingsId: Scalars['ID']['input'];
};


export type GitHubRepositorySettingsMutationUpdateGitHubRepositorySettingsArgs = {
  githubRepositorySettingsData: UpdateGitHubRepositorySettingsInput;
  githubRepositorySettingsId: Scalars['ID']['input'];
};

export type GitHubUser = {
  __typename?: 'GitHubUser';
  githubUserIdentifier: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  metadata?: Maybe<GitHubUserMetadata>;
  userActor: UserActor;
};

export type GitHubUserMetadata = {
  __typename?: 'GitHubUserMetadata';
  avatarUrl: Scalars['String']['output'];
  login: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
};

export type GitHubUserMutation = {
  __typename?: 'GitHubUserMutation';
  /** Delete a GitHub User by ID */
  deleteGitHubUser: DeleteGitHubUserResult;
  /** Generate a GitHub User Access Token */
  generateGitHubUserAccessToken?: Maybe<Scalars['String']['output']>;
};


export type GitHubUserMutationDeleteGitHubUserArgs = {
  id: Scalars['ID']['input'];
};

export type GoogleServiceAccountKey = {
  __typename?: 'GoogleServiceAccountKey';
  account: Account;
  clientEmail: Scalars['String']['output'];
  clientIdentifier: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  privateKeyIdentifier: Scalars['String']['output'];
  projectIdentifier: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type GoogleServiceAccountKeyInput = {
  jsonKey: Scalars['JSONObject']['input'];
};

export type GoogleServiceAccountKeyMutation = {
  __typename?: 'GoogleServiceAccountKeyMutation';
  /** Create a Google Service Account Key */
  createGoogleServiceAccountKey: GoogleServiceAccountKey;
  /** Delete a Google Service Account Key */
  deleteGoogleServiceAccountKey: DeleteGoogleServiceAccountKeyResult;
};


export type GoogleServiceAccountKeyMutationCreateGoogleServiceAccountKeyArgs = {
  accountId: Scalars['ID']['input'];
  googleServiceAccountKeyInput: GoogleServiceAccountKeyInput;
};


export type GoogleServiceAccountKeyMutationDeleteGoogleServiceAccountKeyArgs = {
  id: Scalars['ID']['input'];
};

export type InsightsTimespan = {
  end: Scalars['DateTime']['input'];
  start: Scalars['DateTime']['input'];
};

export type Invoice = {
  __typename?: 'Invoice';
  /** The total amount due for the invoice, in cents */
  amountDue: Scalars['Int']['output'];
  /** The total amount that has been paid, considering any discounts or account credit. Value is in cents. */
  amountPaid: Scalars['Int']['output'];
  /** The total amount that needs to be paid, considering any discounts or account credit. Value is in cents. */
  amountRemaining: Scalars['Int']['output'];
  discount?: Maybe<InvoiceDiscount>;
  id: Scalars['ID']['output'];
  lineItems: Array<InvoiceLineItem>;
  period: InvoicePeriod;
  startingBalance: Scalars['Int']['output'];
  subtotal: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
  totalDiscountedAmount: Scalars['Int']['output'];
};

export type InvoiceDiscount = {
  __typename?: 'InvoiceDiscount';
  /** The coupon's discount value, in percentage or in dollar amount */
  amount: Scalars['Int']['output'];
  duration: Scalars['String']['output'];
  durationInMonths?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  type: InvoiceDiscountType;
};

export enum InvoiceDiscountType {
  Amount = 'AMOUNT',
  Percentage = 'PERCENTAGE'
}

export type InvoiceLineItem = {
  __typename?: 'InvoiceLineItem';
  /** Line-item amount in cents */
  amount: Scalars['Int']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  period: InvoicePeriod;
  plan: InvoiceLineItemPlan;
  proration: Scalars['Boolean']['output'];
  quantity: Scalars['Int']['output'];
  title: Scalars['String']['output'];
};

export type InvoiceLineItemPlan = {
  __typename?: 'InvoiceLineItemPlan';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type InvoicePeriod = {
  __typename?: 'InvoicePeriod';
  end: Scalars['DateTime']['output'];
  start: Scalars['DateTime']['output'];
};

export type InvoiceQuery = {
  __typename?: 'InvoiceQuery';
  /** Preview an upgrade subscription invoice, with proration */
  previewInvoiceForSubscriptionUpdate: Invoice;
};


export type InvoiceQueryPreviewInvoiceForSubscriptionUpdateArgs = {
  accountId: Scalars['String']['input'];
  couponCode?: InputMaybe<Scalars['String']['input']>;
  newPlanIdentifier: Scalars['String']['input'];
};

export type IosAppBuildCredentials = {
  __typename?: 'IosAppBuildCredentials';
  /** @deprecated Get Apple Devices from AppleProvisioningProfile instead */
  appleDevices?: Maybe<Array<Maybe<AppleDevice>>>;
  distributionCertificate?: Maybe<AppleDistributionCertificate>;
  id: Scalars['ID']['output'];
  iosAppCredentials: IosAppCredentials;
  iosDistributionType: IosDistributionType;
  provisioningProfile?: Maybe<AppleProvisioningProfile>;
};

export type IosAppBuildCredentialsFilter = {
  iosDistributionType?: InputMaybe<IosDistributionType>;
};

export type IosAppBuildCredentialsInput = {
  distributionCertificateId: Scalars['ID']['input'];
  iosDistributionType: IosDistributionType;
  provisioningProfileId: Scalars['ID']['input'];
};

export type IosAppBuildCredentialsMutation = {
  __typename?: 'IosAppBuildCredentialsMutation';
  /** Create a set of build credentials for an iOS app */
  createIosAppBuildCredentials: IosAppBuildCredentials;
  /** Disassociate the build credentials from an iOS app */
  deleteIosAppBuildCredentials: DeleteIosAppBuildCredentialsResult;
  /** Set the distribution certificate to be used for an iOS app */
  setDistributionCertificate: IosAppBuildCredentials;
  /** Set the provisioning profile to be used for an iOS app */
  setProvisioningProfile: IosAppBuildCredentials;
};


export type IosAppBuildCredentialsMutationCreateIosAppBuildCredentialsArgs = {
  iosAppBuildCredentialsInput: IosAppBuildCredentialsInput;
  iosAppCredentialsId: Scalars['ID']['input'];
};


export type IosAppBuildCredentialsMutationDeleteIosAppBuildCredentialsArgs = {
  id: Scalars['ID']['input'];
};


export type IosAppBuildCredentialsMutationSetDistributionCertificateArgs = {
  distributionCertificateId: Scalars['ID']['input'];
  id: Scalars['ID']['input'];
};


export type IosAppBuildCredentialsMutationSetProvisioningProfileArgs = {
  id: Scalars['ID']['input'];
  provisioningProfileId: Scalars['ID']['input'];
};

export type IosAppCredentials = {
  __typename?: 'IosAppCredentials';
  app: App;
  appStoreConnectApiKeyForSubmissions?: Maybe<AppStoreConnectApiKey>;
  appleAppIdentifier: AppleAppIdentifier;
  appleTeam?: Maybe<AppleTeam>;
  id: Scalars['ID']['output'];
  /** @deprecated use iosAppBuildCredentialsList instead */
  iosAppBuildCredentialsArray: Array<IosAppBuildCredentials>;
  iosAppBuildCredentialsList: Array<IosAppBuildCredentials>;
  pushKey?: Maybe<ApplePushKey>;
};


export type IosAppCredentialsIosAppBuildCredentialsArrayArgs = {
  filter?: InputMaybe<IosAppBuildCredentialsFilter>;
};


export type IosAppCredentialsIosAppBuildCredentialsListArgs = {
  filter?: InputMaybe<IosAppBuildCredentialsFilter>;
};

export type IosAppCredentialsFilter = {
  appleAppIdentifierId?: InputMaybe<Scalars['String']['input']>;
};

export type IosAppCredentialsInput = {
  appStoreConnectApiKeyForSubmissionsId?: InputMaybe<Scalars['ID']['input']>;
  appleTeamId?: InputMaybe<Scalars['ID']['input']>;
  pushKeyId?: InputMaybe<Scalars['ID']['input']>;
};

export type IosAppCredentialsMutation = {
  __typename?: 'IosAppCredentialsMutation';
  /** Create a set of credentials for an iOS app */
  createIosAppCredentials: IosAppCredentials;
  /** Delete a set of credentials for an iOS app */
  deleteIosAppCredentials: DeleteIosAppCredentialsResult;
  /** Set the App Store Connect Api Key to be used for submitting an iOS app */
  setAppStoreConnectApiKeyForSubmissions: IosAppCredentials;
  /** Set the push key to be used in an iOS app */
  setPushKey: IosAppCredentials;
};


export type IosAppCredentialsMutationCreateIosAppCredentialsArgs = {
  appId: Scalars['ID']['input'];
  appleAppIdentifierId: Scalars['ID']['input'];
  iosAppCredentialsInput: IosAppCredentialsInput;
};


export type IosAppCredentialsMutationDeleteIosAppCredentialsArgs = {
  id: Scalars['ID']['input'];
};


export type IosAppCredentialsMutationSetAppStoreConnectApiKeyForSubmissionsArgs = {
  ascApiKeyId: Scalars['ID']['input'];
  id: Scalars['ID']['input'];
};


export type IosAppCredentialsMutationSetPushKeyArgs = {
  id: Scalars['ID']['input'];
  pushKeyId: Scalars['ID']['input'];
};

/** @deprecated Use developmentClient option instead. */
export enum IosBuildType {
  DevelopmentClient = 'DEVELOPMENT_CLIENT',
  Release = 'RELEASE'
}

export type IosBuilderEnvironmentInput = {
  bun?: InputMaybe<Scalars['String']['input']>;
  bundler?: InputMaybe<Scalars['String']['input']>;
  cocoapods?: InputMaybe<Scalars['String']['input']>;
  env?: InputMaybe<Scalars['JSONObject']['input']>;
  expoCli?: InputMaybe<Scalars['String']['input']>;
  fastlane?: InputMaybe<Scalars['String']['input']>;
  image?: InputMaybe<Scalars['String']['input']>;
  node?: InputMaybe<Scalars['String']['input']>;
  pnpm?: InputMaybe<Scalars['String']['input']>;
  yarn?: InputMaybe<Scalars['String']['input']>;
};

export enum IosDistributionType {
  AdHoc = 'AD_HOC',
  AppStore = 'APP_STORE',
  Development = 'DEVELOPMENT',
  Enterprise = 'ENTERPRISE'
}

export type IosJobDistributionCertificateInput = {
  dataBase64: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type IosJobInput = {
  applicationArchivePath?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated */
  artifactPath?: InputMaybe<Scalars['String']['input']>;
  buildArtifactPaths?: InputMaybe<Array<Scalars['String']['input']>>;
  buildConfiguration?: InputMaybe<Scalars['String']['input']>;
  buildProfile?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated */
  buildType?: InputMaybe<IosBuildType>;
  builderEnvironment?: InputMaybe<IosBuilderEnvironmentInput>;
  cache?: InputMaybe<BuildCacheInput>;
  customBuildConfig?: InputMaybe<CustomBuildConfigInput>;
  developmentClient?: InputMaybe<Scalars['Boolean']['input']>;
  /** @deprecated */
  distribution?: InputMaybe<DistributionType>;
  experimental?: InputMaybe<Scalars['JSONObject']['input']>;
  loggerLevel?: InputMaybe<WorkerLoggerLevel>;
  mode?: InputMaybe<BuildMode>;
  projectArchive: ProjectArchiveSourceInput;
  projectRootDirectory: Scalars['String']['input'];
  releaseChannel?: InputMaybe<Scalars['String']['input']>;
  scheme?: InputMaybe<Scalars['String']['input']>;
  secrets?: InputMaybe<IosJobSecretsInput>;
  simulator?: InputMaybe<Scalars['Boolean']['input']>;
  triggeredBy?: InputMaybe<BuildTrigger>;
  type: BuildWorkflow;
  updates?: InputMaybe<BuildUpdatesInput>;
  username?: InputMaybe<Scalars['String']['input']>;
  version?: InputMaybe<IosJobVersionInput>;
};

export type IosJobOverridesInput = {
  applicationArchivePath?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated */
  artifactPath?: InputMaybe<Scalars['String']['input']>;
  buildArtifactPaths?: InputMaybe<Array<Scalars['String']['input']>>;
  buildConfiguration?: InputMaybe<Scalars['String']['input']>;
  buildProfile?: InputMaybe<Scalars['String']['input']>;
  /** @deprecated */
  buildType?: InputMaybe<IosBuildType>;
  builderEnvironment?: InputMaybe<IosBuilderEnvironmentInput>;
  cache?: InputMaybe<BuildCacheInput>;
  customBuildConfig?: InputMaybe<CustomBuildConfigInput>;
  developmentClient?: InputMaybe<Scalars['Boolean']['input']>;
  /** @deprecated */
  distribution?: InputMaybe<DistributionType>;
  experimental?: InputMaybe<Scalars['JSONObject']['input']>;
  loggerLevel?: InputMaybe<WorkerLoggerLevel>;
  mode?: InputMaybe<BuildMode>;
  releaseChannel?: InputMaybe<Scalars['String']['input']>;
  resign?: InputMaybe<BuildResignInput>;
  scheme?: InputMaybe<Scalars['String']['input']>;
  secrets?: InputMaybe<IosJobSecretsInput>;
  simulator?: InputMaybe<Scalars['Boolean']['input']>;
  type?: InputMaybe<BuildWorkflow>;
  updates?: InputMaybe<BuildUpdatesInput>;
  username?: InputMaybe<Scalars['String']['input']>;
  version?: InputMaybe<IosJobVersionInput>;
};

export type IosJobSecretsInput = {
  buildCredentials?: InputMaybe<Array<InputMaybe<IosJobTargetCredentialsInput>>>;
  robotAccessToken?: InputMaybe<Scalars['String']['input']>;
};

export type IosJobTargetCredentialsInput = {
  distributionCertificate: IosJobDistributionCertificateInput;
  provisioningProfileBase64: Scalars['String']['input'];
  targetName: Scalars['String']['input'];
};

export type IosJobVersionInput = {
  buildNumber: Scalars['String']['input'];
};

/** @deprecated Use developmentClient option instead. */
export enum IosManagedBuildType {
  DevelopmentClient = 'DEVELOPMENT_CLIENT',
  Release = 'RELEASE'
}

export enum IosSchemeBuildConfiguration {
  Debug = 'DEBUG',
  Release = 'RELEASE'
}

export type IosSubmissionConfig = {
  __typename?: 'IosSubmissionConfig';
  appleIdUsername?: Maybe<Scalars['String']['output']>;
  ascApiKeyId?: Maybe<Scalars['String']['output']>;
  ascAppIdentifier: Scalars['String']['output'];
};

export type IosSubmissionConfigInput = {
  appleAppSpecificPassword?: InputMaybe<Scalars['String']['input']>;
  appleIdUsername?: InputMaybe<Scalars['String']['input']>;
  archiveUrl?: InputMaybe<Scalars['String']['input']>;
  ascApiKey?: InputMaybe<AscApiKeyInput>;
  ascApiKeyId?: InputMaybe<Scalars['String']['input']>;
  ascAppIdentifier: Scalars['String']['input'];
  isVerboseFastlaneEnabled?: InputMaybe<Scalars['Boolean']['input']>;
};

export type KeystoreGenerationUrl = {
  __typename?: 'KeystoreGenerationUrl';
  id: Scalars['ID']['output'];
  url: Scalars['String']['output'];
};

export type KeystoreGenerationUrlMutation = {
  __typename?: 'KeystoreGenerationUrlMutation';
  /** Create a Keystore Generation URL */
  createKeystoreGenerationUrl: KeystoreGenerationUrl;
};

export type LatestUpdateOnBranch = {
  __typename?: 'LatestUpdateOnBranch';
  branchId: Scalars['String']['output'];
  update?: Maybe<Update>;
};

export type LeaveAccountResult = {
  __typename?: 'LeaveAccountResult';
  success: Scalars['Boolean']['output'];
};

export type LineChartData = {
  __typename?: 'LineChartData';
  datasets: Array<LineDataset>;
  labels: Array<Scalars['String']['output']>;
};

export type LineDataset = {
  __typename?: 'LineDataset';
  data: Array<Maybe<Scalars['Int']['output']>>;
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
};

export enum MailchimpAudience {
  ExpoDevelopers = 'EXPO_DEVELOPERS',
  ExpoDeveloperOnboarding = 'EXPO_DEVELOPER_ONBOARDING'
}

export enum MailchimpTag {
  DevClientUsers = 'DEV_CLIENT_USERS',
  DidSubscribeToEasAtLeastOnce = 'DID_SUBSCRIBE_TO_EAS_AT_LEAST_ONCE',
  EasMasterList = 'EAS_MASTER_LIST',
  NewsletterSignupList = 'NEWSLETTER_SIGNUP_LIST'
}

export type MailchimpTagPayload = {
  __typename?: 'MailchimpTagPayload';
  id?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
};

export type MeMutation = {
  __typename?: 'MeMutation';
  /** Add an additional second factor device */
  addSecondFactorDevice: SecondFactorDeviceConfigurationResult;
  /** Certify an initiated second factor authentication method for the current user */
  certifySecondFactorDevice: SecondFactorBooleanResult;
  /** Create a new Account and grant this User the owner Role */
  createAccount: Account;
  /** Delete an Account created via createAccount */
  deleteAccount: DeleteAccountResult;
  /** Delete a SSO user. Actor must be an owner on the SSO user's SSO account. */
  deleteSSOUser: DeleteSsoUserResult;
  /** Delete a second factor device */
  deleteSecondFactorDevice: SecondFactorBooleanResult;
  /** Delete a Snack that the current user owns */
  deleteSnack: Snack;
  /** Disable all second factor authentication for the current user */
  disableSecondFactorAuthentication: SecondFactorBooleanResult;
  /** Initiate setup of two-factor authentication for the current user */
  initiateSecondFactorAuthentication: SecondFactorInitiationResult;
  /** Leave an Account (revoke own permissions on Account) */
  leaveAccount: LeaveAccountResult;
  /** Purge unfinished two-factor authentication setup for the current user if not fully-set-up */
  purgeUnfinishedSecondFactorAuthentication: SecondFactorBooleanResult;
  /** Regenerate backup codes for the current user */
  regenerateSecondFactorBackupCodes: SecondFactorRegenerateBackupCodesResult;
  /** Send SMS OTP to a second factor device for use during device setup or during change confirmation */
  sendSMSOTPToSecondFactorDevice: SecondFactorBooleanResult;
  setPreferences: UserPreferences;
  /** Set the user's primary second factor device */
  setPrimarySecondFactorDevice: SecondFactorBooleanResult;
  /** Transfer project to a different Account */
  transferApp: App;
  /** Unpublish an App that the current user owns */
  unpublishApp: App;
  /** Update an App that the current user owns */
  updateApp: App;
  /** Update the current regular user's data */
  updateProfile: User;
  /** Update the current SSO user's data */
  updateSSOProfile: SsoUser;
};


export type MeMutationAddSecondFactorDeviceArgs = {
  deviceConfiguration: SecondFactorDeviceConfiguration;
  otp: Scalars['String']['input'];
};


export type MeMutationCertifySecondFactorDeviceArgs = {
  otp: Scalars['String']['input'];
};


export type MeMutationCreateAccountArgs = {
  accountData: AccountDataInput;
};


export type MeMutationDeleteAccountArgs = {
  accountId: Scalars['ID']['input'];
};


export type MeMutationDeleteSsoUserArgs = {
  ssoUserId: Scalars['ID']['input'];
};


export type MeMutationDeleteSecondFactorDeviceArgs = {
  otp: Scalars['String']['input'];
  userSecondFactorDeviceId: Scalars['ID']['input'];
};


export type MeMutationDeleteSnackArgs = {
  snackId: Scalars['ID']['input'];
};


export type MeMutationDisableSecondFactorAuthenticationArgs = {
  otp: Scalars['String']['input'];
};


export type MeMutationInitiateSecondFactorAuthenticationArgs = {
  deviceConfigurations: Array<SecondFactorDeviceConfiguration>;
  recaptchaResponseToken?: InputMaybe<Scalars['String']['input']>;
};


export type MeMutationLeaveAccountArgs = {
  accountId: Scalars['ID']['input'];
};


export type MeMutationRegenerateSecondFactorBackupCodesArgs = {
  otp: Scalars['String']['input'];
};


export type MeMutationSendSmsotpToSecondFactorDeviceArgs = {
  userSecondFactorDeviceId: Scalars['ID']['input'];
};


export type MeMutationSetPreferencesArgs = {
  preferences: UserPreferencesInput;
};


export type MeMutationSetPrimarySecondFactorDeviceArgs = {
  userSecondFactorDeviceId: Scalars['ID']['input'];
};


export type MeMutationTransferAppArgs = {
  appId: Scalars['ID']['input'];
  destinationAccountId: Scalars['ID']['input'];
};


export type MeMutationUnpublishAppArgs = {
  appId: Scalars['ID']['input'];
};


export type MeMutationUpdateAppArgs = {
  appData: AppDataInput;
};


export type MeMutationUpdateProfileArgs = {
  userData: UserDataInput;
};


export type MeMutationUpdateSsoProfileArgs = {
  userData: SsoUserDataInput;
};

export type MeteredBillingStatus = {
  __typename?: 'MeteredBillingStatus';
  EAS_BUILD: Scalars['Boolean']['output'];
  EAS_UPDATE: Scalars['Boolean']['output'];
};

export type Notification = {
  __typename?: 'Notification';
  accountName: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  event: NotificationEvent;
  id: Scalars['ID']['output'];
  isRead: Scalars['Boolean']['output'];
  metadata?: Maybe<NotificationMetadata>;
  type: NotificationType;
  updatedAt: Scalars['DateTime']['output'];
  websiteMessage: Scalars['String']['output'];
};

export enum NotificationEvent {
  BuildComplete = 'BUILD_COMPLETE',
  BuildErrored = 'BUILD_ERRORED',
  BuildLimitThresholdExceeded = 'BUILD_LIMIT_THRESHOLD_EXCEEDED',
  BuildPlanCreditThresholdExceeded = 'BUILD_PLAN_CREDIT_THRESHOLD_EXCEEDED',
  SubmissionComplete = 'SUBMISSION_COMPLETE',
  SubmissionErrored = 'SUBMISSION_ERRORED',
  Test = 'TEST'
}

export type NotificationMetadata = BuildLimitThresholdExceededMetadata | BuildPlanCreditThresholdExceededMetadata | TestNotificationMetadata;

export type NotificationSubscription = {
  __typename?: 'NotificationSubscription';
  account?: Maybe<Account>;
  actor?: Maybe<Actor>;
  app?: Maybe<App>;
  createdAt: Scalars['DateTime']['output'];
  event: NotificationEvent;
  id: Scalars['ID']['output'];
  type: NotificationType;
};

export type NotificationSubscriptionFilter = {
  accountId?: InputMaybe<Scalars['ID']['input']>;
  appId?: InputMaybe<Scalars['ID']['input']>;
  event?: InputMaybe<NotificationEvent>;
  type?: InputMaybe<NotificationType>;
};

export type NotificationSubscriptionMutation = {
  __typename?: 'NotificationSubscriptionMutation';
  subscribeToEventForAccount: SubscribeToNotificationResult;
  subscribeToEventForApp: SubscribeToNotificationResult;
  unsubscribe: UnsubscribeFromNotificationResult;
};


export type NotificationSubscriptionMutationSubscribeToEventForAccountArgs = {
  input: AccountNotificationSubscriptionInput;
};


export type NotificationSubscriptionMutationSubscribeToEventForAppArgs = {
  input: AppNotificationSubscriptionInput;
};


export type NotificationSubscriptionMutationUnsubscribeArgs = {
  id: Scalars['ID']['input'];
};

export type NotificationThresholdExceeded = {
  __typename?: 'NotificationThresholdExceeded';
  count: Scalars['Int']['output'];
  limit: Scalars['Int']['output'];
  threshold: Scalars['Int']['output'];
  type: BuildLimitThresholdExceededMetadataType;
};

export enum NotificationType {
  Email = 'EMAIL',
  Web = 'WEB'
}

export type Offer = {
  __typename?: 'Offer';
  features?: Maybe<Array<Maybe<Feature>>>;
  id: Scalars['ID']['output'];
  prerequisite?: Maybe<OfferPrerequisite>;
  price: Scalars['Int']['output'];
  quantity?: Maybe<Scalars['Int']['output']>;
  stripeId: Scalars['ID']['output'];
  trialLength?: Maybe<Scalars['Int']['output']>;
  type: OfferType;
};

export type OfferPrerequisite = {
  __typename?: 'OfferPrerequisite';
  stripeIds: Array<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export enum OfferType {
  /** Addon, or supplementary subscription */
  Addon = 'ADDON',
  /** Advanced Purchase of Paid Resource */
  Prepaid = 'PREPAID',
  /** Term subscription */
  Subscription = 'SUBSCRIPTION'
}

export enum Order {
  Asc = 'ASC',
  Desc = 'DESC'
}

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type PartialManifest = {
  assets: Array<InputMaybe<PartialManifestAsset>>;
  extra?: InputMaybe<Scalars['JSONObject']['input']>;
  launchAsset: PartialManifestAsset;
};

export type PartialManifestAsset = {
  bundleKey: Scalars['String']['input'];
  contentType: Scalars['String']['input'];
  fileExtension?: InputMaybe<Scalars['String']['input']>;
  fileSHA256: Scalars['String']['input'];
  storageKey: Scalars['String']['input'];
};

export type PaymentDetails = {
  __typename?: 'PaymentDetails';
  address?: Maybe<Address>;
  card?: Maybe<Card>;
  id: Scalars['ID']['output'];
};

export enum Permission {
  Admin = 'ADMIN',
  Own = 'OWN',
  Publish = 'PUBLISH',
  View = 'VIEW'
}

export type PlanEnablement = Concurrencies | EasTotalPlanEnablement;

export type Project = {
  description: Scalars['String']['output'];
  fullName: Scalars['String']['output'];
  /** @deprecated No longer supported */
  iconUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  published: Scalars['Boolean']['output'];
  slug: Scalars['String']['output'];
  updated: Scalars['DateTime']['output'];
  username: Scalars['String']['output'];
};

export type ProjectArchiveSourceInput = {
  bucketKey?: InputMaybe<Scalars['String']['input']>;
  gitRef?: InputMaybe<Scalars['String']['input']>;
  metadataLocation?: InputMaybe<Scalars['String']['input']>;
  repositoryUrl?: InputMaybe<Scalars['String']['input']>;
  type: ProjectArchiveSourceType;
  url?: InputMaybe<Scalars['String']['input']>;
};

export enum ProjectArchiveSourceType {
  Gcs = 'GCS',
  Git = 'GIT',
  None = 'NONE',
  S3 = 'S3',
  Url = 'URL'
}

export type ProjectPublicData = {
  __typename?: 'ProjectPublicData';
  fullName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

export type ProjectQuery = {
  __typename?: 'ProjectQuery';
  /** @deprecated Snacks and apps should be queried separately */
  byAccountNameAndSlug: Project;
  /** @deprecated No longer supported */
  byPaths: Array<Maybe<Project>>;
  /** @deprecated See byAccountNameAndSlug */
  byUsernameAndSlug: Project;
};


export type ProjectQueryByAccountNameAndSlugArgs = {
  accountName: Scalars['String']['input'];
  platform?: InputMaybe<AppPlatform>;
  sdkVersions?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  slug: Scalars['String']['input'];
};


export type ProjectQueryByPathsArgs = {
  paths?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
};


export type ProjectQueryByUsernameAndSlugArgs = {
  platform?: InputMaybe<Scalars['String']['input']>;
  sdkVersions?: InputMaybe<Array<InputMaybe<Scalars['String']['input']>>>;
  slug: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type PublicArtifacts = {
  __typename?: 'PublicArtifacts';
  applicationArchiveUrl?: Maybe<Scalars['String']['output']>;
  buildUrl?: Maybe<Scalars['String']['output']>;
};

export type PublishUpdateGroupInput = {
  awaitingCodeSigningInfo?: InputMaybe<Scalars['Boolean']['input']>;
  branchId: Scalars['String']['input'];
  excludedAssets?: InputMaybe<Array<PartialManifestAsset>>;
  gitCommitHash?: InputMaybe<Scalars['String']['input']>;
  isGitWorkingTreeDirty?: InputMaybe<Scalars['Boolean']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  rollBackToEmbeddedInfoGroup?: InputMaybe<UpdateRollBackToEmbeddedGroup>;
  runtimeVersion: Scalars['String']['input'];
  updateInfoGroup?: InputMaybe<UpdateInfoGroup>;
};

export type RescindUserInvitationResult = {
  __typename?: 'RescindUserInvitationResult';
  id: Scalars['ID']['output'];
};

/** Represents a robot (not human) actor. */
export type Robot = Actor & {
  __typename?: 'Robot';
  /** Access Tokens belonging to this actor */
  accessTokens: Array<AccessToken>;
  /** Associated accounts */
  accounts: Array<Account>;
  created: Scalars['DateTime']['output'];
  displayName: Scalars['String']['output'];
  /** Experiments associated with this actor */
  experiments: Array<ActorExperiment>;
  /**
   * Server feature gate values for this actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject']['output'];
  firstName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isExpoAdmin: Scalars['Boolean']['output'];
};


/** Represents a robot (not human) actor. */
export type RobotFeatureGatesArgs = {
  filter?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type RobotDataInput = {
  name?: InputMaybe<Scalars['String']['input']>;
};

export type RobotMutation = {
  __typename?: 'RobotMutation';
  /** Create a Robot and grant it Permissions on an Account */
  createRobotForAccount: Robot;
  /** Delete a Robot */
  deleteRobot: DeleteRobotResult;
  /** Update a Robot */
  updateRobot: Robot;
};


export type RobotMutationCreateRobotForAccountArgs = {
  accountID: Scalars['String']['input'];
  permissions: Array<InputMaybe<Permission>>;
  robotData?: InputMaybe<RobotDataInput>;
};


export type RobotMutationDeleteRobotArgs = {
  id: Scalars['String']['input'];
};


export type RobotMutationUpdateRobotArgs = {
  id: Scalars['String']['input'];
  robotData: RobotDataInput;
};

export enum Role {
  Admin = 'ADMIN',
  Custom = 'CUSTOM',
  Developer = 'DEVELOPER',
  HasAdmin = 'HAS_ADMIN',
  NotAdmin = 'NOT_ADMIN',
  Owner = 'OWNER',
  ViewOnly = 'VIEW_ONLY'
}

export type RootMutation = {
  __typename?: 'RootMutation';
  /**
   * This is a placeholder field
   * @deprecated Not used.
   */
  _doNotUse?: Maybe<Scalars['String']['output']>;
  /** Mutations that create, read, update, and delete AccessTokens for Actors */
  accessToken: AccessTokenMutation;
  /** Mutations that modify an Account */
  account: AccountMutation;
  /** Mutations that create, update, and delete an AccountSSOConfiguration */
  accountSSOConfiguration: AccountSsoConfigurationMutation;
  /** Mutations for Actor experiments */
  actorExperiment: ActorExperimentMutation;
  /** Mutations that modify the build credentials for an Android app */
  androidAppBuildCredentials: AndroidAppBuildCredentialsMutation;
  /** Mutations that modify the credentials for an Android app */
  androidAppCredentials: AndroidAppCredentialsMutation;
  /** Mutations that modify an FCM credential */
  androidFcm: AndroidFcmMutation;
  /** Mutations that modify a Keystore */
  androidKeystore: AndroidKeystoreMutation;
  /** Mutations that modify an App */
  app?: Maybe<AppMutation>;
  /** Mutations that modify an App Store Connect Api Key */
  appStoreConnectApiKey: AppStoreConnectApiKeyMutation;
  /** Mutations that modify an AppVersion */
  appVersion: AppVersionMutation;
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
  asset: AssetMutation;
  /** Mutations that modify an EAS Build */
  build: BuildMutation;
  /** Mutations that create, update, and delete Build Annotations */
  buildAnnotation: BuildAnnotationMutation;
  /** Mutations that modify an BuildJob */
  buildJob: BuildJobMutation;
  /** Mutations for Discord users */
  discordUser: DiscordUserMutation;
  /** Mutations that modify an EmailSubscription */
  emailSubscription: EmailSubscriptionMutation;
  /** Mutations that create and delete EnvironmentSecrets */
  environmentSecret: EnvironmentSecretMutation;
  /** Mutations that utilize services facilitated by the GitHub App */
  githubApp: GitHubAppMutation;
  /** Mutations for GitHub App installations */
  githubAppInstallation: GitHubAppInstallationMutation;
  /** Mutations for GitHub build triggers */
  githubBuildTrigger: GitHubBuildTriggerMutation;
  /** Mutations for GitHub repositories */
  githubRepository: GitHubRepositoryMutation;
  /** Mutations for GitHub repository settings */
  githubRepositorySettings: GitHubRepositorySettingsMutation;
  /** Mutations for GitHub users */
  githubUser: GitHubUserMutation;
  /** Mutations that modify a Google Service Account Key */
  googleServiceAccountKey: GoogleServiceAccountKeyMutation;
  /** Mutations that modify the build credentials for an iOS app */
  iosAppBuildCredentials: IosAppBuildCredentialsMutation;
  /** Mutations that modify the credentials for an iOS app */
  iosAppCredentials: IosAppCredentialsMutation;
  keystoreGenerationUrl: KeystoreGenerationUrlMutation;
  /** Mutations that modify the currently authenticated User */
  me: MeMutation;
  /** Mutations that modify a NotificationSubscription */
  notificationSubscription: NotificationSubscriptionMutation;
  /** Mutations that create, update, and delete Robots */
  robot: RobotMutation;
  serverlessFunction: ServerlessFunctionMutation;
  /** Mutations that modify an EAS Submit submission */
  submission: SubmissionMutation;
  update: UpdateMutation;
  updateBranch: UpdateBranchMutation;
  updateChannel: UpdateChannelMutation;
  uploadSession: UploadSession;
  /** Mutations that create, update, and delete pinned apps */
  userAppPins: UserAppPinMutation;
  /** Mutations that create, delete, and accept UserInvitations */
  userInvitation: UserInvitationMutation;
  /** Mutations that create, delete, update Webhooks */
  webhook: WebhookMutation;
  /** Mutations that modify a websiteNotification */
  websiteNotifications: WebsiteNotificationMutation;
};


export type RootMutationAccountArgs = {
  accountName: Scalars['ID']['input'];
};


export type RootMutationAppArgs = {
  appId?: InputMaybe<Scalars['ID']['input']>;
};


export type RootMutationBuildArgs = {
  buildId?: InputMaybe<Scalars['ID']['input']>;
};


export type RootMutationBuildJobArgs = {
  buildId: Scalars['ID']['input'];
};

export type RootQuery = {
  __typename?: 'RootQuery';
  /**
   * This is a placeholder field
   * @deprecated Not used.
   */
  _doNotUse?: Maybe<Scalars['String']['output']>;
  /** Top-level query object for querying Accounts. */
  account: AccountQuery;
  /** Top-level query object for querying AccountSSOConfigurationPublicData */
  accountSSOConfigurationPublicData: AccountSsoConfigurationPublicDataQuery;
  /**
   * Top-level query object for querying Actors.
   * @deprecated Public actor queries are no longer supported
   */
  actor: ActorQuery;
  /**
   * Public apps in the app directory
   * @deprecated Use 'all' field under 'app'.
   */
  allPublicApps?: Maybe<Array<Maybe<App>>>;
  app: AppQuery;
  /**
   * Look up app by app id
   * @deprecated Use 'byId' field under 'app'.
   */
  appByAppId?: Maybe<App>;
  /** Top-level query object for querying Apple Device registration requests. */
  appleDeviceRegistrationRequest: AppleDeviceRegistrationRequestQuery;
  /** Top-level query object for querying Apple Teams. */
  appleTeam: AppleTeamQuery;
  asset: AssetQuery;
  /** Top-level query object for querying Audit Logs. */
  auditLogs: AuditLogQuery;
  backgroundJobReceipt: BackgroundJobReceiptQuery;
  /** Top-level query object for querying annotations. */
  buildAnnotations: BuildAnnotationsQuery;
  buildJobs: BuildJobQuery;
  buildOrBuildJob: BuildOrBuildJobQuery;
  /** Top-level query object for querying BuildPublicData publicly. */
  buildPublicData: BuildPublicDataQuery;
  builds: BuildQuery;
  /** Top-level query object for querying Experimentation configuration. */
  experimentation: ExperimentationQuery;
  /** Top-level query object for querying GitHub App information and resources it has access to. */
  githubApp: GitHubAppQuery;
  /** Top-level query object for querying Stripe Invoices. */
  invoice: InvoiceQuery;
  /**
   * If authenticated as a typical end user, this is the appropriate top-level
   * query object
   */
  me?: Maybe<User>;
  /**
   * If authenticated as any type of Actor, this is the appropriate top-level
   * query object
   */
  meActor?: Maybe<Actor>;
  /**
   * If authenticated as any type of human end user (Actor types User or SSOUser),
   * this is the appropriate top-level query object
   */
  meUserActor?: Maybe<UserActor>;
  /** @deprecated Snacks and apps should be queried separately */
  project: ProjectQuery;
  snack: SnackQuery;
  /** Top-level query object for querying Expo status page services. */
  statuspageService: StatuspageServiceQuery;
  submissions: SubmissionQuery;
  /** fetch all updates in a group */
  updatesByGroup: Array<Update>;
  /**
   * Top-level query object for querying Users.
   * @deprecated Public user queries are no longer supported
   */
  user: UserQuery;
  /**
   * Top-level query object for querying UserActors.
   * @deprecated Public user queries are no longer supported
   */
  userActor: UserActorQuery;
  /** Top-level query object for querying UserActorPublicData publicly. */
  userActorPublicData: UserActorPublicDataQuery;
  /** @deprecated Use 'byId' field under 'user'. */
  userByUserId?: Maybe<User>;
  /** @deprecated Use 'byUsername' field under 'user'. */
  userByUsername?: Maybe<User>;
  /** Top-level query object for querying UserInvitationPublicData publicly. */
  userInvitationPublicData: UserInvitationPublicDataQuery;
  /**
   * If authenticated as a typical end user, this is the appropriate top-level
   * query object
   */
  viewer?: Maybe<User>;
  /** Top-level query object for querying Webhooks. */
  webhook: WebhookQuery;
};


export type RootQueryAllPublicAppsArgs = {
  filter: AppsFilter;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  sort: AppSort;
};


export type RootQueryAppByAppIdArgs = {
  appId: Scalars['String']['input'];
};


export type RootQueryUpdatesByGroupArgs = {
  group: Scalars['ID']['input'];
};


export type RootQueryUserByUserIdArgs = {
  userId: Scalars['String']['input'];
};


export type RootQueryUserByUsernameArgs = {
  username: Scalars['String']['input'];
};

export type Runtime = {
  __typename?: 'Runtime';
  app: App;
  firstBuildCreatedAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  version: Scalars['String']['output'];
};

export type RuntimeEdge = {
  __typename?: 'RuntimeEdge';
  cursor: Scalars['String']['output'];
  node: Runtime;
};

export type RuntimeFilterInput = {
  /** Only return runtimes shared with this branch */
  branchId?: InputMaybe<Scalars['String']['input']>;
};

/** Represents the connection over the runtime edge of an App */
export type RuntimesConnection = {
  __typename?: 'RuntimesConnection';
  edges: Array<RuntimeEdge>;
  pageInfo: PageInfo;
};

/** Represents a human SSO (not robot) actor. */
export type SsoUser = Actor & UserActor & {
  __typename?: 'SSOUser';
  /** Access Tokens belonging to this actor, none at present */
  accessTokens: Array<AccessToken>;
  accounts: Array<Account>;
  /** Coalesced project activity for all apps belonging to all accounts this user belongs to. Only resolves for the viewer. */
  activityTimelineProjectActivities: Array<ActivityTimelineProjectActivity>;
  appCount: Scalars['Int']['output'];
  /** @deprecated No longer supported */
  appetizeCode?: Maybe<Scalars['String']['output']>;
  /** Apps this user has published. If this user is the viewer, this field returns the apps the user has access to. */
  apps: Array<App>;
  bestContactEmail?: Maybe<Scalars['String']['output']>;
  created: Scalars['DateTime']['output'];
  /** Discord account linked to a user */
  discordUser?: Maybe<DiscordUser>;
  displayName: Scalars['String']['output'];
  /** Experiments associated with this actor */
  experiments: Array<ActorExperiment>;
  /**
   * Server feature gate values for this actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject']['output'];
  firstName?: Maybe<Scalars['String']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  /** GitHub account linked to a user */
  githubUser?: Maybe<GitHubUser>;
  /** @deprecated No longer supported */
  githubUsername?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** @deprecated No longer supported */
  industry?: Maybe<Scalars['String']['output']>;
  isExpoAdmin: Scalars['Boolean']['output'];
  lastName?: Maybe<Scalars['String']['output']>;
  /** @deprecated No longer supported */
  location?: Maybe<Scalars['String']['output']>;
  notificationSubscriptions: Array<NotificationSubscription>;
  pinnedApps: Array<App>;
  preferences: UserPreferences;
  /** Associated accounts */
  primaryAccount: Account;
  profilePhoto: Scalars['String']['output'];
  /** Snacks associated with this account */
  snacks: Array<Snack>;
  /** @deprecated No longer supported */
  twitterUsername?: Maybe<Scalars['String']['output']>;
  username: Scalars['String']['output'];
  websiteNotificationsPaginated: WebsiteNotificationsConnection;
};


/** Represents a human SSO (not robot) actor. */
export type SsoUserActivityTimelineProjectActivitiesArgs = {
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  filterTypes?: InputMaybe<Array<ActivityTimelineProjectActivityType>>;
  limit: Scalars['Int']['input'];
};


/** Represents a human SSO (not robot) actor. */
export type SsoUserAppsArgs = {
  includeUnpublished?: InputMaybe<Scalars['Boolean']['input']>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents a human SSO (not robot) actor. */
export type SsoUserFeatureGatesArgs = {
  filter?: InputMaybe<Array<Scalars['String']['input']>>;
};


/** Represents a human SSO (not robot) actor. */
export type SsoUserNotificationSubscriptionsArgs = {
  filter?: InputMaybe<NotificationSubscriptionFilter>;
};


/** Represents a human SSO (not robot) actor. */
export type SsoUserSnacksArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents a human SSO (not robot) actor. */
export type SsoUserWebsiteNotificationsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type SsoUserDataInput = {
  firstName?: InputMaybe<Scalars['String']['input']>;
  lastName?: InputMaybe<Scalars['String']['input']>;
};

export type SecondFactorBooleanResult = {
  __typename?: 'SecondFactorBooleanResult';
  success: Scalars['Boolean']['output'];
};

export type SecondFactorDeviceConfiguration = {
  isPrimary: Scalars['Boolean']['input'];
  method: SecondFactorMethod;
  name: Scalars['String']['input'];
  smsPhoneNumber?: InputMaybe<Scalars['String']['input']>;
};

export type SecondFactorDeviceConfigurationResult = {
  __typename?: 'SecondFactorDeviceConfigurationResult';
  keyURI: Scalars['String']['output'];
  secondFactorDevice: UserSecondFactorDevice;
  secret: Scalars['String']['output'];
};

export type SecondFactorInitiationResult = {
  __typename?: 'SecondFactorInitiationResult';
  configurationResults: Array<SecondFactorDeviceConfigurationResult>;
  plaintextBackupCodes: Array<Scalars['String']['output']>;
};

export enum SecondFactorMethod {
  /** Google Authenticator (TOTP) */
  Authenticator = 'AUTHENTICATOR',
  /** SMS */
  Sms = 'SMS'
}

export type SecondFactorRegenerateBackupCodesResult = {
  __typename?: 'SecondFactorRegenerateBackupCodesResult';
  plaintextBackupCodes: Array<Scalars['String']['output']>;
};

export type ServerlessFunctionIdentifierInput = {
  gitCommitSHA1: Scalars['String']['input'];
};

export type ServerlessFunctionMutation = {
  __typename?: 'ServerlessFunctionMutation';
  createDeployment: DeployServerlessFunctionResult;
  createUploadPresignedUrl: CreateServerlessFunctionUploadUrlResult;
};


export type ServerlessFunctionMutationCreateDeploymentArgs = {
  appId: Scalars['ID']['input'];
  serverlessFunctionIdentifierInput: ServerlessFunctionIdentifierInput;
};


export type ServerlessFunctionMutationCreateUploadPresignedUrlArgs = {
  appId: Scalars['ID']['input'];
  serverlessFunctionIdentifierInput: ServerlessFunctionIdentifierInput;
};

export type Snack = Project & {
  __typename?: 'Snack';
  /** Description of the Snack */
  description: Scalars['String']['output'];
  /** Full name of the Snack, e.g. "@john/mysnack", "@snack/245631" */
  fullName: Scalars['String']['output'];
  /** Has the Snack been run without errors */
  hasBeenRunSuccessfully?: Maybe<Scalars['Boolean']['output']>;
  hashId: Scalars['String']['output'];
  /** @deprecated No longer supported */
  iconUrl?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** Draft status, which is true when the Snack was not saved explicitly, but auto-saved */
  isDraft: Scalars['Boolean']['output'];
  /** Name of the Snack, e.g. "My Snack" */
  name: Scalars['String']['output'];
  /** Preview image of the running snack */
  previewImage?: Maybe<Scalars['String']['output']>;
  published: Scalars['Boolean']['output'];
  /** Slug name, e.g. "mysnack", "245631" */
  slug: Scalars['String']['output'];
  /** Date and time the Snack was last updated */
  updated: Scalars['DateTime']['output'];
  /** Name of the user that created the Snack, or "snack" when the Snack was saved anonymously */
  username: Scalars['String']['output'];
};

export type SnackQuery = {
  __typename?: 'SnackQuery';
  /** Get snack by hashId */
  byHashId: Snack;
  /**
   * Get snack by hashId
   * @deprecated Use byHashId
   */
  byId: Snack;
};


export type SnackQueryByHashIdArgs = {
  hashId: Scalars['ID']['input'];
};


export type SnackQueryByIdArgs = {
  id: Scalars['ID']['input'];
};

export enum StandardOffer {
  /** $29 USD per month, 30 day trial */
  Default = 'DEFAULT',
  /** $800 USD per month */
  Support = 'SUPPORT',
  /** $29 USD per month, 1 year trial */
  YcDeals = 'YC_DEALS',
  /** $348 USD per year, 30 day trial */
  YearlySub = 'YEARLY_SUB'
}

/** Incident for a given component from Expo status page API. */
export type StatuspageIncident = {
  __typename?: 'StatuspageIncident';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  /** Impact of an incident from Expo status page. */
  impact: StatuspageIncidentImpact;
  name: Scalars['String']['output'];
  resolvedAt?: Maybe<Scalars['DateTime']['output']>;
  /** Shortlink to the incident from Expo status page. */
  shortlink: Scalars['String']['output'];
  /** Current status of an incident from Expo status page. */
  status: StatuspageIncidentStatus;
  updatedAt: Scalars['DateTime']['output'];
  /** List of all updates for an incident from Expo status page. */
  updates: Array<StatuspageIncidentUpdate>;
};

/** Possible Incident impact values from Expo status page API. */
export enum StatuspageIncidentImpact {
  Critical = 'CRITICAL',
  Maintenance = 'MAINTENANCE',
  Major = 'MAJOR',
  Minor = 'MINOR',
  None = 'NONE'
}

/** Possible Incident statuses from Expo status page API. */
export enum StatuspageIncidentStatus {
  Completed = 'COMPLETED',
  Identified = 'IDENTIFIED',
  Investigating = 'INVESTIGATING',
  InProgress = 'IN_PROGRESS',
  Monitoring = 'MONITORING',
  Resolved = 'RESOLVED',
  Scheduled = 'SCHEDULED',
  Verifying = 'VERIFYING'
}

/** Update for an Incident from Expo status page API. */
export type StatuspageIncidentUpdate = {
  __typename?: 'StatuspageIncidentUpdate';
  /** Text of an update from Expo status page. */
  body: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  /** Status set at the moment of update. */
  status: StatuspageIncidentStatus;
};

/** Service monitored by Expo status page. */
export type StatuspageService = {
  __typename?: 'StatuspageService';
  /** Description of a service from Expo status page. */
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /**
   * List of last inicdents for a service from Expo status page (we always query for 50 latest incidents for all services)
   * sorted by createdAt field in descending order.
   */
  incidents: Array<StatuspageIncident>;
  /** Name of a service monitored by Expo status page. */
  name: StatuspageServiceName;
  /** Current status of a service from Expo status page. */
  status: StatuspageServiceStatus;
};

/** Name of a service monitored by Expo status page. */
export enum StatuspageServiceName {
  EasBuild = 'EAS_BUILD',
  EasSubmit = 'EAS_SUBMIT',
  EasUpdate = 'EAS_UPDATE',
  GithubApiRequests = 'GITHUB_API_REQUESTS',
  GithubWebhooks = 'GITHUB_WEBHOOKS'
}

export type StatuspageServiceQuery = {
  __typename?: 'StatuspageServiceQuery';
  /** Query services from Expo status page by names. */
  byServiceNames: Array<StatuspageService>;
};


export type StatuspageServiceQueryByServiceNamesArgs = {
  serviceNames: Array<StatuspageServiceName>;
};

/** Possible statuses for a service. */
export enum StatuspageServiceStatus {
  DegradedPerformance = 'DEGRADED_PERFORMANCE',
  MajorOutage = 'MAJOR_OUTAGE',
  Operational = 'OPERATIONAL',
  PartialOutage = 'PARTIAL_OUTAGE',
  UnderMaintenance = 'UNDER_MAINTENANCE'
}

export type StripeCoupon = {
  __typename?: 'StripeCoupon';
  amountOff?: Maybe<Scalars['String']['output']>;
  appliesTo?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  percentOff?: Maybe<Scalars['Float']['output']>;
  valid: Scalars['Boolean']['output'];
};

/** Represents an EAS Submission */
export type Submission = ActivityTimelineProjectActivity & {
  __typename?: 'Submission';
  activityTimestamp: Scalars['DateTime']['output'];
  actor?: Maybe<Actor>;
  androidConfig?: Maybe<AndroidSubmissionConfig>;
  app: App;
  archiveUrl?: Maybe<Scalars['String']['output']>;
  canRetry: Scalars['Boolean']['output'];
  cancelingActor?: Maybe<Actor>;
  childSubmission?: Maybe<Submission>;
  completedAt?: Maybe<Scalars['DateTime']['output']>;
  createdAt: Scalars['DateTime']['output'];
  error?: Maybe<SubmissionError>;
  id: Scalars['ID']['output'];
  initiatingActor?: Maybe<Actor>;
  iosConfig?: Maybe<IosSubmissionConfig>;
  logFiles: Array<Scalars['String']['output']>;
  /** @deprecated Use logFiles instead */
  logsUrl?: Maybe<Scalars['String']['output']>;
  /** Retry time starts after completedAt */
  maxRetryTimeMinutes: Scalars['Int']['output'];
  parentSubmission?: Maybe<Submission>;
  platform: AppPlatform;
  status: SubmissionStatus;
  submittedBuild?: Maybe<Build>;
  updatedAt: Scalars['DateTime']['output'];
};

export enum SubmissionAndroidArchiveType {
  Aab = 'AAB',
  Apk = 'APK'
}

export enum SubmissionAndroidReleaseStatus {
  Completed = 'COMPLETED',
  Draft = 'DRAFT',
  Halted = 'HALTED',
  InProgress = 'IN_PROGRESS'
}

export enum SubmissionAndroidTrack {
  Alpha = 'ALPHA',
  Beta = 'BETA',
  Internal = 'INTERNAL',
  Production = 'PRODUCTION'
}

export type SubmissionArchiveSourceInput = {
  /** Required if the archive source type is GCS_BUILD_APPLICATION_ARCHIVE or GCS_SUBMIT_ARCHIVE */
  bucketKey?: InputMaybe<Scalars['String']['input']>;
  type: SubmissionArchiveSourceType;
  /** Required if the archive source type is URL */
  url?: InputMaybe<Scalars['String']['input']>;
};

export enum SubmissionArchiveSourceType {
  GcsBuildApplicationArchive = 'GCS_BUILD_APPLICATION_ARCHIVE',
  GcsSubmitArchive = 'GCS_SUBMIT_ARCHIVE',
  Url = 'URL'
}

export type SubmissionError = {
  __typename?: 'SubmissionError';
  errorCode?: Maybe<Scalars['String']['output']>;
  message?: Maybe<Scalars['String']['output']>;
};

export type SubmissionFilter = {
  platform?: InputMaybe<AppPlatform>;
  status?: InputMaybe<SubmissionStatus>;
};

export type SubmissionMutation = {
  __typename?: 'SubmissionMutation';
  /** Cancel an EAS Submit submission */
  cancelSubmission: Submission;
  /** Create an Android EAS Submit submission */
  createAndroidSubmission: CreateSubmissionResult;
  /** Create an iOS EAS Submit submission */
  createIosSubmission: CreateSubmissionResult;
  /** Retry an EAS Submit submission */
  retrySubmission: CreateSubmissionResult;
};


export type SubmissionMutationCancelSubmissionArgs = {
  submissionId: Scalars['ID']['input'];
};


export type SubmissionMutationCreateAndroidSubmissionArgs = {
  input: CreateAndroidSubmissionInput;
};


export type SubmissionMutationCreateIosSubmissionArgs = {
  input: CreateIosSubmissionInput;
};


export type SubmissionMutationRetrySubmissionArgs = {
  parentSubmissionId: Scalars['ID']['input'];
};

export type SubmissionQuery = {
  __typename?: 'SubmissionQuery';
  /** Look up EAS Submission by submission ID */
  byId: Submission;
};


export type SubmissionQueryByIdArgs = {
  submissionId: Scalars['ID']['input'];
};

export enum SubmissionStatus {
  AwaitingBuild = 'AWAITING_BUILD',
  Canceled = 'CANCELED',
  Errored = 'ERRORED',
  Finished = 'FINISHED',
  InProgress = 'IN_PROGRESS',
  InQueue = 'IN_QUEUE'
}

export type SubscribeToNotificationResult = {
  __typename?: 'SubscribeToNotificationResult';
  notificationSubscription: NotificationSubscription;
};

export type SubscriptionDetails = {
  __typename?: 'SubscriptionDetails';
  addons: Array<AddonDetails>;
  cancelledAt?: Maybe<Scalars['DateTime']['output']>;
  concurrencies?: Maybe<Concurrencies>;
  coupon?: Maybe<StripeCoupon>;
  endedAt?: Maybe<Scalars['DateTime']['output']>;
  futureSubscription?: Maybe<FutureSubscription>;
  id: Scalars['ID']['output'];
  isDowngrading?: Maybe<Scalars['Boolean']['output']>;
  meteredBillingStatus: MeteredBillingStatus;
  name?: Maybe<Scalars['String']['output']>;
  nextInvoice?: Maybe<Scalars['DateTime']['output']>;
  planEnablement?: Maybe<PlanEnablement>;
  planId?: Maybe<Scalars['String']['output']>;
  price: Scalars['Int']['output'];
  status?: Maybe<Scalars['String']['output']>;
  trialEnd?: Maybe<Scalars['DateTime']['output']>;
  willCancel?: Maybe<Scalars['Boolean']['output']>;
};


export type SubscriptionDetailsPlanEnablementArgs = {
  serviceMetric: EasServiceMetric;
};

export enum TargetEntityMutationType {
  Create = 'CREATE',
  Delete = 'DELETE',
  Update = 'UPDATE'
}

export type TestNotificationMetadata = {
  __typename?: 'TestNotificationMetadata';
  message: Scalars['String']['output'];
};

export type TimelineActivityConnection = {
  __typename?: 'TimelineActivityConnection';
  edges: Array<TimelineActivityEdge>;
  pageInfo: PageInfo;
};

export type TimelineActivityEdge = {
  __typename?: 'TimelineActivityEdge';
  cursor: Scalars['String']['output'];
  node: ActivityTimelineProjectActivity;
};

export type TimelineActivityFilterInput = {
  channels?: InputMaybe<Array<Scalars['String']['input']>>;
  platforms?: InputMaybe<Array<AppPlatform>>;
  releaseChannels?: InputMaybe<Array<Scalars['String']['input']>>;
  types?: InputMaybe<Array<ActivityTimelineProjectActivityType>>;
};

export type UniqueUsersOverTimeData = {
  __typename?: 'UniqueUsersOverTimeData';
  data: LineChartData;
};

export type UnsubscribeFromNotificationResult = {
  __typename?: 'UnsubscribeFromNotificationResult';
  notificationSubscription: NotificationSubscription;
};

export type Update = ActivityTimelineProjectActivity & {
  __typename?: 'Update';
  activityTimestamp: Scalars['DateTime']['output'];
  actor?: Maybe<Actor>;
  app: App;
  awaitingCodeSigningInfo: Scalars['Boolean']['output'];
  branch: UpdateBranch;
  branchId: Scalars['ID']['output'];
  codeSigningInfo?: Maybe<CodeSigningInfo>;
  createdAt: Scalars['DateTime']['output'];
  expoGoSDKVersion?: Maybe<Scalars['String']['output']>;
  gitCommitHash?: Maybe<Scalars['String']['output']>;
  group: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  /** Update query field */
  insights: UpdateInsights;
  isGitWorkingTreeDirty: Scalars['Boolean']['output'];
  isRollBackToEmbedded: Scalars['Boolean']['output'];
  manifestFragment: Scalars['String']['output'];
  manifestPermalink: Scalars['String']['output'];
  message?: Maybe<Scalars['String']['output']>;
  platform: Scalars['String']['output'];
  runtime: Runtime;
  /** @deprecated Use 'runtime' field . */
  runtimeVersion: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type UpdateBranch = {
  __typename?: 'UpdateBranch';
  app: App;
  appId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  latestActivity: Scalars['DateTime']['output'];
  name: Scalars['String']['output'];
  runtimes: RuntimesConnection;
  updateGroups: Array<Array<Update>>;
  updatedAt: Scalars['DateTime']['output'];
  updates: Array<Update>;
};


export type UpdateBranchRuntimesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<RuntimeFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type UpdateBranchUpdateGroupsArgs = {
  filter?: InputMaybe<UpdatesFilter>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


export type UpdateBranchUpdatesArgs = {
  filter?: InputMaybe<UpdatesFilter>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};

export type UpdateBranchMutation = {
  __typename?: 'UpdateBranchMutation';
  /** Create an EAS branch for an app */
  createUpdateBranchForApp: UpdateBranch;
  /** Delete an EAS branch and all of its updates as long as the branch is not being used by any channels */
  deleteUpdateBranch: DeleteUpdateBranchResult;
  /**
   * Edit an EAS branch. The branch can be specified either by its ID or
   * with the combination of (appId, name).
   */
  editUpdateBranch: UpdateBranch;
  /** Publish an update group to a branch */
  publishUpdateGroups: Array<Update>;
};


export type UpdateBranchMutationCreateUpdateBranchForAppArgs = {
  appId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};


export type UpdateBranchMutationDeleteUpdateBranchArgs = {
  branchId: Scalars['ID']['input'];
};


export type UpdateBranchMutationEditUpdateBranchArgs = {
  input: EditUpdateBranchInput;
};


export type UpdateBranchMutationPublishUpdateGroupsArgs = {
  publishUpdateGroupsInput: Array<PublishUpdateGroupInput>;
};

export type UpdateChannel = {
  __typename?: 'UpdateChannel';
  app: App;
  appId: Scalars['ID']['output'];
  branchMapping: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  updateBranches: Array<UpdateBranch>;
  updatedAt: Scalars['DateTime']['output'];
};


export type UpdateChannelUpdateBranchesArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};

export type UpdateChannelMutation = {
  __typename?: 'UpdateChannelMutation';
  /**
   * Create an EAS channel for an app.
   *
   * In order to work with GraphQL formatting, the branchMapping should be a
   * stringified JSON supplied to the mutation as a variable.
   */
  createUpdateChannelForApp: UpdateChannel;
  /** delete an EAS channel that doesn't point to any branches */
  deleteUpdateChannel: DeleteUpdateChannelResult;
  /**
   * Edit an EAS channel.
   *
   * In order to work with GraphQL formatting, the branchMapping should be a
   * stringified JSON supplied to the mutation as a variable.
   */
  editUpdateChannel: UpdateChannel;
};


export type UpdateChannelMutationCreateUpdateChannelForAppArgs = {
  appId: Scalars['ID']['input'];
  branchMapping?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};


export type UpdateChannelMutationDeleteUpdateChannelArgs = {
  channelId: Scalars['ID']['input'];
};


export type UpdateChannelMutationEditUpdateChannelArgs = {
  branchMapping: Scalars['String']['input'];
  channelId: Scalars['ID']['input'];
};

export type UpdateGitHubBuildTriggerInput = {
  autoSubmit: Scalars['Boolean']['input'];
  buildProfile: Scalars['String']['input'];
  isActive: Scalars['Boolean']['input'];
  platform: AppPlatform;
  sourcePattern: Scalars['String']['input'];
  submitProfile?: InputMaybe<Scalars['String']['input']>;
  targetPattern?: InputMaybe<Scalars['String']['input']>;
  type: GitHubBuildTriggerType;
};

export type UpdateGitHubRepositorySettingsInput = {
  baseDirectory: Scalars['String']['input'];
};

export type UpdateInfoGroup = {
  android?: InputMaybe<PartialManifest>;
  ios?: InputMaybe<PartialManifest>;
  web?: InputMaybe<PartialManifest>;
};

export type UpdateInsights = {
  __typename?: 'UpdateInsights';
  id: Scalars['ID']['output'];
  totalUniqueUsers: Scalars['Int']['output'];
};


export type UpdateInsightsTotalUniqueUsersArgs = {
  timespan: InsightsTimespan;
};

export type UpdateMutation = {
  __typename?: 'UpdateMutation';
  /** Delete an EAS update group */
  deleteUpdateGroup: DeleteUpdateGroupResult;
  /** Set code signing info for an update */
  setCodeSigningInfo: Update;
};


export type UpdateMutationDeleteUpdateGroupArgs = {
  group: Scalars['ID']['input'];
};


export type UpdateMutationSetCodeSigningInfoArgs = {
  codeSigningInfo: CodeSigningInfoInput;
  updateId: Scalars['ID']['input'];
};

export type UpdateRollBackToEmbeddedGroup = {
  android?: InputMaybe<Scalars['Boolean']['input']>;
  ios?: InputMaybe<Scalars['Boolean']['input']>;
  web?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdatesFilter = {
  platform?: InputMaybe<AppPlatform>;
  runtimeVersions?: InputMaybe<Array<Scalars['String']['input']>>;
  sdkVersions?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type UploadSession = {
  __typename?: 'UploadSession';
  /** Create an Upload Session */
  createUploadSession: Scalars['JSONObject']['output'];
};


export type UploadSessionCreateUploadSessionArgs = {
  type: UploadSessionType;
};

export enum UploadSessionType {
  EasBuildGcsProjectMetadata = 'EAS_BUILD_GCS_PROJECT_METADATA',
  EasBuildGcsProjectSources = 'EAS_BUILD_GCS_PROJECT_SOURCES',
  /** @deprecated Use EAS_BUILD_GCS_PROJECT_SOURCES instead. */
  EasBuildProjectSources = 'EAS_BUILD_PROJECT_SOURCES',
  /** @deprecated Use EAS_SUBMIT_GCS_APP_ARCHIVE instead. */
  EasSubmitAppArchive = 'EAS_SUBMIT_APP_ARCHIVE',
  EasSubmitGcsAppArchive = 'EAS_SUBMIT_GCS_APP_ARCHIVE'
}

export type UsageMetricTotal = {
  __typename?: 'UsageMetricTotal';
  billingPeriod: BillingPeriod;
  id: Scalars['ID']['output'];
  overageMetrics: Array<EstimatedOverageAndCost>;
  planMetrics: Array<EstimatedUsage>;
  /** Total cost of overages, in cents */
  totalCost: Scalars['Float']['output'];
};

export enum UsageMetricType {
  Bandwidth = 'BANDWIDTH',
  Build = 'BUILD',
  Minute = 'MINUTE',
  Request = 'REQUEST',
  Update = 'UPDATE',
  User = 'USER'
}

export enum UsageMetricsGranularity {
  Day = 'DAY',
  Hour = 'HOUR',
  Minute = 'MINUTE',
  Total = 'TOTAL'
}

export type UsageMetricsTimespan = {
  end: Scalars['DateTime']['input'];
  start: Scalars['DateTime']['input'];
};

/** Represents a human (not robot) actor. */
export type User = Actor & UserActor & {
  __typename?: 'User';
  /** Access Tokens belonging to this actor */
  accessTokens: Array<AccessToken>;
  accounts: Array<Account>;
  /** Coalesced project activity for all apps belonging to all accounts this user belongs to. Only resolves for the viewer. */
  activityTimelineProjectActivities: Array<ActivityTimelineProjectActivity>;
  appCount: Scalars['Int']['output'];
  /** @deprecated No longer supported */
  appetizeCode?: Maybe<Scalars['String']['output']>;
  /** Apps this user has published */
  apps: Array<App>;
  bestContactEmail?: Maybe<Scalars['String']['output']>;
  created: Scalars['DateTime']['output'];
  /** Discord account linked to a user */
  discordUser?: Maybe<DiscordUser>;
  displayName: Scalars['String']['output'];
  email: Scalars['String']['output'];
  emailVerified: Scalars['Boolean']['output'];
  /** Experiments associated with this actor */
  experiments: Array<ActorExperiment>;
  /**
   * Server feature gate values for this actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject']['output'];
  firstName?: Maybe<Scalars['String']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  /** GitHub account linked to a user */
  githubUser?: Maybe<GitHubUser>;
  /** @deprecated No longer supported */
  githubUsername?: Maybe<Scalars['String']['output']>;
  /** Whether this user has any pending user invitations. Only resolves for the viewer. */
  hasPendingUserInvitations: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  /** @deprecated No longer supported */
  industry?: Maybe<Scalars['String']['output']>;
  isExpoAdmin: Scalars['Boolean']['output'];
  /** @deprecated No longer supported */
  isLegacy: Scalars['Boolean']['output'];
  isSecondFactorAuthenticationEnabled: Scalars['Boolean']['output'];
  lastName?: Maybe<Scalars['String']['output']>;
  /** @deprecated No longer supported */
  location?: Maybe<Scalars['String']['output']>;
  notificationSubscriptions: Array<NotificationSubscription>;
  /** Pending UserInvitations for this user. Only resolves for the viewer. */
  pendingUserInvitations: Array<UserInvitation>;
  pinnedApps: Array<App>;
  preferences: UserPreferences;
  /** Associated accounts */
  primaryAccount: Account;
  profilePhoto: Scalars['String']['output'];
  /** Get all certified second factor authentication methods */
  secondFactorDevices: Array<UserSecondFactorDevice>;
  /** Snacks associated with this account */
  snacks: Array<Snack>;
  /** @deprecated No longer supported */
  twitterUsername?: Maybe<Scalars['String']['output']>;
  username: Scalars['String']['output'];
  websiteNotificationsPaginated: WebsiteNotificationsConnection;
};


/** Represents a human (not robot) actor. */
export type UserActivityTimelineProjectActivitiesArgs = {
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  filterTypes?: InputMaybe<Array<ActivityTimelineProjectActivityType>>;
  limit: Scalars['Int']['input'];
};


/** Represents a human (not robot) actor. */
export type UserAppsArgs = {
  includeUnpublished?: InputMaybe<Scalars['Boolean']['input']>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents a human (not robot) actor. */
export type UserFeatureGatesArgs = {
  filter?: InputMaybe<Array<Scalars['String']['input']>>;
};


/** Represents a human (not robot) actor. */
export type UserNotificationSubscriptionsArgs = {
  filter?: InputMaybe<NotificationSubscriptionFilter>;
};


/** Represents a human (not robot) actor. */
export type UserSnacksArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** Represents a human (not robot) actor. */
export type UserWebsiteNotificationsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActor = {
  /** Access Tokens belonging to this user actor */
  accessTokens: Array<AccessToken>;
  accounts: Array<Account>;
  /**
   * Coalesced project activity for all apps belonging to all accounts this user actor belongs to.
   * Only resolves for the viewer.
   */
  activityTimelineProjectActivities: Array<ActivityTimelineProjectActivity>;
  appCount: Scalars['Int']['output'];
  /** @deprecated No longer supported */
  appetizeCode?: Maybe<Scalars['String']['output']>;
  /** Apps this user has published */
  apps: Array<App>;
  bestContactEmail?: Maybe<Scalars['String']['output']>;
  created: Scalars['DateTime']['output'];
  /** Discord account linked to a user */
  discordUser?: Maybe<DiscordUser>;
  /**
   * Best-effort human readable name for this human actor for use in user interfaces during action attribution.
   * For example, when displaying a sentence indicating that actor X created a build or published an update.
   */
  displayName: Scalars['String']['output'];
  /** Experiments associated with this actor */
  experiments: Array<ActorExperiment>;
  /**
   * Server feature gate values for this user actor, optionally filtering by desired gates.
   * Only resolves for the viewer.
   */
  featureGates: Scalars['JSONObject']['output'];
  firstName?: Maybe<Scalars['String']['output']>;
  fullName?: Maybe<Scalars['String']['output']>;
  /** GitHub account linked to a user */
  githubUser?: Maybe<GitHubUser>;
  /** @deprecated No longer supported */
  githubUsername?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** @deprecated No longer supported */
  industry?: Maybe<Scalars['String']['output']>;
  isExpoAdmin: Scalars['Boolean']['output'];
  lastName?: Maybe<Scalars['String']['output']>;
  /** @deprecated No longer supported */
  location?: Maybe<Scalars['String']['output']>;
  notificationSubscriptions: Array<NotificationSubscription>;
  pinnedApps: Array<App>;
  preferences: UserPreferences;
  /** Associated accounts */
  primaryAccount: Account;
  profilePhoto: Scalars['String']['output'];
  /** Snacks associated with this user's personal account */
  snacks: Array<Snack>;
  /** @deprecated No longer supported */
  twitterUsername?: Maybe<Scalars['String']['output']>;
  username: Scalars['String']['output'];
  websiteNotificationsPaginated: WebsiteNotificationsConnection;
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorActivityTimelineProjectActivitiesArgs = {
  createdBefore?: InputMaybe<Scalars['DateTime']['input']>;
  filterTypes?: InputMaybe<Array<ActivityTimelineProjectActivityType>>;
  limit: Scalars['Int']['input'];
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorAppsArgs = {
  includeUnpublished?: InputMaybe<Scalars['Boolean']['input']>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorFeatureGatesArgs = {
  filter?: InputMaybe<Array<Scalars['String']['input']>>;
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorNotificationSubscriptionsArgs = {
  filter?: InputMaybe<NotificationSubscriptionFilter>;
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorSnacksArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorWebsiteNotificationsPaginatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorPublicData = {
  __typename?: 'UserActorPublicData';
  /** Apps this user has published */
  apps: Array<App>;
  firstName?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastName?: Maybe<Scalars['String']['output']>;
  profilePhoto: Scalars['String']['output'];
  /** Snacks associated with this user's personal account */
  snacks: Array<Snack>;
  username: Scalars['String']['output'];
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorPublicDataAppsArgs = {
  includeUnpublished?: InputMaybe<Scalars['Boolean']['input']>;
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


/** A human user (type User or SSOUser) that can login to the Expo website, use Expo services, and be a member of accounts. */
export type UserActorPublicDataSnacksArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};

export type UserActorPublicDataQuery = {
  __typename?: 'UserActorPublicDataQuery';
  /** Get UserActorPublicData by username */
  byUsername: UserActorPublicData;
};


export type UserActorPublicDataQueryByUsernameArgs = {
  username: Scalars['String']['input'];
};

export type UserActorQuery = {
  __typename?: 'UserActorQuery';
  /**
   * Query a UserActor by ID
   * @deprecated Public user actor queries are no longer supported
   */
  byId: UserActor;
  /**
   * Query a UserActor by username
   * @deprecated Public user actor queries are no longer supported
   */
  byUsername: UserActor;
};


export type UserActorQueryByIdArgs = {
  id: Scalars['ID']['input'];
};


export type UserActorQueryByUsernameArgs = {
  username: Scalars['String']['input'];
};

export type UserAppPinMutation = {
  __typename?: 'UserAppPinMutation';
  pinApp: Scalars['ID']['output'];
  unpinApp?: Maybe<Scalars['ID']['output']>;
};


export type UserAppPinMutationPinAppArgs = {
  appId: Scalars['ID']['input'];
};


export type UserAppPinMutationUnpinAppArgs = {
  appId: Scalars['ID']['input'];
};

export type UserDataInput = {
  email?: InputMaybe<Scalars['String']['input']>;
  firstName?: InputMaybe<Scalars['String']['input']>;
  fullName?: InputMaybe<Scalars['String']['input']>;
  id?: InputMaybe<Scalars['ID']['input']>;
  lastName?: InputMaybe<Scalars['String']['input']>;
  profilePhoto?: InputMaybe<Scalars['String']['input']>;
  username?: InputMaybe<Scalars['String']['input']>;
};

/** An pending invitation sent to an email granting membership on an Account. */
export type UserInvitation = {
  __typename?: 'UserInvitation';
  accountName: Scalars['String']['output'];
  /** If the invite is for a personal team, the profile photo of account owner */
  accountProfilePhoto?: Maybe<Scalars['String']['output']>;
  created: Scalars['DateTime']['output'];
  /** Email to which this invitation was sent */
  email: Scalars['String']['output'];
  expires: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  /** If the invite is for an organization or a personal team */
  isForOrganization: Scalars['Boolean']['output'];
  /** Account permissions to be granted upon acceptance of this invitation */
  permissions: Array<Permission>;
  /** Role to be granted upon acceptance of this invitation */
  role: Role;
};

export type UserInvitationMutation = {
  __typename?: 'UserInvitationMutation';
  /** Accept UserInvitation by ID. Viewer must have matching email and email must be verified. */
  acceptUserInvitationAsViewer: AcceptUserInvitationResult;
  /**
   * Accept UserInvitation by token. Note that the viewer's email is not required to match
   * the email on the invitation. If viewer's email does match that of the invitation,
   * their email will also be verified.
   */
  acceptUserInvitationByTokenAsViewer: AcceptUserInvitationResult;
  /**
   * Create a UserInvitation for an email that when accepted grants
   * the specified permissions on an Account
   */
  createUserInvitationForAccount: UserInvitation;
  /** Rescind UserInvitation by ID */
  deleteUserInvitation: RescindUserInvitationResult;
  /**
   * Delete UserInvitation by token. Note that the viewer's email is not required to match
   * the email on the invitation.
   */
  deleteUserInvitationByToken: RescindUserInvitationResult;
  /** Re-send UserInivitation by ID */
  resendUserInvitation: UserInvitation;
};


export type UserInvitationMutationAcceptUserInvitationAsViewerArgs = {
  id: Scalars['ID']['input'];
};


export type UserInvitationMutationAcceptUserInvitationByTokenAsViewerArgs = {
  token: Scalars['ID']['input'];
};


export type UserInvitationMutationCreateUserInvitationForAccountArgs = {
  accountID: Scalars['ID']['input'];
  email: Scalars['String']['input'];
  permissions: Array<InputMaybe<Permission>>;
};


export type UserInvitationMutationDeleteUserInvitationArgs = {
  id: Scalars['ID']['input'];
};


export type UserInvitationMutationDeleteUserInvitationByTokenArgs = {
  token: Scalars['ID']['input'];
};


export type UserInvitationMutationResendUserInvitationArgs = {
  id: Scalars['ID']['input'];
};

/** Publicly visible data for a UserInvitation. */
export type UserInvitationPublicData = {
  __typename?: 'UserInvitationPublicData';
  accountName: Scalars['String']['output'];
  accountProfilePhoto?: Maybe<Scalars['String']['output']>;
  created: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  expires: Scalars['DateTime']['output'];
  /** Email to which this invitation was sent */
  id: Scalars['ID']['output'];
  isForOrganization: Scalars['Boolean']['output'];
};

export type UserInvitationPublicDataQuery = {
  __typename?: 'UserInvitationPublicDataQuery';
  /** Get UserInvitationPublicData by token */
  byToken: UserInvitationPublicData;
};


export type UserInvitationPublicDataQueryByTokenArgs = {
  token: Scalars['ID']['input'];
};

export type UserPermission = {
  __typename?: 'UserPermission';
  actor: Actor;
  permissions: Array<Permission>;
  role: Role;
  /** @deprecated User type is deprecated */
  user?: Maybe<User>;
  userActor?: Maybe<UserActor>;
};

export type UserPreferences = {
  __typename?: 'UserPreferences';
  selectedAccountName?: Maybe<Scalars['String']['output']>;
};

export type UserPreferencesInput = {
  selectedAccountName?: InputMaybe<Scalars['String']['input']>;
};

export type UserQuery = {
  __typename?: 'UserQuery';
  /**
   * Query a User by ID
   * @deprecated Public user queries are no longer supported
   */
  byId: User;
  /**
   * Query a User by username
   * @deprecated Public user queries are no longer supported
   */
  byUsername: User;
};


export type UserQueryByIdArgs = {
  userId: Scalars['ID']['input'];
};


export type UserQueryByUsernameArgs = {
  username: Scalars['String']['input'];
};

/** A second factor device belonging to a User */
export type UserSecondFactorDevice = {
  __typename?: 'UserSecondFactorDevice';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  isCertified: Scalars['Boolean']['output'];
  isPrimary: Scalars['Boolean']['output'];
  method: SecondFactorMethod;
  name: Scalars['String']['output'];
  smsPhoneNumber?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  user: User;
};

export type WebNotificationUpdateReadStateInput = {
  id: Scalars['ID']['input'];
  isRead: Scalars['Boolean']['input'];
};

export type Webhook = {
  __typename?: 'Webhook';
  appId: Scalars['ID']['output'];
  createdAt: Scalars['DateTime']['output'];
  event: WebhookType;
  id: Scalars['ID']['output'];
  updatedAt: Scalars['DateTime']['output'];
  url: Scalars['String']['output'];
};

export type WebhookFilter = {
  event?: InputMaybe<WebhookType>;
};

export type WebhookInput = {
  event: WebhookType;
  secret: Scalars['String']['input'];
  url: Scalars['String']['input'];
};

export type WebhookMutation = {
  __typename?: 'WebhookMutation';
  /** Create a Webhook */
  createWebhook: Webhook;
  /** Delete a Webhook */
  deleteWebhook: DeleteWebhookResult;
  /** Update a Webhook */
  updateWebhook: Webhook;
};


export type WebhookMutationCreateWebhookArgs = {
  appId: Scalars['String']['input'];
  webhookInput: WebhookInput;
};


export type WebhookMutationDeleteWebhookArgs = {
  webhookId: Scalars['ID']['input'];
};


export type WebhookMutationUpdateWebhookArgs = {
  webhookId: Scalars['ID']['input'];
  webhookInput: WebhookInput;
};

export type WebhookQuery = {
  __typename?: 'WebhookQuery';
  byId: Webhook;
};


export type WebhookQueryByIdArgs = {
  id: Scalars['ID']['input'];
};

export enum WebhookType {
  Build = 'BUILD',
  Submit = 'SUBMIT'
}

export type WebsiteNotificationEdge = {
  __typename?: 'WebsiteNotificationEdge';
  cursor: Scalars['String']['output'];
  node: Notification;
};

export type WebsiteNotificationMutation = {
  __typename?: 'WebsiteNotificationMutation';
  updateAllWebsiteNotificationReadStateAsRead: Scalars['Boolean']['output'];
  updateNotificationReadState: Notification;
};


export type WebsiteNotificationMutationUpdateNotificationReadStateArgs = {
  input: WebNotificationUpdateReadStateInput;
};

export type WebsiteNotificationsConnection = {
  __typename?: 'WebsiteNotificationsConnection';
  edges: Array<WebsiteNotificationEdge>;
  pageInfo: PageInfo;
};

export enum WorkerLoggerLevel {
  Debug = 'DEBUG',
  Error = 'ERROR',
  Fatal = 'FATAL',
  Info = 'INFO',
  Trace = 'TRACE',
  Warn = 'WARN'
}

export type DeleteAndroidAppBuildCredentialsResult = {
  __typename?: 'deleteAndroidAppBuildCredentialsResult';
  id: Scalars['ID']['output'];
};

export type DeleteAndroidFcmResult = {
  __typename?: 'deleteAndroidFcmResult';
  id: Scalars['ID']['output'];
};

export type DeleteAppStoreConnectApiKeyResult = {
  __typename?: 'deleteAppStoreConnectApiKeyResult';
  id: Scalars['ID']['output'];
};

export type DeleteApplePushKeyResult = {
  __typename?: 'deleteApplePushKeyResult';
  id: Scalars['ID']['output'];
};

export type CreateUpdateBranchForAppMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
}>;


export type CreateUpdateBranchForAppMutation = { __typename?: 'RootMutation', updateBranch: { __typename?: 'UpdateBranchMutation', createUpdateBranchForApp: { __typename?: 'UpdateBranch', id: string, name: string } } };

export type CreateUpdateChannelOnAppMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  branchMapping: Scalars['String']['input'];
}>;


export type CreateUpdateChannelOnAppMutation = { __typename?: 'RootMutation', updateChannel: { __typename?: 'UpdateChannelMutation', createUpdateChannelForApp: { __typename?: 'UpdateChannel', id: string, name: string, branchMapping: string } } };

export type GetBranchInfoQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  name: Scalars['String']['input'];
}>;


export type GetBranchInfoQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateBranchByName?: { __typename?: 'UpdateBranch', id: string, name: string } | null } } };

export type DeleteUpdateBranchMutationVariables = Exact<{
  branchId: Scalars['ID']['input'];
}>;


export type DeleteUpdateBranchMutation = { __typename?: 'RootMutation', updateBranch: { __typename?: 'UpdateBranchMutation', deleteUpdateBranch: { __typename?: 'DeleteUpdateBranchResult', id: string } } };

export type EditUpdateBranchMutationVariables = Exact<{
  input: EditUpdateBranchInput;
}>;


export type EditUpdateBranchMutation = { __typename?: 'RootMutation', updateBranch: { __typename?: 'UpdateBranchMutation', editUpdateBranch: { __typename?: 'UpdateBranch', id: string, name: string } } };

export type CancelBuildMutationVariables = Exact<{
  buildId: Scalars['ID']['input'];
}>;


export type CancelBuildMutation = { __typename?: 'RootMutation', build: { __typename?: 'BuildMutation', cancel: { __typename?: 'Build', id: string, status: BuildStatus } } };

export type DeleteBuildMutationVariables = Exact<{
  buildId: Scalars['ID']['input'];
}>;


export type DeleteBuildMutation = { __typename?: 'RootMutation', build: { __typename?: 'BuildMutation', deleteBuild: { __typename?: 'Build', id: string } } };

export type DeleteUpdateChannelMutationVariables = Exact<{
  channelId: Scalars['ID']['input'];
}>;


export type DeleteUpdateChannelMutation = { __typename?: 'RootMutation', updateChannel: { __typename?: 'UpdateChannelMutation', deleteUpdateChannel: { __typename?: 'DeleteUpdateChannelResult', id: string } } };

export type UpdateChannelBranchMappingMutationVariables = Exact<{
  channelId: Scalars['ID']['input'];
  branchMapping: Scalars['String']['input'];
}>;


export type UpdateChannelBranchMappingMutation = { __typename?: 'RootMutation', updateChannel: { __typename?: 'UpdateChannelMutation', editUpdateChannel: { __typename?: 'UpdateChannel', id: string, name: string, branchMapping: string } } };

export type AppInfoQueryVariables = Exact<{
  appId: Scalars['String']['input'];
}>;


export type AppInfoQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, fullName: string } } };

export type DeleteUpdateGroupMutationVariables = Exact<{
  group: Scalars['ID']['input'];
}>;


export type DeleteUpdateGroupMutation = { __typename?: 'RootMutation', update: { __typename?: 'UpdateMutation', deleteUpdateGroup: { __typename?: 'DeleteUpdateGroupResult', group: string } } };

export type CreateAndroidAppBuildCredentialsMutationVariables = Exact<{
  androidAppBuildCredentialsInput: AndroidAppBuildCredentialsInput;
  androidAppCredentialsId: Scalars['ID']['input'];
}>;


export type CreateAndroidAppBuildCredentialsMutation = { __typename?: 'RootMutation', androidAppBuildCredentials: { __typename?: 'AndroidAppBuildCredentialsMutation', createAndroidAppBuildCredentials: { __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null } } };

export type SetDefaultAndroidAppBuildCredentialsMutationVariables = Exact<{
  androidAppBuildCredentialsId: Scalars['ID']['input'];
  isDefault: Scalars['Boolean']['input'];
}>;


export type SetDefaultAndroidAppBuildCredentialsMutation = { __typename?: 'RootMutation', androidAppBuildCredentials: { __typename?: 'AndroidAppBuildCredentialsMutation', setDefault: { __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null } } };

export type SetKeystoreMutationVariables = Exact<{
  androidAppBuildCredentialsId: Scalars['ID']['input'];
  keystoreId: Scalars['ID']['input'];
}>;


export type SetKeystoreMutation = { __typename?: 'RootMutation', androidAppBuildCredentials: { __typename?: 'AndroidAppBuildCredentialsMutation', setKeystore: { __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null } } };

export type CreateAndroidAppCredentialsMutationVariables = Exact<{
  androidAppCredentialsInput: AndroidAppCredentialsInput;
  appId: Scalars['ID']['input'];
  applicationIdentifier: Scalars['String']['input'];
}>;


export type CreateAndroidAppCredentialsMutation = { __typename?: 'RootMutation', androidAppCredentials: { __typename?: 'AndroidAppCredentialsMutation', createAndroidAppCredentials: { __typename?: 'AndroidAppCredentials', id: string, applicationIdentifier?: string | null, isLegacy: boolean, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, androidFcm?: { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } } | null, googleServiceAccountKeyForFcmV1?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, googleServiceAccountKeyForSubmissions?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, androidAppBuildCredentialsList: Array<{ __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null }> } } };

export type SetFcmMutationVariables = Exact<{
  androidAppCredentialsId: Scalars['ID']['input'];
  fcmId: Scalars['ID']['input'];
}>;


export type SetFcmMutation = { __typename?: 'RootMutation', androidAppCredentials: { __typename?: 'AndroidAppCredentialsMutation', setFcm: { __typename?: 'AndroidAppCredentials', id: string, applicationIdentifier?: string | null, isLegacy: boolean, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, androidFcm?: { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } } | null, googleServiceAccountKeyForFcmV1?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, googleServiceAccountKeyForSubmissions?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, androidAppBuildCredentialsList: Array<{ __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null }> } } };

export type SetGoogleServiceAccountKeyForSubmissionsMutationVariables = Exact<{
  androidAppCredentialsId: Scalars['ID']['input'];
  googleServiceAccountKeyId: Scalars['ID']['input'];
}>;


export type SetGoogleServiceAccountKeyForSubmissionsMutation = { __typename?: 'RootMutation', androidAppCredentials: { __typename?: 'AndroidAppCredentialsMutation', setGoogleServiceAccountKeyForSubmissions: { __typename?: 'AndroidAppCredentials', id: string, applicationIdentifier?: string | null, isLegacy: boolean, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, androidFcm?: { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } } | null, googleServiceAccountKeyForFcmV1?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, googleServiceAccountKeyForSubmissions?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, androidAppBuildCredentialsList: Array<{ __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null }> } } };

export type SetGoogleServiceAccountKeyForFcmV1MutationVariables = Exact<{
  androidAppCredentialsId: Scalars['ID']['input'];
  googleServiceAccountKeyId: Scalars['ID']['input'];
}>;


export type SetGoogleServiceAccountKeyForFcmV1Mutation = { __typename?: 'RootMutation', androidAppCredentials: { __typename?: 'AndroidAppCredentialsMutation', setGoogleServiceAccountKeyForFcmV1: { __typename?: 'AndroidAppCredentials', id: string, applicationIdentifier?: string | null, isLegacy: boolean, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, androidFcm?: { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } } | null, googleServiceAccountKeyForFcmV1?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, googleServiceAccountKeyForSubmissions?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, androidAppBuildCredentialsList: Array<{ __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null }> } } };

export type CreateAndroidFcmMutationVariables = Exact<{
  androidFcmInput: AndroidFcmInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateAndroidFcmMutation = { __typename?: 'RootMutation', androidFcm: { __typename?: 'AndroidFcmMutation', createAndroidFcm: { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } } } };

export type DeleteAndroidFcmMutationVariables = Exact<{
  androidFcmId: Scalars['ID']['input'];
}>;


export type DeleteAndroidFcmMutation = { __typename?: 'RootMutation', androidFcm: { __typename?: 'AndroidFcmMutation', deleteAndroidFcm: { __typename?: 'deleteAndroidFcmResult', id: string } } };

export type CreateAndroidKeystoreMutationVariables = Exact<{
  androidKeystoreInput: AndroidKeystoreInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateAndroidKeystoreMutation = { __typename?: 'RootMutation', androidKeystore: { __typename?: 'AndroidKeystoreMutation', createAndroidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null } };

export type DeleteAndroidKeystoreMutationVariables = Exact<{
  androidKeystoreId: Scalars['ID']['input'];
}>;


export type DeleteAndroidKeystoreMutation = { __typename?: 'RootMutation', androidKeystore: { __typename?: 'AndroidKeystoreMutation', deleteAndroidKeystore: { __typename?: 'DeleteAndroidKeystoreResult', id: string } } };

export type CreateGoogleServiceAccountKeyMutationVariables = Exact<{
  googleServiceAccountKeyInput: GoogleServiceAccountKeyInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateGoogleServiceAccountKeyMutation = { __typename?: 'RootMutation', googleServiceAccountKey: { __typename?: 'GoogleServiceAccountKeyMutation', createGoogleServiceAccountKey: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } } };

export type DeleteGoogleServiceAccountKeyMutationVariables = Exact<{
  googleServiceAccountKeyId: Scalars['ID']['input'];
}>;


export type DeleteGoogleServiceAccountKeyMutation = { __typename?: 'RootMutation', googleServiceAccountKey: { __typename?: 'GoogleServiceAccountKeyMutation', deleteGoogleServiceAccountKey: { __typename?: 'DeleteGoogleServiceAccountKeyResult', id: string } } };

export type CommonAndroidAppCredentialsWithBuildCredentialsByApplicationIdentifierQueryVariables = Exact<{
  projectFullName: Scalars['String']['input'];
  applicationIdentifier?: InputMaybe<Scalars['String']['input']>;
  legacyOnly?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type CommonAndroidAppCredentialsWithBuildCredentialsByApplicationIdentifierQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byFullName: { __typename?: 'App', id: string, androidAppCredentials: Array<{ __typename?: 'AndroidAppCredentials', id: string, applicationIdentifier?: string | null, isLegacy: boolean, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, androidFcm?: { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } } | null, googleServiceAccountKeyForFcmV1?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, googleServiceAccountKeyForSubmissions?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, androidAppBuildCredentialsList: Array<{ __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null }> }> } } };

export type GoogleServiceAccountKeyByAccountQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
}>;


export type GoogleServiceAccountKeyByAccountQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, googleServiceAccountKeys: Array<{ __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any }> } } };

export type CreateAppStoreConnectApiKeyMutationVariables = Exact<{
  appStoreConnectApiKeyInput: AppStoreConnectApiKeyInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateAppStoreConnectApiKeyMutation = { __typename?: 'RootMutation', appStoreConnectApiKey: { __typename?: 'AppStoreConnectApiKeyMutation', createAppStoreConnectApiKey: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } } };

export type DeleteAppStoreConnectApiKeyMutationVariables = Exact<{
  appStoreConnectApiKeyId: Scalars['ID']['input'];
}>;


export type DeleteAppStoreConnectApiKeyMutation = { __typename?: 'RootMutation', appStoreConnectApiKey: { __typename?: 'AppStoreConnectApiKeyMutation', deleteAppStoreConnectApiKey: { __typename?: 'deleteAppStoreConnectApiKeyResult', id: string } } };

export type CreateAppleAppIdentifierMutationVariables = Exact<{
  appleAppIdentifierInput: AppleAppIdentifierInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateAppleAppIdentifierMutation = { __typename?: 'RootMutation', appleAppIdentifier: { __typename?: 'AppleAppIdentifierMutation', createAppleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } } };

export type CreateAppleDeviceMutationVariables = Exact<{
  appleDeviceInput: AppleDeviceInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateAppleDeviceMutation = { __typename?: 'RootMutation', appleDevice: { __typename?: 'AppleDeviceMutation', createAppleDevice: { __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any } } };

export type DeleteAppleDeviceMutationVariables = Exact<{
  deviceId: Scalars['ID']['input'];
}>;


export type DeleteAppleDeviceMutation = { __typename?: 'RootMutation', appleDevice: { __typename?: 'AppleDeviceMutation', deleteAppleDevice: { __typename?: 'DeleteAppleDeviceResult', id: string } } };

export type UpdateAppleDeviceMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  appleDeviceUpdateInput: AppleDeviceUpdateInput;
}>;


export type UpdateAppleDeviceMutation = { __typename?: 'RootMutation', appleDevice: { __typename?: 'AppleDeviceMutation', updateAppleDevice: { __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any } } };

export type CreateAppleDeviceRegistrationRequestMutationVariables = Exact<{
  appleTeamId: Scalars['ID']['input'];
  accountId: Scalars['ID']['input'];
}>;


export type CreateAppleDeviceRegistrationRequestMutation = { __typename?: 'RootMutation', appleDeviceRegistrationRequest: { __typename?: 'AppleDeviceRegistrationRequestMutation', createAppleDeviceRegistrationRequest: { __typename?: 'AppleDeviceRegistrationRequest', id: string } } };

export type CreateAppleDistributionCertificateMutationVariables = Exact<{
  appleDistributionCertificateInput: AppleDistributionCertificateInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateAppleDistributionCertificateMutation = { __typename?: 'RootMutation', appleDistributionCertificate: { __typename?: 'AppleDistributionCertificateMutation', createAppleDistributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null } };

export type DeleteAppleDistributionCertificateMutationVariables = Exact<{
  appleDistributionCertificateId: Scalars['ID']['input'];
}>;


export type DeleteAppleDistributionCertificateMutation = { __typename?: 'RootMutation', appleDistributionCertificate: { __typename?: 'AppleDistributionCertificateMutation', deleteAppleDistributionCertificate: { __typename?: 'DeleteAppleDistributionCertificateResult', id: string } } };

export type CreateAppleProvisioningProfileMutationVariables = Exact<{
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
  accountId: Scalars['ID']['input'];
  appleAppIdentifierId: Scalars['ID']['input'];
}>;


export type CreateAppleProvisioningProfileMutation = { __typename?: 'RootMutation', appleProvisioningProfile: { __typename?: 'AppleProvisioningProfileMutation', createAppleProvisioningProfile: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } } };

export type UpdateAppleProvisioningProfileMutationVariables = Exact<{
  appleProvisioningProfileId: Scalars['ID']['input'];
  appleProvisioningProfileInput: AppleProvisioningProfileInput;
}>;


export type UpdateAppleProvisioningProfileMutation = { __typename?: 'RootMutation', appleProvisioningProfile: { __typename?: 'AppleProvisioningProfileMutation', updateAppleProvisioningProfile: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } } };

export type DeleteAppleProvisioningProfilesMutationVariables = Exact<{
  appleProvisioningProfileIds: Array<Scalars['ID']['input']> | Scalars['ID']['input'];
}>;


export type DeleteAppleProvisioningProfilesMutation = { __typename?: 'RootMutation', appleProvisioningProfile: { __typename?: 'AppleProvisioningProfileMutation', deleteAppleProvisioningProfiles: Array<{ __typename?: 'DeleteAppleProvisioningProfileResult', id: string }> } };

export type CreateApplePushKeyMutationVariables = Exact<{
  applePushKeyInput: ApplePushKeyInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateApplePushKeyMutation = { __typename?: 'RootMutation', applePushKey: { __typename?: 'ApplePushKeyMutation', createApplePushKey: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } } };

export type DeleteApplePushKeyMutationVariables = Exact<{
  applePushKeyId: Scalars['ID']['input'];
}>;


export type DeleteApplePushKeyMutation = { __typename?: 'RootMutation', applePushKey: { __typename?: 'ApplePushKeyMutation', deleteApplePushKey: { __typename?: 'deleteApplePushKeyResult', id: string } } };

export type CreateAppleTeamMutationVariables = Exact<{
  appleTeamInput: AppleTeamInput;
  accountId: Scalars['ID']['input'];
}>;


export type CreateAppleTeamMutation = { __typename?: 'RootMutation', appleTeam: { __typename?: 'AppleTeamMutation', createAppleTeam: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null, account: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } } } };

export type CreateIosAppBuildCredentialsMutationVariables = Exact<{
  iosAppBuildCredentialsInput: IosAppBuildCredentialsInput;
  iosAppCredentialsId: Scalars['ID']['input'];
}>;


export type CreateIosAppBuildCredentialsMutation = { __typename?: 'RootMutation', iosAppBuildCredentials: { __typename?: 'IosAppBuildCredentialsMutation', createIosAppBuildCredentials: { __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null } } };

export type SetDistributionCertificateMutationVariables = Exact<{
  iosAppBuildCredentialsId: Scalars['ID']['input'];
  distributionCertificateId: Scalars['ID']['input'];
}>;


export type SetDistributionCertificateMutation = { __typename?: 'RootMutation', iosAppBuildCredentials: { __typename?: 'IosAppBuildCredentialsMutation', setDistributionCertificate: { __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null } } };

export type SetProvisioningProfileMutationVariables = Exact<{
  iosAppBuildCredentialsId: Scalars['ID']['input'];
  provisioningProfileId: Scalars['ID']['input'];
}>;


export type SetProvisioningProfileMutation = { __typename?: 'RootMutation', iosAppBuildCredentials: { __typename?: 'IosAppBuildCredentialsMutation', setProvisioningProfile: { __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null } } };

export type CreateIosAppCredentialsMutationVariables = Exact<{
  iosAppCredentialsInput: IosAppCredentialsInput;
  appId: Scalars['ID']['input'];
  appleAppIdentifierId: Scalars['ID']['input'];
}>;


export type CreateIosAppCredentialsMutation = { __typename?: 'RootMutation', iosAppCredentials: { __typename?: 'IosAppCredentialsMutation', createIosAppCredentials: { __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null }>, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }, pushKey?: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } | null, appStoreConnectApiKeyForSubmissions?: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } | null } } };

export type SetPushKeyMutationVariables = Exact<{
  iosAppCredentialsId: Scalars['ID']['input'];
  pushKeyId: Scalars['ID']['input'];
}>;


export type SetPushKeyMutation = { __typename?: 'RootMutation', iosAppCredentials: { __typename?: 'IosAppCredentialsMutation', setPushKey: { __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null }>, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }, pushKey?: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } | null, appStoreConnectApiKeyForSubmissions?: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } | null } } };

export type SetAppStoreConnectApiKeyForSubmissionsMutationVariables = Exact<{
  iosAppCredentialsId: Scalars['ID']['input'];
  ascApiKeyId: Scalars['ID']['input'];
}>;


export type SetAppStoreConnectApiKeyForSubmissionsMutation = { __typename?: 'RootMutation', iosAppCredentials: { __typename?: 'IosAppCredentialsMutation', setAppStoreConnectApiKeyForSubmissions: { __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null }>, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }, pushKey?: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } | null, appStoreConnectApiKeyForSubmissions?: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } | null } } };

export type AppStoreConnectApiKeyByAccountQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
}>;


export type AppStoreConnectApiKeyByAccountQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, appStoreConnectApiKeys: Array<{ __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null }> } } };

export type AppleAppIdentifierByBundleIdQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
  bundleIdentifier: Scalars['String']['input'];
}>;


export type AppleAppIdentifierByBundleIdQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, appleAppIdentifiers: Array<{ __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }> } } };

export type AppleDevicesByAppleTeamQueryVariables = Exact<{
  accountId: Scalars['ID']['input'];
  appleTeamIdentifier: Scalars['String']['input'];
}>;


export type AppleDevicesByAppleTeamQuery = { __typename?: 'RootQuery', appleTeam: { __typename?: 'AppleTeamQuery', byAppleTeamIdentifier?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any, appleTeam: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } }> } | null } };

export type AppleDevicesByTeamIdentifierQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
  appleTeamIdentifier: Scalars['String']['input'];
  offset?: InputMaybe<Scalars['Int']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type AppleDevicesByTeamIdentifierQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, appleTeams: Array<{ __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, deviceClass?: AppleDeviceClass | null, enabled?: boolean | null, model?: string | null, createdAt: any }> }> } } };

export type AppleDevicesByIdentifierQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
  identifier: Scalars['String']['input'];
}>;


export type AppleDevicesByIdentifierQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, model?: string | null, identifier: string, name?: string | null, deviceClass?: AppleDeviceClass | null, enabled?: boolean | null, appleTeam: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } }> } } };

export type AppleDistributionCertificateByAppQueryVariables = Exact<{
  projectFullName: Scalars['String']['input'];
  appleAppIdentifierId: Scalars['String']['input'];
  iosDistributionType: IosDistributionType;
}>;


export type AppleDistributionCertificateByAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byFullName: { __typename?: 'App', id: string, iosAppCredentials: Array<{ __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null }> }> } } };

export type AppleDistributionCertificateByAccountQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
}>;


export type AppleDistributionCertificateByAccountQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, appleDistributionCertificates: Array<{ __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> }> } } };

export type AppleProvisioningProfilesByAppQueryVariables = Exact<{
  projectFullName: Scalars['String']['input'];
  appleAppIdentifierId: Scalars['String']['input'];
  iosDistributionType: IosDistributionType;
}>;


export type AppleProvisioningProfilesByAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byFullName: { __typename?: 'App', id: string, iosAppCredentials: Array<{ __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }>, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } } | null }> }> } } };

export type ApplePushKeyByAccountQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
}>;


export type ApplePushKeyByAccountQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, applePushKeys: Array<{ __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> }> } } };

export type AppleTeamsByAccountNameQueryVariables = Exact<{
  accountName: Scalars['String']['input'];
  offset?: InputMaybe<Scalars['Int']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type AppleTeamsByAccountNameQuery = { __typename?: 'RootQuery', account: { __typename?: 'AccountQuery', byName: { __typename?: 'Account', id: string, appleTeams: Array<{ __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null }> } } };

export type AppleTeamByIdentifierQueryVariables = Exact<{
  accountId: Scalars['ID']['input'];
  appleTeamIdentifier: Scalars['String']['input'];
}>;


export type AppleTeamByIdentifierQuery = { __typename?: 'RootQuery', appleTeam: { __typename?: 'AppleTeamQuery', byAppleTeamIdentifier?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } };

export type IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQueryVariables = Exact<{
  projectFullName: Scalars['String']['input'];
  appleAppIdentifierId: Scalars['String']['input'];
  iosDistributionType: IosDistributionType;
}>;


export type IosAppBuildCredentialsByAppleAppIdentiferAndDistributionQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byFullName: { __typename?: 'App', id: string, iosAppCredentials: Array<{ __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null }> }> } } };

export type IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQueryVariables = Exact<{
  projectFullName: Scalars['String']['input'];
  appleAppIdentifierId: Scalars['String']['input'];
  iosDistributionType?: InputMaybe<IosDistributionType>;
}>;


export type IosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byFullName: { __typename?: 'App', id: string, iosAppCredentials: Array<{ __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null }>, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }, pushKey?: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } | null, appStoreConnectApiKeyForSubmissions?: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } | null }> } } };

export type CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQueryVariables = Exact<{
  projectFullName: Scalars['String']['input'];
  appleAppIdentifierId: Scalars['String']['input'];
}>;


export type CommonIosAppCredentialsWithBuildCredentialsByAppIdentifierIdQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byFullName: { __typename?: 'App', id: string, iosAppCredentials: Array<{ __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null }>, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }, pushKey?: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } | null, appStoreConnectApiKeyForSubmissions?: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } | null }> } } };

export type CreateAppMutationVariables = Exact<{
  appInput: AppInput;
}>;


export type CreateAppMutation = { __typename?: 'RootMutation', app?: { __typename?: 'AppMutation', createApp: { __typename?: 'App', id: string } } | null };

export type CreateAppVersionMutationVariables = Exact<{
  appVersionInput: AppVersionInput;
}>;


export type CreateAppVersionMutation = { __typename?: 'RootMutation', appVersion: { __typename?: 'AppVersionMutation', createAppVersion: { __typename?: 'AppVersion', id: string } } };

export type CreateAndroidBuildMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  job: AndroidJobInput;
  metadata?: InputMaybe<BuildMetadataInput>;
  buildParams?: InputMaybe<BuildParamsInput>;
}>;


export type CreateAndroidBuildMutation = { __typename?: 'RootMutation', build: { __typename?: 'BuildMutation', createAndroidBuild: { __typename?: 'CreateBuildResult', build: { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } }, deprecationInfo?: { __typename?: 'EASBuildDeprecationInfo', type: EasBuildDeprecationInfoType, message: string } | null } } };

export type CreateIosBuildMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  job: IosJobInput;
  metadata?: InputMaybe<BuildMetadataInput>;
  buildParams?: InputMaybe<BuildParamsInput>;
}>;


export type CreateIosBuildMutation = { __typename?: 'RootMutation', build: { __typename?: 'BuildMutation', createIosBuild: { __typename?: 'CreateBuildResult', build: { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } }, deprecationInfo?: { __typename?: 'EASBuildDeprecationInfo', type: EasBuildDeprecationInfoType, message: string } | null } } };

export type UpdateBuildMetadataMutationVariables = Exact<{
  buildId: Scalars['ID']['input'];
  metadata: BuildMetadataInput;
}>;


export type UpdateBuildMetadataMutation = { __typename?: 'RootMutation', build: { __typename?: 'BuildMutation', updateBuildMetadata: { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } } } };

export type RetryIosBuildMutationVariables = Exact<{
  buildId: Scalars['ID']['input'];
  jobOverrides: IosJobOverridesInput;
}>;


export type RetryIosBuildMutation = { __typename?: 'RootMutation', build: { __typename?: 'BuildMutation', retryIosBuild: { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } } } };

export type CreateEnvironmentSecretForAccountMutationVariables = Exact<{
  input: CreateEnvironmentSecretInput;
  accountId: Scalars['String']['input'];
}>;


export type CreateEnvironmentSecretForAccountMutation = { __typename?: 'RootMutation', environmentSecret: { __typename?: 'EnvironmentSecretMutation', createEnvironmentSecretForAccount: { __typename?: 'EnvironmentSecret', id: string, name: string, type: EnvironmentSecretType, createdAt: any } } };

export type CreateEnvironmentSecretForAppMutationVariables = Exact<{
  input: CreateEnvironmentSecretInput;
  appId: Scalars['String']['input'];
}>;


export type CreateEnvironmentSecretForAppMutation = { __typename?: 'RootMutation', environmentSecret: { __typename?: 'EnvironmentSecretMutation', createEnvironmentSecretForApp: { __typename?: 'EnvironmentSecret', id: string, name: string, type: EnvironmentSecretType, createdAt: any } } };

export type DeleteEnvironmentSecretMutationVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type DeleteEnvironmentSecretMutation = { __typename?: 'RootMutation', environmentSecret: { __typename?: 'EnvironmentSecretMutation', deleteEnvironmentSecret: { __typename?: 'DeleteEnvironmentSecretResult', id: string } } };

export type CreateKeystoreGenerationUrlMutationVariables = Exact<{ [key: string]: never; }>;


export type CreateKeystoreGenerationUrlMutation = { __typename?: 'RootMutation', keystoreGenerationUrl: { __typename?: 'KeystoreGenerationUrlMutation', createKeystoreGenerationUrl: { __typename?: 'KeystoreGenerationUrl', id: string, url: string } } };

export type GetSignedUploadMutationVariables = Exact<{
  contentTypes: Array<Scalars['String']['input']> | Scalars['String']['input'];
}>;


export type GetSignedUploadMutation = { __typename?: 'RootMutation', asset: { __typename?: 'AssetMutation', getSignedAssetUploadSpecifications: { __typename?: 'GetSignedAssetUploadSpecificationsResult', specifications: Array<string> } } };

export type UpdatePublishMutationVariables = Exact<{
  publishUpdateGroupsInput: Array<PublishUpdateGroupInput> | PublishUpdateGroupInput;
}>;


export type UpdatePublishMutation = { __typename?: 'RootMutation', updateBranch: { __typename?: 'UpdateBranchMutation', publishUpdateGroups: Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }> } };

export type SetCodeSigningInfoMutationVariables = Exact<{
  updateId: Scalars['ID']['input'];
  codeSigningInfo: CodeSigningInfoInput;
}>;


export type SetCodeSigningInfoMutation = { __typename?: 'RootMutation', update: { __typename?: 'UpdateMutation', setCodeSigningInfo: { __typename?: 'Update', id: string, group: string, awaitingCodeSigningInfo: boolean, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, alg: string, sig: string } | null } } };

export type CreateAndroidSubmissionMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  config: AndroidSubmissionConfigInput;
  submittedBuildId?: InputMaybe<Scalars['ID']['input']>;
  archiveSource?: InputMaybe<SubmissionArchiveSourceInput>;
}>;


export type CreateAndroidSubmissionMutation = { __typename?: 'RootMutation', submission: { __typename?: 'SubmissionMutation', createAndroidSubmission: { __typename?: 'CreateSubmissionResult', submission: { __typename?: 'Submission', id: string, status: SubmissionStatus, platform: AppPlatform, logsUrl?: string | null, app: { __typename?: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } }, androidConfig?: { __typename?: 'AndroidSubmissionConfig', applicationIdentifier?: string | null, track: SubmissionAndroidTrack, releaseStatus?: SubmissionAndroidReleaseStatus | null, rollout?: number | null } | null, iosConfig?: { __typename?: 'IosSubmissionConfig', ascAppIdentifier: string, appleIdUsername?: string | null } | null, error?: { __typename?: 'SubmissionError', errorCode?: string | null, message?: string | null } | null } } } };

export type CreateIosSubmissionMutationVariables = Exact<{
  appId: Scalars['ID']['input'];
  config: IosSubmissionConfigInput;
  submittedBuildId?: InputMaybe<Scalars['ID']['input']>;
  archiveSource?: InputMaybe<SubmissionArchiveSourceInput>;
}>;


export type CreateIosSubmissionMutation = { __typename?: 'RootMutation', submission: { __typename?: 'SubmissionMutation', createIosSubmission: { __typename?: 'CreateSubmissionResult', submission: { __typename?: 'Submission', id: string, status: SubmissionStatus, platform: AppPlatform, logsUrl?: string | null, app: { __typename?: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } }, androidConfig?: { __typename?: 'AndroidSubmissionConfig', applicationIdentifier?: string | null, track: SubmissionAndroidTrack, releaseStatus?: SubmissionAndroidReleaseStatus | null, rollout?: number | null } | null, iosConfig?: { __typename?: 'IosSubmissionConfig', ascAppIdentifier: string, appleIdUsername?: string | null } | null, error?: { __typename?: 'SubmissionError', errorCode?: string | null, message?: string | null } | null } } } };

export type CreateUploadSessionMutationVariables = Exact<{
  type: UploadSessionType;
}>;


export type CreateUploadSessionMutation = { __typename?: 'RootMutation', uploadSession: { __typename?: 'UploadSession', createUploadSession: any } };

export type CreateWebhookMutationVariables = Exact<{
  appId: Scalars['String']['input'];
  webhookInput: WebhookInput;
}>;


export type CreateWebhookMutation = { __typename?: 'RootMutation', webhook: { __typename?: 'WebhookMutation', createWebhook: { __typename?: 'Webhook', id: string, event: WebhookType, url: string, createdAt: any, updatedAt: any } } };

export type UpdateWebhookMutationVariables = Exact<{
  webhookId: Scalars['ID']['input'];
  webhookInput: WebhookInput;
}>;


export type UpdateWebhookMutation = { __typename?: 'RootMutation', webhook: { __typename?: 'WebhookMutation', updateWebhook: { __typename?: 'Webhook', id: string, event: WebhookType, url: string, createdAt: any, updatedAt: any } } };

export type DeleteWebhookMutationVariables = Exact<{
  webhookId: Scalars['ID']['input'];
}>;


export type DeleteWebhookMutation = { __typename?: 'RootMutation', webhook: { __typename?: 'WebhookMutation', deleteWebhook: { __typename?: 'DeleteWebhookResult', id: string } } };

export type AppByIdQueryVariables = Exact<{
  appId: Scalars['String']['input'];
}>;


export type AppByIdQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } } } };

export type AppByFullNameQueryVariables = Exact<{
  fullName: Scalars['String']['input'];
}>;


export type AppByFullNameQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byFullName: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } } } };

export type LatestAppVersionQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  platform: AppPlatform;
  applicationIdentifier: Scalars['String']['input'];
}>;


export type LatestAppVersionQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, latestAppVersionByPlatformAndApplicationIdentifier?: { __typename?: 'AppVersion', id: string, storeVersion: string, buildVersion: string } | null } } };

export type ViewBranchQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  name: Scalars['String']['input'];
}>;


export type ViewBranchQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateBranchByName?: { __typename?: 'UpdateBranch', id: string, name: string } | null } } };

export type BranchesByAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
}>;


export type BranchesByAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateBranches: Array<{ __typename?: 'UpdateBranch', id: string, name: string, updates: Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }> }> } } };

export type BranchesBasicPaginatedOnAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
}>;


export type BranchesBasicPaginatedOnAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, branchesPaginated: { __typename?: 'AppBranchesConnection', edges: Array<{ __typename?: 'AppBranchEdge', cursor: string, node: { __typename?: 'UpdateBranch', id: string, name: string } }>, pageInfo: { __typename?: 'PageInfo', hasNextPage: boolean, hasPreviousPage: boolean, startCursor?: string | null, endCursor?: string | null } } } } };

export type ViewBranchesOnUpdateChannelQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  channelName: Scalars['String']['input'];
  offset: Scalars['Int']['input'];
  limit: Scalars['Int']['input'];
}>;


export type ViewBranchesOnUpdateChannelQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateChannelByName?: { __typename?: 'UpdateChannel', id: string, updateBranches: Array<{ __typename?: 'UpdateBranch', id: string, name: string, updateGroups: Array<Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }>> }> } | null } } };

export type BuildsByIdQueryVariables = Exact<{
  buildId: Scalars['ID']['input'];
}>;


export type BuildsByIdQuery = { __typename?: 'RootQuery', builds: { __typename?: 'BuildQuery', byId: { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } } } };

export type BuildsWithSubmissionsByIdQueryVariables = Exact<{
  buildId: Scalars['ID']['input'];
}>;


export type BuildsWithSubmissionsByIdQuery = { __typename?: 'RootQuery', builds: { __typename?: 'BuildQuery', byId: { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, submissions: Array<{ __typename?: 'Submission', id: string, status: SubmissionStatus, platform: AppPlatform, logsUrl?: string | null, app: { __typename?: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } }, androidConfig?: { __typename?: 'AndroidSubmissionConfig', applicationIdentifier?: string | null, track: SubmissionAndroidTrack, releaseStatus?: SubmissionAndroidReleaseStatus | null, rollout?: number | null } | null, iosConfig?: { __typename?: 'IosSubmissionConfig', ascAppIdentifier: string, appleIdUsername?: string | null } | null, error?: { __typename?: 'SubmissionError', errorCode?: string | null, message?: string | null } | null }>, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } } } };

export type ViewBuildsOnAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  offset: Scalars['Int']['input'];
  limit: Scalars['Int']['input'];
  filter?: InputMaybe<BuildFilter>;
}>;


export type ViewBuildsOnAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, builds: Array<{ __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } }> } } };

export type ViewUpdateChannelOnAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  channelName: Scalars['String']['input'];
  filter?: InputMaybe<UpdatesFilter>;
}>;


export type ViewUpdateChannelOnAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateChannelByName?: { __typename?: 'UpdateChannel', id: string, name: string, updatedAt: any, createdAt: any, branchMapping: string, updateBranches: Array<{ __typename?: 'UpdateBranch', id: string, name: string, updateGroups: Array<Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }>> }> } | null } } };

export type ViewUpdateChannelsOnAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  offset: Scalars['Int']['input'];
  limit: Scalars['Int']['input'];
}>;


export type ViewUpdateChannelsOnAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateChannels: Array<{ __typename?: 'UpdateChannel', id: string, name: string, updatedAt: any, createdAt: any, branchMapping: string, updateBranches: Array<{ __typename?: 'UpdateBranch', id: string, name: string, updateGroups: Array<Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }>> }> }> } } };

export type ViewUpdateChannelsPaginatedOnAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
}>;


export type ViewUpdateChannelsPaginatedOnAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, channelsPaginated: { __typename?: 'AppChannelsConnection', edges: Array<{ __typename?: 'AppChannelEdge', cursor: string, node: { __typename?: 'UpdateChannel', id: string, name: string, branchMapping: string } }>, pageInfo: { __typename?: 'PageInfo', hasNextPage: boolean, hasPreviousPage: boolean, startCursor?: string | null, endCursor?: string | null } } } } };

export type EnvironmentSecretsByAppIdQueryVariables = Exact<{
  appId: Scalars['String']['input'];
}>;


export type EnvironmentSecretsByAppIdQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, ownerAccount: { __typename?: 'Account', id: string, environmentSecrets: Array<{ __typename?: 'EnvironmentSecret', id: string, name: string, type: EnvironmentSecretType, createdAt: any }> }, environmentSecrets: Array<{ __typename?: 'EnvironmentSecret', id: string, name: string, type: EnvironmentSecretType, createdAt: any }> } } };

export type GetAssetMetadataQueryVariables = Exact<{
  storageKeys: Array<Scalars['String']['input']> | Scalars['String']['input'];
}>;


export type GetAssetMetadataQuery = { __typename?: 'RootQuery', asset: { __typename?: 'AssetQuery', metadata: Array<{ __typename?: 'AssetMetadataResult', storageKey: string, status: AssetMetadataStatus }> } };

export type GetAssetLimitPerUpdateGroupForAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
}>;


export type GetAssetLimitPerUpdateGroupForAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, assetLimitPerUpdateGroup: number } } };

export type ViewRuntimesOnBranchQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  name: Scalars['String']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<RuntimeFilterInput>;
}>;


export type ViewRuntimesOnBranchQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateBranchByName?: { __typename?: 'UpdateBranch', id: string, runtimes: { __typename?: 'RuntimesConnection', edges: Array<{ __typename?: 'RuntimeEdge', cursor: string, node: { __typename?: 'Runtime', id: string, version: string } }>, pageInfo: { __typename?: 'PageInfo', hasNextPage: boolean, hasPreviousPage: boolean, startCursor?: string | null, endCursor?: string | null } } } | null } } };

export type StatuspageServiceByServiceNamesQueryVariables = Exact<{
  serviceNames: Array<StatuspageServiceName> | StatuspageServiceName;
}>;


export type StatuspageServiceByServiceNamesQuery = { __typename?: 'RootQuery', statuspageService: { __typename?: 'StatuspageServiceQuery', byServiceNames: Array<{ __typename?: 'StatuspageService', id: string, name: StatuspageServiceName, status: StatuspageServiceStatus, incidents: Array<{ __typename?: 'StatuspageIncident', id: string, status: StatuspageIncidentStatus, name: string, impact: StatuspageIncidentImpact, shortlink: string }> }> } };

export type SubmissionsByIdQueryVariables = Exact<{
  submissionId: Scalars['ID']['input'];
}>;


export type SubmissionsByIdQuery = { __typename?: 'RootQuery', submissions: { __typename?: 'SubmissionQuery', byId: { __typename?: 'Submission', id: string, status: SubmissionStatus, platform: AppPlatform, logsUrl?: string | null, app: { __typename?: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } }, androidConfig?: { __typename?: 'AndroidSubmissionConfig', applicationIdentifier?: string | null, track: SubmissionAndroidTrack, releaseStatus?: SubmissionAndroidReleaseStatus | null, rollout?: number | null } | null, iosConfig?: { __typename?: 'IosSubmissionConfig', ascAppIdentifier: string, appleIdUsername?: string | null } | null, error?: { __typename?: 'SubmissionError', errorCode?: string | null, message?: string | null } | null } } };

export type GetAllSubmissionsForAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  offset: Scalars['Int']['input'];
  limit: Scalars['Int']['input'];
  status?: InputMaybe<SubmissionStatus>;
  platform?: InputMaybe<AppPlatform>;
}>;


export type GetAllSubmissionsForAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, submissions: Array<{ __typename?: 'Submission', id: string, status: SubmissionStatus, platform: AppPlatform, logsUrl?: string | null, app: { __typename?: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } }, androidConfig?: { __typename?: 'AndroidSubmissionConfig', applicationIdentifier?: string | null, track: SubmissionAndroidTrack, releaseStatus?: SubmissionAndroidReleaseStatus | null, rollout?: number | null } | null, iosConfig?: { __typename?: 'IosSubmissionConfig', ascAppIdentifier: string, appleIdUsername?: string | null } | null, error?: { __typename?: 'SubmissionError', errorCode?: string | null, message?: string | null } | null }> } } };

export type ViewUpdatesByGroupQueryVariables = Exact<{
  groupId: Scalars['ID']['input'];
}>;


export type ViewUpdatesByGroupQuery = { __typename?: 'RootQuery', updatesByGroup: Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }> };

export type ViewUpdateGroupsOnBranchQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  branchName: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  filter?: InputMaybe<UpdatesFilter>;
}>;


export type ViewUpdateGroupsOnBranchQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateBranchByName?: { __typename?: 'UpdateBranch', id: string, updateGroups: Array<Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }>> } | null } } };

export type ViewUpdateGroupsOnAppQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  filter?: InputMaybe<UpdatesFilter>;
}>;


export type ViewUpdateGroupsOnAppQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, updateGroups: Array<Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }>> } } };

export type CurrentUserQueryVariables = Exact<{ [key: string]: never; }>;


export type CurrentUserQuery = { __typename?: 'RootQuery', meActor?: { __typename: 'Robot', firstName?: string | null, id: string, featureGates: any, isExpoAdmin: boolean, accounts: Array<{ __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> }> } | { __typename: 'SSOUser', username: string, id: string, featureGates: any, isExpoAdmin: boolean, primaryAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> }, accounts: Array<{ __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> }> } | { __typename: 'User', username: string, id: string, featureGates: any, isExpoAdmin: boolean, primaryAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> }, accounts: Array<{ __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> }> } | null };

export type WebhooksByAppIdQueryVariables = Exact<{
  appId: Scalars['String']['input'];
  webhookFilter?: InputMaybe<WebhookFilter>;
}>;


export type WebhooksByAppIdQuery = { __typename?: 'RootQuery', app: { __typename?: 'AppQuery', byId: { __typename?: 'App', id: string, webhooks: Array<{ __typename?: 'Webhook', id: string, event: WebhookType, url: string, createdAt: any, updatedAt: any }> } } };

export type WebhookByIdQueryVariables = Exact<{
  webhookId: Scalars['ID']['input'];
}>;


export type WebhookByIdQuery = { __typename?: 'RootQuery', webhook: { __typename?: 'WebhookQuery', byId: { __typename?: 'Webhook', id: string, event: WebhookType, url: string, createdAt: any, updatedAt: any } } };

export type AccountFragment = { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> };

export type AppFragment = { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } };

export type BuildFragment = { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } };

export type BuildWithSubmissionsFragment = { __typename?: 'Build', id: string, status: BuildStatus, platform: AppPlatform, channel?: string | null, releaseChannel?: string | null, distribution?: DistributionType | null, iosEnterpriseProvisioning?: BuildIosEnterpriseProvisioning | null, buildProfile?: string | null, sdkVersion?: string | null, appVersion?: string | null, appBuildVersion?: string | null, runtimeVersion?: string | null, gitCommitHash?: string | null, gitCommitMessage?: string | null, initialQueuePosition?: number | null, queuePosition?: number | null, estimatedWaitTimeLeftSeconds?: number | null, priority: BuildPriority, createdAt: any, updatedAt: any, message?: string | null, completedAt?: any | null, expirationDate?: any | null, isForIosSimulator: boolean, submissions: Array<{ __typename?: 'Submission', id: string, status: SubmissionStatus, platform: AppPlatform, logsUrl?: string | null, app: { __typename?: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } }, androidConfig?: { __typename?: 'AndroidSubmissionConfig', applicationIdentifier?: string | null, track: SubmissionAndroidTrack, releaseStatus?: SubmissionAndroidReleaseStatus | null, rollout?: number | null } | null, iosConfig?: { __typename?: 'IosSubmissionConfig', ascAppIdentifier: string, appleIdUsername?: string | null } | null, error?: { __typename?: 'SubmissionError', errorCode?: string | null, message?: string | null } | null }>, error?: { __typename?: 'BuildError', errorCode: string, message: string, docsUrl?: string | null } | null, artifacts?: { __typename?: 'BuildArtifacts', buildUrl?: string | null, xcodeBuildLogsUrl?: string | null, applicationArchiveUrl?: string | null, buildArtifactsUrl?: string | null } | null, initiatingActor?: { __typename: 'Robot', id: string, displayName: string } | { __typename: 'SSOUser', id: string, displayName: string } | { __typename: 'User', id: string, displayName: string } | null, project: { __typename: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } } | { __typename: 'Snack', id: string, name: string, slug: string } };

export type EnvironmentSecretFragment = { __typename?: 'EnvironmentSecret', id: string, name: string, type: EnvironmentSecretType, createdAt: any };

export type RuntimeFragment = { __typename?: 'Runtime', id: string, version: string };

export type StatuspageServiceFragment = { __typename?: 'StatuspageService', id: string, name: StatuspageServiceName, status: StatuspageServiceStatus, incidents: Array<{ __typename?: 'StatuspageIncident', id: string, status: StatuspageIncidentStatus, name: string, impact: StatuspageIncidentImpact, shortlink: string }> };

export type SubmissionFragment = { __typename?: 'Submission', id: string, status: SubmissionStatus, platform: AppPlatform, logsUrl?: string | null, app: { __typename?: 'App', id: string, name: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string } }, androidConfig?: { __typename?: 'AndroidSubmissionConfig', applicationIdentifier?: string | null, track: SubmissionAndroidTrack, releaseStatus?: SubmissionAndroidReleaseStatus | null, rollout?: number | null } | null, iosConfig?: { __typename?: 'IosSubmissionConfig', ascAppIdentifier: string, appleIdUsername?: string | null } | null, error?: { __typename?: 'SubmissionError', errorCode?: string | null, message?: string | null } | null };

export type UpdateFragment = { __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null };

export type UpdateBranchFragment = { __typename?: 'UpdateBranch', id: string, name: string, updates: Array<{ __typename?: 'Update', id: string, group: string, message?: string | null, createdAt: any, runtimeVersion: string, platform: string, manifestFragment: string, isRollBackToEmbedded: boolean, manifestPermalink: string, gitCommitHash?: string | null, actor?: { __typename: 'Robot', firstName?: string | null, id: string } | { __typename: 'SSOUser', username: string, id: string } | { __typename: 'User', username: string, id: string } | null, branch: { __typename?: 'UpdateBranch', id: string, name: string }, codeSigningInfo?: { __typename?: 'CodeSigningInfo', keyid: string, sig: string, alg: string } | null }> };

export type UpdateBranchBasicInfoFragment = { __typename?: 'UpdateBranch', id: string, name: string };

export type UpdateChannelBasicInfoFragment = { __typename?: 'UpdateChannel', id: string, name: string, branchMapping: string };

export type WebhookFragment = { __typename?: 'Webhook', id: string, event: WebhookType, url: string, createdAt: any, updatedAt: any };

export type AndroidAppBuildCredentialsFragment = { __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null };

export type CommonAndroidAppCredentialsFragment = { __typename?: 'AndroidAppCredentials', id: string, applicationIdentifier?: string | null, isLegacy: boolean, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, androidFcm?: { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } } | null, googleServiceAccountKeyForFcmV1?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, googleServiceAccountKeyForSubmissions?: { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any } | null, androidAppBuildCredentialsList: Array<{ __typename?: 'AndroidAppBuildCredentials', id: string, isDefault: boolean, isLegacy: boolean, name: string, androidKeystore?: { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any } | null }> };

export type AndroidFcmFragment = { __typename?: 'AndroidFcm', id: string, credential: any, version: AndroidFcmVersion, createdAt: any, updatedAt: any, snippet: { __typename?: 'FcmSnippetLegacy', firstFourCharacters: string, lastFourCharacters: string } | { __typename?: 'FcmSnippetV1', projectId: string, keyId: string, serviceAccountEmail: string, clientId?: string | null } };

export type AndroidKeystoreFragment = { __typename?: 'AndroidKeystore', id: string, type: AndroidKeystoreType, keystore: string, keystorePassword: string, keyAlias: string, keyPassword?: string | null, md5CertificateFingerprint?: string | null, sha1CertificateFingerprint?: string | null, sha256CertificateFingerprint?: string | null, createdAt: any, updatedAt: any };

export type AppStoreConnectApiKeyFragment = { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null };

export type AppleAppIdentifierFragment = { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string };

export type AppleDeviceFragment = { __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any };

export type AppleDeviceRegistrationRequestFragment = { __typename?: 'AppleDeviceRegistrationRequest', id: string };

export type AppleDistributionCertificateFragment = { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> };

export type AppleProvisioningProfileFragment = { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> };

export type AppleProvisioningProfileIdentifiersFragment = { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null };

export type ApplePushKeyFragment = { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> };

export type AppleTeamFragment = { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null };

export type GoogleServiceAccountKeyFragment = { __typename?: 'GoogleServiceAccountKey', id: string, projectIdentifier: string, privateKeyIdentifier: string, clientEmail: string, clientIdentifier: string, createdAt: any, updatedAt: any };

export type IosAppBuildCredentialsFragment = { __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null };

export type CommonIosAppCredentialsWithoutBuildCredentialsFragment = { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }, pushKey?: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } | null, appStoreConnectApiKeyForSubmissions?: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } | null };

export type CommonIosAppCredentialsFragment = { __typename?: 'IosAppCredentials', id: string, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosDistributionType: IosDistributionType, distributionCertificate?: { __typename?: 'AppleDistributionCertificate', id: string, certificateP12?: string | null, certificatePassword?: string | null, serialNumber: string, developerPortalIdentifier?: string | null, validityNotBefore: any, validityNotAfter: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppBuildCredentialsList: Array<{ __typename?: 'IosAppBuildCredentials', id: string, iosAppCredentials: { __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, developerPortalIdentifier?: string | null } | null }> } | null, provisioningProfile?: { __typename?: 'AppleProvisioningProfile', id: string, expiration: any, developerPortalIdentifier?: string | null, provisioningProfile?: string | null, updatedAt: any, status: string, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleDevices: Array<{ __typename?: 'AppleDevice', id: string, identifier: string, name?: string | null, model?: string | null, deviceClass?: AppleDeviceClass | null, createdAt: any }> } | null }>, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string }, pushKey?: { __typename?: 'ApplePushKey', id: string, keyIdentifier: string, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null, iosAppCredentialsList: Array<{ __typename?: 'IosAppCredentials', id: string, app: { __typename?: 'App', id: string, fullName: string, slug: string, ownerAccount: { __typename?: 'Account', id: string, name: string, ownerUserActor?: { __typename?: 'SSOUser', id: string, username: string } | { __typename?: 'User', id: string, username: string } | null, users: Array<{ __typename?: 'UserPermission', role: Role, actor: { __typename?: 'Robot', id: string } | { __typename?: 'SSOUser', id: string } | { __typename?: 'User', id: string } }> } }, appleAppIdentifier: { __typename?: 'AppleAppIdentifier', id: string, bundleIdentifier: string } }> } | null, appStoreConnectApiKeyForSubmissions?: { __typename?: 'AppStoreConnectApiKey', id: string, issuerIdentifier: string, keyIdentifier: string, name?: string | null, roles?: Array<AppStoreConnectUserRole> | null, createdAt: any, updatedAt: any, appleTeam?: { __typename?: 'AppleTeam', id: string, appleTeamIdentifier: string, appleTeamName?: string | null } | null } | null };
