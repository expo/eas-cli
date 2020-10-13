import { ProjectPrivacy, getConfig } from '@expo/config';
import assert from 'assert';
import chalk from 'chalk';
import gql from 'graphql-tag';
import ora from 'ora';
import pkgDir from 'pkg-dir';

import { apiClient, graphqlClient } from '../api';
import { getUserAsync } from '../user/User';

interface ProjectData {
  accountName: string;
  projectName: string;
  privacy?: ProjectPrivacy;
}

export async function getProjectAccountNameAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  const user = await getUserAsync();
  assert(user, 'You need to be logged in');
  return exp.owner || user.username;
}

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);
  return projectRootDir ?? null;
}

export async function ensureProjectExistsAsync({
  accountName,
  projectName,
  privacy,
}: ProjectData): Promise<string> {
  const projectFullName = `@${accountName}/${projectName}`;

  const spinner = ora(
    `Ensuring project ${chalk.bold(projectFullName)} is registered on Expo servers`
  ).start();

  try {
    const { data, error } = await graphqlClient
      .query(
        gql`
    {
      project {
        byUsernameAndSlug(username: "${accountName}", slug: "${projectName}", sdkVersions: []) {
          id
        }
      }
    }`
      )
      .toPromise();

    if (error) {
      throw error;
    }

    spinner.succeed();
    return data.project.byUsernameAndSlug.id;
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
    const { data } = await apiClient
      .post('projects', {
        json: {
          accountName,
          projectName,
          privacy: privacy || ProjectPrivacy.PUBLIC,
        },
      })
      .json();
    spinner.succeed();
    return data.id;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
