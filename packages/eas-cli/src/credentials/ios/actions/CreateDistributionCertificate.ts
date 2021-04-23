import Log from '../../../log';
import { Account } from '../../../user/Account';
import { Context } from '../../context';
import { AppleDistributionCertificateMutationResult } from '../api/graphql/mutations/AppleDistributionCertificateMutation';
import { provideOrGenerateDistributionCertificateAsync } from './DistributionCertificateUtils';

export class CreateDistributionCertificate {
  constructor(private account: Account) {}

  public async runAsync(ctx: Context): Promise<AppleDistributionCertificateMutationResult> {
    const distCert = await provideOrGenerateDistributionCertificateAsync(ctx, this.account.name);
    const result = await ctx.newIos.createDistributionCertificateAsync(this.account, distCert);
    Log.succeed('Created distribution certificate');
    return result;
  }
}
