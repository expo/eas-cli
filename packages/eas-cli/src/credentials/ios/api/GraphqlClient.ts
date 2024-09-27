import { UserRole } from '@expo/apple-utils';
import nullthrows from 'nullthrows';

import { AppStoreConnectApiKeyMutation } from './graphql/mutations/AppStoreConnectApiKeyMutation';
import { AppleAppIdentifierMutation } from './graphql/mutations/AppleAppIdentifierMutation';
import {
  AppleDistributionCertificateMutation,
  AppleDistributionCertificateMutationResult,
} from './graphql/mutations/AppleDistributionCertificateMutation';
import {
  AppleProvisioningProfileMutation,
  AppleProvisioningProfileMutationResult,
} from './graphql/mutations/AppleProvisioningProfileMutation';
import { ApplePushKeyMutation } from './graphql/mutations/ApplePushKeyMutation';
import { AppleTeamMutation } from './graphql/mutations/AppleTeamMutation';
import { IosAppBuildCredentialsMutation } from './graphql/mutations/IosAppBuildCredentialsMutation';
import { IosAppCredentialsMutation } from './graphql/mutations/IosAppCredentialsMutation';
import { AppStoreConnectApiKeyQuery } from './graphql/queries/AppStoreConnectApiKeyQuery';
import { AppleAppIdentifierQuery } from './graphql/queries/AppleAppIdentifierQuery';
import { AppleDeviceQuery } from './graphql/queries/AppleDeviceQuery';
import { AppleDistributionCertificateQuery } from './graphql/queries/AppleDistributionCertificateQuery';
import {
  AppleProvisioningProfileQuery,
  AppleProvisioningProfileQueryResult,
} from './graphql/queries/AppleProvisioningProfileQuery';
import { ApplePushKeyQuery } from './graphql/queries/ApplePushKeyQuery';
import { AppleTeamQuery } from './graphql/queries/AppleTeamQuery';
import { IosAppCredentialsQuery } from './graphql/queries/IosAppCredentialsQuery';
import { AppLookupParams } from './graphql/types/AppLookupParams';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AccountFragment,
  AppFragment,
  AppStoreConnectApiKeyFragment,
  AppStoreConnectUserRole,
  AppleAppIdentifierFragment,
  AppleDeviceFragment,
  AppleDistributionCertificateFragment,
  ApplePushKeyFragment,
  AppleTeamFragment,
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { isWildcardBundleIdentifier } from '../../../project/ios/bundleIdentifier';
import { DistributionCertificate, PushKey } from '../appstore/Credentials.types';
import { MinimalAscApiKey } from '../credentials';
import { AppleTeamMissingError } from '../errors';

async function getAppAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<AppFragment> {
  const projectFullName = formatProjectFullName(appLookupParams);
  return await AppQuery.byFullNameAsync(graphqlClient, projectFullName);
}

export async function createOrUpdateIosAppBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  {
    appleTeam,
    appleAppIdentifierId,
    iosDistributionType,
    appleProvisioningProfileId,
    appleDistributionCertificateId,
  }: {
    appleTeam: AppleTeamFragment;
    appleAppIdentifierId: string;
    iosDistributionType: IosDistributionType;
    appleProvisioningProfileId: string;
    appleDistributionCertificateId: string;
  }
): Promise<IosAppBuildCredentialsFragment> {
  const iosAppCredentials = await createOrGetExistingIosAppCredentialsWithBuildCredentialsAsync(
    graphqlClient,
    appLookupParams,
    {
      appleTeam,
      appleAppIdentifierId,
      iosDistributionType,
    }
  );
  const iosAppBuildCredentials = iosAppCredentials.iosAppBuildCredentialsList?.[0];
  if (!iosAppBuildCredentials) {
    return await IosAppBuildCredentialsMutation.createIosAppBuildCredentialsAsync(
      graphqlClient,
      {
        iosDistributionType,
        distributionCertificateId: appleDistributionCertificateId,
        provisioningProfileId: appleProvisioningProfileId,
      },
      iosAppCredentials.id
    );
  } else {
    await IosAppBuildCredentialsMutation.setDistributionCertificateAsync(
      graphqlClient,
      iosAppBuildCredentials.id,
      appleDistributionCertificateId
    );
    return await IosAppBuildCredentialsMutation.setProvisioningProfileAsync(
      graphqlClient,
      iosAppBuildCredentials.id,
      appleProvisioningProfileId
    );
  }
}

export async function getIosAppCredentialsWithBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  { iosDistributionType }: { iosDistributionType?: IosDistributionType }
): Promise<CommonIosAppCredentialsFragment | null> {
  const { account, bundleIdentifier } = appLookupParams;
  const appleAppIdentifier = await AppleAppIdentifierQuery.byBundleIdentifierAsync(
    graphqlClient,
    account.name,
    bundleIdentifier
  );
  if (!appleAppIdentifier) {
    return null;
  }
  const projectFullName = formatProjectFullName(appLookupParams);
  return await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(
    graphqlClient,
    projectFullName,
    {
      appleAppIdentifierId: appleAppIdentifier.id,
      iosDistributionType,
    }
  );
}

export async function getIosAppCredentialsWithCommonFieldsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<CommonIosAppCredentialsFragment | null> {
  const { account, bundleIdentifier } = appLookupParams;
  const appleAppIdentifier = await AppleAppIdentifierQuery.byBundleIdentifierAsync(
    graphqlClient,
    account.name,
    bundleIdentifier
  );
  if (!appleAppIdentifier) {
    return null;
  }
  const projectFullName = formatProjectFullName(appLookupParams);
  return await IosAppCredentialsQuery.withCommonFieldsByAppIdentifierIdAsync(
    graphqlClient,
    projectFullName,
    {
      appleAppIdentifierId: appleAppIdentifier.id,
    }
  );
}

export async function createOrGetIosAppCredentialsWithCommonFieldsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  {
    appleTeam,
  }: {
    appleTeam?: AppleTeamFragment;
  }
): Promise<CommonIosAppCredentialsFragment> {
  const maybeIosAppCredentials = await getIosAppCredentialsWithCommonFieldsAsync(
    graphqlClient,
    appLookupParams
  );
  if (maybeIosAppCredentials) {
    return maybeIosAppCredentials;
  }
  const [app, appleAppIdentifier] = await Promise.all([
    getAppAsync(graphqlClient, appLookupParams),
    createOrGetExistingAppleAppIdentifierAsync(graphqlClient, appLookupParams, appleTeam ?? null),
  ]);
  return await IosAppCredentialsMutation.createIosAppCredentialsAsync(
    graphqlClient,
    { appleTeamId: appleTeam?.id },
    app.id,
    appleAppIdentifier.id
  );
}

export async function updateIosAppCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appCredentials: CommonIosAppCredentialsFragment,
  {
    applePushKeyId,
    ascApiKeyIdForSubmissions,
  }: {
    applePushKeyId?: string;
    ascApiKeyIdForSubmissions?: string;
  }
): Promise<CommonIosAppCredentialsFragment> {
  let updatedAppCredentials = appCredentials;
  if (applePushKeyId) {
    updatedAppCredentials = await IosAppCredentialsMutation.setPushKeyAsync(
      graphqlClient,
      updatedAppCredentials.id,
      applePushKeyId
    );
  }
  if (ascApiKeyIdForSubmissions) {
    updatedAppCredentials =
      await IosAppCredentialsMutation.setAppStoreConnectApiKeyForSubmissionsAsync(
        graphqlClient,
        updatedAppCredentials.id,
        ascApiKeyIdForSubmissions
      );
  }
  return updatedAppCredentials;
}

