import { Flags } from '@oclif/core';

import { handleDeprecatedEasJsonAsync } from '.';
import { LocalBuildMode } from '../../build/local';
import { runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import EasCommand from '../../commandUtils/EasCommand';
import { RequestedPlatform } from '../../platform';
import { enableJsonOutput } from '../../utils/json';
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
    'auto-submit': Flags.boolean({
      default: false,
      description:
        'Submit on build complete using the submit profile with the same name as the build profile',
      exclusive: ['auto-submit-with-profile'],
    }),
    'auto-submit-with-profile': Flags.string({
      description: 'Submit on build complete using the submit profile with provided name',
      helpValue: 'PROFILE_NAME',
      exclusive: ['auto-submit'],
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.SessionManagment,
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
      vcsClient,
      sessionManager,
    } = await this.getContextAsync(BuildInternal, {
      nonInteractive: true,
      vcsClientOverride: new GitNoCommitClient(),
    });

    await handleDeprecatedEasJsonAsync(projectDir, flags.nonInteractive);

    await runBuildAndSubmitAsync(
      graphqlClient,
      analytics,
      vcsClient,
      projectDir,
      {
        requestedPlatform: flags.platform as RequestedPlatform,
        profile: flags.profile,
        nonInteractive: true,
        freezeCredentials: false,
        wait: false,
        clearCache: false,
        json: true,
        autoSubmit: flags['auto-submit'] || flags['auto-submit-with-profile'] !== undefined,
        localBuildOptions: {
          localBuildMode: LocalBuildMode.INTERNAL,
        },
        submitProfile: flags['auto-submit-with-profile'] ?? flags.profile,
        repack: false,
      },
      actor,
      getDynamicPrivateProjectConfigAsync,
      sessionManager
    );
  }
}
