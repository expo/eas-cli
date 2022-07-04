import Log from '../../../log.js';
import { Account } from '../../../user/Account.js';
import { CredentialsContext } from '../../context.js';
import { AppleDistributionCertificateMutationResult } from '../api/graphql/mutations/AppleDistributionCertificateMutation.js';
import { provideOrGenerateDistributionCertificateAsync } from './DistributionCertificateUtils.js';

export class CreateDistributionCertificate {
  constructor(private account: Account) {}

  public async runAsync(
    ctx: CredentialsContext
  ): Promise<AppleDistributionCertificateMutationResult> {
    const distCert = await provideOrGenerateDistributionCertificateAsync(ctx);
    const result = await ctx.ios.createDistributionCertificateAsync(this.account, distCert);
    Log.succeed('Created distribution certificate');
    return result;
  }
}
