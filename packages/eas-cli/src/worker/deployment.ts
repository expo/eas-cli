import { CombinedError as GraphqlError } from '@urql/core';
import chalk from 'chalk';

import { DeploymentsMutation } from './mutations';
import { DeploymentsQuery } from './queries';
import { EXPO_BASE_DOMAIN } from './utils/logs';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { WorkerDeploymentAliasFragment, WorkerDeploymentFragment } from '../graphql/generated';
import Log from '../log';
import { promptAsync } from '../prompts';
import { memoize } from '../utils/expodash/memoize';
import { selectPaginatedAsync } from '../utils/relay';

export async function getSignedDeploymentUrlAsync(
  graphqlClient: ExpoGraphqlClient,
  options: {
    appId: string;
    deploymentIdentifier?: string | null;
    /** Custom dev domain name (preview URL subdomain) requested through the `--dev-domain` flag */
    devDomainName?: string;
    /** Callback which is invoked when the project is going to setup the dev domain */
    onSetupDevDomain?: () => any;
    /** If the terminal is running in non interactive mode or not */
    nonInteractive?: boolean;
  }
): Promise<string> {
  let currentDevDomainName: string | null = null;
  if (options.devDomainName) {
    currentDevDomainName = await DeploymentsQuery.getDevDomainNameByAppIdAsync(graphqlClient, {
      appId: options.appId,
    });

    if (currentDevDomainName && currentDevDomainName !== options.devDomainName) {
      throw new Error(
        `The project's preview URL is already set to "${currentDevDomainName}.${EXPO_BASE_DOMAIN}.app" and cannot be changed to "${options.devDomainName}.${EXPO_BASE_DOMAIN}.app" through "eas deploy".\nRemove the --dev-domain flag to deploy to the existing preview URL.`
      );
    }
  }

  let signedUrl: string;
  try {
    signedUrl = await DeploymentsMutation.createSignedDeploymentUrlAsync(graphqlClient, {
      appId: options.appId,
      deploymentIdentifier: options.deploymentIdentifier,
    });
  } catch (error: any) {
    const isMissingDevDomain = (error as GraphqlError)?.graphQLErrors?.some(e =>
      ['APP_NO_DEV_DOMAIN_NAME'].includes(e?.extensions?.errorCode as string)
    );

    // Throw unexpected errors eagerly
    if (!isMissingDevDomain) {
      throw error;
    }

    // Ensure the callback is invoked, containing cleanup logic for possible spinners
    options.onSetupDevDomain?.();
    // Assign the dev domain name by prompting the user
    await assignDevDomainNameAsync({
      graphqlClient,
      appId: options.appId,
      devDomainName: options.devDomainName,
      nonInteractive: options.nonInteractive,
    });
    // Retry creating the signed URL. The dev domain name was just assigned, so drop it from
    // the retry to skip the pre-checks (and their extra query) — it is known to be set now.
    return await getSignedDeploymentUrlAsync(graphqlClient, { ...options, devDomainName: undefined });
  }

  // The --dev-domain flag is applied when the server requires a preview URL to be assigned
  // before the first deployment. If the deployment was accepted without that assignment,
  // fail instead of silently deploying without the requested preview URL.
  if (options.devDomainName && !currentDevDomainName) {
    throw new Error(
      `The --dev-domain flag was provided, but the project's preview URL was not assigned as part of this deployment.\nRemove the --dev-domain flag and set the preview URL from the project's hosting settings on the website instead.`
    );
  }

  return signedUrl;
}

type PromptInstance = {
  cursorOffset: number;
  placeholder: boolean;
  rendered: string;
  initial: string;
  done: boolean;
  get value(): string;
  set value(input: string);
};

const DEV_DOMAIN_INVALID_START_END_CHARACTERS = /^[^a-z0-9]+|[^a-z0-9-]+$/;
const DEV_DOMAIN_INVALID_REPLACEMENT_HYPHEN = /[^a-z0-9-]+/;
const DEV_DOMAIN_INVALID_MULTIPLE_HYPHENS = /(-{2,})/;

