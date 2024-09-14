import { ExpoConfig } from '@expo/config-types';
import { CombinedError as GraphqlError } from '@urql/core';
import chalk from 'chalk';

import { DeploymentsMutation } from './mutations';
import { DeploymentsQuery } from './queries';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { WorkerDeploymentFragment } from '../graphql/generated';
import Log from '../log';
import { promptAsync } from '../prompts';
import { selectPaginatedAsync } from '../utils/relay';
import { EXPO_BASE_DOMAIN } from './utils/logs';
import { memoize } from '../utils/expodash/memoize';

export async function getSignedDeploymentUrlAsync(
  graphqlClient: ExpoGraphqlClient,
  exp: ExpoConfig,
  deploymentVariables: {
    appId: string;
    deploymentIdentifier?: string | null;
  }
): Promise<string> {
  try {
    return await DeploymentsMutation.createSignedDeploymentUrlAsync(
      graphqlClient,
      deploymentVariables
    );
  } catch (error: any) {
    const isMissingDevDomain = (error as GraphqlError)?.graphQLErrors?.some(e =>
      ['APP_NO_DEV_DOMAIN_NAME'].includes(e?.extensions?.errorCode as string)
    );

    if (!isMissingDevDomain) {
      throw error;
    }

    await chooseDevDomainNameAsync({
      graphqlClient,
      appId: deploymentVariables.appId,
      slug: exp.slug,
    });

    return await DeploymentsMutation.createSignedDeploymentUrlAsync(
      graphqlClient,
      deploymentVariables
    );
  }
}

type PromptInstance = {
  cursorOffset: number;
  placeholder: boolean;
  rendered: string;
  initial: string;
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

async function chooseDevDomainNameAsync({
  graphqlClient,
  appId,
  slug,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  slug: string;
}): Promise<void> {
  const rootDomain = `.${EXPO_BASE_DOMAIN}.app`;
  const memoizedFormatDevDomainName = memoize(formatDevDomainName);

  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Choose a URL for your project:',
    initial: slug,
    validate: (value: string) => {
      if (!value) {
        return 'You have to choose a URL for your project';
      }
      if (value.length < 3) {
        return 'Project URLs must be at least 3 characters long';
      }
      if (value.endsWith('-')) {
        return 'Project URLs cannot end with a hyphen (-)';
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

      if (this.placeholder) {
        this.rendered = kleur.dim(`${this.initial} ${rootDomain}`);
      } else {
        this.rendered = this.value + kleur.dim(` ${rootDomain}`);
      }
    },
  });

  if (!name) {
    throw new Error('No project URL provided, aborting deployment.');
  }

  try {
    const success = await DeploymentsMutation.assignDevDomainNameAsync(graphqlClient, {
      appId,
      name,
    });

    if (!success) {
      throw new Error('Failed to assign project URL');
    }
  } catch (error: any) {
    const isChosenNameTaken = (error as GraphqlError)?.graphQLErrors?.some(e =>
      ['DEV_DOMAIN_NAME_TAKEN'].includes(e?.extensions?.errorCode as string)
    );

    if (isChosenNameTaken) {
      Log.error(`The project URL "${name}" is already taken, choose a different name.`);
      await chooseDevDomainNameAsync({ graphqlClient, appId, slug });
    }

    if (!isChosenNameTaken) {
      throw error;
    }
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
