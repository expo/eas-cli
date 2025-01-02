import chalk from 'chalk';

import { getProjectDashboardUrl } from '../build/utils/url';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Role } from '../graphql/generated';
import { AppMutation } from '../graphql/mutations/AppMutation';
import { AppQuery } from '../graphql/queries/AppQuery';
import { link } from '../log';
import { ora } from '../ora';
import { confirmAsync } from '../prompts';
import { Actor } from '../user/User';

/**
 * 1. Looks for an existing project on EAS servers. If found, ask the user whether this is the
 *    project they would like to link. If yes, return that. If not, throw.
 * 2. If no existing project is found, ask the user whether they would like to register a new one.
 *    If yes, register and return that. If not, throw.
 */
export async function fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
  graphqlClient: ExpoGraphqlClient,
  projectInfo: {
    accountName: string;
    projectName: string;
  },
  options: {
    nonInteractive: boolean;
  },
  actor: Actor
): Promise<string> {
  const { accountName, projectName } = projectInfo;
  const projectFullName = `@${accountName}/${projectName}`;

  if (options.nonInteractive) {
    throw new Error(
      `Must configure EAS project by running 'eas init' before this command can be run in non-interactive mode.`
    );
  }

  const allAccounts = actor.accounts;
  const accountNamesWhereUserHasSufficientPublishPermissions = new Set(
    allAccounts
      .filter(a => a.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly)
      .map(it => it.name)
  );
  const account = allAccounts.find(a => a.name === accountName);
  if (!account) {
    throw new Error(
      `You must have access to the ${accountName} account to configure this EAS project.`
    );
  }

  const projectIdOnServer = await findProjectIdByAccountNameAndSlugNullableAsync(
    graphqlClient,
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

  if (!accountNamesWhereUserHasSufficientPublishPermissions.has(accountName)) {
    throw new Error(
      `You don't have permission to create a new project on the ${accountName} account and no matching project already exists on the account.`
    );
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
  const projectLink = link(projectDashboardUrl, { text: projectFullName });

  const spinner = ora(`Creating ${chalk.bold(projectFullName)} on EAS`).start();
  try {
    const id = await AppMutation.createAppAsync(graphqlClient, {
      accountId: account.id,
      projectName,
    });
    spinner.succeed(`Created ${chalk.bold(projectLink)} on EAS`);
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
export async function findProjectIdByAccountNameAndSlugNullableAsync(
  graphqlClient: ExpoGraphqlClient,
  accountName: string,
  slug: string
): Promise<string | null> {
  try {
    const { id } = await AppQuery.byFullNameAsync(graphqlClient, `@${accountName}/${slug}`);
    return id;
  } catch (err: any) {
    if (err.graphQLErrors?.some((it: any) => it.extensions?.errorCode !== 'EXPERIENCE_NOT_FOUND')) {
      throw err;
    }
    return null;
  }
}
