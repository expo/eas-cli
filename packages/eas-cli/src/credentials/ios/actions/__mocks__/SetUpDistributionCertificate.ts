import { AppleDistributionCertificateFragment } from '../../../../graphql/generated';
import { testDistCertFragmentOneDependency } from '../../../__tests__/fixtures-ios';
import { CredentialsContext } from '../../../context';
export class SetUpDistributionCertificate {
  public async runAsync(_ctx: CredentialsContext): Promise<AppleDistributionCertificateFragment> {
    return testDistCertFragmentOneDependency;
  }
}
