import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import path from 'path';

import { Role } from '../../graphql/generated';
import Log from '../../log';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { Choice, promptAsync } from '../../prompts';
import { Actor, getActorUsername } from '../../user/User';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

function validateProjectPath(resolvedPath: string): void {
  const normalizedPath = path.normalize(resolvedPath);

  // Check for path traversal attempts
  if (normalizedPath.includes('..')) {
    throw new Error(`Invalid project path: "${resolvedPath}". Path traversal is not allowed.`);
  }

  // Ensure we're not trying to create a project in system directories
  const systemDirs = ['/bin', '/sbin', '/etc', '/usr', '/var', '/sys', '/proc', '/dev'];
  const isSystemDir = systemDirs.some(
    dir => normalizedPath === dir || normalizedPath.startsWith(dir + path.sep)
  );

  if (isSystemDir) {
    throw new Error(
      `Invalid project path: "${resolvedPath}". Cannot create projects in system directories.`
    );
  }
}

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
  let baseName = 'new-expo-project';
  let parentDirectory = process.cwd();

  if (pathArg) {
    const resolvedPath = path.isAbsolute(pathArg) ? pathArg : path.resolve(process.cwd(), pathArg);
    validateProjectPath(resolvedPath);
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

  Log.withInfo(`Using project directory: ${projectDirectory}`);

  return {
    projectName,
    projectDirectory,
  };
}

function getAccountPermissionsMap(actor: Actor): Map<string, boolean> {
  const permissionsMap = new Map<string, boolean>();

  for (const account of actor.accounts) {
    const hasPermission =
      account.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly;
    permissionsMap.set(account.name, hasPermission);
  }

  return permissionsMap;
}

export async function promptForProjectAccountAsync(actor: Actor): Promise<string> {
  const permissionsMap = getAccountPermissionsMap(actor);

  // If only one account, use it (if has permissions)
  if (actor.accounts.length === 1) {
    const account = actor.accounts[0];

    if (permissionsMap.get(account.name)) {
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
      choices: getAccountChoices(actor, permissionsMap),
    })
  ).account.name;
}

export function getAccountChoices(actor: Actor, permissionsMap?: Map<string, boolean>): Choice[] {
  const permissions = permissionsMap ?? getAccountPermissionsMap(actor);
  const sortedAccounts = [...actor.accounts].sort((a, _b) =>
    actor.__typename === 'User' ? (a.name === actor.username ? -1 : 1) : 0
  );

  return sortedAccounts.map(account => {
    const isPersonalAccount = actor.__typename === 'User' && account.name === actor.username;
    const accountDisplayName = isPersonalAccount
      ? `${account.name} (personal account)`
      : account.name;
    const disabled = !permissions.get(account.name);

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

export function generateProjectNameVariations(actor: Actor, baseName: string): string[] {
  const username = getActorUsername(actor);
  const date = new Date().toISOString().split('T')[0];

  return [
    baseName,
    `${baseName}-${username}-${date}`,
    `${baseName}-${username}-${date}-${nanoid(6)}`,
  ];
}

async function verifyProjectDoesNotExistAsync(
  graphqlClient: ExpoGraphqlClient,
  accountName: string,
  projectName: string,
  { silent = false }: { silent?: boolean } = {}
): Promise<boolean> {
  const existingProjectId = await findProjectIdByAccountNameAndSlugNullableAsync(
    graphqlClient,
    accountName,
    projectName
  );

  const doesNotExist = existingProjectId === null;
  if (!doesNotExist && !silent) {
    Log.warn(`Project @${accountName}/${projectName} already exists on the server.`);
  }

  return doesNotExist;
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
  const nameVariations = generateProjectNameVariations(actor, baseName);

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

    Log.withInfo(`Using ${usingVariant ? 'alternate ' : ''}project name: ${nameVariation}`);

    return {
      projectName: nameVariation,
      projectDirectory: proposedDirectory,
    };
  }

  throw new Error(
    `Unable to find a unique project name for "${baseName}". All generated variations already exist.`
  );
}
