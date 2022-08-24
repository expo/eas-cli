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
    serviceName: StatuspageServiceName
  ): Promise<StatuspageServiceFragment | null> {
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
          { serviceNames: serviceName },
          {
            additionalTypenames: ['StatuspageService', 'StatuspageIncident'],
          }
        )
        .toPromise()
    );

    return (
      data.statuspageService.byServiceNames.find(service => service.name === serviceName) ?? null
    );
  },
};
