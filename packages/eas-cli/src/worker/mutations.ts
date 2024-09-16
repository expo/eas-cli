import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { WorkerDeploymentFragmentNode } from './fragments/WorkerDeployment';
import { WorkerDeploymentAliasFragmentNode } from './fragments/WorkerDeploymentAlias';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  AssignAliasMutation,
  AssignAliasMutationVariables,
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

  async assignAliasAsync(
    graphqlClient: ExpoGraphqlClient,
    aliasVariables: { appId: string; deploymentId: string; aliasName: string | null }
  ): Promise<AssignAliasMutation['deployments']['assignAlias']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<AssignAliasMutation, AssignAliasMutationVariables>(
          gql`
            mutation AssignAlias(
              $appId: ID!
              $deploymentId: ID!
              $aliasName: WorkerDeploymentIdentifier
            ) {
              deployments {
                assignAlias(
                  appId: $appId
                  deploymentIdentifier: $deploymentId
                  aliasName: $aliasName
                ) {
                  id
                  ...WorkerDeploymentAliasFragment
                  workerDeployment {
                    id
                    ...WorkerDeploymentFragment
                  }
                }
              }
            }

            ${print(WorkerDeploymentFragmentNode)}
            ${print(WorkerDeploymentAliasFragmentNode)}
          `,
          aliasVariables
        )
        .toPromise()
    );

    return data.deployments.assignAlias;
  },
};
