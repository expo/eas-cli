import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import path from 'path';

import { printDirectory } from './utils';
import { Role } from '../../graphql/generated';
import Log from '../../log';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { Choice, promptAsync } from '../../prompts';
import { Actor } from '../../user/User';
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
  pathArg: string | undefined,
  options: {
    graphqlClient: ExpoGraphqlClient;
    projectAccount: string;
  }
): Promise<{
  projectName: string;
  projectDirectory: string;
}> {
  let baseName = 'expo-project';
  let parentDirectory = process.cwd();

  if (pathArg) {
    const resolvedPath = path.isAbsolute(pathArg) ? pathArg : path.resolve(process.cwd(), pathArg);
    validateProjectPath(resolvedPath);
    baseName = path.basename(resolvedPath);
    parentDirectory = path.dirname(resolvedPath);
  } else {
    baseName = (
      await promptAsync({
        type: 'text',
        name: 'name',
        message: 'What would you like to name your project?',
        initial: 'expo-project',
      })
    ).name;
  }

  // Find an available name checking both local filesystem and remote server
  const { projectName, projectDirectory } = await findAvailableProjectNameAsync(
    baseName,
    parentDirectory,
    options
  );

  Log.withInfo(`Using project name: ${projectName}`);
  Log.withInfo(`Using project directory: ${printDirectory(projectDirectory)}`);

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
  const sortedAccounts = [...actor.accounts].sort((a, _b) => (a.ownerUserActor ? 1 : -1));

  return sortedAccounts.map(account => {
    const isPersonalAccount = !!account.ownerUserActor && account.ownerUserActor.id === actor.id;
    const isTeamAccount = !!account.ownerUserActor && account.ownerUserActor.id !== actor.id;

    const accountDisplayName = isPersonalAccount
      ? `${account.name} (Limited - Personal Account)`
      : isTeamAccount
        ? `${account.name} (Limited - Team Account)`
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
  let projectName = baseName;
  let projectDirectory = path.join(parentDirectory, projectName);

  const localExists = await fs.pathExists(projectDirectory);

  const remoteAvailable = await verifyProjectDoesNotExistAsync(
    graphqlClient,
    projectAccount,
    projectName
  );

  if (localExists || !remoteAvailable) {
    projectName = `${baseName}-${nanoid(6)}`;
    projectDirectory = path.join(parentDirectory, projectName);
  }

  return {
    projectName,
    projectDirectory,
  };
}
