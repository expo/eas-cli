import chalk from 'chalk';
import terminalLink from 'terminal-link';

import { getProjectDashboardUrl } from '../build/utils/url';
import { AppPrivacy } from '../graphql/generated';
import { AppMutation } from '../graphql/mutations/AppMutation';
import { AppQuery } from '../graphql/queries/AppQuery';
import { ora } from '../ora';
import { confirmAsync } from '../prompts';
import { findAccountByName } from '../user/Account';
import { ensureLoggedInAsync } from '../user/actions';

/**
 * 1. Looks for an existing project on EAS servers. If found, ask the user whether this is the
 *    project they would like to link. If yes, return that. If not, throw.
 * 2. If no existing project is found, ask the user whether they would like to register a new one.
 *    If yes, register and return that. If not, throw.
 */
export async function fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
  projectInfo: {
    accountName: string;
    projectName: string;
    privacy?: AppPrivacy;
  },
  options: {
    nonInteractive: boolean;
  }
): Promise<string> {
  const { accountName, projectName } = projectInfo;
  const projectFullName = `@${accountName}/${projectName}`;

  if (options.nonInteractive) {
    throw new Error(
      `Must configure EAS project by running 'eas init' before this command can be run in non-interactive mode.`
    );
  }

  const actor = await ensureLoggedInAsync({ nonInteractive: options.nonInteractive });
  const account = findAccountByName(actor.accounts, accountName);
  if (!account) {
    throw new Error(
      `You must have access to the ${accountName} account to configure this EAS project.`
    );
  }

  const projectIdOnServer = await findProjectIdByAccountNameAndSlugNullableAsync(
    accountName,
    projectName
  );
  if (projectIdOnServer) {
    const affirmedLink = await confirmAsync({
      message: `Existing EAS project found for ${projectFullName} (id = ${projectIdOnServer}). Configure this project?`,
    });
    if (!affirmedLink) {
      throw new Error(
        `EAS project ID configuration canceled for ${projectFullName}. Run 'eas init' to configure.`
      );
    }
    return projectIdOnServer;
  }

  const affirmedCreate = await confirmAsync({
    message: `Would you like to automatically create an EAS project for ${projectFullName}?`,
  });
  if (!affirmedCreate) {
    throw new Error(
      `EAS project ID configuration canceled for ${projectFullName}. Run 'eas init' to configure.`
    );
  }

  const projectDashboardUrl = getProjectDashboardUrl(accountName, projectName);
  const projectLink = terminalLink(projectFullName, projectDashboardUrl, {
    // https://github.com/sindresorhus/terminal-link/issues/18#issuecomment-1068020361
    fallback: () => `${projectFullName} (${projectDashboardUrl})`,
  });

  const spinner = ora(`Creating ${chalk.bold(projectFullName)} on Expo`).start();
  try {
    const id = await AppMutation.createAppAsync({
      accountId: account.id,
      projectName,
      privacy: projectInfo.privacy ?? AppPrivacy.Public,
    });
    spinner.succeed(`Created ${chalk.bold(projectLink)} on Expo`);
    return id;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

/**
 * Finds project by `@accountName/slug` and returns its ID, return null if the project does not exist.
 * @param accountName account name
 * @param slug project slug
 * @returns A promise resolving to Project ID, null if it doesn't exist
 */
async function findProjectIdByAccountNameAndSlugNullableAsync(
  accountName: string,
  slug: string
): Promise<string | null> {
  try {
    const { id } = await AppQuery.byFullNameAsync(`@${accountName}/${slug}`);
    return id;
  } catch (err: any) {
    if (err.graphQLErrors?.some((it: any) => it.extensions?.errorCode !== 'EXPERIENCE_NOT_FOUND')) {
      throw err;
    }
    return null;
  }
}
