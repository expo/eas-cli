import { AppleDistributionCertificateFragment } from '../../../../graphql/generated.js';
import { testDistCertFragmentOneDependency } from '../../../__tests__/fixtures-ios.js';
import { CredentialsContext } from '../../../context.js';
export class SetUpDistributionCertificate {
  public async runAsync(_ctx: CredentialsContext): Promise<AppleDistributionCertificateFragment> {
    return testDistCertFragmentOneDependency;
  }
}