async function createOrGetExistingIosAppCredentialsWithBuildCredentialsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  {
    appleTeam,
    appleAppIdentifierId,
    iosDistributionType,
  }: {
    appleTeam?: AppleTeamFragment;
    appleAppIdentifierId: string;
    iosDistributionType: IosDistributionType;
  }
): Promise<CommonIosAppCredentialsFragment> {
  const maybeIosAppCredentials = await getIosAppCredentialsWithBuildCredentialsAsync(
    graphqlClient,
    appLookupParams,
    {
      iosDistributionType,
    }
  );
  if (maybeIosAppCredentials) {
    return maybeIosAppCredentials;
  } else {
    const [app, appleAppIdentifier] = await Promise.all([
      getAppAsync(graphqlClient, appLookupParams),
      createOrGetExistingAppleAppIdentifierAsync(graphqlClient, appLookupParams, appleTeam ?? null),
    ]);
    await IosAppCredentialsMutation.createIosAppCredentialsAsync(
      graphqlClient,
      { appleTeamId: appleTeam?.id },
      app.id,
      appleAppIdentifier.id
    );
    const projectFullName = formatProjectFullName(appLookupParams);
    return nullthrows(
      await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(
        graphqlClient,
        projectFullName,
        {
          appleAppIdentifierId,
          iosDistributionType,
        }
      )
    );
  }
}

export async function createOrGetExistingAppleTeamAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment,
  { appleTeamIdentifier, appleTeamName }: { appleTeamIdentifier: string; appleTeamName?: string }
): Promise<AppleTeamFragment> {
  const appleTeam = await AppleTeamQuery.getByAppleTeamIdentifierAsync(
    graphqlClient,
    account.id,
    appleTeamIdentifier
  );
  if (appleTeam) {
    return appleTeam;
  } else {
    return await AppleTeamMutation.createAppleTeamAsync(
      graphqlClient,
      { appleTeamIdentifier, appleTeamName },
      account.id
    );
  }
}

export async function createOrGetExistingAppleAppIdentifierAsync(
  graphqlClient: ExpoGraphqlClient,
  { account, projectName, bundleIdentifier, parentBundleIdentifier }: AppLookupParams,
  appleTeam: AppleTeamFragment | null
): Promise<AppleAppIdentifierFragment> {
  const appleAppIdentifier = await AppleAppIdentifierQuery.byBundleIdentifierAsync(
    graphqlClient,
    account.name,
    bundleIdentifier
  );
  if (appleAppIdentifier) {
    return appleAppIdentifier;
  } else {
    if (isWildcardBundleIdentifier(bundleIdentifier) && !appleTeam) {
      throw new AppleTeamMissingError(
        `An Apple Team is required for wildcard bundle identifier: ${bundleIdentifier}`
      );
    }
    const parentAppleAppIdentifier = parentBundleIdentifier
      ? await createOrGetExistingAppleAppIdentifierAsync(
          graphqlClient,
          { account, projectName, bundleIdentifier: parentBundleIdentifier },
          appleTeam
        )
      : null;
    return await AppleAppIdentifierMutation.createAppleAppIdentifierAsync(
      graphqlClient,
      {
        bundleIdentifier,
        appleTeamId: appleTeam?.id,
        parentAppleAppId: parentAppleAppIdentifier?.id,
      },
      account.id
    );
  }
}

export async function getDevicesForAppleTeamAsync(
  graphqlClient: ExpoGraphqlClient,
  { account }: AppLookupParams,
  { appleTeamIdentifier }: AppleTeamFragment,
  { useCache = true }: { useCache?: boolean } = {}
): Promise<AppleDeviceFragment[]> {
  return await AppleDeviceQuery.getAllByAppleTeamIdentifierAsync(
    graphqlClient,
    account.name,
    appleTeamIdentifier,
    {
      useCache,
    }
  );
}

export async function createProvisioningProfileAsync(
  graphqlClient: ExpoGraphqlClient,
  { account }: AppLookupParams,
  appleAppIdentifier: AppleAppIdentifierFragment,
  appleProvisioningProfileInput: {
    appleProvisioningProfile: string;
    developerPortalIdentifier?: string;
  }
): Promise<AppleProvisioningProfileMutationResult> {
  return await AppleProvisioningProfileMutation.createAppleProvisioningProfileAsync(
    graphqlClient,
    appleProvisioningProfileInput,
    account.id,
    appleAppIdentifier.id
  );
}

