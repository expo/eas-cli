import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
} from '../../../../graphql/generated';
import { testProvisioningProfileFragment } from '../../../__tests__/fixtures-ios';
import { CredentialsContext } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleProvisioningProfileMutationResult } from '../../api/graphql/mutations/AppleProvisioningProfileMutation';

export class ConfigureProvisioningProfile {
  constructor(
    private app: AppLookupParams,
    private distributionCertificate: AppleDistributionCertificateFragment,
    private originalProvisioningProfile: AppleProvisioningProfileFragment
  ) {}

  public async runAsync(
    ctx: CredentialsContext
  ): Promise<AppleProvisioningProfileMutationResult | null> {
    return testProvisioningProfileFragment;
  }
}
