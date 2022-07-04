import { testProvisioningProfileFragment } from '../../../__tests__/fixtures-ios.js';
import { CredentialsContext } from '../../../context.js';
import { AppleProvisioningProfileMutationResult } from '../../api/graphql/mutations/AppleProvisioningProfileMutation.js';

export class CreateProvisioningProfile {
  async runAsync(_ctx: CredentialsContext): Promise<AppleProvisioningProfileMutationResult> {
    return testProvisioningProfileFragment;
  }
}
