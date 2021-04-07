import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  WebhookFilter,
  WebhookFragment,
  WebhooksByAppIdQuery,
  WebhooksByAppIdQueryVariables,
} from '../generated';
import { WebhookFragmentNode } from '../types/Webhook';

export const WebhookQuery = {
  async byAppIdAsync(appId: string, webhookFilter?: WebhookFilter): Promise<WebhookFragment[]> {
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
          { appId, webhookFilter }
        )
        .toPromise()
    );
    return data.app?.byId.webhooks ?? [];
  },
};
