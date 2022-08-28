import { EasJsonReader } from '@expo/eas-json';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../commandUtils/EasCommand';
import { StatuspageServiceName, SubmissionFragment } from '../graphql/generated';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import {
  RequestedPlatform,
  appPlatformDisplayNames,
  appPlatformEmojis,
  selectRequestedPlatformAsync,
  toPlatforms,
} from '../platform';
import { getExpoConfig } from '../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../project/projectUtils';
import { SubmitArchiveFlags, createSubmissionContextAsync } from '../submit/context';
import {
  exitWithNonZeroCodeIfSomeSubmissionsDidntFinish,
  submitAsync,
  waitToCompleteAsync,
} from '../submit/submit';
import { printSubmissionDetailsUrls } from '../submit/utils/urls';
import { getProfilesAsync } from '../utils/profiles';
import { maybeWarnAboutEasOutagesAsync } from '../utils/statuspageService';

interface RawCommandFlags {
  platform?: string;
  profile?: string;
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
  verbose: boolean;
  wait: boolean;
  'non-interactive': boolean;
}

interface CommandFlags {
  requestedPlatform: RequestedPlatform;
  profile?: string;
  archiveFlags: SubmitArchiveFlags;
  verbose: boolean;
  wait: boolean;
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
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Submit);

    const flags = this.sanitizeFlags(rawFlags);

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    await maybeWarnAboutEasOutagesAsync([StatuspageServiceName.EasSubmit]);

    flags.requestedPlatform = await selectRequestedPlatformAsync(flags.requestedPlatform);
    this.validateFlagsWithPlatform(rawFlags, flags.requestedPlatform);

    const platforms = toPlatforms(flags.requestedPlatform);
    const submissionProfiles = await getProfilesAsync({
      type: 'submit',
      easJsonReader: new EasJsonReader(projectDir),
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
      const completedSubmissions = await waitToCompleteAsync(submissions, {
        verbose: flags.verbose,
      });
      exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(completedSubmissions);
    }
  }

  private sanitizeFlags(
    flags: RawCommandFlags
  ): Omit<CommandFlags, 'requestedPlatform'> & { requestedPlatform?: RequestedPlatform } {
    const {
      platform,
      verbose,
      wait,
      profile,
      'non-interactive': nonInteractive,
      ...archiveFlags
    } = flags;

    if (!flags.platform && nonInteractive) {
      Errors.error('--platform is required when building in non-interactive mode', { exit: 1 });
    }

    const requestedPlatform =
      flags.platform &&
      Object.values(RequestedPlatform).includes(flags.platform.toLowerCase() as RequestedPlatform)
        ? (flags.platform.toLowerCase() as RequestedPlatform)
        : undefined;

    this.validateFlagsWithPlatform(archiveFlags, requestedPlatform);

    return {
      archiveFlags,
      requestedPlatform,
      verbose,
      wait,
      profile,
      nonInteractive,
    };
  }

  private validateFlagsWithPlatform(
    archiveFlags: {
      latest?: boolean | undefined;
      id?: string | undefined;
      path?: string | undefined;
      url?: string | undefined;
    },
    requestedPlatform?: RequestedPlatform
  ): void {
    if (requestedPlatform === RequestedPlatform.All) {
      if (archiveFlags.id || archiveFlags.path || archiveFlags.url) {
        Errors.error(
          '--id, --path, and --url params are only supported when performing a single-platform submit',
          { exit: 1 }
        );
      }
    }
  }
}
