import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  CreateWebhookMutation,
  CreateWebhookMutationVariables,
  UpdateWebhookMutation,
  UpdateWebhookMutationVariables,
  WebhookFragment,
  WebhookInput,
} from '../generated';
import { WebhookFragmentNode } from '../types/Webhook';

export const WebhookMutation = {
  async createWebhookAsync(appId: string, webhookInput: WebhookInput): Promise<WebhookFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateWebhookMutation, CreateWebhookMutationVariables>(
          gql`
            mutation CreateWebhookMutation($appId: String!, $webhookInput: WebhookInput!) {
              webhook {
                createWebhook(appId: $appId, webhookInput: $webhookInput) {
                  id
                  ...WebhookFragment
                }
              }
            }
            ${print(WebhookFragmentNode)}
          `,
          { appId, webhookInput }
        )
        .toPromise()
    );
    return data.webhook.createWebhook;
  },
  async updateWebhookAsync(
    webhookId: string,
    webhookInput: WebhookInput
  ): Promise<WebhookFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateWebhookMutation, UpdateWebhookMutationVariables>(
          gql`
            mutation UpdateWebhookMutation($webhookId: ID!, $webhookInput: WebhookInput!) {
              webhook {
                updateWebhook(webhookId: $webhookId, webhookInput: $webhookInput) {
                  id
                  ...WebhookFragment
                }
              }
            }
            ${print(WebhookFragmentNode)}
          `,
          { webhookId, webhookInput }
        )
        .toPromise()
    );
    return data.webhook.updateWebhook;
  },
};
