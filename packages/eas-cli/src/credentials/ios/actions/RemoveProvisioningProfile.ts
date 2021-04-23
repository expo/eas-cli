import { assert } from '@expo/config';

import { AppleProvisioningProfileIdentifiersFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

export class RemoveProvisioningProfiles {
  constructor(
    private apps: AppLookupParams[],
    private provisioningProfiles: AppleProvisioningProfileIdentifiersFragment[]
  ) {
    assert(
      apps.length === provisioningProfiles.length,
      'apps must correspond to the provisioning profiles being removed'
    );
  }

  async runAsync(ctx: Context): Promise<void> {
    if (this.provisioningProfiles.length === 0) {
      Log.log(`Skipping deletion of Provisioning Profiles`);
      return;
    }
    await ctx.ios.deleteProvisioningProfilesAsync(
      this.provisioningProfiles.map(profile => profile.id)
    );
    const appAndBundles = this.apps
      .map(app => `@${app.account.name}/${app.projectName} (${app.bundleIdentifier})`)
      .join(',');
    Log.succeed(`Successfully removed provisioning profiles for ${appAndBundles}`);
  }
}