/**
 * Format a dev domain name to match whats allowed on the backend.
 * This is equal to our `DEV_DOMAIN_NAME_REGEX`, but implemented as a filtering function
 * to help users find a valid name while typing.
 */
function formatDevDomainName(name = ''): string {
  return name
    .toLowerCase()
    .replace(DEV_DOMAIN_INVALID_REPLACEMENT_HYPHEN, '-')
    .replace(DEV_DOMAIN_INVALID_START_END_CHARACTERS, '')
    .replace(DEV_DOMAIN_INVALID_MULTIPLE_HYPHENS, '-')
    .trim();
}

/**
 * Validate a dev domain name (preview URL subdomain), matching the rules of the interactive prompt.
 * Returns `true` when valid, or an error message describing why the name is invalid.
 */
function validateDevDomainName(value: string): true | string {
  if (!value) {
    return 'You have to choose a preview URL for your project';
  }
  if (value.length < 3) {
    return 'Preview URLs must be at least 3 characters long';
  }
  if (value.endsWith('-')) {
    return 'Preview URLs cannot end with a hyphen (-)';
  }
  return true;
}

/**
 * Assert that a user-provided dev domain name (preview URL subdomain) is valid.
 * Unlike the interactive prompt, which reformats invalid input while typing,
 * this throws an error when the name contains invalid characters.
 */
export function assertValidDevDomainName(name: string): void {
  const validationResult = validateDevDomainName(name);
  if (validationResult !== true) {
    throw new Error(validationResult);
  }
  if (formatDevDomainName(name) !== name) {
    throw new Error(
      `Preview URLs can only contain lowercase letters, numbers, and non-consecutive hyphens (-), and cannot start or end with a hyphen: "${name}"`
    );
  }
}

async function promptDevDomainNameAsync(initialDevDomain: string): Promise<string> {
  const rootDomain = `.${EXPO_BASE_DOMAIN}.app`;
  const memoizedFormatDevDomainName = memoize(formatDevDomainName);

  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Choose a preview URL for your project:',
    initial: initialDevDomain,
    validate: validateDevDomainName,
    onState(this: PromptInstance, state: { value?: string }) {
      const value = memoizedFormatDevDomainName(state.value);
      if (value !== state.value) {
        this.value = value;
      }
    },
    onRender(this: PromptInstance, kleur) {
      this.cursorOffset = -rootDomain.length - 1;

      if (this.done) {
        // Remove the space for the cursor when the prompt is done
        this.rendered = this.value + kleur.dim(`${rootDomain}`);
      } else if (this.placeholder) {
        this.rendered = kleur.dim(`${this.initial} ${rootDomain}`);
      } else {
        this.rendered = this.value + kleur.dim(` ${rootDomain}`);
      }
    },
  });

  // This should never happen due to the validation, if it does its an error
  if (!name) {
    throw new Error('No preview URL provided, aborting deployment.');
  }

  return name;
}

/**
 * Assign a dev domain name to a project.
 *   - When a dev domain name is provided, it will assign that name without prompting.
 *   - When running in interactive mode, it will prompt the user with a suggested domain name.
 *   - When running in non interactive mode, it will auto-assign the suggested domain name.
 */
