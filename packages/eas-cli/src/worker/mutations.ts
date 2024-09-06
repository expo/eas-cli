import assert from 'assert';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  AssignDevDomainNameMutation,
  AssignDevDomainNameMutationVariables,
  CreateDeploymentUrlMutation,
  CreateDeploymentUrlMutationVariables,
} from '../graphql/generated';

export const DeploymentsMutation = {
  async createSignedDeploymentUrlAsync(
    graphqlClient: ExpoGraphqlClient,
    deploymentVariables: {
      appId: string;
      deploymentIdentifier?: string | null;
    }
  ): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateDeploymentUrlMutation, CreateDeploymentUrlMutationVariables>(
          gql`
            mutation createDeploymentUrlMutation($appId: ID!, $deploymentIdentifier: ID) {
              deployments {
                createSignedDeploymentUrl(
                  appId: $appId
                  deploymentIdentifier: $deploymentIdentifier
                ) {
                  pendingWorkerDeploymentId
                  deploymentIdentifier
                  url
                }
              }
            }
          `,
          deploymentVariables
        )
        .toPromise()
    );
    const url = data.deployments?.createSignedDeploymentUrl.url;
    assert(url, 'Deployment URL must be defined');
    return url;
  },

  async assignDevDomainNameAsync(
    graphqlClient: ExpoGraphqlClient,
    devDomainNameVariables: { appId: string; name: string }
  ): Promise<boolean> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<AssignDevDomainNameMutation, AssignDevDomainNameMutationVariables>(
          gql`
            mutation AssignDevDomainName($appId: ID!, $name: DevDomainName!) {
              devDomainName {
                assignDevDomainName(appId: $appId, name: $name) {
                  id
                  name
                }
              }
            }
          `,
          devDomainNameVariables
        )
        .toPromise()
    );

    return data.devDomainName.assignDevDomainName.name === devDomainNameVariables.name;
  },
};
