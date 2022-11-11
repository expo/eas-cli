import { getProjectConfigDescription, modifyConfigAsync } from '@expo/config';
import { ExpoConfig } from '@expo/config-types';
import { Env } from '@expo/eas-build-job';
import chalk from 'chalk';

import { AppQuery } from '../../../graphql/queries/AppQuery';
import Log, { learnMore } from '../../../log';
import { ora } from '../../../ora';
import { getExpoConfig } from '../../../project/expoConfig';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { toAppPrivacy } from '../../../project/projectUtils';
import SessionManager from '../../../user/SessionManager';
import { Actor } from '../../../user/User';
import { createGraphqlClient } from './createGraphqlClient';
import { findProjectRootAsync } from './findProjectDirAndVerifyProjectSetupAsync';

/**
 * Save an EAS project ID to the appropriate field in the app config.
 *
 * @deprecated Should not be used outside of context functions except in the init command.
 */
export async function saveProjectIdToAppConfigAsync(
  projectDir: string,
  projectId: string,
  options: { env?: Env } = {}
): Promise<void> {
  const exp = getExpoConfig(projectDir, options);
  const result = await modifyConfigAsync(
    projectDir,
    {
      extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
    },
    { skipSDKVersionRequirement: true }
  );

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
        `To complete the setup process, set "${chalk.bold(
          'extra.eas.projectId'
        )}" in your ${chalk.bold(getProjectConfigDescription(projectDir))}:`
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
 *
 * @returns the EAS project ID
 *
 * @deprecated Should not be used outside of context functions.
 */
export async function getProjectIdAsync(
  sessionManager: SessionManager,
  exp: ExpoConfig,
  options: { env?: Env; nonInteractive: boolean }
): Promise<string> {
  // all codepaths in this function require a logged-in user with access to the owning account
  // since they either query the app via graphql or create it, which includes getting info about
  // the owner
  const { actor, authenticationInfo } = await sessionManager.ensureLoggedInAsync({
    nonInteractive: options.nonInteractive,
  });
  const graphqlClient = createGraphqlClient(authenticationInfo);

  const localProjectId = exp.extra?.eas?.projectId;
  if (localProjectId) {
    // check that the local project ID matches account and slug
    const appForProjectId = await AppQuery.byIdAsync(graphqlClient, localProjectId);
    if (exp.owner && exp.owner !== appForProjectId.ownerAccount.name) {
      throw new Error(
        `Project config: Project identified by "extra.eas.projectId" (${
          appForProjectId.ownerAccount.name
        }) is not owned by owner specified in the "owner" field (${exp.owner}). ${learnMore(
          'https://expo.fyi/eas-project-id'
        )}`
      );
    }

    if (exp.slug && exp.slug !== appForProjectId.slug) {
      throw new Error(
        `Project config: Slug for project identified by "extra.eas.projectId" (${
          appForProjectId.slug
        }) does not match the "slug" field (${exp.slug}). ${learnMore(
          'https://expo.fyi/eas-project-id'
        )}`
      );
    }

    return localProjectId;
  }

  const projectDir = await findProjectRootAsync();
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

  const projectId = await fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
    graphqlClient,
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
    await saveProjectIdToAppConfigAsync(projectDir, projectId, options);
    spinner.succeed(`Linked local project to EAS project ${projectId}`);
  } catch (e: any) {
    spinner.fail();
    throw e;
  }

  return projectId;
}
