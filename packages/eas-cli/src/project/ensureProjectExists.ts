import { ExpoConfig } from '@expo/config';
import chalk from 'chalk';
import gql from 'graphql-tag';
import ora from 'ora';

import { apiClient, graphqlClient } from '../api';

interface ProjectInfo {
  accountName: string;
  projectName: string;
  privacy?: ExpoConfig['privacy'];
}

/**
 * Ensures project exists on Expo servers. Registers it when it doesn't
 * @returns The project ID
 */
export async function ensureProjectExistsAsync(projectInfo: ProjectInfo): Promise<string> {
  const { accountName, projectName } = projectInfo;
  const projectFullName = `@${accountName}/${projectName}`;

  const spinner = ora(
    `Ensuring project ${chalk.bold(projectFullName)} is registered on Expo servers`
  ).start();

  try {
    const id = await findProjectIdByUsernameAndSlugAsync(accountName, projectName);
    spinner.succeed();
    return id;
  } catch (err) {
    if (err.grapgQLErrors?.some((it: any) => it.extensions?.errorCode !== 'EXPERIENCE_NOT_FOUND')) {
      spinner.fail(
        `Something went wrong when looking for project ${chalk.bold(
          projectFullName
        )} on Expo servers`
      );
      throw err;
    }
  }

  try {
    spinner.text = `Registering project ${chalk.bold(projectFullName)} on Expo servers`;
    const id = await registerNewProjectAsync(projectInfo);
    spinner.succeed();
    return id;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

/**
 * Finds project by `@accountName/slug` and returns its ID
 * @param accountName account name
 * @param slug project slug
 * @returns A promise resolving to Project ID
 */
async function findProjectIdByUsernameAndSlugAsync(
  accountName: string,
  slug: string
): Promise<string> {
  const { data, error } = await graphqlClient
    .query(
      gql`
      {
        project {
          byUsernameAndSlug(username: "${accountName}", slug: "${slug}", sdkVersions: []) {
            id
          }
        }
      }`
    )
    .toPromise();

  if (error) {
    throw error;
  }
  return data.project.byUsernameAndSlug.id;
}

/**
 * Registers new project on Expo servers
 * @returns Created project's ID
 */
async function registerNewProjectAsync({
  accountName,
  projectName,
  privacy,
}: ProjectInfo): Promise<string> {
  const { data } = await apiClient
    .post('projects', {
      json: {
        accountName,
        projectName,
        privacy: privacy ?? 'public',
      },
    })
    .json();
  return data.id;
}
