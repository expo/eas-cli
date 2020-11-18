import nullthrows from 'nullthrows';

import { AppQuery } from '../../../graphql/queries/AppQuery';
import { App } from '../../../graphql/types/App';
import { AppleAppIdentifier } from '../../../graphql/types/credentials/AppleAppIdentifier';
import { AppleDevice } from '../../../graphql/types/credentials/AppleDevice';
import { AppleDistributionCertificate } from '../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleProvisioningProfile } from '../../../graphql/types/credentials/AppleProvisioningProfile';
import { AppleTeam } from '../../../graphql/types/credentials/AppleTeam';
import {
  IosAppBuildCredentials,
  IosDistributionType,
} from '../../../graphql/types/credentials/IosAppBuildCredentials';
import { IosAppCredentials } from '../../../graphql/types/credentials/IosAppCredentials';
import { Account } from '../../../user/Account';
import { DistributionCertificate } from '../appstore/Credentials.types';
import { AppleAppIdentifierMutation } from './graphql/mutations/AppleAppIdentifierMutation';
import { AppleDistributionCertificateMutation } from './graphql/mutations/AppleDistributionCertificateMutation';
import { AppleProvisioningProfileMutation } from './graphql/mutations/AppleProvisioningProfileMutation';
import { AppleTeamMutation } from './graphql/mutations/AppleTeamMutation';
import { IosAppBuildCredentialsMutation } from './graphql/mutations/IosAppBuildCredentialsMutation';
import { IosAppCredentialsMutation } from './graphql/mutations/IosAppCredentialsMutation';
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

export default class IosGraphqlClient {
  public async getAppAsync(appLookupParams: AppLookupParams): Promise<App> {
    const projectFullName = formatProjectFullName(appLookupParams);
    return await AppQuery.byFullNameAsync(projectFullName);
  }

  public async createOrUpdateIosAppBuildCredentialsAsync(
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
    const projectFullName = formatProjectFullName(appLookupParams);
    const maybeIosAppCredentials = await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(
      projectFullName,
      { appleAppIdentifierId, iosDistributionType }
    );
    let iosAppCredentials: IosAppCredentials;
    if (maybeIosAppCredentials) {
      iosAppCredentials = maybeIosAppCredentials;
    } else {
      const { account } = appLookupParams;
      const app = await this.getAppAsync(appLookupParams);
      await IosAppCredentialsMutation.createIosAppCredentialsAsync(
        { appleTeamId: appleTeam.id },
        app.id,
        account.id
      );
      iosAppCredentials = nullthrows(
        await IosAppCredentialsQuery.withBuildCredentialsByAppIdentifierIdAsync(projectFullName, {
          appleAppIdentifierId,
          iosDistributionType,
        })
      );
    }

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

  public async createOrGetExistingAppleTeamAsync(
    { account }: AppLookupParams,
    { appleTeamIdentifier, appleTeamName }: { appleTeamIdentifier: string; appleTeamName: string }
  ): Promise<AppleTeam> {
    const appleTeam = await AppleTeamQuery.byAppleTeamIdentifierAsync(
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

  public async createOrGetExistingAppleAppIdentifierAsync(
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

  public async getDevicesForAppleTeamAsync(
    { account }: AppLookupParams,
    { appleTeamIdentifier }: AppleTeam
  ): Promise<AppleDevice[]> {
    return await AppleDeviceQuery.getAllByAppleTeamIdentifierAsync(account.id, appleTeamIdentifier);
  }

  public async createProvisioningProfileAsync(
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

  public async getProvisioningProfileAsync(
    appLookupParams: AppLookupParams,
    appleTeam: AppleTeam,
    iosDistributionType: IosDistributionType
  ): Promise<AppleProvisioningProfile | null> {
    const projectFullName = formatProjectFullName(appLookupParams);
    const appleAppIdentifier = await this.createOrGetExistingAppleAppIdentifierAsync(
      appLookupParams,
      appleTeam
    );
    return await AppleProvisioningProfileQuery.getForAppAsync(projectFullName, {
      appleAppIdentifierId: appleAppIdentifier?.id,
      iosDistributionType,
    });
  }

  public async updateProvisioningProfileAsync(
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

  public async getDistributionCertificateForAppAsync(
    appLookupParams: AppLookupParams,
    appleTeam: AppleTeam,
    iosDistributionType: IosDistributionType
  ): Promise<AppleDistributionCertificate | null> {
    const projectFullName = formatProjectFullName(appLookupParams);
    const appleAppIdentifier = await this.createOrGetExistingAppleAppIdentifierAsync(
      appLookupParams,
      appleTeam
    );
    return await AppleDistributionCertificateQuery.getForAppAsync(projectFullName, {
      appleAppIdentifierId: appleAppIdentifier?.id,
      iosDistributionType,
    });
  }

  public async getDistributionCertificatesForAccountAsync({
    account,
  }: AppLookupParams): Promise<AppleDistributionCertificate[]> {
    return await AppleDistributionCertificateQuery.getAllForAccount(account.name);
  }

  public async createDistributionCertificateAsync(
    { account }: AppLookupParams,
    distCert: DistributionCertificate
  ): Promise<AppleDistributionCertificate> {
    const appleTeam = nullthrows(
      await AppleTeamQuery.byAppleTeamIdentifierAsync(account.id, distCert.teamId)
    );
    return await AppleDistributionCertificateMutation.createAppleDistributionCertificate(
      {
        certP12: distCert.certP12,
        certPassword: distCert.certPassword,
        certPrivateSigningKey: distCert.certPrivateSigningKey,
        appleTeamId: appleTeam.id,
      },
      account.id
    );
  }
}

const formatProjectFullName = ({ account, projectName }: AppLookupParams): string =>
  `@${account.name}/${projectName}`;