export async function getProvisioningProfileAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  iosDistributionType: IosDistributionType,
  { appleTeam }: { appleTeam: AppleTeamFragment | null } = { appleTeam: null }
): Promise<AppleProvisioningProfileQueryResult | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  const appleAppIdentifier = await createOrGetExistingAppleAppIdentifierAsync(
    graphqlClient,
    appLookupParams,
    appleTeam
  );
  return await AppleProvisioningProfileQuery.getForAppAsync(graphqlClient, projectFullName, {
    appleAppIdentifierId: appleAppIdentifier.id,
    iosDistributionType,
  });
}

export async function updateProvisioningProfileAsync(
  graphqlClient: ExpoGraphqlClient,
  appleProvisioningProfileId: string,
  appleProvisioningProfileInput: {
    appleProvisioningProfile: string;
    developerPortalIdentifier?: string;
  }
): Promise<AppleProvisioningProfileMutationResult> {
  return await AppleProvisioningProfileMutation.updateAppleProvisioningProfileAsync(
    graphqlClient,
    appleProvisioningProfileId,
    appleProvisioningProfileInput
  );
}

export async function deleteProvisioningProfilesAsync(
  graphqlClient: ExpoGraphqlClient,
  appleProvisioningProfileIds: string[]
): Promise<void> {
  await AppleProvisioningProfileMutation.deleteAppleProvisioningProfilesAsync(
    graphqlClient,
    appleProvisioningProfileIds
  );
}

export async function getDistributionCertificateForAppAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams,
  iosDistributionType: IosDistributionType,
  { appleTeam }: { appleTeam: AppleTeamFragment | null } = { appleTeam: null }
): Promise<AppleDistributionCertificateFragment | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  const appleAppIdentifier = await createOrGetExistingAppleAppIdentifierAsync(
    graphqlClient,
    appLookupParams,
    appleTeam
  );
  return await AppleDistributionCertificateQuery.getForAppAsync(graphqlClient, projectFullName, {
    appleAppIdentifierId: appleAppIdentifier.id,
    iosDistributionType,
  });
}

export async function getDistributionCertificatesForAccountAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment
): Promise<AppleDistributionCertificateFragment[]> {
  return await AppleDistributionCertificateQuery.getAllForAccountAsync(graphqlClient, account.name);
}

export async function createDistributionCertificateAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment,
  distCert: DistributionCertificate
): Promise<AppleDistributionCertificateMutationResult> {
  const appleTeam = await createOrGetExistingAppleTeamAsync(graphqlClient, account, {
    appleTeamIdentifier: distCert.teamId,
    appleTeamName: distCert.teamName,
  });
  return await AppleDistributionCertificateMutation.createAppleDistributionCertificateAsync(
    graphqlClient,
    {
      certP12: distCert.certP12,
      certPassword: distCert.certPassword,
      certPrivateSigningKey: distCert.certPrivateSigningKey,
      developerPortalIdentifier: distCert.certId,
      appleTeamId: appleTeam.id,
    },
    account.id
  );
}

export async function deleteDistributionCertificateAsync(
  graphqlClient: ExpoGraphqlClient,
  distributionCertificateId: string
): Promise<void> {
  await AppleDistributionCertificateMutation.deleteAppleDistributionCertificateAsync(
    graphqlClient,
    distributionCertificateId
  );
}

export async function createPushKeyAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment,
  pushKey: PushKey
): Promise<ApplePushKeyFragment> {
  const appleTeam = await createOrGetExistingAppleTeamAsync(graphqlClient, account, {
    appleTeamIdentifier: pushKey.teamId,
    appleTeamName: pushKey.teamName,
  });
  return await ApplePushKeyMutation.createApplePushKeyAsync(
    graphqlClient,
    {
      keyP8: pushKey.apnsKeyP8,
      keyIdentifier: pushKey.apnsKeyId,
      appleTeamId: appleTeam.id,
    },
    account.id
  );
}

export async function getPushKeysForAccountAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment
): Promise<ApplePushKeyFragment[]> {
  return await ApplePushKeyQuery.getAllForAccountAsync(graphqlClient, account.name);
}

export async function getPushKeyForAppAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<ApplePushKeyFragment | null> {
  const maybeIosAppCredentials = await getIosAppCredentialsWithCommonFieldsAsync(
    graphqlClient,
    appLookupParams
  );
  return maybeIosAppCredentials?.pushKey ?? null;
}