export async function assignDevDomainNameAsync({
  graphqlClient,
  appId,
  devDomainName: requestedDevDomainName,
  nonInteractive,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  devDomainName?: string;
  nonInteractive?: boolean;
}): ReturnType<typeof DeploymentsMutation.assignDevDomainNameAsync> {
  let devDomainName =
    requestedDevDomainName ??
    (await DeploymentsQuery.getSuggestedDevDomainByAppIdAsync(graphqlClient, {
      appId,
    }));

  if (!requestedDevDomainName && !nonInteractive) {
    devDomainName = await promptDevDomainNameAsync(devDomainName);
  }

  try {
    return await DeploymentsMutation.assignDevDomainNameAsync(graphqlClient, {
      appId,
      name: devDomainName,
    });
  } catch (error) {
    const isChosenNameTaken = (error as GraphqlError)?.graphQLErrors?.some(e =>
      ['DEV_DOMAIN_NAME_TAKEN'].includes(e?.extensions?.errorCode as string)
    );

    // Throw unexpected errors eagerly
    if (!isChosenNameTaken) {
      throw error;
    }

    if (nonInteractive) {
      throw new Error(
        requestedDevDomainName
          ? `The preview URL "${requestedDevDomainName}" is already taken, choose a different URL with the --dev-domain flag.`
          : `The suggested preview URL "${devDomainName}" is already taken, choose a different URL with the --dev-domain flag.`
      );
    }

    // In interactive mode, fall back to the prompt so a taken name (requested or suggested)
    // does not abort the deployment.
    Log.error(`The preview URL "${devDomainName}" is already taken, choose a different URL.`);
    return await assignDevDomainNameAsync({ graphqlClient, appId, nonInteractive });
  }
}

export async function assignWorkerDeploymentAliasAsync({
  graphqlClient,
  appId,
  deploymentId,
  aliasName,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  deploymentId: string;
  aliasName: string;
}): ReturnType<typeof DeploymentsMutation.assignAliasAsync> {
  return await DeploymentsMutation.assignAliasAsync(graphqlClient, {
    appId,
    deploymentId,
    aliasName,
  });
}

export async function assignWorkerDeploymentProductionAsync({
  graphqlClient,
  appId,
  deploymentId,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  deploymentId: string;
}): ReturnType<typeof DeploymentsMutation.assignAliasAsync> {
  return await DeploymentsMutation.assignAliasAsync(graphqlClient, {
    appId,
    deploymentId,
    aliasName: null, // this will assign the deployment as production
  });
}

export async function selectWorkerDeploymentOnAppAsync({
  graphqlClient,
  appId,
  selectTitle,
  pageSize,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  selectTitle?: string;
  pageSize?: number;
}): ReturnType<typeof selectPaginatedAsync<WorkerDeploymentFragment>> {
  return await selectPaginatedAsync({
    pageSize: pageSize ?? 25,
    printedType: selectTitle ?? 'worker deployment',
    queryAsync: async queryParams =>
      await DeploymentsQuery.getAllDeploymentsPaginatedAsync(graphqlClient, {
        ...queryParams,
        appId,
      }),
    getTitleAsync: async (deployment: WorkerDeploymentFragment) =>
      chalk`${deployment.deploymentIdentifier}{dim  - created at: ${new Date(
        deployment.createdAt
      ).toLocaleString()}}`,
  });
}

export async function deleteWorkerDeploymentAliasAsync({
  graphqlClient,
  appId,
  aliasName,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  aliasName: string;
}): Promise<{ aliasName?: string; id: string }> {
  return await DeploymentsMutation.deleteAliasAsync(graphqlClient, {
    appId,
    aliasName,
  });
}

export async function selectWorkerDeploymentAliasOnAppAsync({
  graphqlClient,
  appId,
  selectTitle,
  pageSize,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  selectTitle?: string;
  pageSize?: number;
}): ReturnType<typeof selectPaginatedAsync<WorkerDeploymentAliasFragment>> {
  return await selectPaginatedAsync({
    pageSize: pageSize ?? 25,
    printedType: selectTitle ?? 'worker deployment alias',
    queryAsync: async queryParams =>
      await DeploymentsQuery.getAllAliasesPaginatedAsync(graphqlClient, {
        ...queryParams,
        appId,
      }),
    getTitleAsync: async (alias: WorkerDeploymentAliasFragment) =>
      chalk`${alias.aliasName ?? 'production'}{dim  - ${alias.url}}`,
  });
}

export async function deleteWorkerDeploymentAsync({
  graphqlClient,
  appId,
  deploymentIdentifier,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  deploymentIdentifier: string;
}): Promise<{ deploymentIdentifier: string; id: string }> {
  return await DeploymentsMutation.deleteWorkerDeploymentAsync(graphqlClient, {
    appId,
    deploymentIdentifier,
  });
}
