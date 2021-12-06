import { getConfig } from '@expo/config';
import { flags } from '@oclif/command';
import { error } from '@oclif/errors';
import chalk from 'chalk';

import EasCommand from '../commandUtils/EasCommand';
import { SubmissionFragment } from '../graphql/generated';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log, { link } from '../log';
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
import { getProfilesAsync } from '../utils/profiles';

interface RawFlags {
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

interface Flags {
  requestedPlatform: RequestedPlatform;
  profile?: string;
  archiveFlags: SubmitArchiveFlags;
  verbose: boolean;
  wait: boolean;
  nonInteractive: boolean;
}

export default class Submit extends EasCommand {
  static description = `submit build archive to App Store Connect
See how to configure submits with eas.json: ${link('https://docs.expo.dev/submit/eas-json/')}`;
  static aliases = ['build:submit'];

  static flags = {
    platform: flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    profile: flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
    latest: flags.boolean({
      description: 'Submit the latest build for specified platform',
      exclusive: ['id', 'path', 'url'],
    }),
    id: flags.string({
      description: 'ID of the build to submit',
      exclusive: ['latest, path, url'],
    }),
    path: flags.string({
      description: 'Path to the .apk/.aab/.ipa file',
      exclusive: ['latest', 'id', 'url'],
    }),
    url: flags.string({
      description: 'App archive url',
      exclusive: ['latest', 'id', 'path'],
    }),
    verbose: flags.boolean({
      description: 'Always print logs from Submission Service',
      default: false,
    }),
    wait: flags.boolean({
      description: 'Wait for submission to complete',
      default: true,
      allowNo: true,
    }),
    'non-interactive': flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = this.parse(Submit);
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
  }

  private async sanitizeFlagsAsync(flags: RawFlags): Promise<Flags> {
    const {
      platform,
      verbose,
      wait,
      profile,
      'non-interactive': nonInteractive,
      ...archiveFlags
    } = flags;

    if (!flags.platform && nonInteractive) {
      error('--platform is required when building in non-interactive mode', { exit: 1 });
    }

    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);
    if (requestedPlatform === RequestedPlatform.All) {
      if (archiveFlags.id || archiveFlags.path || archiveFlags.url) {
        error(
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
    };
  }
}
