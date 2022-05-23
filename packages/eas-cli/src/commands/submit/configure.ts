import { App, Auth } from '@expo/apple-utils';
import { getConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { IosSubmitProfile } from '@expo/eas-json/build/submit/types';
import { Errors, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { downloadAppleMetadataAsync } from '../../metadata/download';
import { RequestedPlatform, selectRequestedPlatformAsync, toPlatforms } from '../../platform';
import { findProjectRootAsync } from '../../project/projectUtils';
import { getProfilesAsync } from '../../utils/profiles';

interface RawCommandFlags {
  platform?: string;
  profile?: string;
}

interface CommandFlags {
  requestedPlatform: RequestedPlatform;
  profile?: string;
}

export default class SubmitConfigure extends EasCommand {
  static flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['ios', 'all'],
      default: 'ios',
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(SubmitConfigure);
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

    const platforms = toPlatforms(flags.requestedPlatform);
    const submissionProfiles = await getProfilesAsync({
      type: 'submit',
      projectDir,
      platforms,
      profileName: flags.profile,
    });

    // Only load the supported iOS profile to prepare the metadata
    const iosSubmissionProfile = submissionProfiles.filter(
      profile => profile.platform === Platform.IOS
    )[0];
    if (!iosSubmissionProfile) {
      return Errors.error('Only iOS submission profiles are supported');
    }

    const submissionProfile = iosSubmissionProfile.profile as IosSubmitProfile;
    const metadataFile = submissionProfile.meta ?? 'apple-meta.json';

    // TODO: update the submission profile to include a link to the metadata file, if not defined
    const auth = await Auth.loginAsync();
    // TODO: ask bundle identifier if not defined in app.json
    const app = await App.findAsync(auth.context, { bundleId: exp.ios?.bundleIdentifier || '' });
    if (!app) {
      return Errors.warn(`Could not find the App Store Conntect App`);
    }

    await downloadAppleMetadataAsync(projectDir, metadataFile, app);

    Log.newLine();
    Log.succeed(`Created metadata configuration at "${metadataFile}"`);
  }

  private async sanitizeFlagsAsync(flags: RawCommandFlags): Promise<CommandFlags> {
    const { platform, profile } = flags;
    const requestedPlatform = await selectRequestedPlatformAsync(platform);

    return {
      requestedPlatform,
      profile,
    };
  }
}
