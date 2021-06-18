import { AppleDistributionCertificateFragment } from '../../../graphql/generated';
import {
  DistributionCertificate,
  DistributionCertificateStoreInfo,
  PushKey,
  PushKeyStoreInfo,
} from './Credentials.types';

export async function filterRevokedPushKeys<T extends PushKey>(
  pushKeys: T[],
  pushInfoFromApple: PushKeyStoreInfo[]
): Promise<T[]> {
  // if the credentials are valid, check it against apple to make sure it hasnt been revoked
  const validKeyIdsOnAppleServer = pushInfoFromApple.map(pushKey => pushKey.id);
  return pushKeys.filter(pushKey => {
    return validKeyIdsOnAppleServer.includes(pushKey.apnsKeyId);
  });
}

export function filterRevokedDistributionCertsFromEasServers(
  distributionCerts: AppleDistributionCertificateFragment[],
  certInfoFromApple: DistributionCertificateStoreInfo[]
): AppleDistributionCertificateFragment[] {
  if (distributionCerts.length === 0) {
    return [];
  }

  // if the cert is valid, check it against apple to make sure it hasnt been revoked
  const validCertSerialsOnAppleServer = certInfoFromApple
    .filter(
      // remove expired certs
      cert => cert.expires > Math.floor(Date.now() / 1000)
    )
    .map(cert => cert.serialNumber);
  return distributionCerts.filter(cert =>
    validCertSerialsOnAppleServer.includes(cert.serialNumber)
  );
}

export function filterRevokedDistributionCerts<T extends DistributionCertificate>(
  distributionCerts: T[],
  certInfoFromApple: DistributionCertificateStoreInfo[]
): T[] {
  if (distributionCerts.length === 0) {
    return [];
  }

  // if the credentials are valid, check it against apple to make sure it hasnt been revoked
  const validCertSerialsOnAppleServer = certInfoFromApple
    .filter(
      // remove expired certs
      cert => cert.expires > Math.floor(Date.now() / 1000)
    )
    .map(cert => cert.serialNumber);
  const validDistributionCerts = distributionCerts.filter(cert => {
    if (!cert.distCertSerialNumber) {
      return false;
    }
    return validCertSerialsOnAppleServer.includes(cert.distCertSerialNumber);
  });
  return validDistributionCerts;
}

export function sortCertificatesByExpiryDesc<T extends DistributionCertificate>(
  certInfoFromApple: DistributionCertificateStoreInfo[],
  distributionCerts: T[]
): T[] {
  return distributionCerts.sort((certA, certB) => {
    const certAInfo = certInfoFromApple.find(cert => cert.id === certA.certId);
    const certAExpiry = certAInfo ? certAInfo.expires : Number.NEGATIVE_INFINITY;
    const certBInfo = certInfoFromApple.find(cert => cert.id === certB.certId);
    const certBExpiry = certBInfo ? certBInfo.expires : Number.NEGATIVE_INFINITY;
    return certBExpiry - certAExpiry;
  });
}

export function getValidCertSerialNumbers(
  certInfoFromApple: DistributionCertificateStoreInfo[]
): string[] {
  return certInfoFromApple
    .filter(
      // remove expired certs
      cert => cert.expires > Math.floor(Date.now() / 1000)
    )
    .map(cert => cert.serialNumber);
}
