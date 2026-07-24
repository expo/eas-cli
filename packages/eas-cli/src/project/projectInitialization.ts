import { ConfigError, ExpoConfig, getProjectConfigDescription } from '@expo/config';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import {
  getAccountChoices,
  getAccountNamesWhereUserHasSufficientPermissionsToCreateApp,
} from './accountSelection';
import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from './expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from './fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { getProjectDashboardUrl } from '../build/utils/url';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { saveProjectIdToAppConfigAsync } from '../commandUtils/context/contextUtils/getProjectIdAsync';
import { validSlugName, validateFullNameAndSlug } from '../commandUtils/projectNameValidation';
import { AppMutation } from '../graphql/mutations/AppMutation';
import { AppQuery } from '../graphql/queries/AppQuery';
import Log, { link } from '../log';
import { ora } from '../ora';
import { confirmAsync, promptAsync } from '../prompts';
import { Actor } from '../user/User';

export type InitializeMethodOptions = {
  force: boolean;
  nonInteractive: boolean;
};

async function saveProjectIdAndLogSuccessAsync(
  projectDir: string,
  projectId: string
): Promise<void> {
  await saveProjectIdToAppConfigAsync(projectDir, projectId);
  Log.withTick(`Project successfully linked (ID: ${chalk.bold(projectId)}) (modified app.json)`);
}

async function modifyExpoConfigAsync(
  projectDir: string,
  modifications: Partial<ExpoConfig>
): Promise<void> {
  let result;
  try {
    result = await createOrModifyExpoConfigAsync(projectDir, modifications);
  } catch (error) {
    if (error instanceof ConfigError && error.code === 'MODULE_NOT_FOUND') {
      Log.warn(
        'Cannot determine which native SDK version your project uses because the module `expo` is not installed.'
      );
      return;
    } else {
      throw error;
    }
  }
  switch (result.type) {
    case 'success':
      break;
    case 'warn': {
      Log.warn();
      Log.warn(
        `Warning: Your project uses dynamic app configuration, and cannot be automatically modified.`
      );
      Log.warn(
        chalk.dim(
          'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs'
        )
      );
      Log.warn();
      Log.warn(
        `To complete the setup process, add the following in your ${chalk.bold(
          getProjectConfigDescription(projectDir)
        )}:`
      );
      Log.warn();
      Log.warn(chalk.bold(JSON.stringify(modifications, null, 2)));
      Log.warn();
      throw new Error(result.message);
    }
    case 'fail':
      throw new Error(result.message);
    default:
      throw new Error('Unexpected result type from modifyConfigAsync');
  }
}

export async function ensureOwnerSlugConsistencyAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  projectDir: string,
  { force, nonInteractive }: InitializeMethodOptions
): Promise<void> {
  const exp = await getPrivateExpoConfigAsync(projectDir);
  const appForProjectId = await AppQuery.byIdAsync(graphqlClient, projectId);
  const correctOwner = appForProjectId.ownerAccount.name;
  const correctSlug = appForProjectId.slug;

  if (exp.owner && exp.owner !== correctOwner) {
    if (force) {
      await modifyExpoConfigAsync(projectDir, { owner: correctOwner });
    } else {
      const message = `Project owner (${correctOwner}) does not match the value configured in the "owner" field (${exp.owner}).`;
      if (nonInteractive) {
        throw new Error(`Project config error: ${message} Use --force flag to overwrite.`);
      }

      const confirm = await confirmAsync({
        message: `${message}. Do you wish to overwrite it?`,
      });
      if (!confirm) {
        throw new Error('Aborting');
      }

      await modifyExpoConfigAsync(projectDir, { owner: correctOwner });
    }
  } else if (!exp.owner) {
    await modifyExpoConfigAsync(projectDir, { owner: correctOwner });
  }

  if (exp.slug && exp.slug !== correctSlug) {
    if (force) {
      await modifyExpoConfigAsync(projectDir, { slug: correctSlug });
    } else {
      const message = `Project slug (${correctSlug}) does not match the value configured in the "slug" field (${exp.slug}).`;
      if (nonInteractive) {
        throw new Error(`Project config error: ${message} Use --force flag to overwrite.`);
      }

      const confirm = await confirmAsync({
        message: `${message}. Do you wish to overwrite it?`,
      });
      if (!confirm) {
        throw new Error('Aborting');
      }

      await modifyExpoConfigAsync(projectDir, { slug: correctSlug });
    }
  } else if (!exp.slug) {
    await modifyExpoConfigAsync(projectDir, { slug: correctSlug });
  }
}

async function setExplicitIDAsync(
  projectId: string,
  projectDir: string,
  { force, nonInteractive }: InitializeMethodOptions
): Promise<void> {
  const exp = await getPrivateExpoConfigAsync(projectDir);
  const existingProjectId = exp.extra?.eas?.projectId;

  if (projectId === existingProjectId) {
    Log.succeed(`Project already linked (ID: ${chalk.bold(existingProjectId)})`);
    return;
  }

  if (!existingProjectId) {
    await saveProjectIdAndLogSuccessAsync(projectDir, projectId);
    return;
  }

  if (projectId !== existingProjectId) {
    if (force) {
      await saveProjectIdAndLogSuccessAsync(projectDir, projectId);
      return;
    }

    if (nonInteractive) {
      throw new Error(
        `Project is already linked to a different ID: ${chalk.bold(
          existingProjectId
        )}. Use --force flag to overwrite.`
      );
    }

    const confirm = await confirmAsync({
      message: `Project is already linked to a different ID: ${chalk.bold(
        existingProjectId
      )}. Do you wish to overwrite it?`,
    });
    if (!confirm) {
      throw new Error('Aborting');
    }

    await saveProjectIdAndLogSuccessAsync(projectDir, projectId);
  }
}

