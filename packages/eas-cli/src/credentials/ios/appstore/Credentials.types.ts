export interface DistributionCertificateStoreInfo {
  id: string;
  name: string;
  status: string;
  created: number;
  expires: number;
  ownerType: string;
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
