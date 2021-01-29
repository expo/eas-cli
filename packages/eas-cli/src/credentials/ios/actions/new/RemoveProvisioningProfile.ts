import { assert } from '@expo/config';

import { AppleProvisioningProfileIdentifiersFragment } from '../../../../graphql/generated';
import log from '../../../../log';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';

/* interface RemoveOptions {
  shouldRevoke?: boolean;
}

export class RemoveProvisioningProfile implements Action {
  constructor(private accountName: string, private options: RemoveOptions = {}) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const selected = await selectProvisioningProfileFromExpoAsync(ctx, this.accountName);
    if (selected) {
      const app = getAppLookupParams(selected.experienceName, selected.bundleIdentifier);
      await manager.runActionAsync(new RemoveSpecificProvisioningProfile(app, this.options));
    }
  }
} */

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
    await ctx.newIos.deleteProvisioningProfilesAsync(
      this.provisioningProfiles.map(profile => profile.id)
    );
    const appAndBundles = this.apps
      .map(app => `@${app.account.name}/${app.projectName} (${app.bundleIdentifier})`)
      .join(',');
    log.succeed(`Successfully removed provisioning profiles for ${appAndBundles}`);
  }
}
