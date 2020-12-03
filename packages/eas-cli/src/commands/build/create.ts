import { Command, flags } from '@oclif/command';
import { v4 as uuidv4 } from 'uuid';

import { createCommandContextAsync } from '../../build/context';
import { buildAsync } from '../../build/create';
import { AnalyticsEvent, BuildCommandPlatform } from '../../build/types';
import Analytics from '../../build/utils/analytics';
import {
  isEasEnabledForProjectAsync,
  warnEasUnavailable,
} from '../../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';

export default class BuildCreate extends Command {
  static description = 'Start a build';

  static flags = {
    platform: flags.enum({ char: 'p', options: ['android', 'ios', 'all'], required: true }),
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
    const { flags } = this.parse(BuildCreate);
    await ensureLoggedInAsync();

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const projectId = await getProjectIdAsync(projectDir);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    const trackingCtx = {
      tracking_id: uuidv4(),
      requested_platform: flags.platform,
    };
    Analytics.logEvent(AnalyticsEvent.BUILD_COMMAND, trackingCtx);

    const commandCtx = await createCommandContextAsync({
      requestedPlatform: flags.platform as BuildCommandPlatform,
      profile: flags.profile,
      projectDir,
      projectId,
      trackingCtx,
      nonInteractive: flags['non-interactive'],
      skipCredentialsCheck: flags['skip-credentials-check'],
      skipProjectConfiguration: flags['skip-project-configuration'],
      waitForBuildEnd: flags.wait,
    });
    await buildAsync(commandCtx);
  }
}
