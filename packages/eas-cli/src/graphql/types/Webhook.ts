import gql from 'graphql-tag';

export const WebhookFragmentNode = gql`
  fragment WebhookFragment on Webhook {
    id
    event
    url
    createdAt
    updatedAt
  }
`;