export async function deletePushKeyAsync(
  graphqlClient: ExpoGraphqlClient,
  pushKeyId: string
): Promise<void> {
  await ApplePushKeyMutation.deleteApplePushKeyAsync(graphqlClient, pushKeyId);
}

export async function createAscApiKeyAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment,
  ascApiKey: MinimalAscApiKey
): Promise<AppStoreConnectApiKeyFragment> {
  const maybeAppleTeam = ascApiKey.teamId
    ? await createOrGetExistingAppleTeamAsync(graphqlClient, account, {
        appleTeamIdentifier: ascApiKey.teamId,
        appleTeamName: ascApiKey.teamName,
      })
    : null;
  return await AppStoreConnectApiKeyMutation.createAppStoreConnectApiKeyAsync(
    graphqlClient,
    {
      issuerIdentifier: ascApiKey.issuerId,
      keyIdentifier: ascApiKey.keyId,
      keyP8: ascApiKey.keyP8,
      name: ascApiKey.name ?? null,
      roles: ascApiKey.roles?.map(role => convertUserRoleToGraphqlType(role)) ?? null,
      appleTeamId: maybeAppleTeam ? maybeAppleTeam.id : null,
    },
    account.id
  );
}

export async function getAscApiKeysForAccountAsync(
  graphqlClient: ExpoGraphqlClient,
  account: AccountFragment
): Promise<AppStoreConnectApiKeyFragment[]> {
  return await AppStoreConnectApiKeyQuery.getAllForAccountAsync(graphqlClient, account.name);
}

export async function getAscApiKeyForAppSubmissionsAsync(
  graphqlClient: ExpoGraphqlClient,
  appLookupParams: AppLookupParams
): Promise<AppStoreConnectApiKeyFragment | null> {
  const maybeIosAppCredentials = await getIosAppCredentialsWithCommonFieldsAsync(
    graphqlClient,
    appLookupParams
  );
  return maybeIosAppCredentials?.appStoreConnectApiKeyForSubmissions ?? null;
}

export async function deleteAscApiKeyAsync(
  graphqlClient: ExpoGraphqlClient,
  ascApiKeyId: string
): Promise<void> {
  await AppStoreConnectApiKeyMutation.deleteAppStoreConnectApiKeyAsync(graphqlClient, ascApiKeyId);
}

function convertUserRoleToGraphqlType(userRole: UserRole): AppStoreConnectUserRole {
  switch (userRole) {
    case UserRole.ADMIN:
      return AppStoreConnectUserRole.Admin;
    case UserRole.ACCESS_TO_REPORTS:
      return AppStoreConnectUserRole.AccessToReports;
    case UserRole.ACCOUNT_HOLDER:
      return AppStoreConnectUserRole.AccountHolder;
    case UserRole.APP_MANAGER:
      return AppStoreConnectUserRole.AppManager;
    case UserRole.CLOUD_MANAGED_APP_DISTRIBUTION:
      return AppStoreConnectUserRole.CloudManagedAppDistribution;
    case UserRole.CLOUD_MANAGED_DEVELOPER_ID:
      return AppStoreConnectUserRole.CloudManagedDeveloperId;
    case UserRole.CREATE_APPS:
      return AppStoreConnectUserRole.CreateApps;
    case UserRole.CUSTOMER_SUPPORT:
      return AppStoreConnectUserRole.CustomerSupport;
    case UserRole.DEVELOPER:
      return AppStoreConnectUserRole.Developer;
    case UserRole.FINANCE:
      return AppStoreConnectUserRole.Finance;
    case UserRole.MARKETING:
      return AppStoreConnectUserRole.Marketing;
    case UserRole.READ_ONLY:
      return AppStoreConnectUserRole.ReadOnly;
    case UserRole.SALES:
      return AppStoreConnectUserRole.Sales;
    case UserRole.TECHNICAL:
      return AppStoreConnectUserRole.Technical;
  }
}

const formatProjectFullName = ({ account, projectName }: AppLookupParams): string =>
  `@${account.name}/${projectName}`;
