import { AppleDistributionCertificateQueryResult } from '../api/graphql/queries/AppleDistributionCertificateQuery';
import { DistributionCertificateStoreInfo } from './Credentials.types';

export function filterRevokedDistributionCerts(
  distributionCerts: AppleDistributionCertificateQueryResult[],
  certInfoFromApple: DistributionCertificateStoreInfo[]
): AppleDistributionCertificateQueryResult[] {
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
    return validCertSerialsOnAppleServer.includes(cert.serialNumber);
  });
  return validDistributionCerts;
}
