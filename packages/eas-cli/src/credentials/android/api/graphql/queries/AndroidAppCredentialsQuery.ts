import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CommonAndroidAppCredentialsFragment,
  CommonAndroidAppCredentialsWithBuildCredentialsByApplicationIdentifierQuery,
} from '../../../../../graphql/generated';
import { CommonAndroidAppCredentialsFragmentNode } from '../../../../../graphql/types/credentials/AndroidAppCredentials';

export const AndroidAppCredentialsQuery = {
  async withCommonFieldsByApplicationIdentifierAsync(
    graphqlClient: ExpoGraphqlClient,
    projectFullName: string,
    {
      androidApplicationIdentifier,
      legacyOnly,
    }: {
      androidApplicationIdentifier?: string;
      legacyOnly?: boolean;
    }
  ): Promise<CommonAndroidAppCredentialsFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<CommonAndroidAppCredentialsWithBuildCredentialsByApplicationIdentifierQuery>(
          gql`
            query CommonAndroidAppCredentialsWithBuildCredentialsByApplicationIdentifierQuery(
              $projectFullName: String!
              $applicationIdentifier: String
              $legacyOnly: Boolean
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  id
                  androidAppCredentials(
                    filter: {
                      applicationIdentifier: $applicationIdentifier
                      legacyOnly: $legacyOnly
                    }
                  ) {
                    id
                    ...CommonAndroidAppCredentialsFragment
                  }
                }
              }
            }
            ${print(CommonAndroidAppCredentialsFragmentNode)}
          `,
          {
            projectFullName,
            applicationIdentifier: androidApplicationIdentifier,
            legacyOnly,
          },
          {
            additionalTypenames: [
              'AndroidAppCredentials',
              'AndroidAppBuildCredentials',
              'App',
              'AndroidFcm',
            ],
          }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return data.app.byFullName.androidAppCredentials[0] ?? null;
  },
};
