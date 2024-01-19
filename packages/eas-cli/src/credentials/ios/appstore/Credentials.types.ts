import { ProfileType } from '@expo/app-store';
import { UserRole } from '@expo/apple-utils';
import { Ios } from '@expo/eas-build-job';

export interface DistributionCertificateStoreInfo {
  id: string;
  name: string;
  status: string;
  created: number;
  expires: number;
  ownerName: string;
  ownerId: string;
  serialNumber: string;
}

export interface DistributionCertificate {
  certId?: string;
  certP12: string;
  certPassword: string;
  certPrivateSigningKey?: string;
  distCertSerialNumber?: string;
  teamId: string;
  teamName?: string;
}

export interface ProvisioningProfile {
  provisioningProfileId?: string;
  provisioningProfile: string;
  teamId: string;
  teamName?: string;
  provisioningProfileType: Ios.ProvisioningProfileType;
}

export function getProvisioningProfileTypeForDistributionMethod(
  distributionMethod: ProfileType
): Ios.ProvisioningProfileType {
  switch (distributionMethod) {
    case ProfileType.IOS_APP_DEVELOPMENT:
    case ProfileType.IOS_APP_STORE:
    case ProfileType.IOS_APP_ADHOC:
    case ProfileType.IOS_APP_INHOUSE:
    case ProfileType.TVOS_APP_DEVELOPMENT:
    case ProfileType.TVOS_APP_STORE:
    case ProfileType.TVOS_APP_ADHOC:
    case ProfileType.TVOS_APP_INHOUSE:
      return Ios.ProvisioningProfileType.MOBILEPROVISION;
    case ProfileType.MAC_APP_DEVELOPMENT:
    case ProfileType.MAC_APP_STORE:
    case ProfileType.MAC_APP_DIRECT:
    case ProfileType.MAC_CATALYST_APP_DEVELOPMENT:
    case ProfileType.MAC_CATALYST_APP_STORE:
    case ProfileType.MAC_CATALYST_APP_DIRECT:
      return Ios.ProvisioningProfileType.PROVISIONPROFILE;
  }
}

export interface ProvisioningProfileStoreInfo extends ProvisioningProfile {
  name: string;
  status: string;
  expires: number;
  distributionMethod: string;
  certificates: DistributionCertificateStoreInfo[];
  devices?: {
    id: string;
    udid: string;
    name?: string;
  }[];
}

export interface PushKeyStoreInfo {
  id: string;
  name: string;
}

export interface PushKey {
  apnsKeyP8: string;
  apnsKeyId: string;
  teamId: string;
  teamName?: string;
}

export type AscApiKeyInfo = {
  keyId: string;
  issuerId?: string;
  teamId: string;
  name: string;
  teamName?: string;
  roles: UserRole[];
  isRevoked: boolean;
};

export type AscApiKey = AscApiKeyInfo & {
  keyP8: string;
};
