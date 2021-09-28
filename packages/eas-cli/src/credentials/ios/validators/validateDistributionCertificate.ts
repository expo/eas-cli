import { CredentialsContext } from '../../context';
import { DistributionCertificate } from '../appstore/Credentials.types';
import { filterRevokedDistributionCerts } from '../appstore/CredentialsUtils';

export async function validateDistributionCertificateAsync(
  ctx: CredentialsContext,
  distributionCertificate: DistributionCertificate
): Promise<boolean> {
  const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
  const validDistributionCerts = filterRevokedDistributionCerts(
    [distributionCertificate],
    certInfoFromApple
  );
  return validDistributionCerts.length > 0;
}
