import { App, Auth } from '@expo/apple-utils';
import { getConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { IosSubmitProfile } from '@expo/eas-json/build/submit/types';
import { Errors, Flags } from '@oclif/core';

import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import { MetadataUploadError, MetadataValidationError } from '../metadata/errors';
import { uploadAppleMetadataAsync } from '../metadata/upload';
import { RequestedPlatform, toPlatforms } from '../platform';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
import { findProjectRootAsync, getProjectIdAsync } from '../project/projectUtils';
import { SubmissionContext, createSubmissionContextAsync } from '../submit/context';
import { getProfilesAsync } from '../utils/profiles';

type RawCommandFlags = {
  platform?: string;
  profile?: string;
  'non-interactive': boolean;
};

type CommandFlags = {
  requestedPlatforms: RequestedPlatform;
  profile?: string;
  nonInteractive: boolean;
};

export default class Metadata extends EasCommand {
  static description = 'upload metadata configuration to the app stores';

  static flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['ios'],
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  static args = [];

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Metadata);
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    // TODO: add support for multiple platforms, right now we only support ios
    const submissionContext = await this.resolveIosSubmissionContextAsync({
      flags,
      projectDir,
      projectId,
    });

    const metadataFile = submissionContext.profile.meta || 'store.config.json';
    // TODO: fetch this from the ios submit command options resolver
    const bundleId =
      submissionContext.profile.bundleIdentifier ||
      (await getBundleIdentifierAsync(projectDir, exp));

    // TODO: fetch this from the ios submit command options resolver
    const auth = await Auth.loginAsync();
    const app = await App.findAsync(auth.context, { bundleId });
    if (!app) {
      return Log.warn(`Could not find the App Store Conntect App`);
    }

    try {
      await uploadAppleMetadataAsync({
        app,
        auth,
        projectDir,
        metadataFile,
      });
    } catch (error: any) {
      this.handleMetadataError(error);
    }
  }

  private async sanitizeFlagsAsync(flags: RawCommandFlags): Promise<CommandFlags> {
    const { platform, profile, 'non-interactive': nonInteractive } = flags;

    if (!platform && nonInteractive) {
      Errors.error('--platform is required when building in non-interactive mode', { exit: 1 });
    }

    return {
      // TODO: add support for multiple platforms, right now we only support ios
      requestedPlatforms: RequestedPlatform.Ios, // enforced by the flag options
      profile,
      nonInteractive,
    };
  }

  private handleMetadataError(error: any): void {
    if (error instanceof MetadataValidationError) {
      const entries = error.errors?.map(err => `  - ${err.dataPath} ${err.message}`).join('\n');
      Errors.error(`❌ ${error.message}${entries ? `\n${entries}` : ''}`, { exit: 1 });
    }

    if (error instanceof MetadataUploadError) {
      Errors.error(
        `⚠️ ${error.message}

        Please check the logs for any configuration issues.
        If this issue persists, please open a new bug report at https://github.com/expo/eas-cli
        and include ID "${error.executionId}" to help us track down the issue.`,
        { exit: 1 }
      );
    }

    throw error;
  }

  /**
   * Metadata is configured in the submission profile.
   * We need to initialize the same context to get access to the ASC credentials.
   * This command MUST NOT start the submission context.
   */
  private async resolveIosSubmissionContextAsync(options: {
    flags: CommandFlags;
    projectId: string;
    projectDir: string;
  }): Promise<SubmissionContext<Platform.IOS>> {
    const platforms = toPlatforms(options.flags.requestedPlatforms);
    const submissionProfiles = await getProfilesAsync({
      type: 'submit',
      projectDir: options.projectDir,
      platforms,
      profileName: options.flags.profile,
    });

    // TODO: add support for multiple platforms, right now we only support ios
    const submissionProfile = submissionProfiles[0];
    if (submissionProfile.platform !== Platform.IOS) {
      Errors.error('Metadata is only supported for iOS at the moment', { exit: 1 });
    }
    const iosSubmissionProfile = submissionProfile.profile as IosSubmitProfile;
    const iosSubmissionCtx = await createSubmissionContextAsync({
      platform: submissionProfile.platform,
      projectDir: options.projectDir,
      projectId: options.projectId,
      profile: iosSubmissionProfile,
      nonInteractive: options.flags.nonInteractive,
      // This property acts as a stub, we won't be starting the submission context in this instance
      archiveFlags: { latest: true },
    });

    return iosSubmissionCtx;
  }
}
