import gql from 'graphql-tag';

export const RuntimeFragmentNode = gql`
  fragment RuntimeFragment on Runtime {
    id
    version
  }
`;
