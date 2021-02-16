import { AppleDistributionCertificateFragment } from '../../../graphql/generated';
import { DistributionCertificateStoreInfo } from './Credentials.types';

export function filterRevokedDistributionCerts(
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
