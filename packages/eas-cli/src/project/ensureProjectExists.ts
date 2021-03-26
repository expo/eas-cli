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
async function registerNewProjectAsync({
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
