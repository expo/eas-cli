import assert from 'assert';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';

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
        .mutation<any, any>(
          gql`
            mutation createSignedDeploymentUrl($appId: ID!, $deploymentIdentifier: ID) {
              deployments {
                createSignedDeploymentUrl(appId: $appId, deploymentIdentifier: $deploymentIdentifier) {
                  pendingWorkerDeploymentId
                  deploymentIdentifier
                  url
                }
              }
            }
          `,
          deploymentVariables,
        )
        .toPromise()
    );
    const url = data.deployments?.createSignedDeploymentUrlAsync.url;
    assert(url, 'Deployment URL must be defined');
    return url;
  },
};
