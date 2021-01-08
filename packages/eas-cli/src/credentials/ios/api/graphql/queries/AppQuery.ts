import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { App, AppByFullNameQuery, AppFragment } from '../../../../../graphql/generated';
import { AppFragmentNode } from '../../../../../graphql/types/App';

const AppQuery = {
  async byFullNameAsync(fullName: string): Promise<AppFragment> {
    const data = (await withErrorHandlingAsync(
      graphqlClient
        .query<{ app: { byFullName: App } }>(
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
          { fullName }
        )
        .toPromise()
    )) as AppByFullNameQuery;

    return data.app!.byFullName;
  },
};

export { AppQuery };
