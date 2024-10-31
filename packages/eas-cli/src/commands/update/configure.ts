import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import { easJsonExistsAsync } from '../../build/configure';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EASNonInteractiveFlag,
  WithEasEnvironmentVariablesSetFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableEnvironment } from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { RequestedPlatform } from '../../platform';
import {
  ensureEASUpdateIsConfiguredAsync,
  ensureEASUpdateIsConfiguredInEasJsonAsync,
} from '../../update/configure';
import { isEnvironment } from '../../utils/variableUtils';

type RawUpdateConfigureFlags = {
  platform: RequestedPlatform;
  'non-interactive': boolean;
  'with-eas-environment-variables-set'?: string;
};

type UpdateConfigureFlags = {
  platform: RequestedPlatform;
  nonInteractive: boolean;
  withEasEnvironmentVariablesSet: EnvironmentVariableEnvironment | null;
};

export default class UpdateConfigure extends EasCommand {
  static override description = 'configure the project to support EAS Update';

  static override flags = {
    platform: Flags.enum<RequestedPlatform>({
      description: 'Platform to configure',
      char: 'p',
      options: Object.values(RequestedPlatform),
      default: RequestedPlatform.All,
    }),
    ...WithEasEnvironmentVariablesSetFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateConfigure);
    const { platform, nonInteractive, withEasEnvironmentVariablesSet } = this.sanitizeFlags(flags);
    const {
      privateProjectConfig: { projectId, exp, projectDir },
      vcsClient,
    } = await this.getContextAsync(UpdateConfigure, {
      nonInteractive,
      withServerSideEnvironment: withEasEnvironmentVariablesSet,
    });

    Log.log(
      '💡 The following process will configure your project to use EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    await vcsClient.ensureRepoExistsAsync();

    await ensureEASUpdateIsConfiguredAsync({
      exp,
      projectId,
      projectDir,
      platform,
      vcsClient,
      env: undefined,
    });

    await ensureEASUpdateIsConfiguredInEasJsonAsync(projectDir);

    Log.addNewLineIfNone();
    Log.log(`🎉 Your app is configured to use EAS Update!`);
    Log.newLine();
    const easJsonExists = await easJsonExistsAsync(projectDir);
    if (!easJsonExists) {
      Log.log(`- Run ${chalk.bold('eas build:configure')} to complete your installation`);
    }
    Log.log(
      `- ${learnMore('https://docs.expo.dev/eas-update/introduction/', {
        learnMoreMessage: 'Learn more about other capabilities of EAS Update',
      })}`
    );
  }

  private sanitizeFlags(flags: RawUpdateConfigureFlags): UpdateConfigureFlags {
    if (
      flags['with-eas-environment-variables-set'] &&
      !isEnvironment(flags['with-eas-environment-variables-set'])
    ) {
      Errors.error(
        `--with-eas-environment-variables-set must be one of ${Object.values(
          EnvironmentVariableEnvironment
        )
          .map(env => `"${env.toLocaleLowerCase()}"`)
          .join(', ')}`,
        { exit: 1 }
      );
    }

    return {
      platform: flags.platform,
      nonInteractive: flags['non-interactive'],
      withEasEnvironmentVariablesSet: flags['with-eas-environment-variables-set']
        ? isEnvironment(flags['with-eas-environment-variables-set'])
          ? flags['with-eas-environment-variables-set']
          : null
        : null,
    };
  }
}
