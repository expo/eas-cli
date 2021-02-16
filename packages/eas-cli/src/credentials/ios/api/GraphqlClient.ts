import nullthrows from 'nullthrows';

import {
  AppFragment,
  AppleAppIdentifierFragment,
  AppleDistributionCertificateFragment,
  AppleTeamFragment,
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import { Account } from '../../../user/Account';
import { DistributionCertificate } from '../appstore/Credentials.types';
import { AppleAppIdentifierMutation } from './graphql/mutations/AppleAppIdentifierMutation';
import {
  AppleDistributionCertificateMutation,
  AppleDistributionCertificateMutationResult,
} from './graphql/mutations/AppleDistributionCertificateMutation';
import {
  AppleProvisioningProfileMutation,
  AppleProvisioningProfileMutationResult,
} from './graphql/mutations/AppleProvisioningProfileMutation';
import { AppleTeamMutation } from './graphql/mutations/AppleTeamMutation';
import { IosAppBuildCredentialsMutation } from './graphql/mutations/IosAppBuildCredentialsMutation';
import { IosAppCredentialsMutation } from './graphql/mutations/IosAppCredentialsMutation';
import { AppQuery } from './graphql/queries/AppQuery';
import { AppleAppIdentifierQuery } from './graphql/queries/AppleAppIdentifierQuery';
import {
  AppleDeviceFragmentWithAppleTeam,
  AppleDeviceQuery,
} from './graphql/queries/AppleDeviceQuery';
import { AppleDistributionCertificateQuery } from './graphql/queries/AppleDistributionCertificateQuery';
import {
  AppleProvisioningProfileQuery,
  AppleProvisioningProfileQueryResult,
} from './graphql/queries/AppleProvisioningProfileQuery';
import { AppleTeamQuery } from './graphql/queries/AppleTeamQuery';
import {
  IosAppCredentialsQuery,
  IosAppCredentialsWithBuildCredentialsQueryResult,
} from './graphql/queries/IosAppCredentialsQuery';

export interface AppLookupParams {
  account: Account;
  projectName: string;
  bundleIdentifier: string;
}

export async function getAppAsync(appLookupParams: AppLookupParams): Promise<AppFragment> {
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
  const iosAppBuildCredentials = iosAppCredentials.iosAppBuildCredentialsArray?.[0];
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

export async function createOrGetExistingIosAppCredentialsWithBuildCredentialsAsync(
  appLookupParams: AppLookupParams,
  {
    appleTeam,
    appleAppIdentifierId,
    iosDistributionType,
  }: {
    appleTeam: AppleTeamFragment;
    appleAppIdentifierId: string;
    iosDistributionType: IosDistributionType;
  }
): Promise<IosAppCredentialsWithBuildCredentialsQueryResult> {
  const projectFullName = formatProjectFullName(appLookupParams);
  const maybeIosAppCredentials = await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(
    projectFullName,
    { appleAppIdentifierId, iosDistributionType }
  );

  if (maybeIosAppCredentials) {
    return maybeIosAppCredentials;
  } else {
    const [app, appleAppIdentifier] = await Promise.all([
      getAppAsync(appLookupParams),
      createOrGetExistingAppleAppIdentifierAsync(appLookupParams, appleTeam),
    ]);
    await IosAppCredentialsMutation.createIosAppCredentialsAsync(
      { appleTeamId: appleTeam.id },
      app.id,
      appleAppIdentifier.id
    );
    return nullthrows(
      await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(projectFullName, {
        appleAppIdentifierId,
        iosDistributionType,
      })
    );
  }
}

export async function createOrGetExistingAppleTeamAsync(
  { account }: AppLookupParams,
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
  { account, bundleIdentifier }: AppLookupParams,
  appleTeam: AppleTeamFragment
): Promise<AppleAppIdentifierFragment> {
  const appleAppIdentifier = await AppleAppIdentifierQuery.byBundleIdentifierAsync(
    account.name,
    bundleIdentifier
  );
  if (appleAppIdentifier) {
    return appleAppIdentifier;
  } else {
    return await AppleAppIdentifierMutation.createAppleAppIdentifierAsync(
      { bundleIdentifier, appleTeamId: appleTeam.id },
      account.id
    );
  }
}

export async function getDevicesForAppleTeamAsync(
  { account }: AppLookupParams,
  { appleTeamIdentifier }: AppleTeamFragment
): Promise<AppleDeviceFragmentWithAppleTeam[]> {
  return await AppleDeviceQuery.getAllByAppleTeamIdentifierAsync(account.id, appleTeamIdentifier);
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
  appleTeam: AppleTeamFragment,
  iosDistributionType: IosDistributionType
): Promise<AppleProvisioningProfileQueryResult | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  const appleAppIdentifier = await createOrGetExistingAppleAppIdentifierAsync(
    appLookupParams,
    appleTeam
  );
  return await AppleProvisioningProfileQuery.getForAppAsync(projectFullName, {
    appleAppIdentifierId: appleAppIdentifier?.id,
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
  appleTeam: AppleTeamFragment,
  iosDistributionType: IosDistributionType
): Promise<AppleDistributionCertificateFragment | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  const appleAppIdentifier = await createOrGetExistingAppleAppIdentifierAsync(
    appLookupParams,
    appleTeam
  );
  return await AppleDistributionCertificateQuery.getForAppAsync(projectFullName, {
    appleAppIdentifierId: appleAppIdentifier?.id,
    iosDistributionType,
  });
}

export async function getDistributionCertificatesForAccountAsync(
  account: Account
): Promise<AppleDistributionCertificateFragment[]> {
  return await AppleDistributionCertificateQuery.getAllForAccount(account.name);
}

export async function createDistributionCertificateAsync(
  appLookupParams: AppLookupParams,
  distCert: DistributionCertificate
): Promise<AppleDistributionCertificateMutationResult> {
  const appleTeam = await createOrGetExistingAppleTeamAsync(appLookupParams, {
    appleTeamIdentifier: distCert.teamId,
    appleTeamName: distCert.teamName,
  });
  const { account } = appLookupParams;
  return await AppleDistributionCertificateMutation.createAppleDistributionCertificate(
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
  return await AppleDistributionCertificateMutation.deleteAppleDistributionCertificate(
    distributionCertificateId
  );
}

const formatProjectFullName = ({ account, projectName }: AppLookupParams): string =>
  `@${account.name}/${projectName}`;
