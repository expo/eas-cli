import assert from 'assert';

import { AppleProvisioningProfileIdentifiersFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export class RemoveProvisioningProfiles {
  constructor(
    private readonly apps: AppLookupParams[],
    private readonly provisioningProfiles: AppleProvisioningProfileIdentifiersFragment[]
  ) {
    assert(
      apps.length === provisioningProfiles.length,
      'apps must correspond to the provisioning profiles being removed'
    );
  }

  async runAsync(ctx: CredentialsContext): Promise<void> {
    if (this.provisioningProfiles.length === 0) {
      Log.log(`Skipping deletion of Provisioning Profiles`);
      return;
    }
    await ctx.ios.deleteProvisioningProfilesAsync(
      ctx.graphqlClient,
      this.provisioningProfiles.map(profile => profile.id)
    );
    const appAndBundles = this.apps
      .map(app => `@${app.account.name}/${app.projectName} (${app.bundleIdentifier})`)
      .join(',');
    Log.succeed(`Successfully removed provisioning profiles for ${appAndBundles}`);
  }
}
