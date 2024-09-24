import { CombinedError as GraphqlError } from '@urql/core';
import chalk from 'chalk';

import { DeploymentsMutation } from './mutations';
import { DeploymentsQuery } from './queries';
import { EXPO_BASE_DOMAIN } from './utils/logs';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { WorkerDeploymentFragment } from '../graphql/generated';
import Log from '../log';
import { promptAsync } from '../prompts';
import { memoize } from '../utils/expodash/memoize';
import { selectPaginatedAsync } from '../utils/relay';

export async function getSignedDeploymentUrlAsync(
  graphqlClient: ExpoGraphqlClient,
  options: {
    appId: string;
    deploymentIdentifier?: string | null;
    /** Callback which is invoked when the project is going to setup the dev domain */
    onSetupDevDomain?: () => any;
    /** If the terminal is running in non interactive mode or not */
    nonInteractive?: boolean;
  }
): Promise<string> {
  try {
    return await DeploymentsMutation.createSignedDeploymentUrlAsync(graphqlClient, {
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
      nonInteractive: options.nonInteractive,
    });
    // Retry creating the signed URL
    return await getSignedDeploymentUrlAsync(graphqlClient, options);
  }
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

async function promptDevDomainNameAsync(initialDevDomain: string): Promise<string> {
  const rootDomain = `.${EXPO_BASE_DOMAIN}.app`;
  const memoizedFormatDevDomainName = memoize(formatDevDomainName);

  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Choose a preview URL for your project:',
    initial: initialDevDomain,
    validate: (value: string) => {
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
    },
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
 *   - When running in interactive mode, it will prompt the user with a suggested domain name.
 *   - When running in non interactive mode, it will auto-assign the suggested domain name.
 */
export async function assignDevDomainNameAsync({
  graphqlClient,
  appId,
  nonInteractive,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  nonInteractive?: boolean;
}): ReturnType<typeof DeploymentsMutation.assignDevDomainNameAsync> {
  let devDomainName = await DeploymentsQuery.getSuggestedDevDomainByAppIdAsync(graphqlClient, {
    appId,
  });

  if (!nonInteractive) {
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

    if (!nonInteractive) {
      Log.error(`The preview URL "${devDomainName}" is already taken, choose a different URL.`);
    }

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
