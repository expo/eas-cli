import { ExpoConfig } from '@expo/config';
import chalk from 'chalk';
import ora from 'ora';

import { apiClient } from '../api';
import { ProjectQuery } from '../graphql/queries/ProjectQuery';

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

  const spinner = ora(`Linking to project ${chalk.bold(projectFullName)}`).start();

  try {
    const id = await findProjectIdByAccountNameAndSlugAsync(accountName, projectName);
    spinner.succeed(`Linked to project ${chalk.bold(projectFullName)}`);
    return id;
  } catch (err) {
    if (err.graphQLErrors?.some((it: any) => it.extensions?.errorCode !== 'EXPERIENCE_NOT_FOUND')) {
      spinner.fail(`Something went wrong while looking for ${chalk.bold(projectFullName)} on Expo`);
      throw err;
    }
  }

  try {
    spinner.text = `Creating ${chalk.bold(projectFullName)} on Expo`;
    const id = await registerNewProjectAsync(projectInfo);
    spinner.succeed(`Created ${chalk.bold(projectFullName)} on Expo`);
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
async function findProjectIdByAccountNameAndSlugAsync(
  accountName: string,
  slug: string
): Promise<string> {
  const project = await ProjectQuery.byUsernameAndSlugAsync(accountName, slug);
  return project.id;
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
