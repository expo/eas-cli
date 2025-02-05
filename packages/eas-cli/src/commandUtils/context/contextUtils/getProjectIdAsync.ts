import { ExpoConfig, getProjectConfigDescription } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import chalk from 'chalk';
import semver from 'semver';

import { ExpoGraphqlClient, createGraphqlClient } from './createGraphqlClient';
import { findProjectRootAsync } from './findProjectDirAndVerifyProjectSetupAsync';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import Log, { learnMore } from '../../../log';
import { ora } from '../../../ora';
import {
  createOrModifyExpoConfigAsync,
  getPrivateExpoConfigAsync,
} from '../../../project/expoConfig';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import SessionManager from '../../../user/SessionManager';
import { Actor, getActorUsername } from '../../../user/User';

/**
 * Save an EAS project ID to the appropriate field in the app config.
 *
 * @deprecated Should not be used outside of context functions except in the init command.
 * @deprecated Starting from `@expo/config` from SDK 52, the `modifyConfigAsync` function is merging existing data. Once this is released, we can use that instead of manually merging.
 */
export async function saveProjectIdToAppConfigAsync(
  projectDir: string,
  projectId: string,
  options: { env?: Env } = {}
): Promise<void> {
  // NOTE(cedric): we disable plugins to avoid writing plugin-generated content to `expo.extra`
  const exp = await getPrivateExpoConfigAsync(projectDir, { skipPlugins: true, ...options });
  const result = await createOrModifyExpoConfigAsync(
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

  const projectId = await validateOrSetProjectIdAsync({ exp, graphqlClient, actor, options });
  return projectId;
}

export async function validateOrSetProjectIdAsync({
  exp,
  graphqlClient,
  actor,
  options,
  cwd,
}: {
  exp: ExpoConfig;
  graphqlClient: ExpoGraphqlClient;
  actor: Actor;
  options: { env?: Env; nonInteractive: boolean };
  cwd?: string;
}): Promise<string> {
  const localProjectId = exp.extra?.eas?.projectId;
  if (localProjectId) {
    if (typeof localProjectId !== 'string') {
      throw new Error(
        `Project config: "extra.eas.projectId" must be a string, found ${typeof localProjectId}. If you're not sure how to set it up on your own, remove the property entirely and it will be automatically configured on the next EAS CLI run.`
      );
    }

    // check that the local project ID matches account and slug
    const appForProjectId = await AppQuery.byIdAsync(graphqlClient, localProjectId);
    if (exp.owner && exp.owner !== appForProjectId.ownerAccount.name) {
      throw new Error(
        `Project config: Owner of project identified by "extra.eas.projectId" (${
          appForProjectId.ownerAccount.name
        }) does not match owner specified in the "owner" field (${exp.owner}). ${learnMore(
          'https://expo.fyi/eas-project-id'
        )}`
      );
    }

    const sdkVersion = exp.sdkVersion;
    // SDK 53 and above no longer require owner field in app config
    if (sdkVersion && semver.satisfies(sdkVersion, '< 53.0.0')) {
      const actorUsername = getActorUsername(actor);
      if (!exp.owner && appForProjectId.ownerAccount.name !== actorUsername) {
        if (actorUsername) {
          throw new Error(
            `Project config: Owner of project identified by "extra.eas.projectId" (${
              appForProjectId.ownerAccount.name
            }) does not match the logged in user (${actorUsername}) and the "owner" field is not specified. To ensure all libraries work correctly, "owner": "${
              appForProjectId.ownerAccount.name
            }" should be added to the project config, which can be done automatically by re-running "eas init". ${learnMore(
              'https://expo.fyi/eas-project-id'
            )}`
          );
        } else {
          // robot caller
          throw new Error(
            `Project config: Owner of project identified by "extra.eas.projectId" (${
              appForProjectId.ownerAccount.name
            }) must be specified in "owner" field when using a robot access token. To ensure all libraries work correctly, "owner": "${
              appForProjectId.ownerAccount.name
            }" should be added to the project config, which can be done automatically by re-running "eas init". ${learnMore(
              'https://expo.fyi/eas-project-id'
            )}`
          );
        }
      }
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

  const projectDir = await findProjectRootAsync({
    cwd,
  });
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
      case 'SSOUser':
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
