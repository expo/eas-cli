import { UserRole } from '@expo/apple-utils';
import nullthrows from 'nullthrows';

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

async function getAppAsync(appLookupParams: AppLookupParams): Promise<AppFragment> {
  const projectFullName = formatProjectFullName(appLookupParams);
  return await AppQuery.byFullNameAsync(projectFullName);
}

export async function createOrUpdateIosAppBuildCredentialsAsync(
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
      {
        iosDistributionType,
        distributionCertificateId: appleDistributionCertificateId,
        provisioningProfileId: appleProvisioningProfileId,
      },
      iosAppCredentials.id
    );
  } else {
    await IosAppBuildCredentialsMutation.setDistributionCertificateAsync(
      iosAppBuildCredentials.id,
      appleDistributionCertificateId
    );
    return await IosAppBuildCredentialsMutation.setProvisioningProfileAsync(
      iosAppBuildCredentials.id,
      appleProvisioningProfileId
    );
  }
}

export async function getIosAppCredentialsWithBuildCredentialsAsync(
  appLookupParams: AppLookupParams,
  { iosDistributionType }: { iosDistributionType?: IosDistributionType }
): Promise<CommonIosAppCredentialsFragment | null> {
  const { account, bundleIdentifier } = appLookupParams;
  const appleAppIdentifier = await AppleAppIdentifierQuery.byBundleIdentifierAsync(
    account.name,
    bundleIdentifier
  );
  if (!appleAppIdentifier) {
    return null;
  }
  const projectFullName = formatProjectFullName(appLookupParams);
  return await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(projectFullName, {
    appleAppIdentifierId: appleAppIdentifier.id,
    iosDistributionType,
  });
}

export async function getIosAppCredentialsWithCommonFieldsAsync(
  appLookupParams: AppLookupParams
): Promise<CommonIosAppCredentialsFragment | null> {
  const { account, bundleIdentifier } = appLookupParams;
  const appleAppIdentifier = await AppleAppIdentifierQuery.byBundleIdentifierAsync(
    account.name,
    bundleIdentifier
  );
  if (!appleAppIdentifier) {
    return null;
  }
  const projectFullName = formatProjectFullName(appLookupParams);
  return await IosAppCredentialsQuery.withCommonFieldsByAppIdentifierIdAsync(projectFullName, {
    appleAppIdentifierId: appleAppIdentifier.id,
  });
}

export async function createOrGetIosAppCredentialsWithCommonFieldsAsync(
  appLookupParams: AppLookupParams,
  {
    appleTeam,
  }: {
    appleTeam?: AppleTeamFragment;
  }
): Promise<CommonIosAppCredentialsFragment> {
  const maybeIosAppCredentials = await getIosAppCredentialsWithCommonFieldsAsync(appLookupParams);
  if (maybeIosAppCredentials) {
    return maybeIosAppCredentials;
  }
  const [app, appleAppIdentifier] = await Promise.all([
    getAppAsync(appLookupParams),
    createOrGetExistingAppleAppIdentifierAsync(appLookupParams, appleTeam ?? null),
  ]);
  return await IosAppCredentialsMutation.createIosAppCredentialsAsync(
    { appleTeamId: appleTeam?.id },
    app.id,
    appleAppIdentifier.id
  );
}

export async function updateIosAppCredentialsAsync(
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
      updatedAppCredentials.id,
      applePushKeyId
    );
  }
  if (ascApiKeyIdForSubmissions) {
    updatedAppCredentials =
      await IosAppCredentialsMutation.setAppStoreConnectApiKeyForSubmissionsAsync(
        updatedAppCredentials.id,
        ascApiKeyIdForSubmissions
      );
  }
  return updatedAppCredentials;
}

