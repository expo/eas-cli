import Log from '../../../../log';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleDistributionCertificateMutationResult } from '../../api/graphql/mutations/AppleDistributionCertificateMutation';
import { provideOrGenerateDistributionCertificateAsync } from '../DistributionCertificateUtils';

export class CreateDistributionCertificate {
  constructor(private app: AppLookupParams) {}

  public async runAsync(ctx: Context): Promise<AppleDistributionCertificateMutationResult> {
    const distCert = await provideOrGenerateDistributionCertificateAsync(
      ctx,
      this.app.account.name
    );
    const result = await ctx.newIos.createDistributionCertificateAsync(this.app, distCert);
    Log.succeed('Created distribution certificate');
    return result;
  }
}
