import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import path from 'path';

import { Role } from '../../graphql/generated';
import Log from '../../log';
import { Choice, promptAsync, selectAsync } from '../../prompts';
import { Actor, getActorUsername } from '../../user/User';

export async function generateProjectConfigAsync(
  actor: Actor,
  pathArg?: string
): Promise<{
  projectName: string;
  projectDirectory: string;
}> {
  // Step 1: Determine the target directory
  let targetDirectory: string;
  if (!pathArg) {
    // No path provided - we'll use cwd
    targetDirectory = process.cwd();
  } else if (path.isAbsolute(pathArg)) {
    // Absolute path provided - use as-is
    targetDirectory = pathArg;
  } else {
    // TODO this didn't work
    // Relative path provided - resolve from cwd
    targetDirectory = path.resolve(process.cwd(), pathArg);
  }

  // Step 2: Generate project name based on what's available in the target directory
  const baseName = 'new-expo-project';
  let projectName = baseName;

  if (targetDirectory === process.cwd()) {
    const username = getActorUsername(actor);
    const date = new Date().toISOString().split('T')[0];

    // Try different name combinations until we find one that doesn't exist
    const nameOptions = [
      baseName,
      `${baseName}-${username}-${date}`,
      `${baseName}-${username}-${date}-${nanoid(6)}`,
    ];

    for (const option of nameOptions) {
      if (!(await fs.pathExists(path.join(targetDirectory, option)))) {
        projectName = option;
        break;
      }
    }

    // Append the generated name to the target directory
    targetDirectory = path.join(targetDirectory, projectName);
  } else {
    // Path was explicitly provided, use the last segment as the project name
    projectName = path.basename(targetDirectory);
  }

  Log.log(`Using project name: ${projectName}`);
  Log.log(`Using project directory: ${targetDirectory}`);

  return {
    projectName,
    projectDirectory: targetDirectory,
  };
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
    const config = await generateProjectConfigAsync(actor);
    projectName = config.projectName;
  } else {
    projectAccount = await promptForProjectAccountAsync(actor);
  }

  return {
    projectName,
    projectAccount,
  };
}
