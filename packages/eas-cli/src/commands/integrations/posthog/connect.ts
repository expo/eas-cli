import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { DefaultEnvironment } from '../../../build/utils/environment';
import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
  PostHogRegion,
} from '../../../graphql/generated';
import { getPostHogProjectDashboardUrl } from '../../../commandUtils/posthog';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { PostHogMutation } from '../../../graphql/mutations/PostHogMutation';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import { PostHogQuery } from '../../../graphql/queries/PostHogQuery';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

// Backend ExpoErrorCode for the existing-PostHog-user dead-end (v1 supports new accounts only).
const POSTHOG_EXISTING_USER_NOT_SUPPORTED_ERROR_CODE = 'POSTHOG_EXISTING_USER_NOT_SUPPORTED_ERROR';

function getGraphQLErrorCode(error: unknown): string | undefined {
  return (error as { graphQLErrors?: { extensions?: { errorCode?: string } }[] }).graphQLErrors?.[0]
    ?.extensions?.errorCode;
}

const POSTHOG_REGIONS = [
  { title: 'United States (US)', value: PostHogRegion.Us },
  { title: 'European Union (EU)', value: PostHogRegion.Eu },
];

const EAS_POSTHOG_ENVIRONMENTS = [
  DefaultEnvironment.Production,
  DefaultEnvironment.Preview,
  DefaultEnvironment.Development,
];

const EAS_POSTHOG_API_KEY_ENV_VAR_NAME = 'EXPO_PUBLIC_POSTHOG_API_KEY';
const EAS_POSTHOG_HOST_ENV_VAR_NAME = 'EXPO_PUBLIC_POSTHOG_HOST';

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
    overwrite: Flags.boolean({
      description:
        'Overwrite existing EXPO_PUBLIC_POSTHOG_* environment variables without prompting',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsPostHogConnect);
    const { region: regionFlag, overwrite } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsPostHogConnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    // PostHog provisioning is irreversible, so reuse the account's existing
    // connection instead of creating a duplicate organization.
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
        // Existing-PostHog-user dead-end: surface the documented guidance rather
        // than a generic failure. v1 supports brand-new PostHog accounts only.
        if (getGraphQLErrorCode(error) === POSTHOG_EXISTING_USER_NOT_SUPPORTED_ERROR_CODE) {
          spinner.fail('This email already has a PostHog account');
          Log.error((error as Error).message);
          return;
        }
        spinner.fail('Failed to create PostHog organization');
        throw error;
      }
    }

    // Reuse an existing project for this app rather than failing the setup mutation.
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

    await this.upsertPostHogEnvVarAsync(
      graphqlClient,
      projectId,
      EAS_POSTHOG_API_KEY_ENV_VAR_NAME,
      project.posthogProjectToken,
      nonInteractive,
      overwrite
    );
    await this.upsertPostHogEnvVarAsync(
      graphqlClient,
      projectId,
      EAS_POSTHOG_HOST_ENV_VAR_NAME,
      project.posthogHost,
      nonInteractive,
      overwrite
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
        dashboardUrl: getPostHogProjectDashboardUrl(project),
        environmentVariables: [EAS_POSTHOG_API_KEY_ENV_VAR_NAME, EAS_POSTHOG_HOST_ENV_VAR_NAME],
      });
      return;
    }

    Log.addNewLineIfNone();
    Log.log(chalk.green('PostHog is connected!'));
    Log.newLine();
    Log.log(
      `${chalk.bold('Dashboard')}: ${link(getPostHogProjectDashboardUrl(project), { dim: false })}`
    );
    Log.log(
      `Wrote ${chalk.bold(EAS_POSTHOG_API_KEY_ENV_VAR_NAME)} and ${chalk.bold(
        EAS_POSTHOG_HOST_ENV_VAR_NAME
      )} to Production, Preview, and Development.`
    );
    Log.newLine();
    Log.log('Next steps:');
    Log.log(
      `  Wrap your app in ${chalk.cyan('<PostHogProvider>')} following our guide: ${chalk.cyan('https://docs.expo.dev/guides/using-posthog')}`
    );
  }

  private async resolveRegionAsync(
    flagValue: string | undefined,
    nonInteractive: boolean
  ): Promise<PostHogRegion> {
    if (flagValue) {
      const match = POSTHOG_REGIONS.find(r => r.value === flagValue);
      if (!match) {
        throw new Error(
          `Unsupported PostHog region "${flagValue}". Use one of: ${POSTHOG_REGIONS.map(r => r.value).join(', ')}.`
        );
      }
      return match.value;
    }
    if (nonInteractive) {
      // No silent default: region sets data residency and can't be changed after
      // connecting, so an implicit US default could put EU data in the wrong place.
      throw new Error(
        'A PostHog region is required in non-interactive mode. Pass --region US or --region EU. The region sets data residency and cannot be changed after connecting.'
      );
    }
    return await selectAsync('Select a PostHog region', POSTHOG_REGIONS);
  }

  private async upsertPostHogEnvVarAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string,
    name: string,
    value: string,
    nonInteractive: boolean,
    overwrite: boolean
  ): Promise<void> {
    const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
      appId: projectId,
      filterNames: [name],
    });
    const existingProjectVariable = existingVariables.find(
      variable => variable.scope === EnvironmentVariableScope.Project
    );

    if (existingProjectVariable) {
      const shouldOverwrite =
        overwrite ||
        (!nonInteractive &&
          (await confirmAsync({
            message: `EAS already has an ${name} environment variable for this project. Overwrite it?`,
          })));
      if (!shouldOverwrite) {
        Log.warn(
          `Skipped updating EAS environment variable ${chalk.bold(name)}${
            nonInteractive ? ' (pass --overwrite to replace it)' : ''
          }.`
        );
        return;
      }
      await EnvironmentVariableMutation.updateAsync(graphqlClient, {
        id: existingProjectVariable.id,
        name,
        value,
        environments: EAS_POSTHOG_ENVIRONMENTS,
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      });
      Log.withTick(`Updated EAS environment variable ${chalk.bold(name)} for builds`);
      return;
    }

    await EnvironmentVariableMutation.createForAppAsync(
      graphqlClient,
      {
        name,
        value,
        environments: EAS_POSTHOG_ENVIRONMENTS,
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      },
      projectId
    );
    Log.withTick(`Created EAS environment variable ${chalk.bold(name)} for builds`);
  }
}
