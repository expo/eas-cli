import { UserRole } from '@expo/apple-utils';

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
