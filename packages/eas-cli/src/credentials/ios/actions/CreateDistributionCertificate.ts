import { AccountFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppleDistributionCertificateMutationResult } from '../api/graphql/mutations/AppleDistributionCertificateMutation';
import { provideOrGenerateDistributionCertificateAsync } from './DistributionCertificateUtils';

export class CreateDistributionCertificate {
  constructor(private account: AccountFragment) {}

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