export async function initializeWithExplicitIDAsync(
  projectId: string,
  projectDir: string,
  { force, nonInteractive }: InitializeMethodOptions
): Promise<void> {
  await setExplicitIDAsync(projectId, projectDir, {
    force,
    nonInteractive,
  });
}

export async function initializeWithoutExplicitIDAsync(
  graphqlClient: ExpoGraphqlClient,
  actor: Actor,
  projectDir: string,
  { force, nonInteractive }: InitializeMethodOptions
): Promise<string> {
  const exp = await getPrivateExpoConfigAsync(projectDir);
  const existingProjectId = exp.extra?.eas?.projectId;

  if (existingProjectId) {
    Log.succeed(
      `Project already linked (ID: ${chalk.bold(
        existingProjectId
      )}). To re-configure, remove the "extra.eas.projectId" field from your app config.`
    );
    return existingProjectId;
  }

  const allAccounts = actor.accounts;
  const accountNamesWhereUserHasSufficientPermissionsToCreateApp =
    getAccountNamesWhereUserHasSufficientPermissionsToCreateApp(actor);

  // if no owner field, ask the user which account they want to use to create/link the project
  let accountName = exp.owner;
  if (!accountName) {
    if (allAccounts.length === 1) {
      accountName = allAccounts[0].name;
    } else if (nonInteractive) {
      if (!force) {
        throw new Error(
          `There are multiple accounts that you have access to: ${allAccounts
            .map(a => a.name)
            .join(
              ', '
            )}. Explicitly set the owner property in your app config or run this command with the --force flag to proceed with a default account: ${
            allAccounts[0].name
          }.`
        );
      }
      accountName = allAccounts[0].name;
      Log.log(`Using default account ${accountName} for non-interactive and force mode`);
    } else {
      const choices = getAccountChoices(
        actor,
        accountNamesWhereUserHasSufficientPermissionsToCreateApp
      );

      accountName = (
        await promptAsync({
          type: 'select',
          name: 'account',
          message: 'Which account should own this project?',
          choices,
        })
      ).account.name;
    }
  }

  if (!accountName) {
    throw new Error('No account selected for project. Canceling.');
  }

  const projectName = validSlugName(exp.slug); // This filters out invalid characters
  const projectFullName = `@${accountName}/${projectName}`;
  validateFullNameAndSlug(projectFullName, projectName);
  const existingProjectIdOnServer = await findProjectIdByAccountNameAndSlugNullableAsync(
    graphqlClient,
    accountName,
    projectName
  );
  if (existingProjectIdOnServer) {
    if (!force) {
      if (nonInteractive) {
        throw new Error(
          `Existing project found: ${projectFullName} (ID: ${existingProjectIdOnServer}). Use --force flag to continue with this project.`
        );
      }

      const affirmedLink = await confirmAsync({
        message: `Existing project found: ${projectFullName} (ID: ${existingProjectIdOnServer}). Link this project?`,
      });
      if (!affirmedLink) {
        throw new Error(
          `Project ID configuration canceled. Re-run the command to select a different account/project.`
        );
      }
    }

    await saveProjectIdAndLogSuccessAsync(projectDir, existingProjectIdOnServer);
    return existingProjectIdOnServer;
  }

  if (!accountNamesWhereUserHasSufficientPermissionsToCreateApp.has(accountName)) {
    throw new Error(
      `You don't have permission to create a new project on the ${accountName} account and no matching project already exists on the account.`
    );
  }

  if (!force) {
    if (nonInteractive) {
      throw new Error(
        `Project does not exist: ${projectFullName}. Use --force flag to create this project.`
      );
    }
    const affirmedCreate = await confirmAsync({
      message: `Would you like to create a project for ${projectFullName}?`,
    });
    if (!affirmedCreate) {
      throw new Error(`Project ID configuration canceled for ${projectFullName}.`);
    }
  }

  const projectDashboardUrl = getProjectDashboardUrl(accountName, projectName);
  const projectLink = link(projectDashboardUrl, { text: projectFullName });

  const account = nullthrows(allAccounts.find(a => a.name === accountName));

  const spinner = ora(`Creating ${chalk.bold(projectFullName)}`).start();
  let createdProjectId: string;
  try {
    createdProjectId = await AppMutation.createAppAsync(graphqlClient, {
      accountId: account.id,
      projectName,
    });
    spinner.succeed(`Created ${chalk.bold(projectLink)}`);
  } catch (err) {
    spinner.fail();
    throw err;
  }

  await saveProjectIdAndLogSuccessAsync(projectDir, createdProjectId);
  return createdProjectId;
}