async function createOrGetExistingIosAppCredentialsWithBuildCredentialsAsync(
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
    appLookupParams,
    {
      iosDistributionType,
    }
  );
  if (maybeIosAppCredentials) {
    return maybeIosAppCredentials;
  } else {
    const [app, appleAppIdentifier] = await Promise.all([
      getAppAsync(appLookupParams),
      createOrGetExistingAppleAppIdentifierAsync(appLookupParams, appleTeam ?? null),
    ]);
    await IosAppCredentialsMutation.createIosAppCredentialsAsync(
      { appleTeamId: appleTeam?.id },
      app.id,
      appleAppIdentifier.id
    );
    const projectFullName = formatProjectFullName(appLookupParams);
    return nullthrows(
      await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(projectFullName, {
        appleAppIdentifierId,
        iosDistributionType,
      })
    );
  }
}

export async function createOrGetExistingAppleTeamAsync(
  account: AccountFragment,
  { appleTeamIdentifier, appleTeamName }: { appleTeamIdentifier: string; appleTeamName?: string }
): Promise<AppleTeamFragment> {
  const appleTeam = await AppleTeamQuery.getByAppleTeamIdentifierAsync(
    account.id,
    appleTeamIdentifier
  );
  if (appleTeam) {
    return appleTeam;
  } else {
    return await AppleTeamMutation.createAppleTeamAsync(
      { appleTeamIdentifier, appleTeamName },
      account.id
    );
  }
}

export async function createOrGetExistingAppleAppIdentifierAsync(
  { account, projectName, bundleIdentifier, parentBundleIdentifier }: AppLookupParams,
  appleTeam: AppleTeamFragment | null
): Promise<AppleAppIdentifierFragment> {
  const appleAppIdentifier = await AppleAppIdentifierQuery.byBundleIdentifierAsync(
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
          { account, projectName, bundleIdentifier: parentBundleIdentifier },
          appleTeam
        )
      : null;
    return await AppleAppIdentifierMutation.createAppleAppIdentifierAsync(
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
  { account }: AppLookupParams,
  { appleTeamIdentifier }: AppleTeamFragment,
  { useCache = true }: { useCache?: boolean } = {}
): Promise<AppleDeviceFragment[]> {
  return await AppleDeviceQuery.getAllByAppleTeamIdentifierAsync(account.id, appleTeamIdentifier, {
    useCache,
  });
}

export async function createProvisioningProfileAsync(
  { account }: AppLookupParams,
  appleAppIdentifier: AppleAppIdentifierFragment,
  appleProvisioningProfileInput: {
    appleProvisioningProfile: string;
    developerPortalIdentifier?: string;
  }
): Promise<AppleProvisioningProfileMutationResult> {
  return await AppleProvisioningProfileMutation.createAppleProvisioningProfileAsync(
    appleProvisioningProfileInput,
    account.id,
    appleAppIdentifier.id
  );
}

export async function getProvisioningProfileAsync(
  appLookupParams: AppLookupParams,
  iosDistributionType: IosDistributionType,
  { appleTeam }: { appleTeam: AppleTeamFragment | null } = { appleTeam: null }
): Promise<AppleProvisioningProfileQueryResult | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  const appleAppIdentifier = await createOrGetExistingAppleAppIdentifierAsync(
    appLookupParams,
    appleTeam
  );
  return await AppleProvisioningProfileQuery.getForAppAsync(projectFullName, {
    appleAppIdentifierId: appleAppIdentifier.id,
    iosDistributionType,
  });
}

export async function updateProvisioningProfileAsync(
  appleProvisioningProfileId: string,
  appleProvisioningProfileInput: {
    appleProvisioningProfile: string;
    developerPortalIdentifier?: string;
  }
): Promise<AppleProvisioningProfileMutationResult> {
  return await AppleProvisioningProfileMutation.updateAppleProvisioningProfileAsync(
    appleProvisioningProfileId,
    appleProvisioningProfileInput
  );
}

export async function deleteProvisioningProfilesAsync(
  appleProvisioningProfileIds: string[]
): Promise<void> {
  return await AppleProvisioningProfileMutation.deleteAppleProvisioningProfilesAsync(
    appleProvisioningProfileIds
  );
}

