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

async function chooseDevDomainNameAsync({
  graphqlClient,
  appId,
  slug,
}: {
  graphqlClient: ExpoGraphqlClient;
  appId: string;
  slug: string;
}): Promise<void> {
  const validationMessage = 'The project does not have a dev domain name.';
  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: 'Choose a dev domain name for your project:',
    validate: value => (value && value.length > 3 ? true : validationMessage),
    initial: slug,
  });

  if (!name) {
    throw new Error('Prompt failed');
  }

  try {
    const success = await DeploymentsMutation.assignDevDomainNameAsync(graphqlClient, {
      appId,
      name,
    });

    if (!success) {
      throw new Error('Failed to assign dev domain name');
    }
  } catch (error: any) {
    const isChosenNameTaken = (error as GraphqlError)?.graphQLErrors?.some(e =>
      ['DEV_DOMAIN_NAME_TAKEN'].includes(e?.extensions?.errorCode as string)
    );

    if (isChosenNameTaken) {
      Log.error(`The entered dev domain name "${name}" is taken. Choose a different name.`);
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
