import path from 'path';

import { Role } from '../graphql/generated';
import Log from '../log';
import { Choice, promptAsync, selectAsync } from '../prompts';
import { Actor, getActorUsername } from '../user/User';

export async function promptForProjectNameAsync(
  actor: Actor,
  projectNameFromArgs?: string
): Promise<string> {
  if (projectNameFromArgs) {
    Log.log(`Using project name from args: ${projectNameFromArgs}`);
    return projectNameFromArgs;
  }

  return (
    await promptAsync({
      type: 'text',
      name: 'projectName',
      message: 'What is the name of your project?',
      initial: getActorUsername(actor) + '-app',
    })
  ).projectName;
}

export async function promptForTargetDirectoryAsync(
  projectName: string,
  targetProjectDirFromArgs?: string
): Promise<string> {
  if (targetProjectDirFromArgs) {
    Log.log(`Using project directory from args: ${targetProjectDirFromArgs}`);
    return targetProjectDirFromArgs;
  }

  return (
    await promptAsync({
      type: 'text',
      name: 'targetProjectDir',
      message: 'Where would you like to create your new project?',
      initial: path.join(process.cwd(), projectName),
    })
  ).targetProjectDir;
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
    projectName = await promptForProjectNameAsync(actor);
  } else {
    projectAccount = await promptForProjectAccountAsync(actor);
  }

  return {
    projectName,
    projectAccount,
  };
}
