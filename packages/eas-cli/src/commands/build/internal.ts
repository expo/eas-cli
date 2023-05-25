import { Flags } from '@oclif/core';

import { handleDeprecatedEasJsonAsync } from '.';
import { LocalBuildMode } from '../../build/local';
import { runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import EasCommand from '../../commandUtils/EasCommand';
import { RequestedPlatform } from '../../platform';
import { enableJsonOutput } from '../../utils/json';
import { setVcsClient } from '../../vcs';
import GitNoCommitClient from '../../vcs/clients/gitNoCommit';

/**
 * This command will be run on the EAS Build workers, when building
 * directly from git. This command resolves credentials and other
 * build configuration, that normally would be included in the
 * job and metadata objects, and prints them to stdout.
 */
export default class BuildInternal extends EasCommand {
  static override hidden = true;

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
      required: true,
    }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Analytics,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildInternal);
    // This command is always run with implicit --non-interactive and --json options
    enableJsonOutput();

    const {
      loggedIn: { actor, graphqlClient },
      getDynamicPrivateProjectConfigAsync,
      projectDir,
      analytics,
    } = await this.getContextAsync(BuildInternal, {
      nonInteractive: true,
    });

    setVcsClient(new GitNoCommitClient());

    await handleDeprecatedEasJsonAsync(projectDir, flags.nonInteractive);

    await runBuildAndSubmitAsync(
      graphqlClient,
      analytics,
      projectDir,
      {
        requestedPlatform: flags.platform as RequestedPlatform,
        profile: flags.profile,
        nonInteractive: true,
        wait: false,
        clearCache: false,
        json: true,
        autoSubmit: false,
        localBuildOptions: {
          localBuildMode: LocalBuildMode.INTERNAL,
        },
      },
      actor,
      getDynamicPrivateProjectConfigAsync
    );
  }
}
