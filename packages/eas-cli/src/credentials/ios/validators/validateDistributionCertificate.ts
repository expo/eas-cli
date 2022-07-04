import { CredentialsContext } from '../../context.js';
import { DistributionCertificate } from '../appstore/Credentials.types.js';
import { filterRevokedDistributionCerts } from '../appstore/CredentialsUtils.js';

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
