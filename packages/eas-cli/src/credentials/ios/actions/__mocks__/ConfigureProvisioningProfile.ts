import { testProvisioningProfileFragment } from '../../../__tests__/fixtures-ios';
import { CredentialsContext } from '../../../context';
import { AppleProvisioningProfileMutationResult } from '../../api/graphql/mutations/AppleProvisioningProfileMutation';

export class ConfigureProvisioningProfile {
  public async runAsync(
    _ctx: CredentialsContext
  ): Promise<AppleProvisioningProfileMutationResult | null> {
    return testProvisioningProfileFragment;
  }
}
