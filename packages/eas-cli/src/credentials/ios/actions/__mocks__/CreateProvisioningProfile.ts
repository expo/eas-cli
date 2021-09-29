import { AppleDistributionCertificateFragment } from '../../../../graphql/generated';
import { testProvisioningProfileFragment } from '../../../__tests__/fixtures-ios';
import { CredentialsContext } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleProvisioningProfileMutationResult } from '../../api/graphql/mutations/AppleProvisioningProfileMutation';

export class CreateProvisioningProfile {
  constructor(
    private app: AppLookupParams,
    private distributionCertificate: AppleDistributionCertificateFragment
  ) {}

  async runAsync(ctx: CredentialsContext): Promise<AppleProvisioningProfileMutationResult> {
    return testProvisioningProfileFragment;
  }
}
