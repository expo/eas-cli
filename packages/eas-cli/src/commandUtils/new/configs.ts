import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import path from 'path';

import { verifyProjectDoesNotExistAsync } from './verifications';
import { Role } from '../../graphql/generated';
import Log from '../../log';
import { Choice, promptAsync } from '../../prompts';
import { Actor, getActorUsername } from '../../user/User';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

export async function generateProjectConfigAsync(
  actor: Actor,
  pathArg: string | undefined,
  options: {
    graphqlClient: ExpoGraphqlClient;
    projectAccount: string;
  }
): Promise<{
  projectName: string;
  projectDirectory: string;
}> {
  // Determine the base name and parent directory
  let baseName: string;
  let parentDirectory: string;

  if (!pathArg) {
    // No path provided - use default base name in cwd
    baseName = 'new-expo-project';
    parentDirectory = process.cwd();
  } else if (path.isAbsolute(pathArg)) {
    // Absolute path provided
    baseName = path.basename(pathArg);
    parentDirectory = path.dirname(pathArg);
  } else {
    // Relative path provided
    const resolvedPath = path.resolve(process.cwd(), pathArg);
    baseName = path.basename(resolvedPath);
    parentDirectory = path.dirname(resolvedPath);
  }

  // Find an available name checking both local filesystem and remote server
  const { projectName, projectDirectory } = await findAvailableProjectNameAsync(
    actor,
    baseName,
    parentDirectory,
    options
  );

  Log.log(`Using project directory: ${projectDirectory}`);

  return {
    projectName,
    projectDirectory,
  };
}

function hasAccountPermissions(actor: Actor, accountName: string): boolean {
  const account = actor.accounts.find(a => a.name === accountName);
  if (!account) {
    return false;
  }
  return account.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly;
}

export async function promptForProjectAccountAsync(actor: Actor): Promise<string> {
  // If only one account, use it (if has permissions)
  if (actor.accounts.length === 1) {
    const account = actor.accounts[0];

    if (hasAccountPermissions(actor, account.name)) {
      return account.name;
    }

    throw new Error(
      `You don't have permission to create projects on your only available account (${account.name}).`
    );
  }

  // Multiple accounts - prompt user to select one with permissions
  return (
    await promptAsync({
      type: 'select',
      name: 'account',
      message: 'Which account should own this project?',
      choices: getAccountChoices(actor),
    })
  ).account.name;
}

export function getAccountChoices(actor: Actor): Choice[] {
  const sortedAccounts = actor.accounts.sort((a, _b) =>
    actor.__typename === 'User' ? (a.name === actor.username ? -1 : 1) : 0
  );

  return sortedAccounts.map(account => {
    const isPersonalAccount = actor.__typename === 'User' && account.name === actor.username;
    const accountDisplayName = isPersonalAccount
      ? `${account.name} (personal account)`
      : account.name;
    const disabled = !hasAccountPermissions(actor, account.name);

    return {
      title: accountDisplayName,
      value: { name: account.name },
      ...(disabled && {
        disabled: true,
        description: 'You do not have the required permissions to create projects on this account.',
      }),
    };
  });
}

export function generateUniqueProjectName(actor: Actor, baseName: string): string[] {
  const username = getActorUsername(actor);
  const date = new Date().toISOString().split('T')[0];

  return [
    baseName,
    `${baseName}-${username}-${date}`,
    `${baseName}-${username}-${date}-${nanoid(6)}`,
  ];
}

/**
 * Finds an available project name that doesn't conflict with either:
 * Local filesystem (directory already exists)
 * Remote server (project already exists on Expo)
 */
export async function findAvailableProjectNameAsync(
  actor: Actor,
  baseName: string,
  parentDirectory: string,
  {
    graphqlClient,
    projectAccount,
  }: {
    graphqlClient: ExpoGraphqlClient;
    projectAccount: string;
  }
): Promise<{ projectName: string; projectDirectory: string }> {
  const nameVariations = generateUniqueProjectName(actor, baseName);

  for (let i = 0; i < nameVariations.length; i++) {
    const nameVariation = nameVariations[i];
    const proposedDirectory = path.join(parentDirectory, nameVariation);
    const usingVariant = i !== 0;

    const localExists = await fs.pathExists(proposedDirectory);
    if (localExists) {
      continue;
    }

    const remoteAvailable = await verifyProjectDoesNotExistAsync(
      graphqlClient,
      projectAccount,
      nameVariation,
      { silent: usingVariant }
    );
    if (!remoteAvailable) {
      continue;
    }

    Log.log(`Using ${usingVariant ? 'alternate ' : ''}project name: ${nameVariation}`);

    return {
      projectName: nameVariation,
      projectDirectory: proposedDirectory,
    };
  }

  throw new Error(
    `Unable to find a unique project name for "${baseName}". All generated variations already exist.`
  );
}
