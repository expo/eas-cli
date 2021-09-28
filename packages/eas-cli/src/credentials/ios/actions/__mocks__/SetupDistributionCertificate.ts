import {
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import { testDistCertFragmentOneDependency } from '../../../__tests__/fixtures-ios';
import { CredentialsContext } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
export class SetupDistributionCertificate {
  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  public async runAsync(_ctx: CredentialsContext): Promise<AppleDistributionCertificateFragment> {
    return testDistCertFragmentOneDependency;
  }
}
