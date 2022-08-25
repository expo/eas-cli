import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  StatuspageServiceByServiceNamesQuery,
  StatuspageServiceByServiceNamesQueryVariables,
  StatuspageServiceFragment,
  StatuspageServiceName,
} from '../generated';
import { StatuspageServiceFragmentNode } from '../types/StatuspageService';

export const StatuspageServiceQuery = {
  async statuspageServicesAsync(
    serviceNames: StatuspageServiceName[]
  ): Promise<StatuspageServiceFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<StatuspageServiceByServiceNamesQuery, StatuspageServiceByServiceNamesQueryVariables>(
          gql`
            query StatuspageServiceByServiceNamesQuery($serviceNames: [StatuspageServiceName!]!) {
              statuspageService {
                byServiceNames(serviceNames: $serviceNames) {
                  id
                  ...StatuspageServiceFragment
                }
              }
            }
            ${print(StatuspageServiceFragmentNode)}
          `,
          { serviceNames },
          {
            additionalTypenames: ['StatuspageService', 'StatuspageIncident'],
          }
        )
        .toPromise()
    );

    return data.statuspageService.byServiceNames ?? null;
  },
};
