import {
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { CredentialsManager } from '../../../../CredentialsManager';
import { testDistCertFragmentOneDependency } from '../../../../__tests__/fixtures-ios';
import { Context } from '../../../../context';
import { AppLookupParams } from '../../../api/GraphqlClient';
export class SetupDistributionCertificate {
  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  public async runAsync(
    _manager: CredentialsManager,
    _ctx: Context
  ): Promise<AppleDistributionCertificateFragment> {
    return testDistCertFragmentOneDependency;
  }
}
