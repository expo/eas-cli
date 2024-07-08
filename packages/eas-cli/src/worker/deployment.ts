import { ExpoConfig } from '@expo/config-types';
import { CombinedError as GraphqlError } from '@urql/core';

import { DeploymentsMutation } from './mutations';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
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

    const validationMessage = 'The project does not have a dev domain name.';
    const { name } = await promptAsync({
      type: 'text',
      name: 'name',
      message: 'Choose a dev domain name for your project:',
      validate: value => (value && value.length > 3 ? true : validationMessage),
      initial: exp.slug,
    });

    if (!name) {
      throw new Error('Prompt failed');
    }

    // TODO(Kadi): handle the case where the chosen name already exists
    const success = await DeploymentsMutation.assignDevDomainNameAsync(graphqlClient, {
      appId: deploymentVariables.appId,
      name,
    });

    if (!success) {
      throw new Error('Failed to assign dev domain name');
    }

    return await DeploymentsMutation.createSignedDeploymentUrlAsync(
      graphqlClient,
      deploymentVariables
    );
  }
}
