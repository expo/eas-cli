import gql from 'graphql-tag';

export const EnvironmentVariableFragmentNode = gql`
  fragment EnvironmentVariableFragment on EnvironmentVariable {
    id
    name
    value
    environments
    createdAt
    updatedAt
    scope
    visibility
    type
  }
`;
