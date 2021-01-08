import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { App } from '../../../../../graphql/generated';
import { AppFragment } from '../../../../../graphql/types/App';

const AppQuery = {
  async byFullNameAsync(fullName: string): Promise<App> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ app: { byFullName: App } }>(
          gql`
            query AppByFullNameQuery($fullName: String!) {
              app {
                byFullName(fullName: $fullName) {
                  ...AppFragment
                }
              }
            }
            ${print(AppFragment)}
          `,
          { fullName }
        )
        .toPromise()
    );

    return data.app.byFullName;
  },
};

export { AppQuery };