export async function getDistributionCertificateForAppAsync(
  appLookupParams: AppLookupParams,
  iosDistributionType: IosDistributionType,
  { appleTeam }: { appleTeam: AppleTeamFragment | null } = { appleTeam: null }
): Promise<AppleDistributionCertificateFragment | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  const appleAppIdentifier = await createOrGetExistingAppleAppIdentifierAsync(
    appLookupParams,
    appleTeam
  );
  return await AppleDistributionCertificateQuery.getForAppAsync(projectFullName, {
    appleAppIdentifierId: appleAppIdentifier.id,
    iosDistributionType,
  });
}

export async function getDistributionCertificatesForAccountAsync(
  account: AccountFragment
): Promise<AppleDistributionCertificateFragment[]> {
  return await AppleDistributionCertificateQuery.getAllForAccountAsync(account.name);
}

export async function createDistributionCertificateAsync(
  account: AccountFragment,
  distCert: DistributionCertificate
): Promise<AppleDistributionCertificateMutationResult> {
  const appleTeam = await createOrGetExistingAppleTeamAsync(account, {
    appleTeamIdentifier: distCert.teamId,
    appleTeamName: distCert.teamName,
  });
  return await AppleDistributionCertificateMutation.createAppleDistributionCertificateAsync(
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
  distributionCertificateId: string
): Promise<void> {
  return await AppleDistributionCertificateMutation.deleteAppleDistributionCertificateAsync(
    distributionCertificateId
  );
}

export async function createPushKeyAsync(
  account: AccountFragment,
  pushKey: PushKey
): Promise<ApplePushKeyFragment> {
  const appleTeam = await createOrGetExistingAppleTeamAsync(account, {
    appleTeamIdentifier: pushKey.teamId,
    appleTeamName: pushKey.teamName,
  });
  return await ApplePushKeyMutation.createApplePushKeyAsync(
    {
      keyP8: pushKey.apnsKeyP8,
      keyIdentifier: pushKey.apnsKeyId,
      appleTeamId: appleTeam.id,
    },
    account.id
  );
}

export async function getPushKeysForAccountAsync(
  account: AccountFragment
): Promise<ApplePushKeyFragment[]> {
  return await ApplePushKeyQuery.getAllForAccountAsync(account.name);
}

export async function getPushKeyForAppAsync(
  appLookupParams: AppLookupParams
): Promise<ApplePushKeyFragment | null> {
  const maybeIosAppCredentials = await getIosAppCredentialsWithCommonFieldsAsync(appLookupParams);
  return maybeIosAppCredentials?.pushKey ?? null;
}

export async function deletePushKeyAsync(pushKeyId: string): Promise<void> {
  return await ApplePushKeyMutation.deleteApplePushKeyAsync(pushKeyId);
}

export async function createAscApiKeyAsync(
  account: AccountFragment,
  ascApiKey: MinimalAscApiKey
): Promise<AppStoreConnectApiKeyFragment> {
  const maybeAppleTeam = ascApiKey.teamId
    ? await createOrGetExistingAppleTeamAsync(account, {
        appleTeamIdentifier: ascApiKey.teamId,
        appleTeamName: ascApiKey.teamName,
      })
    : null;
  return await AppStoreConnectApiKeyMutation.createAppStoreConnectApiKeyAsync(
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
  account: AccountFragment
): Promise<AppStoreConnectApiKeyFragment[]> {
  return await AppStoreConnectApiKeyQuery.getAllForAccountAsync(account.name);
}

export async function getAscApiKeyForAppSubmissionsAsync(
  appLookupParams: AppLookupParams
): Promise<AppStoreConnectApiKeyFragment | null> {
  const maybeIosAppCredentials = await getIosAppCredentialsWithCommonFieldsAsync(appLookupParams);
  return maybeIosAppCredentials?.appStoreConnectApiKeyForSubmissions ?? null;
}

export async function deleteAscApiKeyAsync(ascApiKeyId: string): Promise<void> {
  return await AppStoreConnectApiKeyMutation.deleteAppStoreConnectApiKeyAsync(ascApiKeyId);
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
