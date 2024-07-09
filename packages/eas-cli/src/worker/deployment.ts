import { ExpoConfig } from '@expo/config-types';
import { CombinedError as GraphqlError } from '@urql/core';

import { DeploymentsMutation } from './mutations';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../log';
import { promptAsync } from '../prompts';

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
