import { App, Auth } from '@expo/apple-utils';
import { getConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { IosSubmitProfile } from '@expo/eas-json/build/submit/types';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../commandUtils/EasCommand';
import { SubmissionFragment } from '../graphql/generated';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import { MetadataUploadError, MetadataValidationError } from '../metadata/errors';
import { uploadAppleMetadataAsync } from '../metadata/upload';
import {
  RequestedPlatform,
  appPlatformDisplayNames,
  appPlatformEmojis,
  selectRequestedPlatformAsync,
  toPlatforms,
} from '../platform';
import { findProjectRootAsync, getProjectIdAsync } from '../project/projectUtils';
import { SubmitArchiveFlags, createSubmissionContextAsync } from '../submit/context';
import { submitAsync, waitToCompleteAsync } from '../submit/submit';
import { printSubmissionDetailsUrls } from '../submit/utils/urls';
import { ProfileData, getProfilesAsync } from '../utils/profiles';

interface RawCommandFlags {
  platform?: string;
  profile?: string;
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
  verbose: boolean;
  wait: boolean;
  metadata: boolean;
  'non-interactive': boolean;
}

interface CommandFlags {
  requestedPlatform: RequestedPlatform;
  profile?: string;
  archiveFlags: SubmitArchiveFlags;
  verbose: boolean;
  wait: boolean;
  metadata: boolean;
  nonInteractive: boolean;
}

export default class Submit extends EasCommand {
  static description = 'submit app binary to App Store and/or Play Store';
  static aliases = ['build:submit'];

  static flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
    latest: Flags.boolean({
      description: 'Submit the latest build for specified platform',
      exclusive: ['id', 'path', 'url'],
    }),
    id: Flags.string({
      description: 'ID of the build to submit',
      exclusive: ['latest, path, url'],
    }),
    path: Flags.string({
      description: 'Path to the .apk/.aab/.ipa file',
      exclusive: ['latest', 'id', 'url'],
    }),
    url: Flags.string({
      description: 'App archive url',
      exclusive: ['latest', 'id', 'path'],
    }),
    verbose: Flags.boolean({
      description: 'Always print logs from Submission Service',
      default: false,
    }),
    wait: Flags.boolean({
      description: 'Wait for submission to complete',
      default: true,
      allowNo: true,
    }),
    metadata: Flags.boolean({
      description: 'Uploading the local metadata configuration to the stores with the submission',
      default: false,
      allowNo: true,
    }),
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Submit);
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    const platforms = toPlatforms(flags.requestedPlatform);
    const submissionProfiles = await getProfilesAsync({
      type: 'submit',
      projectDir,
      platforms,
      profileName: flags.profile,
    });

    const submissions: SubmissionFragment[] = [];
    for (const submissionProfile of submissionProfiles) {
      const ctx = await createSubmissionContextAsync({
        platform: submissionProfile.platform,
        projectDir,
        projectId,
        profile: submissionProfile.profile,
        archiveFlags: flags.archiveFlags,
        nonInteractive: flags.nonInteractive,
      });

      if (submissionProfiles.length > 1) {
        Log.newLine();
        const appPlatform = toAppPlatform(submissionProfile.platform);
        Log.log(
          `${appPlatformEmojis[appPlatform]} ${chalk.bold(
            `${appPlatformDisplayNames[appPlatform]} submission`
          )}`
        );
      }

      const submission = await submitAsync(ctx);
      submissions.push(submission);
    }

    Log.newLine();
    printSubmissionDetailsUrls(submissions);

    if (flags.wait) {
      await waitToCompleteAsync(submissions, { verbose: flags.verbose });
    }

    if (flags.metadata) {
      await this.maybeUploadMetadataAsync(
        projectDir,
        submissionProfiles,
        exp.ios?.bundleIdentifier || ''
      );
    }
  }

  private async sanitizeFlagsAsync(flags: RawCommandFlags): Promise<CommandFlags> {
    const {
      platform,
      verbose,
      wait,
      profile,
      metadata,
      'non-interactive': nonInteractive,
      ...archiveFlags
    } = flags;

    if (!flags.platform && nonInteractive) {
      Errors.error('--platform is required when building in non-interactive mode', { exit: 1 });
    }

    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);
    if (requestedPlatform === RequestedPlatform.All) {
      if (archiveFlags.id || archiveFlags.path || archiveFlags.url) {
        Errors.error(
          '--id, --path, and --url params are only supported when performing a single-platform submit',
          { exit: 1 }
        );
      }
    }

    return {
      archiveFlags,
      requestedPlatform,
      verbose,
      wait,
      profile,
      nonInteractive,
      metadata,
    };
  }

  private async maybeUploadMetadataAsync(
    projectDir: string,
    submissionProfiles: ProfileData<'submit'>[],
    bundleId: string
  ): Promise<void> {
    // Only load the supported iOS profile to prepare the metadata
    const iosSubmissionProfile = submissionProfiles.filter(
      profile => profile.platform === Platform.IOS
    )[0];
    const { meta: metaFile } = iosSubmissionProfile.profile as IosSubmitProfile;
    if (!metaFile) {
      return Log.warn(
        `Metadata not configured for submission profile ${iosSubmissionProfile.profileName}`
      );
    }

    // TODO: find a better way to hook into the submission information to select the ASC App
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
        metadataFile: metaFile,
      });
    } catch (error: any) {
      if (error instanceof MetadataValidationError) {
        const entries = error.errors?.map(err => `  - ${err.dataPath} ${err.message}`).join('\n');
        Errors.error(`❌ ${error.message}${entries ? `\n${entries}` : ''}`, { exit: 1 });
      } else if (error instanceof MetadataUploadError) {
        Errors.error(
          `⚠️ ${error.message}

          Please check the logs for any configuration issues.
          If this issue persists, please open a new bug report at https://github.com/expo/eas-cli
          and include ID "${error.executionId}" to help us track down the issue.`,
          { exit: 1 }
        );
      } else {
        throw error;
      }
    }
  }
}
