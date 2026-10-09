import type { ExperimentationDefinition } from '@expo/experimentation';
import { OperationResult } from '@urql/core';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EMPTY_EXPERIMENTATION_DEFINITION } from '../../experimentation/ExperimentationClient';
import {
  ExperimentationConfigsQuery,
  ExperimentationConfigsQueryVariables,
  ExperimentationOwnerAccountQuery,
  ExperimentationOwnerAccountQueryVariables,
} from '../generated';

export type ExperimentationConfigsResult = {
  userConfig: ExperimentationDefinition;
  accountConfig: ExperimentationDefinition;
  deviceConfig: ExperimentationDefinition;
};

/** Like `withErrorHandlingAsync`, but never logs. Callers fail open. */
async function quietQueryAsync<T>(promise: Promise<OperationResult<T>>): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('Returned query result data is null!');
  }
  return data;
}

/** The server sends an untyped JSONObject. Anything but the expected shape means no experiments. */
function toExperimentationDefinition(value: unknown): ExperimentationDefinition {
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { experiments?: unknown }).experiments) &&
    Array.isArray((value as { namespaces?: unknown }).namespaces)
  ) {
    return value as ExperimentationDefinition;
  }
  return EMPTY_EXPERIMENTATION_DEFINITION;
}

export const ExperimentationConfigQuery = {
  async getConfigsAsync(graphqlClient: ExpoGraphqlClient): Promise<ExperimentationConfigsResult> {
    const data = await quietQueryAsync(
      graphqlClient
        .query<ExperimentationConfigsQuery, ExperimentationConfigsQueryVariables>(
          gql`
            query ExperimentationConfigs {
              experimentation {
                userConfig
                accountConfig
                deviceConfig
              }
            }
          `,
          {},
          // A failing network must not delay the command.
          { additionalTypenames: ['ExperimentationQuery'], noRetry: true }
        )
        .toPromise()
    );
    return {
      userConfig: toExperimentationDefinition(data.experimentation.userConfig),
      accountConfig: toExperimentationDefinition(data.experimentation.accountConfig),
      deviceConfig: toExperimentationDefinition(data.experimentation.deviceConfig),
    };
  },

  /** Separate from `AppQuery.byIdAsync` so that a failure stays silent. */
  async getOwnerAccountIdForProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string
  ): Promise<string> {
    const data = await quietQueryAsync(
      graphqlClient
        .query<ExperimentationOwnerAccountQuery, ExperimentationOwnerAccountQueryVariables>(
          gql`
            query ExperimentationOwnerAccount($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
                    id
                  }
                }
              }
            }
          `,
          { appId: projectId },
          { additionalTypenames: ['App', 'Account'], noRetry: true }
        )
        .toPromise()
    );
    return data.app.byId.ownerAccount.id;
  },
};
