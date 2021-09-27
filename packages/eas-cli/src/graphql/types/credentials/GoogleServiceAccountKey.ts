import gql from 'graphql-tag';

export const GoogleServiceAccountKeyFragmentNode = gql`
  fragment GoogleServiceAccountKeyFragment on GoogleServiceAccountKey {
    id
    projectIdentifier
    privateKeyIdentifier
    clientEmail
    clientIdentifier
    createdAt
    updatedAt
  }
`;
