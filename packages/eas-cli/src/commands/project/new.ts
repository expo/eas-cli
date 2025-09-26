import { ExpoConfig } from '@expo/config';
import { AppVersionSource, EasJson } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';
import path from 'path';

import { getEASUpdateURL } from '../../api';
import { getProjectDashboardUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppFragment, Role } from '../../graphql/generated';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log, { learnMore, link } from '../../log';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../onboarding/git';
import {
  installDependenciesAsync,
  promptForPackageManagerAsync,
} from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';
import { ora } from '../../ora';
import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { Choice, promptAsync } from '../../prompts';
import { Actor, getActorUsername } from '../../user/User';
import { easCliVersion } from '../../utils/easCli';

export async function promptForTargetDirectoryAsync(
  targetProjectDirFromArgs?: string
): Promise<string> {
  Log.log(
    `🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies.`
  );
  Log.newLine();

  if (targetProjectDirFromArgs) {
    return targetProjectDirFromArgs;
  }

  const result = await promptAsync({
    type: 'text',
    name: 'targetProjectDir',
    message: 'Where would you like to create your new project directory?',
    initial: path.join(process.cwd(), 'new-expo-project'),
  });

  return result.targetProjectDir;
}

export async function cloneTemplateAsync(targetProjectDir: string): Promise<string> {
  const githubUsername = 'expo';
  const githubRepositoryName = 'expo-template-default';

  Log.log(`📂 Cloning the project to ${targetProjectDir}`);
  Log.newLine();

  const cloneMethod = (await canAccessRepositoryUsingSshAsync({
    githubUsername,
    githubRepositoryName,
  }))
    ? 'ssh'
    : 'https';
  Log.log(chalk.dim(`We detected that ${cloneMethod} is your preferred git clone method`));
  Log.newLine();

  const { targetProjectDir: finalTargetProjectDirectory } = await runGitCloneAsync({
    githubUsername,
    githubRepositoryName,
    targetProjectDir,
    cloneMethod,
  });

  return finalTargetProjectDirectory;
}

export async function installProjectDependenciesAsync(projectDir: string): Promise<void> {
  const packageManager = await promptForPackageManagerAsync();
  await installDependenciesAsync({
    projectDir,
    packageManager,
  });

  const dependencies = ['expo-updates', '@expo/metro-runtime'];
  for (const dependency of dependencies) {
    await runCommandAsync({
      cwd: projectDir,
      command: 'npx',
      args: ['expo', 'install', dependency],
    });
  }
}

