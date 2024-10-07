import gql from 'graphql-tag';

export const EnvironmentVariableWithSecretFragmentNode = gql`
  fragment EnvironmentVariableWithSecretFragment on EnvironmentVariableWithSecret {
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
