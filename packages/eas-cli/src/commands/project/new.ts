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
  generateProjectConfigAsync,
  promptForProjectAccountAsync,
} from '../../commandUtils/new/configs';
import {
  copyProjectTemplatesAsync,
  generateAppConfigAsync,
  generateEasConfigAsync,
  updatePackageJsonAsync,
  updateReadmeAsync,
} from '../../commandUtils/new/projectFiles';
import { printDirectory } from '../../commandUtils/new/utils';
import { AppFragment } from '../../graphql/generated';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log, { learnMore, link } from '../../log';
import { PACKAGE_MANAGERS, PackageManager } from '../../onboarding/installDependencies';
import { ora } from '../../ora';
import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { Actor } from '../../user/User';

export async function generateConfigsAsync(
  args: { path?: string },
  actor: Actor,
  graphqlClient: ExpoGraphqlClient
): Promise<{
  projectName: string;
  projectDirectory: string;
  projectAccount: string;
}> {
  const projectAccount = await promptForProjectAccountAsync(actor);
  const { projectName, projectDirectory } = await generateProjectConfigAsync(args.path, {
    graphqlClient,
    projectAccount,
  });

  return {
    projectAccount,
    projectDirectory,
    projectName,
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
  Log.withInfo(`Project successfully linked (ID: ${chalk.bold(projectId)})`);

  return projectId;
}

export async function generateProjectFilesAsync(
  projectDir: string,
  app: AppFragment,
  packageManager: PackageManager
): Promise<void> {
  const spinner = ora(`Generating project files`).start();
  await generateAppConfigAsync(projectDir, app);

  await generateEasConfigAsync(projectDir);

  await updatePackageJsonAsync(projectDir);

  await copyProjectTemplatesAsync(projectDir);

  await updateReadmeAsync(projectDir, packageManager);
  spinner.succeed(`Generated project files`);
  Log.withInfo(
    `Generated ${chalk.bold('app.json')}. ${learnMore(
      'https://docs.expo.dev/versions/latest/config/app/'
    )}`
  );
  Log.withInfo(
    `Generated ${chalk.bold('eas.json')}. ${learnMore(
      'https://docs.expo.dev/build-reference/eas-json/'
    )}`
  );
}

export default class New extends EasCommand {
  static override aliases = ['new'];

  static override description =
    'Create a new project configured with Expo Application Services (EAS)';

  static override args = [
    {
      name: 'path',
      description: 'Path to create the project (defaults to current directory)',
      required: false,
    },
  ];

  static override flags = {
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
    const { args, flags } = await this.parse(New);

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

    const {
      projectName,
      projectDirectory: targetProjectDirectory,
      projectAccount,
    } = await generateConfigsAsync(args, actor, graphqlClient);

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
    await generateProjectFilesAsync(projectDirectory, app, packageManager);

    await initializeGitRepositoryAsync(projectDirectory);

    Log.log('🎉 We finished creating your new project.');
    Log.newLine();
    Log.log('Next steps:');
    Log.withInfo(`Run \`cd ${printDirectory(projectDirectory)}\` to navigate to your project.`);
    Log.withInfo(
      `Run \`${packageManager} run draft\` to create a preview on EAS. ${learnMore(
        'https://docs.expo.dev/eas/workflows/examples/publish-preview-update/'
      )}`
    );
    Log.withInfo(
      `Run \`${packageManager} run start\` to start developing locally. ${learnMore(
        'https://docs.expo.dev/get-started/start-developing/'
      )}`
    );
    Log.withInfo(`See the README.md for more information about your project.`);
  }
}
