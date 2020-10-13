import { ProjectPrivacy } from '@expo/config';
import gql from 'graphql-tag';
import ora from 'ora';
import pkgDir from 'pkg-dir';

import { apiClient, graphqlClient } from './api';
import log from './log';

interface ProjectData {
  accountName: string;
  projectName: string;
  privacy?: ProjectPrivacy;
}

export async function ensureProjectExistsAsync({
  accountName,
  projectName,
  privacy,
}: ProjectData): Promise<string> {
  const projectFullName = `@${accountName}/${projectName}`;

  const spinner = ora(
    `Ensuring project ${log.chalk.bold(projectFullName)} is registered on Expo servers`
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
    console.log(err);
    if (err.grapgQLErrors?.some((it: any) => it.extensions?.errorCode !== 'EXPERIENCE_NOT_FOUND')) {
      spinner.fail(
        `Something went wrong when looking for project ${log.chalk.bold(
          projectFullName
        )} on Expo servers`
      );
      throw err;
    }
  }

  try {
    spinner.text = `Registering project ${log.chalk.bold(projectFullName)} on Expo servers`;
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

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);

  return projectRootDir ?? null;
}
