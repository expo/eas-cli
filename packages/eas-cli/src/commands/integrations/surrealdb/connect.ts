import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  parseEnvironmentFlag,
  resolveTargetEnvironmentsAsync,
} from '../../../environments/resolve';
import { upsertEnvVarAsync, upsertEnvVarsSequentiallyAsync } from '../../../environments/variables';
import { writeEnvLocalAsync } from '../../../integrations/shared/envFile';
import { installSdkPackagesAsync } from '../../../integrations/shared/sdk';
import {
  SURREAL_EXPO_GUIDE_URL,
  SURREAL_STUDIO_URL,
  isCleartextEndpoint,
  isSurrealEndpointReachableAsync,
  parseSurrealEndpoint,
  validateSurrealEndpoint,
  validateSurrealName,
} from '../../../integrations/surrealdb/endpoint';
import {
  EAS_SURREAL_DATABASE_ENV_VAR_NAME,
  EAS_SURREAL_ENDPOINT_ENV_VAR_NAME,
  EAS_SURREAL_ENVIRONMENTS,
  EAS_SURREAL_NAMESPACE_ENV_VAR_NAME,
  SURREAL_ENV_LABEL,
  createSurrealEnvVars,
  surrealEnvironmentCancelMessage,
  surrealMoveConfirmMessage,
} from '../../../integrations/surrealdb/env';
import Log, { link } from '../../../log';
import { ora } from '../../../ora';
import { promptAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

// expo-secure-store keeps session tokens in the platform keystore, as the SurrealDB Expo guide does.
const SDK_PACKAGES = ['surrealdb', 'expo-secure-store'];

export default class IntegrationsSurrealdbConnect extends EasCommand {
  static override description =
    'connect a SurrealDB instance: install the SDK, and write EXPO_PUBLIC_SURREAL_ENDPOINT / EXPO_PUBLIC_SURREAL_NAMESPACE / EXPO_PUBLIC_SURREAL_DATABASE';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --endpoint wss://my-instance.aws-euw1.surreal.cloud --namespace app --database production',
    '<%= config.bin %> <%= command.id %> --environment preview --endpoint wss://staging.example.com --namespace app --database preview',
    '<%= config.bin %> <%= command.id %> --endpoint wss://db.example.com --namespace app --database main --non-interactive --overwrite',
  ];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    endpoint: Flags.string({
      description:
        'SurrealDB endpoint the app connects to, e.g. wss://my-instance.aws-euw1.surreal.cloud. A bare hostname gets wss://. Required with --non-interactive',
    }),
    namespace: Flags.string({
      description: 'SurrealDB namespace the app uses. Required with --non-interactive',
    }),
    database: Flags.string({
      description: 'SurrealDB database the app uses. Required with --non-interactive',
    }),
    overwrite: Flags.boolean({
      description: 'Replace existing EXPO_PUBLIC_SURREAL_* in .env.local and EAS without prompting',
      default: false,
    }),
    environment: Flags.string({
      description:
        'EAS environments to point at this instance (e.g. preview). Other environments keep their values, and .env.local is not written. Defaults to production, preview and development',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsSurrealdbConnect);
    const { overwrite, environment: environmentFlag } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const requestedEnvironments = parseEnvironmentFlag(environmentFlag);
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (nonInteractive) {
      const missing = (['endpoint', 'namespace', 'database'] as const).filter(
        name => !flags[name]?.trim()
      );
      if (missing.length > 0) {
        throw new Error(
          `Pass ${missing.map(name => `--${name}`).join(', ')} in non-interactive mode.`
        );
      }
    }
    // Fail on a bad flag before touching the project.
    const endpointFromFlag =
      flags.endpoint !== undefined ? parseSurrealEndpoint(flags.endpoint) : undefined;

    const {
      privateProjectConfig: { projectId, projectDir },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsSurrealdbConnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const targetEnvironments = requestedEnvironments
      ? await resolveTargetEnvironmentsAsync(
          graphqlClient,
          projectId,
          requestedEnvironments,
          nonInteractive,
          {
            defaultEnvironments: EAS_SURREAL_ENVIRONMENTS,
            cancelMessage: surrealEnvironmentCancelMessage,
          }
        )
      : EAS_SURREAL_ENVIRONMENTS;

    const endpoint = endpointFromFlag ?? (await promptEndpointAsync());
    const namespace = flags.namespace?.trim() || (await promptNameAsync('namespace'));
    const database = flags.database?.trim() || (await promptNameAsync('database'));

    const reachable = await this.checkEndpointAsync(endpoint, jsonFlag);
    const cleartext = isCleartextEndpoint(endpoint);
    if (cleartext && !jsonFlag) {
      Log.warn(
        `${chalk.bold(endpoint)} is not encrypted. Android and iOS block cleartext traffic by default, so use it for development builds only and connect over wss:// in builds you ship. See ${link(`${SURREAL_EXPO_GUIDE_URL}#reaching-your-database-from-a-device`)}`
      );
    }

    const manualSteps: string[] = [];
    const installResult = await installSdkPackagesAsync(projectDir, {
      packages: SDK_PACKAGES,
      label: SURREAL_ENV_LABEL,
      jsonFlag,
    });
    if (installResult.status === 'failed') {
      manualSteps.push(
        `Run npx expo install ${SDK_PACKAGES.join(' ')} from your project directory.`
      );
    } else if (installResult.dynamicConfigGuidance) {
      manualSteps.push(installResult.dynamicConfigGuidance);
    }

    const envVars = createSurrealEnvVars({ endpoint, namespace, database });

    // .env.local is the local counterpart of the default write. With --environment the values are
    // for a separate instance, so local development keeps pointing where it did.
    const envLocalWritten = requestedEnvironments
      ? false
      : await writeEnvLocalAsync(projectDir, envVars, {
          label: SURREAL_ENV_LABEL,
          nonInteractive,
          overwrite,
        });
    const easWritten = await upsertEnvVarsSequentiallyAsync(envVars, envVar =>
      upsertEnvVarAsync(
        graphqlClient,
        projectId,
        envVar,
        targetEnvironments,
        nonInteractive,
        overwrite,
        requestedEnvironments
          ? { mode: 'keepOtherEnvironments', moveConfirmMessage: surrealMoveConfirmMessage }
          : { mode: 'replaceOtherEnvironments' }
      )
    );

    if (jsonFlag) {
      printJsonOnlyOutput({
        endpoint,
        namespace,
        database,
        reachable,
        environments: targetEnvironments,
        dashboardUrl: SURREAL_STUDIO_URL,
        envLocalWritten,
        environmentVariables: envVars.map((v, i) => ({ name: v.name, easWritten: easWritten[i] })),
        manualSteps,
      });
      return;
    }

    this.printNextSteps({
      targetEnvironments,
      isDefaultWrite: !requestedEnvironments,
      manualSteps,
    });
  }

  private async checkEndpointAsync(endpoint: string, jsonFlag: boolean): Promise<boolean> {
    const spinner = jsonFlag ? null : ora(`Checking ${endpoint}`).start();
    const reachable = await isSurrealEndpointReachableAsync(endpoint);
    if (reachable) {
      spinner?.succeed(`SurrealDB is reachable at ${chalk.bold(endpoint)}`);
    } else {
      spinner?.warn(
        `Could not reach SurrealDB at ${chalk.bold(endpoint)} from this machine. The values are written anyway; check that the instance is running and that devices can reach it.`
      );
    }
    return reachable;
  }

  private printNextSteps({
    targetEnvironments,
    isDefaultWrite,
    manualSteps,
  }: {
    targetEnvironments: string[];
    isDefaultWrite: boolean;
    manualSteps: string[];
  }): void {
    Log.addNewLineIfNone();
    Log.log(
      chalk.green(
        isDefaultWrite
          ? 'SurrealDB is connected!'
          : `SurrealDB is connected for ${targetEnvironments.join(', ')}!`
      )
    );
    Log.newLine();
    Log.log(`${chalk.bold('SurrealDB Studio')}: ${link(SURREAL_STUDIO_URL, { dim: false })}`);
    Log.newLine();
    Log.log('Next steps:');
    Log.log(
      `  1. Create a connection provider following the SurrealDB Expo guide (${chalk.cyan(SURREAL_EXPO_GUIDE_URL)}). It reads ${chalk.bold(EAS_SURREAL_ENDPOINT_ENV_VAR_NAME)}, ${chalk.bold(EAS_SURREAL_NAMESPACE_ENV_VAR_NAME)} and ${chalk.bold(EAS_SURREAL_DATABASE_ENV_VAR_NAME)}.`
    );
    Log.log(
      `  2. Sign users in with record access (${chalk.bold('DEFINE ACCESS … TYPE RECORD')}). Never put system user credentials in ${chalk.bold('EXPO_PUBLIC_')} variables; they ship in the app bundle.`
    );
    if (isDefaultWrite) {
      Log.log(
        `  3. To use a separate instance for Preview (or other EAS environments), re-run ${chalk.cyan('eas integrations:surrealdb:connect --environment preview')}.`
      );
    }

    if (manualSteps.length > 0) {
      Log.newLine();
      Log.warn('Finish setup manually:');
      for (const step of manualSteps) {
        for (const line of step.split('\n')) {
          Log.warn(`  ${line}`);
        }
      }
    }
  }
}

async function promptEndpointAsync(): Promise<string> {
  const { endpoint } = await promptAsync({
    type: 'text',
    name: 'endpoint',
    message: 'SurrealDB endpoint (e.g. wss://my-instance.aws-euw1.surreal.cloud)',
    validate: validateSurrealEndpoint,
  });
  return parseSurrealEndpoint(endpoint);
}

async function promptNameAsync(kind: 'namespace' | 'database'): Promise<string> {
  const { value } = await promptAsync({
    type: 'text',
    name: 'value',
    message: `SurrealDB ${kind}`,
    validate: validateSurrealName(kind),
  });
  return value.trim();
}