export function getAccountChoices(
  actor: Actor,
  namesWithSufficientPermissions: Set<string>
): Choice[] {
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

export async function createProjectAsync(
  graphqlClient: ExpoGraphqlClient,
  actor: Actor,
  projectDir: string
): Promise<string> {
  const allAccounts = actor.accounts;
  const accountNamesWhereUserHasSufficientPermissionsToCreateApp = new Set(
    allAccounts
      .filter(a => a.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly)
      .map(it => it.name)
  );

  let accountName = allAccounts[0].name;
  if (allAccounts.length > 1) {
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

  const projectName = getActorUsername(actor) + '-app';
  const projectFullName = `@${accountName}/${projectName}`;
  const existingProjectIdOnServer = await findProjectIdByAccountNameAndSlugNullableAsync(
    graphqlClient,
    accountName,
    projectName
  );

  if (existingProjectIdOnServer) {
    throw new Error(
      `Existing project found: ${projectFullName} (ID: ${existingProjectIdOnServer}). Project ID configuration canceled. Re-run the command to select a different account/project.`
    );
  }

  if (!accountNamesWhereUserHasSufficientPermissionsToCreateApp.has(accountName)) {
    throw new Error(
      `You don't have permission to create a new project on the ${accountName} account and no matching project already exists on the account.`
    );
  }

  const projectDashboardUrl = getProjectDashboardUrl(accountName, projectName);
  const projectLink = link(projectDashboardUrl, { text: projectFullName });

  const account = nullthrows(allAccounts.find(a => a.name === accountName));

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

  const exp = await getPrivateExpoConfigAsync(projectDir, { skipPlugins: true });
  await createOrModifyExpoConfigAsync(
    projectDir,
    {
      extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
    },
    { skipSDKVersionRequirement: true }
  );
  Log.withTick(`Project successfully linked (ID: ${chalk.bold(projectId)}) (modified app.json)`);

  return projectId;
}

export function stripInvalidCharactersForBundleIdentifier(string: string): string {
  return string.replaceAll(/[^A-Za-z0-9]/g, '');
}

export async function generateConfigFilesAsync(
  projectDir: string,
  app: AppFragment
): Promise<void> {
  await generateAppConfigAsync(projectDir, app);

  await generateEasConfigAsync(projectDir);

  await updatePackageJsonAsync(projectDir);

  await copyProjectTemplatesAsync(projectDir);

  await mergeReadmeAsync(projectDir);
}

export async function generateAppConfigAsync(projectDir: string, app: AppFragment): Promise<void> {
  // Android package name requires each component to start with a lowercase letter.
  const isUsernameValidSegment = /^[^a-z]/.test(app.ownerAccount.name);
  const userPrefix = isUsernameValidSegment ? 'user' : '';
  const isSlugValidSegment = /^[^a-z]/.test(app.slug);
  const slugPrefix = isSlugValidSegment ? 'app' : '';

  const bundleIdentifier = `com.${userPrefix}${stripInvalidCharactersForBundleIdentifier(
    app.ownerAccount.name
  )}.${slugPrefix}${stripInvalidCharactersForBundleIdentifier(app.slug)}`;
  const updateUrl = getEASUpdateURL(app.id, /* manifestHostOverride */ null);

  const baseExpoConfig = JSON.parse('{"expo": {}}').expo;

  const expoConfig: ExpoConfig = {
    ...baseExpoConfig,
    name: app.name ?? app.slug,
    slug: app.slug,
    extra: {
      eas: {
        projectId: app.id,
      },
    },
    owner: app.ownerAccount.name,
    updates: {
      url: updateUrl,
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    ios: {
      ...baseExpoConfig.ios,
      bundleIdentifier,
    },
    android: {
      ...baseExpoConfig.android,
      package: bundleIdentifier,
    },
  };

  const appJsonPath = path.join(projectDir, 'app.json');
  await fs.writeFile(appJsonPath, `${JSON.stringify({ expo: expoConfig }, null, 2)}\n`);
  Log.withTick(
    `Generated ${chalk.bold('app.json')}. ${learnMore(
      'https://docs.expo.dev/versions/latest/config/app/'
    )}`
  );
  Log.log();
}

export async function generateEasConfigAsync(projectDir: string): Promise<void> {
  const easBuildGitHubConfig = {
    android: {
      image: 'latest',
    },
    ios: {
      image: 'latest',
    },
  };

  const easJson: EasJson = {
    cli: {
      version: `>= ${easCliVersion}`,
      appVersionSource: AppVersionSource.REMOTE,
    },
    build: {
      development: {
        developmentClient: true,
        distribution: 'internal',
        ...easBuildGitHubConfig,
      },
      'development-simulator': {
        extends: 'development',
        ios: {
          simulator: true,
        },
      },
      preview: {
        distribution: 'internal',
        channel: 'main',
        ...easBuildGitHubConfig,
      },
      production: {
        channel: 'production',
        autoIncrement: true,
        ...easBuildGitHubConfig,
      },
    },
    submit: {
      production: {},
    },
  };

  const easJsonPath = path.join(projectDir, 'eas.json');
  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  Log.withTick(
    `Generated ${chalk.bold('eas.json')}. ${learnMore(
      'https://docs.expo.dev/build-reference/eas-json/'
    )}`
  );
  Log.log();
}

export async function updatePackageJsonAsync(projectDir: string): Promise<void> {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const packageJson = await fs.readJson(packageJsonPath);

  if (!packageJson.scripts) {
    packageJson.scripts = {};
  }
  packageJson.scripts.preview = 'npx eas-cli@latest workflow:run publish-preview-update.yml';
  packageJson.scripts['development-builds'] =
    'npx eas-cli@latest workflow:run create-development-builds.yml';
  packageJson.scripts.deploy = 'npx eas-cli@latest workflow:run deploy-to-production.yml';

  await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
  Log.withTick('Updated package.json with scripts');
  Log.log();
}

export async function copyProjectTemplatesAsync(projectDir: string): Promise<void> {
  const templatesSourceDir = path.join(__dirname, 'templates', '.eas', 'workflows');
  const easWorkflowsTargetDir = path.join(projectDir, '.eas', 'workflows');

  await fs.copy(templatesSourceDir, easWorkflowsTargetDir, {
    overwrite: true,
    errorOnExist: false,
  });

  Log.withTick('Created EAS workflow files');
  Log.log();
}

export async function mergeReadmeAsync(projectDir: string): Promise<void> {
  const readmeTemplatePath = path.join(__dirname, 'templates', 'readme-additions.md');
  const projectReadmePath = path.join(projectDir, 'README.md');

  const readmeAdditions = await fs.readFile(readmeTemplatePath, 'utf8');
  const existingReadme = await fs.readFile(projectReadmePath, 'utf8');

  const targetSection = '## Get a fresh project';
  const sectionIndex = existingReadme.indexOf(targetSection);

  let mergedReadme: string;
  if (sectionIndex !== -1) {
    // Insert before "## Get a fresh project" section
    const beforeSection = existingReadme.substring(0, sectionIndex).trim();
    const afterSection = existingReadme.substring(sectionIndex);
    mergedReadme = beforeSection + '\n\n' + readmeAdditions.trim() + '\n\n' + afterSection;
  } else {
    // Append to the end if section doesn't exist
    mergedReadme = existingReadme.trim() + '\n\n' + readmeAdditions.trim() + '\n';
  }

  await fs.writeFile(projectReadmePath, mergedReadme);

  Log.withTick('Updated README.md with EAS configuration details');
  Log.log();
}

export async function initializeGitRepositoryAsync(projectDir: string): Promise<void> {
  await fs.remove(path.join(projectDir, '.git'));

  const commands = [['init'], ['add', '.'], ['commit', '-m', 'Initial commit']];

  for (const args of commands) {
    await runCommandAsync({
      cwd: projectDir,
      command: 'git',
      args,
    });
    Log.log();
  }
}

export default class New extends EasCommand {
  static override aliases = ['new'];

  static override description = "create a new project set up with Expo's services.";

  static override flags = {};

  static override hidden = true;

  static override args = [{ name: 'TARGET_PROJECT_DIRECTORY' }];

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args } = await this.parse(New);

    const {
      loggedIn: { actor, graphqlClient },
    } = await this.getContextAsync(New, { nonInteractive: false });

    if (actor.__typename === 'Robot') {
      throw new Error(
        'This command is not available for robot users. Make sure you are not using a robot token and try again.'
      );
    }

    Log.warn(
      'This command is not yet implemented. It will create a new project, but it will not be fully configured.'
    );
    Log.log(`👋 Welcome to Expo, ${actor.username}!`);
    Log.newLine();

    const targetProjectDirectory = await promptForTargetDirectoryAsync(
      args.TARGET_PROJECT_DIRECTORY
    );
    const projectDirectory = await cloneTemplateAsync(targetProjectDirectory);

    await installProjectDependenciesAsync(projectDirectory);

    const projectId = await createProjectAsync(graphqlClient, actor, projectDirectory);

    const app = await AppQuery.byIdAsync(graphqlClient, projectId);
    await generateConfigFilesAsync(projectDirectory, app);

    await initializeGitRepositoryAsync(projectDirectory);

    Log.log('🎉 We finished creating your new project.');
    Log.newLine();
  }
}
