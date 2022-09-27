import { getProjectConfigDescription, modifyConfigAsync } from '@expo/config';
import { ExpoConfig } from '@expo/config-types';
import { Env } from '@expo/eas-build-job';
import chalk from 'chalk';

import Log from '../../log';
import { ora } from '../../ora';
import { getExpoConfig } from '../../project/expoConfig';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { toAppPrivacy } from '../../project/projectUtils';
import { Actor } from '../../user/User';
import ActorContextField from './ActorContextField';
import ContextField, { ContextOptions } from './ContextField';
import ProjectDirContextField from './ProjectDirContextField';

export default class ProjectConfigContextField extends ContextField<{
  projectId: string;
  exp: ExpoConfig;
}> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<{
    projectId: string;
    exp: ExpoConfig;
  }> {
    const projectDir = await ProjectDirContextField['findProjectDirAndVerifyProjectSetupAsync']();
    const expBefore = getExpoConfig(projectDir);
    const projectId = await ProjectConfigContextField.getProjectIdAsync(expBefore, {
      nonInteractive,
    });
    const exp = getExpoConfig(projectDir);

    return {
      projectId,
      exp,
    };
  }

  /**
   * Save an EAS project ID to the appropriate field in the app config.
   */
  private static async saveProjectIdToAppConfigAsync(
    projectDir: string,
    projectId: string,
    options: { env?: Env } = {}
  ): Promise<void> {
    const exp = getExpoConfig(projectDir, options);
    const result = await modifyConfigAsync(projectDir, {
      extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
    });

    switch (result.type) {
      case 'success':
        break;
      case 'warn': {
        Log.warn();
        Log.warn(
          `Warning: Your project uses dynamic app configuration, and the EAS project ID can't automatically be added to it.`
        );
        Log.warn(
          chalk.dim(
            'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs'
          )
        );
        Log.warn();
        Log.warn(
          `To complete the setup process, set the ${chalk.bold(
            'extra.eas.projectId'
          )} in your ${chalk.bold(getProjectConfigDescription(projectDir))}:`
        );
        Log.warn();
        Log.warn(chalk.bold(JSON.stringify({ expo: { extra: { eas: { projectId } } } }, null, 2)));
        Log.warn();
        throw new Error(result.message);
      }
      case 'fail':
        throw new Error(result.message);
      default:
        throw new Error('Unexpected result type from modifyConfigAsync');
    }
  }

  /**
   * Get the EAS project ID from the app config. If the project ID is not set in the config,
   * use the owner/slug to identify an EAS project on the server (asking for confirmation first),
   * and attempt to save the EAS project ID to the appropriate field in the app config. If unable to
   * save to the app config, throw an error.
   */
  private static async getProjectIdAsync(
    exp: ExpoConfig,
    options: { env?: Env; nonInteractive: boolean }
  ): Promise<string> {
    const localProjectId = exp.extra?.eas?.projectId;
    if (localProjectId) {
      return localProjectId;
    }

    const projectDir = await ProjectDirContextField['findProjectRootAsync']();
    if (!projectDir) {
      throw new Error('This command must be run inside a project directory.');
    }

    Log.warn('EAS project not configured.');

    const getAccountNameForEASProjectSync = (exp: ExpoConfig, user: Actor): string => {
      if (exp.owner) {
        return exp.owner;
      }
      switch (user.__typename) {
        case 'User':
          return user.username;
        case 'Robot':
          throw new Error(
            'The "owner" manifest property is required when using robot users. See: https://docs.expo.dev/versions/latest/config/app/#owner'
          );
      }
    };

    const actor = await ActorContextField['ensureLoggedInAsync']({
      nonInteractive: options.nonInteractive,
    });
    const projectId = await fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
      {
        accountName: getAccountNameForEASProjectSync(exp, actor),
        projectName: exp.slug,
        privacy: toAppPrivacy(exp.privacy),
      },
      {
        nonInteractive: options.nonInteractive,
      },
      actor
    );

    const spinner = ora(`Linking local project to EAS project ${projectId}`).start();
    try {
      await this.saveProjectIdToAppConfigAsync(projectDir, projectId, options);
      spinner.succeed(`Linked local project to EAS project ${projectId}`);
    } catch (e: any) {
      spinner.fail();
      throw e;
    }

    return projectId;
  }
}
