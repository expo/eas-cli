import { EasJsonAccessor } from '@expo/eas-json';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand, {
  EASCommandLoggedInContext,
  EASCommandProjectConfigContext,
  EASCommandProjectDirContext,
} from '../commandUtils/EasCommand';
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
  static override description = 'submit app binary to App Store and/or Play Store';
  static override aliases = ['build:submit'];

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    profile: Flags.string({
      char: 'e',
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

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandProjectConfigContext,
    ...EASCommandProjectDirContext,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Submit);
    const {
      actor,
      projectConfig: { exp, projectId, projectDir },
    } = await this.getContextAsync(Submit, {
      nonInteractive: false,
    });

    const flags = this.sanitizeFlags(rawFlags);

    await maybeWarnAboutEasOutagesAsync([StatuspageServiceName.EasSubmit]);

    const flagsWithPlatform = await this.ensurePlatformSelectedAsync(flags);

    const platforms = toPlatforms(flagsWithPlatform.requestedPlatform);
    const submissionProfiles = await getProfilesAsync({
      type: 'submit',
      easJsonAccessor: new EasJsonAccessor(projectDir),
      platforms,
      profileName: flagsWithPlatform.profile,
    });

    const submissions: SubmissionFragment[] = [];
    for (const submissionProfile of submissionProfiles) {
      // this command doesn't make use of env when getting the project config
      const ctx = await createSubmissionContextAsync({
        platform: submissionProfile.platform,
        projectDir,
        profile: submissionProfile.profile,
        archiveFlags: flagsWithPlatform.archiveFlags,
        nonInteractive: flagsWithPlatform.nonInteractive,
        actor,
        exp,
        projectId,
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

    if (flagsWithPlatform.wait) {
      const completedSubmissions = await waitToCompleteAsync(submissions, {
        verbose: flagsWithPlatform.verbose,
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

    return {
      archiveFlags,
      requestedPlatform,
      verbose,
      wait,
      profile,
      nonInteractive,
    };
  }

  private async ensurePlatformSelectedAsync(
    flags: Omit<CommandFlags, 'requestedPlatform'> & { requestedPlatform?: RequestedPlatform }
  ): Promise<CommandFlags> {
    const requestedPlatform = await selectRequestedPlatformAsync(flags.requestedPlatform);

    if (requestedPlatform === RequestedPlatform.All) {
      if (flags.archiveFlags.id || flags.archiveFlags.path || flags.archiveFlags.url) {
        Errors.error(
          '--id, --path, and --url params are only supported when performing a single-platform submit',
          { exit: 1 }
        );
      }
    }

    return {
      ...flags,
      requestedPlatform,
    };
  }
}
