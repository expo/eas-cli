import { IosAppBuildCredentialsFragment } from '../../../../graphql/generated';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { SetupAdhocProvisioningProfile } from './SetupAdhocProvisioningProfile';

export class SetupInternalProvisioningProfile {
  constructor(private app: AppLookupParams) {}

  async runAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    return await new SetupAdhocProvisioningProfile(this.app).runAsync(ctx);
  }
}
