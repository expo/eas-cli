import { Flags } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { getProjectDashboardUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  cloneTemplateAsync,
  initializeGitRepositoryAsync,
  installProjectDependenciesAsync,
} from '../../commandUtils/new/commands';
import {
  generateDirectoryAsync,
  generateProjectNameAsync,
  promptForProjectAccountAsync,
  promptToChangeProjectNameOrAccountAsync,
} from '../../commandUtils/new/configs';
import {
  copyProjectTemplatesAsync,
  generateAppConfigAsync,
  generateEasConfigAsync,
  updatePackageJsonAsync,
  updateReadmeAsync,
} from '../../commandUtils/new/projectFiles';
import {
  verifyAccountPermissionsAsync,
  verifyProjectDirectoryDoesNotExistAsync,
  verifyProjectDoesNotExistAsync,
} from '../../commandUtils/new/verifications';
import { AppFragment } from '../../graphql/generated';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log, { learnMore, link } from '../../log';
import { PACKAGE_MANAGERS, PackageManager } from '../../onboarding/installDependencies';
import { ora } from '../../ora';
import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { Actor } from '../../user/User';

export async function generateConfigsAsync(
  flags: { name?: string; directory?: string },
  actor: Actor
): Promise<{
  projectName: string;
  projectDirectory: string;
  projectAccount: string;
}> {
  const projectAccount = await promptForProjectAccountAsync(actor);
  const projectName = await generateProjectNameAsync(actor, flags.name);
  const projectDirectory = await generateDirectoryAsync(projectName, flags.directory);

  return {
    projectAccount,
    projectDirectory,
    projectName,
  };
}

export async function verifyConfigsAsync(
  initialConfigs: {
    projectName: string;
    projectDirectory: string;
    projectAccount: string;
  },
  actor: Actor,
  graphqlClient: ExpoGraphqlClient
): Promise<{
  projectName: string;
  projectDirectory: string;
  projectAccount: string;
}> {
  Log.gray('Verifying project values...');

  let { projectName, projectDirectory, projectAccount } = initialConfigs;
  let allFieldsValid = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!allFieldsValid && retryCount < maxRetries) {
    retryCount++;

    const hasPermissions = await verifyAccountPermissionsAsync(actor, projectAccount);
    if (!hasPermissions) {
      projectAccount = await promptForProjectAccountAsync(actor);
    }

    const projectDoesNotExist = await verifyProjectDoesNotExistAsync(
      graphqlClient,
      projectAccount,
      projectName
    );
    if (!projectDoesNotExist) {
      const prompted = await promptToChangeProjectNameOrAccountAsync(
        actor,
        projectName,
        projectAccount
      );
      projectName = prompted.projectName;
      projectAccount = prompted.projectAccount;
    }

    const directoryDoesNotExist = await verifyProjectDirectoryDoesNotExistAsync(projectDirectory);
    if (!directoryDoesNotExist) {
      projectDirectory = await generateDirectoryAsync(projectName);
    }

    allFieldsValid = hasPermissions && projectDoesNotExist && directoryDoesNotExist;
  }

  // If we hit the retry limit, throw an error
  if (!allFieldsValid) {
    throw new Error(
      'Unable to resolve project configuration conflicts after multiple attempts. Please try again with different values.'
    );
  }

  return {
    projectName,
    projectDirectory,
    projectAccount,
  };
}

