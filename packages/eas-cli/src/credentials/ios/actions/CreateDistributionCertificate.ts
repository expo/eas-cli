import { provideOrGenerateDistributionCertificateAsync } from './DistributionCertificateUtils';
import { AccountFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppleDistributionCertificateMutationResult } from '../api/graphql/mutations/AppleDistributionCertificateMutation';

export class CreateDistributionCertificate {
  constructor(private readonly account: AccountFragment) {}

  public async runAsync(
    ctx: CredentialsContext
  ): Promise<AppleDistributionCertificateMutationResult> {
    const distCert = await provideOrGenerateDistributionCertificateAsync(ctx);
    const result = await ctx.ios.createDistributionCertificateAsync(
      ctx.graphqlClient,
      this.account,
      distCert
    );
    Log.succeed('Created distribution certificate');
    return result;
  }
}
