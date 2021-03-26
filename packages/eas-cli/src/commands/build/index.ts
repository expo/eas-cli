import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { apiClient } from '../../api';
import { configureAsync } from '../../build/configure';
import { createCommandContextAsync } from '../../build/context';
import { buildAsync } from '../../build/create';
import { AnalyticsEvent, Build as BuildType, RequestedPlatform } from '../../build/types';
import Analytics from '../../build/utils/analytics';
import { formatBuild } from '../../build/utils/formatBuild';
import { isGitStatusCleanAsync } from '../../build/utils/repository';
import { AppPlatform } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log, { learnMore } from '../../log';
import {
  isEasEnabledForProjectAsync,
  warnEasUnavailable,
} from '../../project/isEasEnabledForProject';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../prompts';
import { Actor } from '../../user/User';
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
      allowNo: true,
      description: 'Wait for build(s) to complete',
    }),
  };

  async run(): Promise<void> {
    const { flags } = this.parse(Build);
    const user = await ensureLoggedInAsync();

    const nonInteractive = flags['non-interactive'];
    if (!flags.platform && nonInteractive) {
      throw new Error('--platform is required when building in non-interactive mode');
    }
    const platform =
      (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    const accountName = await getProjectAccountNameAsync(exp);
    const accountHasPendingBuilds = await ensureNoPendingBuildsExistAsync({
      accountName,
      platform,
      projectId,
      user,
    });
    if (accountHasPendingBuilds) {
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
      exp,
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

async function ensureNoPendingBuildsExistAsync({
  user,
  platform,
  accountName,
  projectId,
}: {
  user: Actor;
  platform: RequestedPlatform;
  accountName: string;
  projectId: string;
}): Promise<boolean> {
  // allow expo admins to run as many builds as they wish
  if (user.isExpoAdmin) {
    return false;
  }

  const appPlatforms = toAppPlatforms(platform);
  const maybePendingBuilds = await Promise.all(
    appPlatforms.map(appPlatform => BuildQuery.getPendingBuildIdAsync(accountName, appPlatform))
  );
  const pendingBuilds = maybePendingBuilds.filter(i => i !== null);
  if (pendingBuilds.length > 0) {
    Log.newLine();
    Log.error(
      'Your other builds are still pending. Wait for them to complete before running this command again.'
    );
    Log.newLine();
    const results = await Promise.all(
      pendingBuilds.map(pendingBuild => {
        return apiClient.get<{ data: BuildType }>(
          `projects/${projectId}/builds/${pendingBuild?.id}`,
          {
            responseType: 'json',
          }
        );
      })
    );

    for (const result of results) {
      Log.log(formatBuild(result.body.data, { accountName }));
    }

    process.exitCode = 1;
    return true;
  }
  return false;
}

function toAppPlatforms(requestedPlatform: RequestedPlatform): AppPlatform[] {
  if (requestedPlatform === RequestedPlatform.All) {
    return [AppPlatform.Android, AppPlatform.Ios];
  } else if (requestedPlatform === RequestedPlatform.Android) {
    return [AppPlatform.Android];
  } else {
    return [AppPlatform.Ios];
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
    message: 'This app is not set up for building with EAS. Set it up now?',
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