export async function createProjectAsync({
  graphqlClient,
  actor,
  projectDirectory,
  projectAccount,
  projectName,
}: {
  graphqlClient: ExpoGraphqlClient;
  actor: Actor;
  projectDirectory: string;
  projectAccount: string;
  projectName: string;
}): Promise<string> {
  const projectFullName = `@${projectAccount}/${projectName}`;
  const projectDashboardUrl = getProjectDashboardUrl(projectAccount, projectName);
  const projectLink = link(projectDashboardUrl, { text: projectFullName });

  const account = nullthrows(actor.accounts.find(a => a.name === projectAccount));

  const spinner = ora(`Creating ${chalk.bold(projectFullName)}`).start();
  let projectId: string;
  try {
    projectId = await AppMutation.createAppAsync(graphqlClient, {
      accountId: account.id,
      projectName,
    });
    spinner.succeed(`Created ${chalk.bold(projectLink)}`);
  } catch (err) {
    spinner.fail();
    throw err;
  }

  const exp = await getPrivateExpoConfigAsync(projectDirectory, { skipPlugins: true });
  await createOrModifyExpoConfigAsync(
    projectDirectory,
    {
      extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
    },
    { skipSDKVersionRequirement: true }
  );
  Log.withTick(`Project successfully linked (ID: ${chalk.bold(projectId)}) (modified app.json)`);

  return projectId;
}

export async function generateConfigFilesAsync(
  projectDir: string,
  app: AppFragment,
  packageManager: PackageManager
): Promise<void> {
  await generateAppConfigAsync(projectDir, app);

  await generateEasConfigAsync(projectDir);

  await updatePackageJsonAsync(projectDir);

  await copyProjectTemplatesAsync(projectDir);

  await updateReadmeAsync(projectDir, packageManager);
}

export default class New extends EasCommand {
  static override aliases = ['new'];

  static override description = "create a new project set up with Expo's services.";

  static override flags = {
    name: Flags.string({
      char: 'n',
      description: 'Name of the project',
      helpValue: 'PROJECT_NAME',
    }),
    directory: Flags.string({
      char: 'd',
      description: 'Directory to create the project in',
      helpValue: 'PROJECT_DIRECTORY',
    }),
    'package-manager': Flags.enum<PackageManager>({
      char: 'p',
      description: 'Package manager to use for installing dependencies',
      options: [...PACKAGE_MANAGERS],
      default: 'npm',
    }),
  };

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(New);

    const {
      loggedIn: { actor, graphqlClient },
    } = await this.getContextAsync(New, { nonInteractive: false });

    if (actor.__typename === 'Robot') {
      throw new Error(
        'This command is not available for robot users. Make sure you are not using a robot token and try again.'
      );
    }

    Log.warn(
      'This command is not yet implemented. It will create a new project, but it may not be fully configured.'
    );
    Log.log(`👋 Welcome to Expo, ${actor.username}!`);
    Log.newLine();

    const initialConfigs = await generateConfigsAsync(flags, actor);
    const {
      projectName,
      projectDirectory: targetProjectDirectory,
      projectAccount,
    } = await verifyConfigsAsync(initialConfigs, actor, graphqlClient);

    const projectDirectory = await cloneTemplateAsync(targetProjectDirectory);

    const packageManager = flags['package-manager'];
    await installProjectDependenciesAsync(projectDirectory, packageManager);

    const projectId = await createProjectAsync({
      projectDirectory,
      projectAccount,
      projectName,
      actor,
      graphqlClient,
    });

    const app = await AppQuery.byIdAsync(graphqlClient, projectId);
    await generateConfigFilesAsync(projectDirectory, app, packageManager);

    await initializeGitRepositoryAsync(projectDirectory);

    Log.log('🎉 We finished creating your new project.');
    Log.log('Next steps:');
    Log.withInfo(`Run \`cd ${projectDirectory}\` to navigate to your project.`);
    Log.withInfo(
      `Run \`${packageManager} run preview\` to create a preview build on EAS. ${learnMore(
        'https://docs.expo.dev/eas/workflows/examples/publish-preview-update/'
      )}`
    );
    Log.withInfo(
      `Run \`${packageManager} run start\` to start developing locally. ${learnMore(
        'https://docs.expo.dev/get-started/start-developing/'
      )}`
    );
    Log.withInfo(`See the README.md for more information about your project.`);
    Log.newLine();
  }
}
