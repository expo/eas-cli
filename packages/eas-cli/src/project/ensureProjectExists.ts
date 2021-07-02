import assert from 'assert';
import chalk from 'chalk';
import ora from 'ora';

import { AppPrivacy } from '../graphql/generated';
import { AppMutation } from '../graphql/mutations/AppMutation';
import { ProjectQuery } from '../graphql/queries/ProjectQuery';
import { findAccountByName } from '../user/Account';
import { ensureLoggedInAsync } from '../user/actions';

interface ProjectInfo {
  accountName: string;
  projectName: string;
  privacy?: AppPrivacy;
}

/**
 * Ensures project exists on EAS servers. Registers it when it doesn't
 * @returns The project ID
 */
export async function ensureProjectExistsAsync(projectInfo: ProjectInfo): Promise<string> {
  const { accountName, projectName } = projectInfo;

  const actor = await ensureLoggedInAsync();
  const account = findAccountByName(actor.accounts, accountName);
  assert(account, `You must have access to the ${accountName} account to run this command`);

  const projectFullName = `@${accountName}/${projectName}`;

  const spinner = ora(`Linking to project ${chalk.bold(projectFullName)}`).start();

  const maybeId = await findProjectIdByAccountNameAndSlugNullableAsync(accountName, projectName);
  if (maybeId) {
    spinner.succeed(`Linked to project ${chalk.bold(projectFullName)}`);
    return maybeId;
  }

  try {
    spinner.text = `Creating ${chalk.bold(projectFullName)} on Expo`;
    const id = await registerNewProjectAsync({
      accountId: account.id,
      projectName,
      privacy: projectInfo.privacy,
    });
    spinner.succeed(`Created ${chalk.bold(projectFullName)} on Expo`);
    return id;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

/**
 * Finds project by `@accountName/slug` and returns its ID, return null if the project does not exist
 * @param accountName account name
 * @param slug project slug
 * @returns A promise resolving to Project ID, null if it doesn't exist
 */
export async function findProjectIdByAccountNameAndSlugNullableAsync(
  accountName: string,
  slug: string
): Promise<string | null> {
  try {
    return await findProjectIdByAccountNameAndSlugAsync(accountName, slug);
  } catch (err) {
    if (err.graphQLErrors?.some((it: any) => it.extensions?.errorCode !== 'EXPERIENCE_NOT_FOUND')) {
      throw err;
    }
    return null;
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
 * Registers new project on EAS servers
 * @returns Created project's ID
 */
export async function registerNewProjectAsync({
  accountId,
  projectName,
  privacy,
}: {
  accountId: string;
  projectName: string;
  privacy?: AppPrivacy;
}): Promise<string> {
  return AppMutation.createAppAsync({
    accountId,
    projectName,
    privacy: privacy ?? AppPrivacy.Public,
  });
}
