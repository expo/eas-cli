import { ExpoConfig } from '@expo/config';
import spawnAsync from '@expo/spawn-async';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import dotenv from 'dotenv';
import * as fs from 'fs-extra';
import path from 'path';

import { DefaultEnvironment } from '../../../build/utils/environment';
import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { getPostHogProjectDashboardUrl } from '../../../commandUtils/posthog';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
  PostHogRegion,
} from '../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { PostHogMutation } from '../../../graphql/mutations/PostHogMutation';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import { PostHogQuery } from '../../../graphql/queries/PostHogQuery';
import { PostHogProjectData } from '../../../graphql/types/PostHogConnection';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import { createOrModifyExpoConfigAsync } from '../../../project/expoConfig';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { Choice, confirmAsync, promptAsync, selectAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

const POSTHOG_REGIONS = [
  { title: 'United States (US)', value: PostHogRegion.Us },
  { title: 'European Union (EU)', value: PostHogRegion.Eu },
];

const EAS_POSTHOG_ENVIRONMENTS = [
  DefaultEnvironment.Production,
  DefaultEnvironment.Preview,
  DefaultEnvironment.Development,
];

const SDK_PACKAGES = [
  'posthog-react-native',
  'expo-file-system',
  'expo-application',
  'expo-device',
  'expo-localization',
];
const SESSION_REPLAY_PACKAGE = 'posthog-react-native-session-replay';
const CONFIG_PLUGIN = 'posthog-react-native/expo';

const EAS_POSTHOG_API_KEY_ENV_VAR_NAME = 'EXPO_PUBLIC_POSTHOG_API_KEY';
const EAS_POSTHOG_HOST_ENV_VAR_NAME = 'EXPO_PUBLIC_POSTHOG_HOST';
const POSTHOG_CLI_API_KEY_ENV_VAR_NAME = 'POSTHOG_CLI_API_KEY';
const POSTHOG_CLI_PROJECT_ID_ENV_VAR_NAME = 'POSTHOG_CLI_PROJECT_ID';
const POSTHOG_CLI_HOST_ENV_VAR_NAME = 'POSTHOG_CLI_HOST';

const PERSONAL_API_KEY_SETTINGS_PATH = '/settings/user-api-keys';
const ERROR_TRACKING_NEEDS_KEY_MESSAGE = `Error tracking needs a PostHog personal API key in non-interactive mode. Pass --posthog-cli-api-key (create one in PostHog under Settings → Personal API keys (${PERSONAL_API_KEY_SETTINGS_PATH}) with the "Source map upload" preset), or drop --error-tracking.`;

type Features = { analytics: boolean; sessionReplay: boolean; errorTracking: boolean };
type EnvVar = { name: string; value: string; visibility: EnvironmentVariableVisibility };

export default class IntegrationsPostHogConnect extends EasCommand {
  static override description = 'connect PostHog to your Expo project';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    region: Flags.string({
      description: 'PostHog region',
      options: POSTHOG_REGIONS.map(r => r.value),
    }),
    'session-replay': Flags.boolean({
      allowNo: true,
      description: 'Set up PostHog session replay (default: yes)',
    }),
    'error-tracking': Flags.boolean({
      allowNo: true,
      description: 'Set up PostHog error tracking / source maps (requires a personal API key)',
    }),
    'posthog-cli-api-key': Flags.string({
      description:
        'PostHog personal API key for error-tracking source-map uploads (enables error tracking non-interactively)',
    }),
    overwrite: Flags.boolean({
      description: 'Overwrite existing PostHog environment variables without prompting',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsPostHogConnect);
    const { region: regionFlag, overwrite } = flags;
    const cliApiKeyFlag =
      (flags['posthog-cli-api-key'] ?? process.env[POSTHOG_CLI_API_KEY_ENV_VAR_NAME])?.trim() ||
      undefined;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (nonInteractive && flags['error-tracking'] === true && !cliApiKeyFlag) {
      throw new Error(ERROR_TRACKING_NEEDS_KEY_MESSAGE);
    }

    const {
      privateProjectConfig: { projectId, exp, projectDir },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsPostHogConnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    let connection = await PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync(
      graphqlClient,
      account.id
    );
    if (connection) {
      if (regionFlag && regionFlag !== connection.posthogRegion) {
        Log.warn(
          `This account is already connected to PostHog in the ${connection.posthogRegion} region; --region ${regionFlag} is ignored. An account has a single PostHog organization and its region can't be changed.`
        );
      }
      Log.withTick(
        `Using existing PostHog organization ${chalk.bold(connection.posthogOrganizationName)} (${connection.posthogRegion})`
      );
    } else {
      const region = await this.resolveRegionAsync(regionFlag, nonInteractive);
      const spinner = ora('Creating PostHog organization').start();
      try {
        connection = await PostHogMutation.createPostHogAccountRequestAsync(graphqlClient, {
          accountId: account.id,
          region,
        });
        spinner.succeed(
          `Created PostHog organization ${chalk.bold(connection.posthogOrganizationName)}`
        );
      } catch (error) {
        spinner.fail('Failed to create PostHog organization');
        throw error;
      }
    }

    let project = await PostHogQuery.getPostHogProjectByAppIdAsync(graphqlClient, projectId);
    if (project) {
      Log.withTick(`Using existing PostHog project ${chalk.bold(project.posthogProjectName)}`);
    } else {
      const spinner = ora('Setting up PostHog project').start();
      try {
        project = await PostHogMutation.setupPostHogProjectAsync(graphqlClient, {
          appId: projectId,
          posthogOrganizationConnectionId: connection.id,
        });
        spinner.succeed(`Created PostHog project ${chalk.bold(project.posthogProjectName)}`);
      } catch (error) {
        spinner.fail('Failed to set up PostHog project');
        throw error;
      }
    }

    const features = await this.resolveFeaturesAsync(flags, cliApiKeyFlag, nonInteractive);
    const anyFeatureSelected =
      features.analytics || features.sessionReplay || features.errorTracking;

    const envVars: EnvVar[] = [];
    if (anyFeatureSelected) {
      envVars.push(
        {
          name: EAS_POSTHOG_API_KEY_ENV_VAR_NAME,
          value: project.posthogProjectToken,
          visibility: EnvironmentVariableVisibility.Public,
        },
        {
          name: EAS_POSTHOG_HOST_ENV_VAR_NAME,
          value: project.posthogHost,
          visibility: EnvironmentVariableVisibility.Public,
        }
      );
    }
    if (features.errorTracking) {
      const cliApiKey = await this.resolveCliApiKeyAsync(cliApiKeyFlag, project.posthogHost);
      envVars.push(
        {
          name: POSTHOG_CLI_API_KEY_ENV_VAR_NAME,
          value: cliApiKey,
          visibility: EnvironmentVariableVisibility.Sensitive,
        },
        {
          name: POSTHOG_CLI_PROJECT_ID_ENV_VAR_NAME,
          value: project.posthogProjectIdentifier,
          visibility: EnvironmentVariableVisibility.Public,
        },
        {
          name: POSTHOG_CLI_HOST_ENV_VAR_NAME,
          value: project.posthogHost,
          visibility: EnvironmentVariableVisibility.Public,
        }
      );
    }

    if (!anyFeatureSelected) {
      Log.warn('No PostHog features selected — skipping SDK install and config changes.');
    } else {
      await this.installSdkPackagesAsync(projectDir, features, jsonFlag);
      await this.addConfigPluginAsync(projectDir, exp);
    }

    await this.writeEnvLocalAsync(projectDir, envVars, nonInteractive, overwrite);
    await Promise.all(
      envVars.map(envVar =>
        this.upsertEasEnvVarAsync(graphqlClient, projectId, envVar, nonInteractive, overwrite)
      )
    );

    if (jsonFlag) {
      printJsonOnlyOutput({
        organizationConnection: {
          id: connection.id,
          name: connection.posthogOrganizationName,
          region: connection.posthogRegion,
        },
        project: {
          id: project.id,
          name: project.posthogProjectName,
          apiKey: project.posthogProjectToken,
          host: project.posthogHost,
        },
        features,
        dashboardUrl: getPostHogProjectDashboardUrl(project),
        environmentVariables: envVars.map(v => v.name),
      });
      return;
    }

    this.printNextSteps(project, features);
  }

  private async resolveFeaturesAsync(
    flags: { 'session-replay'?: boolean; 'error-tracking'?: boolean },
    cliApiKey: string | undefined,
    nonInteractive: boolean
  ): Promise<Features> {
    const sessionReplayFlag = flags['session-replay'];
    const errorTrackingFlag = flags['error-tracking'];
    const hasCliApiKey = !!cliApiKey;

    if (nonInteractive) {
      const errorTracking = errorTrackingFlag ?? hasCliApiKey;
      if (errorTrackingFlag === undefined && !hasCliApiKey) {
        Log.warn(
          'Skipping error tracking (source maps) — it needs a personal API key. Re-run interactively, or pass --posthog-cli-api-key to enable it non-interactively.'
        );
      }
      return { analytics: true, sessionReplay: sessionReplayFlag ?? true, errorTracking };
    }

    if (sessionReplayFlag !== undefined || errorTrackingFlag !== undefined) {
      return {
        analytics: true,
        sessionReplay: sessionReplayFlag ?? true,
        errorTracking: errorTrackingFlag ?? true,
      };
    }

    const { features } = await promptAsync({
      type: 'multiselect',
      name: 'features',
      message: 'PostHog features to set up',
      choices: [
        { title: 'Analytics', value: 'analytics', selected: true },
        { title: 'Session replay', value: 'session-replay', selected: true },
        {
          title: 'Error tracking (source maps) — requires a personal API key',
          value: 'error-tracking',
          selected: true,
        },
      ] satisfies Choice[],
      instructions: false,
      min: 0,
    });
    const selected = new Set<string>(features as string[]);
    return {
      analytics: selected.has('analytics'),
      sessionReplay: selected.has('session-replay'),
      errorTracking: selected.has('error-tracking'),
    };
  }

  private async resolveCliApiKeyAsync(
    cliApiKey: string | undefined,
    host: string
  ): Promise<string> {
    if (cliApiKey) {
      return cliApiKey;
    }
    const settingsUrl = `${host.replace(/\/$/, '')}${PERSONAL_API_KEY_SETTINGS_PATH}`;
    const { apiKey } = await promptAsync({
      type: 'password',
      name: 'apiKey',
      message: `Paste a PostHog personal API key for source-map uploads.\nCreate one at ${settingsUrl} using the "Source map upload" preset.`,
      validate: (value: string) => (value.trim() ? true : 'Personal API key cannot be empty'),
    });
    return apiKey.trim();
  }

  private async resolveRegionAsync(
    flagValue: string | undefined,
    nonInteractive: boolean
  ): Promise<PostHogRegion> {
    const flagRegion = POSTHOG_REGIONS.find(r => r.value === flagValue);
    if (flagRegion) {
      return flagRegion.value;
    }
    if (nonInteractive) {
      throw new Error(
        'A PostHog region is required in non-interactive mode. Pass --region US or --region EU. The region sets data residency and cannot be changed after connecting.'
      );
    }
    return await selectAsync('Select a PostHog region', POSTHOG_REGIONS);
  }

  private async installSdkPackagesAsync(
    projectDir: string,
    features: Features,
    jsonFlag: boolean
  ): Promise<void> {
    const packages = [...SDK_PACKAGES];
    if (features.sessionReplay) {
      packages.push(SESSION_REPLAY_PACKAGE);
    }
    Log.newLine();
    Log.log(`Running ${chalk.bold(`npx expo install ${packages.join(' ')}`)}`);
    Log.newLine();
    try {
      await spawnAsync('npx', ['expo', 'install', ...packages], {
        cwd: projectDir,
        stdio: jsonFlag ? ['ignore', 2, 2] : 'inherit',
      });
      Log.withTick('Installed the PostHog SDK packages');
    } catch (error) {
      Log.warn(
        `Failed to install the PostHog SDK packages. Run ${chalk.cyan(
          `npx expo install ${packages.join(' ')}`
        )} from your project directory.`
      );
      throw error;
    }
  }

  private async addConfigPluginAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
    const plugins = exp.plugins ?? [];
    const alreadyAdded = plugins.some(p => (Array.isArray(p) ? p[0] : p) === CONFIG_PLUGIN);
    if (alreadyAdded) {
      Log.withTick(`Config plugin ${chalk.bold(CONFIG_PLUGIN)} is already configured`);
      return;
    }

    const modification = await createOrModifyExpoConfigAsync(
      projectDir,
      { plugins: [...plugins, CONFIG_PLUGIN] },
      { skipSDKVersionRequirement: true }
    );
    if (modification.type !== 'success') {
      if (modification.type === 'warn') {
        Log.warn(modification.message);
      }
      Log.log(chalk.cyan('Add the PostHog config plugin to your app config:'));
      Log.log(`  "plugins": [..., ${JSON.stringify(CONFIG_PLUGIN)}]`);
      return;
    }
    Log.withTick(`Added the ${chalk.bold(CONFIG_PLUGIN)} config plugin`);
  }

  private async writeEnvLocalAsync(
    projectDir: string,
    envVars: EnvVar[],
    nonInteractive: boolean,
    overwrite: boolean
  ): Promise<void> {
    if (envVars.length === 0) {
      return;
    }
    const envPath = path.join(projectDir, '.env.local');
    let rawContent = '';
    if (await fs.pathExists(envPath)) {
      rawContent = await fs.readFile(envPath, 'utf8');
      const existing = dotenv.parse(rawContent);
      const conflicts = envVars.filter(v => existing[v.name] !== undefined);
      if (conflicts.length > 0 && !overwrite) {
        if (nonInteractive) {
          Log.warn(
            `.env.local already defines ${conflicts
              .map(v => v.name)
              .join(', ')}; skipped (pass --overwrite to replace).`
          );
          return;
        }
        const confirmed = await confirmAsync({
          message: `.env.local already defines ${conflicts
            .map(v => v.name)
            .join(', ')}. Overwrite with the PostHog values?`,
        });
        if (!confirmed) {
          Log.warn(`Skipped updating ${chalk.bold('.env.local')}.`);
          return;
        }
      }
    }

    const updatedContent = this.mergeEnvContent(
      rawContent,
      Object.fromEntries(envVars.map(v => [v.name, v.value]))
    );
    await fs.writeFile(envPath, updatedContent);
    Log.withTick(`Wrote PostHog config to ${chalk.bold('.env.local')}`);
  }

  private mergeEnvContent(rawContent: string, newVars: Record<string, string>): string {
    let content = rawContent;
    const keysToAdd: Record<string, string> = { ...newVars };
    for (const [key, value] of Object.entries(newVars)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, () => `${key}=${value}`);
        delete keysToAdd[key];
      }
    }
    const remaining = Object.entries(keysToAdd);
    if (remaining.length > 0) {
      if (content.length > 0 && !content.endsWith('\n')) {
        content += '\n';
      }
      for (const [key, value] of remaining) {
        content += `${key}=${value}\n`;
      }
    }
    return content;
  }

  private async upsertEasEnvVarAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string,
    envVar: EnvVar,
    nonInteractive: boolean,
    overwrite: boolean
  ): Promise<void> {
    const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
      appId: projectId,
      filterNames: [envVar.name],
    });
    const existingProjectVariable = existingVariables.find(
      variable => variable.scope === EnvironmentVariableScope.Project
    );

    if (existingProjectVariable) {
      const shouldOverwrite =
        overwrite ||
        (!nonInteractive &&
          (await confirmAsync({
            message: `EAS already has an ${envVar.name} environment variable for this project. Overwrite it?`,
          })));
      if (!shouldOverwrite) {
        Log.warn(
          `Skipped updating EAS environment variable ${chalk.bold(envVar.name)}${
            nonInteractive ? ' (pass --overwrite to replace it)' : ''
          }.`
        );
        return;
      }
      await EnvironmentVariableMutation.updateAsync(graphqlClient, {
        id: existingProjectVariable.id,
        name: envVar.name,
        value: envVar.value,
        environments: EAS_POSTHOG_ENVIRONMENTS,
        visibility: envVar.visibility,
        type: EnvironmentSecretType.String,
      });
      Log.withTick(`Updated EAS environment variable ${chalk.bold(envVar.name)} for builds`);
      return;
    }

    await EnvironmentVariableMutation.createForAppAsync(
      graphqlClient,
      {
        name: envVar.name,
        value: envVar.value,
        environments: EAS_POSTHOG_ENVIRONMENTS,
        visibility: envVar.visibility,
        type: EnvironmentSecretType.String,
      },
      projectId
    );
    Log.withTick(`Created EAS environment variable ${chalk.bold(envVar.name)} for builds`);
  }

  private printNextSteps(project: PostHogProjectData, features: Features): void {
    Log.addNewLineIfNone();
    Log.log(chalk.green('PostHog is connected!'));
    Log.newLine();
    Log.log(
      `${chalk.bold('Dashboard')}: ${link(getPostHogProjectDashboardUrl(project), { dim: false })}`
    );
    Log.newLine();
    Log.log('Next steps:');
    const steps: string[] = [
      `Wrap your app in ${chalk.cyan('<PostHogProvider>')} following our guide (${chalk.cyan('https://docs.expo.dev/guides/using-posthog')}).`,
    ];
    if (features.sessionReplay) {
      steps.push(
        `Enable session replay in the provider options (the ${chalk.bold(SESSION_REPLAY_PACKAGE)} package is installed).`
      );
    }
    if (features.errorTracking) {
      steps.push(
        `Error-tracking source maps: your ${chalk.bold('POSTHOG_CLI_*')} env vars are set in ${chalk.bold('.env.local')} and EAS — see the guide above to enable source-map uploads on your builds.`
      );
    }
    steps.forEach((step, index) => {
      Log.log(`  ${index + 1}. ${step}`);
    });
  }
}
