import Log from '../../../log';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { AppleDistributionCertificateMutationResult } from '../api/graphql/mutations/AppleDistributionCertificateMutation';
import { provideOrGenerateDistributionCertificateAsync } from './DistributionCertificateUtils';

export class CreateDistributionCertificate {
  constructor(private account: Account) {}

  public async runAsync(
    ctx: CredentialsContext
  ): Promise<AppleDistributionCertificateMutationResult> {
    const distCert = await provideOrGenerateDistributionCertificateAsync(ctx, this.account.name);
    const result = await ctx.ios.createDistributionCertificateAsync(this.account, distCert);
    Log.succeed('Created distribution certificate');
    return result;
  }
}
