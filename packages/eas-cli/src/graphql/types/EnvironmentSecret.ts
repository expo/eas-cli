import gql from 'graphql-tag';

export const EnvironmentSecretFragmentNode = gql`
  fragment EnvironmentSecretFragment on EnvironmentSecret {
    id
    name
    createdAt
  }
`;
