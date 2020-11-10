import { Context } from '../../context';
import { DistributionCertificate } from '../appstore/Credentials.types';
import { filterRevokedDistributionCerts } from '../appstore/CredentialsUtils';

export async function validateDistributionCertificateAsync(
  ctx: Context,
  distributionCertificate: DistributionCertificate
): Promise<boolean> {
  const certInfoFromApple = await ctx.appStore.listDistributionCertificatesAsync();
  const validDistributionCerts = await filterRevokedDistributionCerts(
    [distributionCertificate],
    certInfoFromApple
  );
  return validDistributionCerts.length > 0;
}
