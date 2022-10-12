import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  StatuspageServiceByServiceNamesQuery,
  StatuspageServiceByServiceNamesQueryVariables,
  StatuspageServiceFragment,
  StatuspageServiceName,
} from '../generated';
import { StatuspageServiceFragmentNode } from '../types/StatuspageService';

export const StatuspageServiceQuery = {
  async statuspageServicesAsync(
    graphqlClient: ExpoGraphqlClient,
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

    return data.statuspageService.byServiceNames;
  },
};
