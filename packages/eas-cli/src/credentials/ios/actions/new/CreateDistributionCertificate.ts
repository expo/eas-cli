import assert from 'assert';

import log from '../../../../log';
import { Action, CredentialsManager } from '../../../CredentialsManager';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleDistributionCertificateMutationResult } from '../../api/graphql/mutations/AppleDistributionCertificateMutation';
import { provideOrGenerateDistributionCertificateAsync } from '../DistributionCertificateUtils';

export class CreateDistributionCertificate implements Action {
  private _distributionCertificate?: AppleDistributionCertificateMutationResult;

  constructor(private app: AppLookupParams) {}

  public get distributionCertificate(): AppleDistributionCertificateMutationResult {
    assert(
      this._distributionCertificate,
      'distributionCertificate can be accessed only after calling .runAsync()'
    );
    return this._distributionCertificate;
  }

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const distCert = await provideOrGenerateDistributionCertificateAsync(
      manager,
      ctx,
      this.app.account.name
    );
    this._distributionCertificate = await ctx.newIos.createDistributionCertificateAsync(
      this.app,
      distCert
    );
    log.succeed('Created distribution certificate');
  }
}
