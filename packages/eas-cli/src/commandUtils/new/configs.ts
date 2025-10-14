import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import path from 'path';

import { Role } from '../../graphql/generated';
import Log from '../../log';
import { Choice, promptAsync, selectAsync } from '../../prompts';
import { Actor, getActorUsername } from '../../user/User';

export async function generateProjectNameAsync(
  actor: Actor,
  projectNameFromArgs?: string
): Promise<string> {
  if (projectNameFromArgs) {
    Log.log(`Using project name from args: ${projectNameFromArgs}`);
    return projectNameFromArgs;
  }

  const baseDir = process.cwd();
  const baseName = 'new-expo-project';

  // Try base name first
  const basePath = path.join(baseDir, baseName);
  if (!(await fs.pathExists(basePath))) {
    Log.log(`Using default project name: ${baseName}`);
    return baseName;
  }

  // Try with username-date
  const username = getActorUsername(actor);
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const nameWithUsernameDate = `${baseName}-${username}-${date}`;
  const pathWithUsernameDate = path.join(baseDir, nameWithUsernameDate);
  if (!(await fs.pathExists(pathWithUsernameDate))) {
    Log.log(`Using default project name: ${nameWithUsernameDate}`);
    return nameWithUsernameDate;
  }

  // Try with short ID
  const shortId = nanoid(6);
  const nameWithShortId = `${baseName}-${shortId}`;
  Log.log(`Using default project name: ${nameWithShortId}`);
  return nameWithShortId;
}

export async function generateDirectoryAsync(
  projectName: string,
  targetProjectDirFromArgs?: string
): Promise<string> {
  if (targetProjectDirFromArgs) {
    Log.log(`Using project directory from args: ${targetProjectDirFromArgs}`);
    return targetProjectDirFromArgs;
  }

  const defaultDirectory = path.join(process.cwd(), projectName);
  Log.log(`Using default project directory: ${defaultDirectory}`);
  return defaultDirectory;
}

export async function promptForProjectAccountAsync(actor: Actor): Promise<string> {
  if (actor.accounts.length === 1) {
    return actor.accounts[0].name;
  }

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
  const namesWithSufficientPermissions = new Set(
    actor.accounts
      .filter(a => a.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly)
      .map(it => it.name)
  );

  const sortedAccounts = actor.accounts.sort((a, _b) =>
    actor.__typename === 'User' ? (a.name === actor.username ? -1 : 1) : 0
  );

  return sortedAccounts.map(account => {
    const isPersonalAccount = actor.__typename === 'User' && account.name === actor.username;
    const accountDisplayName = isPersonalAccount
      ? `${account.name} (personal account)`
      : account.name;
    const disabled = !namesWithSufficientPermissions.has(account.name);

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

export async function promptToChangeProjectNameOrAccountAsync(
  actor: Actor,
  projectName: string,
  projectAccount: string
): Promise<{
  projectName: string;
  projectAccount: string;
}> {
  const selection = await selectAsync(
    'Would you like to change the project name or account?',
    [
      { title: 'Project name', value: 'name' },
      { title: 'Account', value: 'account' },
    ],
    { initial: 'name' }
  );

  if (selection === 'name') {
    projectName = await generateProjectNameAsync(actor);
  } else {
    projectAccount = await promptForProjectAccountAsync(actor);
  }

  return {
    projectName,
    projectAccount,
  };
}
