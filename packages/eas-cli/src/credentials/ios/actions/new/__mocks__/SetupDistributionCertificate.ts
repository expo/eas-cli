import {
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { Action, CredentialsManager } from '../../../../CredentialsManager';
import { testDistCertFragmentOneDependency } from '../../../../__tests__/fixtures-ios';
import { Context } from '../../../../context';
import { AppLookupParams } from '../../../api/GraphqlClient';
export class SetupDistributionCertificate implements Action {
  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  public get distributionCertificate(): AppleDistributionCertificateFragment {
    return testDistCertFragmentOneDependency;
  }

  public async runAsync(_manager: CredentialsManager, _ctx: Context): Promise<void> {}
}
