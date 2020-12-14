import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { configureAsync } from '../../build/configure';
import { createCommandContextAsync } from '../../build/context';
import { buildAsync } from '../../build/create';
import { AnalyticsEvent, RequestedPlatform } from '../../build/types';
import Analytics from '../../build/utils/analytics';
import { isGitStatusCleanAsync } from '../../build/utils/repository';
import { learnMore } from '../../log';
import {
  isEasEnabledForProjectAsync,
  warnEasUnavailable,
} from '../../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';

export default class Build extends Command {
  static description = 'Start a build';

  static flags = {
    platform: flags.enum({ char: 'p', options: ['android', 'ios', 'all'] }),
    'skip-credentials-check': flags.boolean({
      default: false,
      description: 'Skip validation of build credentials',
    }),
    'skip-project-configuration': flags.boolean({
      default: false,
      description: 'Skip project configuration',
    }),
    profile: flags.string({
      default: 'release',
      description: 'Name of the build profile from eas.json',
    }),
    'non-interactive': flags.boolean({
      default: false,
      description: 'Run command in --non-interactive mode',
    }),
    wait: flags.boolean({
      default: true,
      description: 'Wait for build(s) to complete',
    }),
  };

  async run(): Promise<void> {
    const { flags } = this.parse(Build);
    await ensureLoggedInAsync();

    const nonInteractive = flags['non-interactive'];
    if (!flags.platform && nonInteractive) {
      throw new Error('--platform is required when building in non-interactive mode');
    }
    const platform =
      (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const projectId = await getProjectIdAsync(projectDir);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    await ensureProjectConfiguredAsync(projectDir);

    const trackingCtx = {
      tracking_id: uuidv4(),
      requested_platform: flags.platform,
    };
    Analytics.logEvent(AnalyticsEvent.BUILD_COMMAND, trackingCtx);

    const commandCtx = await createCommandContextAsync({
      requestedPlatform: platform,
      profile: flags.profile,
      projectDir,
      projectId,
      trackingCtx,
      nonInteractive,
      skipCredentialsCheck: flags['skip-credentials-check'],
      skipProjectConfiguration: flags['skip-project-configuration'],
      waitForBuildEnd: flags.wait,
    });
    await buildAsync(commandCtx);
  }
}

async function promptForPlatformAsync(): Promise<RequestedPlatform> {
  const { platform } = await promptAsync({
    type: 'select',
    message: 'Build for platforms',
    name: 'platform',
    choices: [
      {
        title: 'All',
        value: RequestedPlatform.All,
      },
      {
        title: 'iOS',
        value: RequestedPlatform.iOS,
      },
      {
        title: 'Android',
        value: RequestedPlatform.Android,
      },
    ],
  });
  return platform;
}

async function ensureProjectConfiguredAsync(projectDir: string): Promise<void> {
  if (await fs.pathExists(path.join(projectDir, 'eas.json'))) {
    return;
  }
  const confirm = await confirmAsync({
    message: "This app isn't setup for building with EAS. Set it up now?",
  });
  if (confirm) {
    await configureAsync({
      projectDir,
      platform: RequestedPlatform.All,
      allowExperimental: false,
    });
    if (!(await isGitStatusCleanAsync())) {
      throw new Error(
        'Build process requires clean git working tree, please commit all your changes and run `eas build` again'
      );
    }
  } else {
    throw new Error(
      `Aborting, please run ${chalk.bold('eas build:configure')} or create eas.json (${learnMore(
        'https://docs.expo.io/build/eas-json'
      )})`
    );
  }
}
