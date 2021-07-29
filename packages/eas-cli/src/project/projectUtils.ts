import { AppJSONConfig, ExpoConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import chalk from 'chalk';
import gql from 'graphql-tag';
import path from 'path';
import pkgDir from 'pkg-dir';

import { graphqlClient, withErrorHandlingAsync } from '../graphql/client';
import { AppPrivacy, UpdateBranch } from '../graphql/generated';
import Log from '../log';
import { confirmAsync } from '../prompts';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import {
  ensureProjectExistsAsync,
  findProjectIdByAccountNameAndSlugNullableAsync,
} from './ensureProjectExists';
import { getExpoConfig } from './expoConfig';

export function getProjectAccountName(exp: ExpoConfig, user: Actor): string {
  switch (user.__typename) {
    case 'User':
      return exp.owner || user.username;
    case 'Robot':
      if (!exp.owner) {
        throw new Error(
          'The "owner" manifest property is required when using robot users. See: https://docs.expo.io/versions/latest/config/app/#owner'
        );
      }
      return exp.owner;
  }
}

export function getUsername(exp: ExpoConfig, user: Actor): string | undefined {
  switch (user.__typename) {
    case 'User':
      return user.username;
    case 'Robot':
      // owner field is necessary to run `expo prebuild`
      if (!exp.owner) {
        throw new Error(
          'The "owner" manifest property is required when using robot users. See: https://docs.expo.io/versions/latest/config/app/#owner'
        );
      }
      // robot users don't have usernames
      return undefined;
  }
}

export async function getProjectAccountNameAsync(exp: ExpoConfig): Promise<string> {
  const user = await ensureLoggedInAsync();
  return getProjectAccountName(exp, user);
}

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);
  return projectRootDir ?? null;
}

export async function setProjectIdAsync(
  projectDir: string,
  options: { env?: Env } = {}
): Promise<ExpoConfig | undefined> {
  const exp = getExpoConfig(projectDir, options);

  const privacy = toAppPrivacy(exp.privacy);
  const projectId = await ensureProjectExistsAsync({
    accountName: getProjectAccountName(exp, await ensureLoggedInAsync()),
    projectName: exp.slug,
    privacy,
  });

  const result = await modifyConfigAsync(projectDir, {
    extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
  });

  switch (result.type) {
    case 'success':
      break;
    case 'warn': {
      Log.log();
      Log.warn('It looks like you are using a dynamic configuration!');
      Log.log(
        chalk.dim(
          'https://docs.expo.io/workflow/configuration/#dynamic-configuration-with-appconfigjs)\n'
        )
      );
      Log.warn(
        'In order to finish setting up your project you are going to need manually add the following to your "extra" key:\n\n'
      );
      Log.log(chalk.bold(`"extra": {\n  ...\n  "eas": {\n    "projectId": "${projectId}"\n  }\n}`));
      throw new Error(result.message);
    }
    case 'fail':
      throw new Error(result.message);
    default:
      throw new Error('Unexpected result type from modifyConfigAsync');
  }

  Log.withTick(`Linked app.json to project with ID ${chalk.bold(projectId)}`);
  /**
   * result.config will always be an AppJSONConfig if result.type === 'success'
   * PR to fix this typing: https://github.com/expo/expo-cli/pull/3482/files
   *
   * Code is written to safely handle the case where config type is not
   * AppJSONConfig (namely there will be no expo key and the result will be undefined).
   * TODO-JJ delete AppJSONConfig casting once typing is updated in the published @expo/config and
   * remove undefined alternative from return type
   */
  return (result.config as AppJSONConfig)?.expo;
}

export async function getProjectIdAsync(
  exp: ExpoConfig,
  options: { env?: Env } = {}
): Promise<string> {
  if (!process.env.EAS_ENABLE_PROJECT_ID) {
    const privacy = toAppPrivacy(exp.privacy);
    return await ensureProjectExistsAsync({
      accountName: getProjectAccountName(exp, await ensureLoggedInAsync()),
      projectName: exp.slug,
      privacy,
    });
  }

  const localProjectId = exp.extra?.eas?.projectId;
  if (localProjectId) {
    return localProjectId;
  }

  // Set the project ID if it is missing.
  const projectDir = await findProjectRootAsync(process.cwd());
  if (!projectDir) {
    throw new Error('Please run this command inside a project directory.');
  }
  const newExp = await setProjectIdAsync(projectDir, options);

  const newLocalProjectId = newExp?.extra?.eas?.projectId;
  if (!newLocalProjectId) {
    // throw if we still can't locate the projectId
    throw new Error('Could not retrieve project ID from app.json');
  }
  return newLocalProjectId;
}

const toAppPrivacy = (privacy: ExpoConfig['privacy']) => {
  if (privacy === 'public') {
    return AppPrivacy.Public;
  } else if (privacy === 'hidden') {
    return AppPrivacy.Hidden;
  } else {
    return AppPrivacy.Unlisted;
  }
};

export async function getProjectFullNameAsync(exp: ExpoConfig): Promise<string> {
  const accountName = await getProjectAccountNameAsync(exp);
  return `@${accountName}/${exp.slug}`;
}

/**
 * Return a useful name describing the project config.
 * - dynamic: app.config.js
 * - static: app.json
 * - custom path app config relative to root folder
 * - both: app.config.js or app.json
 */
export function getProjectConfigDescription(projectDir: string): string {
  const paths = getConfigFilePaths(projectDir);
  if (paths.dynamicConfigPath) {
    const relativeDynamicConfigPath = path.relative(projectDir, paths.dynamicConfigPath);
    if (paths.staticConfigPath) {
      return `${relativeDynamicConfigPath} or ${path.relative(projectDir, paths.staticConfigPath)}`;
    }
    return relativeDynamicConfigPath;
  } else if (paths.staticConfigPath) {
    return path.relative(projectDir, paths.staticConfigPath);
  }
  return 'app.config.js/app.json';
}

export async function getBranchByNameAsync({
  appId,
  name,
}: {
  appId: string;
  name: string;
}): Promise<UpdateBranch> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<
        {
          app: {
            byId: {
              updateBranchByName: UpdateBranch;
            };
          };
        },
        {
          appId: string;
          name: string;
        }
      >(
        gql`
          query ViewBranch($appId: String!, $name: String!) {
            app {
              byId(appId: $appId) {
                id
                updateBranchByName(name: $name) {
                  id
                  name
                }
              }
            }
          }
        `,
        {
          appId,
          name,
        }
      )
      .toPromise()
  );
  return data.app.byId.updateBranchByName;
}

// copy-pasted from expo-cli
// https://github.com/expo/expo-cli/blob/master/packages/expo-cli/src/utils/extractTemplateAppAsync.ts#L15
export function sanitizedProjectName(name: string) {
  return name
    .replace(/[\W_]+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// return project id of existing/newly created project, or null if user declines
export async function promptToCreateProjectIfNotExistsAsync(
  exp: ExpoConfig
): Promise<string | null> {
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
  const maybeProjectId = await findProjectIdByAccountNameAndSlugNullableAsync(
    accountName,
    exp.slug
  );
  if (maybeProjectId) {
    return maybeProjectId;
  }
  const fullName = await getProjectFullNameAsync(exp);
  const shouldCreateProject = await confirmAsync({
    message: `Looks like ${fullName} is new. Register it with EAS?`,
  });
  if (!shouldCreateProject) {
    return null;
  }
  const privacy = toAppPrivacy(exp.privacy);
  return await ensureProjectExistsAsync({
    accountName,
    projectName: exp.slug,
    privacy,
  });
}
