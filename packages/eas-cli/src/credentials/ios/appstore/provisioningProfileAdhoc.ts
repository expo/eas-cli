import ora from 'ora';

import { ProvisioningProfile } from './Credentials.types';
import { AuthCtx } from './authenticate';
import { runActionAsync, travelingFastlane } from './fastlane';

export async function createOrReuseAdhocProvisioningProfileAsync(
  ctx: AuthCtx,
  udids: string[],
  bundleIdentifier: string,
  distCertSerialNumber: string
): Promise<ProvisioningProfile> {
  const spinner = ora(`Handling Adhoc provisioning profiles on Apple Developer Portal...`).start();
  try {
    const args = [
      '--apple-id',
      ctx.appleId,
      '--apple-password',
      ctx.appleIdPassword,
      ctx.team.id,
      udids.join(','),
      bundleIdentifier,
      distCertSerialNumber,
    ];
    const adhocProvisioningProfile = await runActionAsync(
      travelingFastlane.manageAdHocProvisioningProfile,
      args
    );

    const {
      provisioningProfileUpdateTimestamp,
      provisioningProfileCreateTimestamp,
      provisioningProfileName,
    } = adhocProvisioningProfile;
    if (provisioningProfileCreateTimestamp) {
      spinner.succeed(`Created new profile: ${provisioningProfileName}`);
    } else if (provisioningProfileUpdateTimestamp) {
      spinner.succeed(`Updated existing profile: ${provisioningProfileName}`);
    } else {
      spinner.succeed(`Used existing profile: ${provisioningProfileName}`);
    }

    delete adhocProvisioningProfile.provisioningProfileUpdateTimestamp;
    delete adhocProvisioningProfile.provisioningProfileCreateTimestamp;
    delete adhocProvisioningProfile.provisioningProfileName;

    return {
      ...adhocProvisioningProfile,
      teamId: ctx.team.id,
      teamName: ctx.team.name,
    };
  } catch (error) {
    spinner.fail();
    throw error;
  }
}
