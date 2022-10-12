import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  WebhookByIdQuery,
  WebhookByIdQueryVariables,
  WebhookFilter,
  WebhookFragment,
  WebhooksByAppIdQuery,
  WebhooksByAppIdQueryVariables,
} from '../generated';
import { WebhookFragmentNode } from '../types/Webhook';

export const WebhookQuery = {
  async byAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    webhookFilter?: WebhookFilter
  ): Promise<WebhookFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WebhooksByAppIdQuery, WebhooksByAppIdQueryVariables>(
          gql`
            query WebhooksByAppId($appId: String!, $webhookFilter: WebhookFilter) {
              app {
                byId(appId: $appId) {
                  id
                  webhooks(filter: $webhookFilter) {
                    id
                    ...WebhookFragment
                  }
                }
              }
            }
            ${print(WebhookFragmentNode)}
          `,
          { appId, webhookFilter },
          {
            additionalTypenames: ['Webhook'],
          }
        )
        .toPromise()
    );
    return data.app?.byId.webhooks ?? [];
  },
  async byIdAsync(graphqlClient: ExpoGraphqlClient, webhookId: string): Promise<WebhookFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WebhookByIdQuery, WebhookByIdQueryVariables>(
          gql`
            query WebhookById($webhookId: ID!) {
              webhook {
                byId(id: $webhookId) {
                  id
                  ...WebhookFragment
                }
              }
            }
            ${print(WebhookFragmentNode)}
          `,
          { webhookId },
          {
            additionalTypenames: ['Webhook'],
          }
        )
        .toPromise()
    );
    return data.webhook.byId;
  },
};
