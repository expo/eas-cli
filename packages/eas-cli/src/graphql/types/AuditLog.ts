import gql from 'graphql-tag';

export const AuditLogFragmentNode = gql`
  fragment AuditLogFragment on AuditLog {
    id
    createdAt
    websiteMessage
    targetEntityTypePublicName
    targetEntityMutationType
    actor {
      id
      displayName
    }
  }
`;
