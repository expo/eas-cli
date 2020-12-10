import nullthrows from 'nullthrows';

import {
  App,
  AppleAppIdentifier,
  AppleDevice,
  AppleDistributionCertificate,
  AppleProvisioningProfile,
  AppleTeam,
  IosAppBuildCredentials,
  IosAppCredentials,
  IosDistributionType,
} from '../../../graphql/generated';
import { Account } from '../../../user/Account';
import { DistributionCertificate } from '../appstore/Credentials.types';
import { AppleAppIdentifierMutation } from './graphql/mutations/AppleAppIdentifierMutation';
import { AppleDistributionCertificateMutation } from './graphql/mutations/AppleDistributionCertificateMutation';
import { AppleProvisioningProfileMutation } from './graphql/mutations/AppleProvisioningProfileMutation';
import { AppleTeamMutation } from './graphql/mutations/AppleTeamMutation';
import { IosAppBuildCredentialsMutation } from './graphql/mutations/IosAppBuildCredentialsMutation';
import { IosAppCredentialsMutation } from './graphql/mutations/IosAppCredentialsMutation';
import { AppQuery } from './graphql/queries/AppQuery';
import { AppleAppIdentifierQuery } from './graphql/queries/AppleAppIdentifierQuery';
import { AppleDeviceQuery } from './graphql/queries/AppleDeviceQuery';
import { AppleDistributionCertificateQuery } from './graphql/queries/AppleDistributionCertificateQuery';
import { AppleProvisioningProfileQuery } from './graphql/queries/AppleProvisioningProfileQuery';
import { AppleTeamQuery } from './graphql/queries/AppleTeamQuery';
import { IosAppCredentialsQuery } from './graphql/queries/IosAppCredentialsQuery';

export interface AppLookupParams {
  account: Account;
  projectName: string;
  bundleIdentifier: string;
}

export async function getAppAsync(appLookupParams: AppLookupParams): Promise<App> {
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
    appleTeam: AppleTeam;
    appleAppIdentifierId: string;
    iosDistributionType: IosDistributionType;
    appleProvisioningProfileId: string;
    appleDistributionCertificateId: string;
  }
): Promise<IosAppBuildCredentials> {
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

export async function createOrGetExistingIosAppCredentialsWithBuildCredentialsAsync(
  appLookupParams: AppLookupParams,
  {
    appleTeam,
    appleAppIdentifierId,
    iosDistributionType,
  }: {
    appleTeam: AppleTeam;
    appleAppIdentifierId: string;
    iosDistributionType: IosDistributionType;
  }
): Promise<IosAppCredentials> {
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
): Promise<AppleTeam> {
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
  appleTeam: AppleTeam
): Promise<AppleAppIdentifier> {
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
  { appleTeamIdentifier }: AppleTeam
): Promise<AppleDevice[]> {
  return await AppleDeviceQuery.getAllByAppleTeamIdentifierAsync(account.id, appleTeamIdentifier);
}

export async function createProvisioningProfileAsync(
  { account }: AppLookupParams,
  appleAppIdentifier: AppleAppIdentifier,
  appleProvisioningProfileInput: {
    appleProvisioningProfile: string;
    developerPortalIdentifier?: string;
  }
): Promise<AppleProvisioningProfile> {
  return await AppleProvisioningProfileMutation.createAppleProvisioningProfileAsync(
    appleProvisioningProfileInput,
    account.id,
    appleAppIdentifier.id
  );
}

export async function getProvisioningProfileAsync(
  appLookupParams: AppLookupParams,
  appleTeam: AppleTeam,
  iosDistributionType: IosDistributionType
): Promise<AppleProvisioningProfile | null> {
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
): Promise<AppleProvisioningProfile> {
  return await AppleProvisioningProfileMutation.updateAppleProvisioningProfileAsync(
    appleProvisioningProfileId,
    appleProvisioningProfileInput
  );
}

export async function getDistributionCertificateForAppAsync(
  appLookupParams: AppLookupParams,
  appleTeam: AppleTeam,
  iosDistributionType: IosDistributionType
): Promise<AppleDistributionCertificate | null> {
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

export async function getDistributionCertificatesForAccountAsync({
  account,
}: AppLookupParams): Promise<AppleDistributionCertificate[]> {
  return await AppleDistributionCertificateQuery.getAllForAccount(account.name);
}

export async function createDistributionCertificateAsync(
  appLookupParams: AppLookupParams,
  distCert: DistributionCertificate
): Promise<AppleDistributionCertificate> {
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

const formatProjectFullName = ({ account, projectName }: AppLookupParams): string =>
  `@${account.name}/${projectName}`;
