import { Errors, Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentSecretFragment, EnvironmentSecretType } from '../../graphql/generated';
import { EnvironmentSecretMutation } from '../../graphql/mutations/EnvironmentSecretMutation';
import {
  EnvironmentSecretScope,
  EnvironmentSecretsQuery,
} from '../../graphql/queries/EnvironmentSecretsQuery';
import Log from '../../log';
import { ora } from '../../ora';
import {
  getDisplayNameForProjectIdAsync,
  getOwnerAccountForProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import intersection from '../../utils/expodash/intersection';

export default class EnvironmentSecretSync extends EasCommand {
  static override description = 'read environment secrets from env file and store on the server';

  static override flags = {
    scope: Flags.enum({
      description: 'Scope for the secrets',
      options: [EnvironmentSecretScope.ACCOUNT, EnvironmentSecretScope.PROJECT],
      default: EnvironmentSecretScope.PROJECT,
    }),
    'env-file': Flags.string({
      description: 'Env file with secrets',
    }),
    force: Flags.boolean({
      description: 'Delete and recreate existing secrets',
      default: false,
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      flags: { scope, force, 'env-file': envFilePath, 'non-interactive': nonInteractive },
    } = await this.parse(EnvironmentSecretSync);
    const {
      projectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentSecretSync, {
      nonInteractive,
    });

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    const ownerAccount = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    if (!envFilePath) {
      const validationMessage = 'Env file must be passed.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }

      ({ envFilePath } = await promptAsync({
        type: 'text',
        name: 'envFilePath',
        message: 'Path to the env file with secrets:',
        // eslint-disable-next-line async-protect/async-suffix
        validate: async secretValueRaw => {
          if (!secretValueRaw) {
            return validationMessage;
          }
          envFilePath = path.resolve(secretValueRaw);
          if (!(await fs.pathExists(envFilePath))) {
            return `File "${envFilePath}" does not exist.`;
          }
          return true;
        },
      }));
    }

    assert(envFilePath);
    if (!(await fs.pathExists(envFilePath))) {
      throw new Error(`File "${envFilePath}" does not exist`);
    }

    const newSecrets: Record<string, string> = dotenv.parse(await fs.readFile(envFilePath));

    const serverSecrets = await readAllSecretsFromServerAsync(graphqlClient, projectId, scope);
    const commonSecretNames = findCommonSecretNames(serverSecrets, newSecrets);

    if (commonSecretNames.length > 0) {
      if (!force) {
        Log.log(`This ${scope} already has environment secrets with the following names:`);
        for (const name of commonSecretNames) {
          Log.log(`- ${name}`);
        }
        Log.error('Run with --force flag to proceed');
        Errors.exit(1);
      } else {
        const spinner = ora('Deleting secrets already present on server...').start();
        const commonSecretNameSet = new Set(commonSecretNames);
        const commonServerSecrets = serverSecrets.filter(({ name }) =>
          commonSecretNameSet.has(name)
        );
        await deleteSecretsAsync(graphqlClient, commonServerSecrets);
        spinner.succeed();
      }
    }

    await createSecretsAsync(
      graphqlClient,
      {
        scope,
        accountId: ownerAccount.id,
        accountName: ownerAccount.name,
        projectId,
        projectDisplayName,
      },
      newSecrets
    );

    Log.withTick(
      `Created the following secrets on ${scope} ${chalk.bold(
        scope === EnvironmentSecretScope.ACCOUNT ? ownerAccount.name : projectDisplayName
      )}:`
    );
    for (const secretName of Object.keys(newSecrets)) {
      Log.log(`- ${secretName}`);
    }
  }
}

async function readAllSecretsFromServerAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  scope: EnvironmentSecretScope
): Promise<EnvironmentSecretFragment[]> {
  const { appSecrets, accountSecrets } = await EnvironmentSecretsQuery.byAppIdAsync(
    graphqlClient,
    projectId
  );

  return scope === EnvironmentSecretScope.ACCOUNT ? accountSecrets : appSecrets;
}

function findCommonSecretNames(
  serverSecrets: EnvironmentSecretFragment[],
  newSecrets: Record<string, string>
): string[] {
  const serverSecretKeys = serverSecrets.map(({ name }) => name);
  const newSecretKeys = Object.keys(newSecrets);
  const commonKeys = intersection(serverSecretKeys, newSecretKeys);
  return commonKeys;
}

async function deleteSecretsAsync(
  graphqlClient: ExpoGraphqlClient,
  secrets: EnvironmentSecretFragment[]
): Promise<void> {
  const promises = secrets.map(secret =>
    EnvironmentSecretMutation.deleteAsync(graphqlClient, secret.id)
  );
  await Promise.all(promises);
}

async function createSecretsAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    scope,
    accountId,
    accountName,
    projectId,
    projectDisplayName,
  }: {
    scope: EnvironmentSecretScope;
    accountId: string;
    accountName: string;
    projectId: string;
    projectDisplayName: string;
  },
  secrets: Record<string, string>
): Promise<void> {
  const promises = [];

  const spinner = ora(
    `Creating secrets on ${scope} ${chalk.bold(
      scope === EnvironmentSecretScope.ACCOUNT ? accountName : projectDisplayName
    )}...`
  ).start();
  for (const [secretName, secretValue] of Object.entries(secrets)) {
    if (scope === EnvironmentSecretScope.ACCOUNT) {
      promises.push(
        EnvironmentSecretMutation.createForAccountAsync(
          graphqlClient,
          { name: secretName, value: secretValue, type: EnvironmentSecretType.String },
          accountId
        )
      );
    } else {
      promises.push(
        EnvironmentSecretMutation.createForAppAsync(
          graphqlClient,
          { name: secretName, value: secretValue, type: EnvironmentSecretType.String },
          projectId
        )
      );
    }
  }

  try {
    await Promise.all(promises);
    spinner.succeed();
  } catch (err) {
    spinner.fail();
    throw err;
  }
}
