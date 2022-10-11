import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { AppByFullNameQuery, AppByIdQuery, AppFragment } from '../generated';
import { AppFragmentNode } from '../types/App';

export const AppQuery = {
  async byIdAsync(graphqlClient: ExpoGraphqlClient, projectId: string): Promise<AppFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByIdQuery>(
          gql`
            query AppByIdQuery($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  ...AppFragment
                }
              }
            }
            ${print(AppFragmentNode)}
          `,
          { appId: projectId },
          {
            additionalTypenames: ['App'],
          }
        )
        .toPromise()
    );

    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byId;
  },
  async byFullNameAsync(graphqlClient: ExpoGraphqlClient, fullName: string): Promise<AppFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppByFullNameQuery>(
          gql`
            query AppByFullNameQuery($fullName: String!) {
              app {
                byFullName(fullName: $fullName) {
                  id
                  ...AppFragment
                }
              }
            }
            ${print(AppFragmentNode)}
          `,
          { fullName },
          {
            additionalTypenames: ['App'],
          }
        )
        .toPromise()
    );

    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byFullName;
  },
};
